import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { CommitExplorer } from '../git/commitExplorer';
import { normalizeProject } from '../domain/projects';

const sha = 'a'.repeat(40), blob = 'b'.repeat(40);
const project = normalizeProject({ id: 1, name: 'Project', repoLink: 'https://github.com/school/project' }, 'https://my.epitech.eu');

test('remote explorer reuses the VS Code session, lazily reads blobs, and keeps tokens out of document URIs', async () => {
  const calls: string[] = [];
  const sessions: any[] = [];
  const savedFetch = globalThis.fetch;
  Object.assign(vscode.window, { createTreeView: () => ({ dispose() {} }), showQuickPick: async () => ({ id: 'explore' }), showInformationMessage: () => undefined });
  Object.assign(vscode.commands, { registerCommand: () => ({ dispose() {} }) });
  Object.assign(vscode.workspace, { registerTextDocumentContentProvider: () => ({ dispose() {} }) });
  Object.assign(vscode.Uri, { from: (parts: any) => ({ ...parts, toString: () => `${parts.scheme}://${parts.authority}${parts.path}?${parts.query}` }) });
  Object.assign(vscode.authentication, { getSession: async (...args: any[]) => {
    sessions.push(args);
    return { accessToken: 'secret-test-token', account: { label: 'student' } };
  } });
  let fail = false;
  let failureHeaders: Record<string, string> = {};
  let binary = false;
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    calls.push(input);
    assert.equal((init.headers as any).Authorization, 'Bearer secret-test-token');
    assert.ok(input.startsWith('https://api.github.com/repos/school/project/git/'));
    if (fail) return new Response('{}', { status: 403, headers: failureHeaders });
    return new Response(JSON.stringify(input.includes('/trees/')
      ? { tree: [{ path: 'file.ts', sha: blob, type: 'blob', size: 4 }], truncated: false }
      : { encoding: 'base64', content: Buffer.from(binary ? '\0abc' : 'old\n').toString('base64') }));
  }) as typeof fetch;
  const explorer = new CommitExplorer();
  try {
    await explorer.open(project, sha);
    assert.equal(calls.length, 1);
    const [root] = await explorer.getChildren();
    const [file] = await explorer.getChildren(root);
    assert.equal(calls.length, 1, 'directory reads are cached');
    const item = explorer.getTreeItem(file);
    assert.equal(item.command?.command, 'bananabox.compareCommitFile');
    const uri = item.resourceUri!;
    assert.ok(!uri.toString().includes('secret-test-token'));
    assert.equal(await explorer.provideTextDocumentContent(uri), 'old\n');
    assert.ok(sessions.some(args => args[0] === 'github' && args[2].createIfNone));
    const commands: any[][] = [];
    Object.assign(vscode.commands, { executeCommand: async (...args: any[]) => { commands.push(args); } });
    await explorer.compareFile(uri);
    assert.equal(commands.pop()?.[0], 'vscode.open', 'without a local repo, open the historical file');
    file.snapshot.localFolder = '/tmp/bananabox-diff';
    Object.assign(vscode.workspace, { textDocuments: [], fs: { stat: async () => ({ type: 1 }) } });
    await explorer.compareFile(uri);
    let diff = commands.pop()!;
    assert.equal(diff[0], 'vscode.diff');
    assert.equal(diff[1].fsPath, '/tmp/bananabox-diff/file.ts', 'current local file is on the left');
    assert.equal(diff[2], uri, 'historical file is on the right');
    Object.assign(vscode.workspace, { fs: { stat: async () => { throw Object.assign(new Error(), { code: 'FileNotFound' }); } } });
    await explorer.compareFile(uri);
    diff = commands.pop()!;
    assert.equal(await explorer.provideTextDocumentContent(diff[1]), '', 'deleted local file has an empty left side');
    Object.assign(vscode.workspace, { textDocuments: [{ uri: vscode.Uri.file('/tmp/bananabox-diff/file.ts') }] });
    await explorer.compareFile(uri);
    assert.equal(commands.pop()![1].scheme, 'file', 'open unsaved document remains the left side');
    binary = true;
    await assert.rejects(explorer.provideTextDocumentContent(uri), /binary/);
    fail = true;
    await assert.rejects(explorer.open(project, sha), /403/);
    failureHeaders = { 'x-github-sso': 'required' };
    await assert.rejects(explorer.open(project, sha), /SSO/);
    failureHeaders = { 'x-ratelimit-remaining': '0' };
    await assert.rejects(explorer.open(project, sha), /rate limit/);

    assert.equal((await explorer.getChildren())[0].snapshot, root.snapshot, 'failed opens preserve the previous snapshot');
  } finally { explorer.dispose(); globalThis.fetch = savedFetch; }
});
