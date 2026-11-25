import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const extensionRoot = path.resolve('clion/build/plugin/bananabox/host');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));

async function launch(t, trusted = true, setup = async () => ({}), entry = path.join(extensionRoot, 'main.cjs')) {
  const root = await mkdtemp(path.join(tmpdir(), 'bananabox-clion-test-'));
  const file = path.join(root, 'main.c'), uri = pathToFileURL(file).href;
  const text = 'int main(void)\n{\n    return 0;  \n}\n';
  await writeFile(file, text);
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, stderr = '';
  const pending = new Map(), calls = [], waiters = [];
  let document = { uri, text, version: 1, dirty: false };
  const replies = new Map([
    ['secret.get', () => null], ['secret.set', () => null],
    ['dialog.message', () => null], ['dialog.input', () => null], ['dialog.open', () => null], ['dialog.save', () => null], ['dialog.pick', () => null],
    ['settings.update', () => null], ['state.update', () => null], ['github.session', () => null],
    ['document.read', () => document], ['editor.open', () => true], ['documents.save', () => true],
    ['documents.edit', params => {
      if (params.changes.some(change => change.before !== document.text || change.version !== document.version)) return null;
      document = { ...document, text: params.changes[0].after, version: document.version + 1, dirty: !params.save };
      return [document];
    }],
  ]);
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}; stderr: ${stderr}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer }); send({ id, method, params });
  });
  const wait = (predicate, timeout = 10_000) => {
    const existing = calls.find(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const item = { predicate, resolve, reject, timer: setTimeout(() => reject(new Error(`Expected host event not received; stderr: ${stderr}`)), timeout) }; waiters.push(item);
    });
  };
  child.stderr.on('data', data => stderr += data.toString());
  const input = createInterface({ input: child.stdout });
  input.on('line', line => {
    const message = JSON.parse(line);
    if (!message.method) {
      const task = pending.get(message.id); if (!task) return;
      pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.reject(new Error(message.error)); else task.resolve(message.result); return;
    }
    calls.push(message);
    for (const waiter of [...waiters]) if (waiter.predicate(message)) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    if (message.id !== undefined) {
      const fn = replies.get(message.method);
      if (!fn) { send({ id: message.id, error: `Unexpected native request: ${message.method}` }); return; }
      Promise.resolve(fn(message.params)).then(result => send({ id: message.id, result }));
    }
  });
  t.after(async () => {
    for (const waiter of waiters) clearTimeout(waiter.timer);
    for (const task of pending.values()) clearTimeout(task.timer);
    if (child.exitCode === null) { await request('shutdown').catch(() => {}); await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 1500).unref(); }); }
    input.close(); await rm(root, { recursive: true, force: true });
  });
  const settings = { 'bananalens.compiler': path.resolve('test/codingStyle/fake-epiclang.sh'), 'bananalens.makeDryRun': false, 'bananalens.corrections.mode': 'off', ...await setup(root) };
  await request('initialize', { root, extensionRoot, storage: root, manifest, trusted, language: 'fr', globalState: {}, projectState: {}, globalSettings: settings, projectSettings: {} });
  const update = async patch => { document = { ...document, ...patch }; return request('document', document); };
  return { root, uri, text, child, request, wait, calls, replies, document: () => document, update, settings, stderr: () => stderr };
}

test('real extension boots in CLion host, serves original UI and does not expose workspace files', async t => {
  const host = await launch(t);
  const html = await host.wait(call => call.method === 'webview.html' && call.params.id === 'sidebar');
  assert.match(html.params.html, /Content-Security-Policy/);
  assert.match(html.params.html, /data-pdf-worker/);
  await host.request('webview', { id: 'sidebar', message: { type: 'ready', surface: 'sidebar' } });
  const state = await host.wait(call => call.method === 'webview.message' && call.params.message.type === 'state' && call.params.message.state.lang);
    assert.equal(state.params.message.state.lang, 'fr');
  const js = await fetch(html.params.base + 'dist/webview/main.js'); assert.equal(js.status, 200);
  assert.equal(await js.text(), await readFile(extensionRoot + '/dist/webview/main.js', 'utf8'));
  assert.equal((await fetch(html.params.base + 'main.c')).status, 404);
  assert.equal((await fetch(html.params.base + 'package.json')).status, 404);
  assert.equal((await fetch(html.params.base + 'dist/webview/..%2f..%2fpackage.json')).status, 403);
  assert.equal((await fetch(new URL('/dist/webview/main.js', html.params.base))).status, 404);
  const page = await host.request('webview.content', { id: 'sidebar', html: html.params.html });
  const response = await fetch(page); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(await response.text(), html.params.html);
  await host.request('webview.removeContent', { id: 'sidebar' });
  assert.equal((await fetch(page)).status, 404);
  assert.equal(host.stderr(), '');
});

test('editor snapshot invokes shared epiclang, diagnostics, lenses, quick fixes and setting changes', async t => {
  const host = await launch(t);
  await host.request('editors', { documents: [host.document()], active: host.uri });
  await host.request('command', { id: 'bananabox.codingStyle.run' });
  const diagnostic = await host.wait(call => call.method === 'diagnostics' && call.params.diagnostics.length > 0);
  assert.equal(diagnostic.params.uri, host.uri);
  assert.equal(diagnostic.params.diagnostics[0].code, 'C-C1');
  assert.equal(diagnostic.params.diagnostics[0].range.start.line, 2);
  await host.wait(call => call.method === 'editor.decorations' && call.params.decorations.some(value => value.renderOptions?.after?.contentText?.includes('C-C1')));
  await host.wait(call => call.method === 'editor.lenses' && call.params.lenses.length > 0);
  await host.request('command', { id: 'bananabox.codingStyle.fixTrailingWhitespace' });
  assert.equal(host.document().text, 'int main(void)\n{\n    return 0;\n}\n');
  assert.equal(host.document().dirty, true, 'accepting an edit leaves it undoable and unsaved');
  await host.request('command', { id: 'bananabox.codingStyle.toggle' });
  await host.wait(call => call.method === 'settings.update' && call.params.key === 'bananalens.enabled' && call.params.value === false);
  assert.equal(host.stderr(), '');
});

test('untrusted project never starts epiclang or local preflight', async t => {
  const host = await launch(t, false);
  await host.request('editors', { documents: [host.document()], active: host.uri });
  await host.request('command', { id: 'bananabox.codingStyle.run' });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(host.calls.some(call => call.method === 'diagnostics' && call.params.diagnostics.length > 0), false);
  await host.request('trust', { trusted: true });
  await host.request('command', { id: 'bananabox.codingStyle.run' });
  await host.wait(call => call.method === 'diagnostics' && call.params.diagnostics.length > 0);
});

test('appearance uses the existing screen and preserves workspace scope', async t => {
  const host = await launch(t);
  await host.request('command', { id: 'bananabox.codingStyle.configureAppearance' });
  const appearance = await host.wait(call => call.method === 'webview.html' && call.params.id !== 'sidebar');
  assert.match(appearance.params.html, /Choisissez ce qui reste visible/);
  const id = appearance.params.id;
  await host.request('webview', { id, message: { type: 'ready', scope: 'workspace' } });
  await host.wait(call => call.method === 'webview.message' && call.params.id === id && call.params.message.type === 'settings');
  await host.request('webview', { id, message: { type: 'apply', values: { 'inline.mode': 'compact' } } });
  await host.wait(call => call.method === 'settings.update' && call.params.key === 'bananalens.inline.mode' && call.params.value === 'compact' && call.params.target === 2);
});

test('suggested corrections preview, become stale on typing and automatic corrections save through native edits', async t => {
  const host = await launch(t, true, async root => {
    const compiler = path.join(root, 'epiclang-clean.cjs'), formatter = path.join(root, 'clang-format.cjs');
    await writeFile(compiler, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o755 });
    await writeFile(formatter, '#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("clang-format version 21.1.0");process.exit(0)}let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(s.replace(/[ \\t]+$/gm,"")));\n', { mode: 0o755 });
    return { 'bananalens.compiler': compiler, 'bananalens.corrections.clangFormat': formatter, 'bananalens.corrections.mode': 'suggest' };
  });
  await host.request('editors', { documents: [host.document()], active: host.uri });
  await host.update({ event: 'save' });
  await host.wait(call => call.method === 'context' && call.params.key === 'bananabox.codingStyle.hasCorrections' && call.params.value === true);
  let diff;
  host.replies.set('editor.diff', params => { diff = params; return null; });
  await host.request('command', { id: 'bananabox.codingStyle.previewCorrections' });
  assert.equal(diff.left, host.text);
  assert.match(diff.right, /EPITECH PROJECT/);
  assert.equal(host.calls.some(call => call.method === 'documents.edit'), false, 'preview does not change source code');
  await host.update({ text: host.text.replace('return 0;', 'return 1;'), version: 2, dirty: true, event: 'change' });
  await host.request('command', { id: 'bananabox.codingStyle.acceptCorrections' });
  assert.equal(host.calls.some(call => call.method === 'documents.edit'), false, 'typing invalidates the proposal');
  await host.request('settings.changed', { global: { ...host.settings, 'bananalens.corrections.mode': 'onSave' }, project: {} });
  await host.update({ dirty: false, event: 'save' });
  await host.wait(call => call.method === 'documents.edit' && call.params.save === true);
  await host.wait(call => call.method === 'diagnostics' && call.params.version === 3);
  assert.match(host.document().text, /return 1;/);
  assert.match(host.document().text, /EPITECH PROJECT/);
  assert.equal(host.document().dirty, false);
  assert.equal(host.stderr(), '');
});


test('CLion commit tree opens the historical file and compares it without changing the checkout', async t => {
  const host = await launch(t, true, async () => ({}), path.resolve('clion/build/tests/commitHost.js'));
  const git = (...args) => execFileSync('git', args, { cwd: host.root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('remote', 'add', 'origin', 'https://github.com/school/commit-test');
  git('add', 'main.c');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Historical content');
  const sha = git('rev-parse', 'HEAD');
  const current = host.text.replace('return 0', 'return 1');
  await writeFile(path.join(host.root, 'main.c'), current);
  host.replies.set('document.read', () => ({ uri: host.uri, text: current, version: 1, dirty: false }));
  host.replies.set('dialog.pick', () => [1]);
  host.replies.set('editor.diff', () => true);
  await host.request('test.openCommit', { repo: 'https://github.com/school/commit-test', sha });
  const [root] = await host.request('tree.children', { id: 'bananabox.commits' });
  assert.equal(root.collapsibleState, 2);
  const [file] = await host.request('tree.children', { id: 'bananabox.commits', node: root.id });
  await host.request('command', { id: 'vscode.open', arguments: [file.resourceUri] });
  const opened = await host.wait(call => call.method === 'editor.open');
  assert.equal(opened.params.text, host.text);
  assert.match(opened.params.uri, /^bananabox-commit:/);
  await host.request('command', { id: file.command.command, arguments: file.command.arguments });
  const diff = await host.wait(call => call.method === 'editor.diff');
  assert.equal(diff.params.left, current);
  assert.equal(diff.params.right, host.text);
  assert.equal(await readFile(path.join(host.root, 'main.c'), 'utf8'), current);
  assert.equal(git('rev-parse', 'HEAD'), sha);
});
