// Drives dist/loader.js against a fake `vscode` API: two installed versions side by side, then a hot swap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const commands = new Map();
const viewProviders = new Map();
const disposable = (fn = () => {}) => ({ dispose: fn });
const listeners = new Set();
const event = () => (fn) => { listeners.add(fn); return disposable(() => listeners.delete(fn)); };
const fakeView = () => ({
  webview: { html: '', options: {}, onDidReceiveMessage: event(), postMessage() {} },
  onDidDispose: event(),
  onDidChangeVisibility: event(),
  visible: true,
});
// Frozen like VS Code's own API and extension context: wrappers must not trip over frozen properties.
class Uri { constructor(p) { this.fsPath = p; this.scheme = 'file'; } static file(p) { return new Uri(p); } }
const vscode = {
  Uri,
  Disposable: class { constructor(fn) { this.dispose = fn; } },
  CancellationTokenSource: class { token = { isCancellationRequested: false }; },
  commands: { registerCommand: (id, fn) => { assert.ok(!commands.has(id), `${id} registered twice`); commands.set(id, fn); return disposable(() => commands.delete(id)); } },
  window: {
    registerWebviewViewProvider: (type, provider) => {
      assert.ok(!viewProviders.has(type), `${type} provider registered twice`);
      viewProviders.set(type, provider);
      return disposable(() => viewProviders.delete(type));
    },
  },
};
Object.freeze(vscode.window);
Object.freeze(vscode);

// Each fake version registers a command and the sidebar view, and says which version answered.
const bundle = (version) => `
const vscode = globalThis[Symbol.for('techneoncode.bananabox.vscode')];
exports.activate = (context) => {
  if (!(vscode.Uri.file('/x') instanceof vscode.Uri)) throw new Error('vscode classes lost their identity');
  if (context.asAbsolutePath('a') !== require('node:path').join(context.extensionPath, 'a')) throw new Error('asAbsolutePath');
  context.subscriptions.push(
    vscode.commands.registerCommand('bananabox.version', () => '${version}@' + context.extension.packageJSON.version + '@' + context.extensionPath),
    vscode.window.registerWebviewViewProvider('bananabox.sidebar', { resolveWebviewView(view) {
      view.webview.html = 'v${version}';
      view.webview.onDidReceiveMessage(() => { globalThis.__answers.push('${version}'); });
    } }),
  );
};
exports.deactivate = () => { globalThis.__deactivated.push('${version}'); };
`;

function install(dir, version) {
  const root = path.join(dir, `techneoncode.bananabox-${version}`);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ publisher: 'techneoncode', name: 'bananabox', version, main: './dist/loader.js', contributes: { commands: [] } }));
  fs.writeFileSync(path.join(root, 'dist', 'extension.js'), bundle(version));
  return root;
}

test('the loader swaps Bananabox for a newer installed version without restarting VS Code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-loader-'));
  const v1 = install(dir, '2.1.0');
  install(dir, '2.2.0');
  globalThis.__answers = [];
  globalThis.__deactivated = [];
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : original.call(this, request, ...rest); };
  try {
    const loader = require(path.resolve('dist/loader.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(v1, 'package.json'), 'utf8'));
    const subscriptions = [];
    await loader.activate(Object.freeze({
      subscriptions, extensionPath: v1, extensionUri: vscode.Uri.file(v1),
      asAbsolutePath: (p) => path.join(v1, p),
      extension: Object.freeze({ id: 'techneoncode.bananabox', packageJSON: manifest }),
    }));
    assert.equal(commands.get('bananabox.version')(), `2.1.0@2.1.0@${v1}`);

    // VS Code shows the sidebar once, with the provider the loader registered.
    const view = fakeView();
    await viewProviders.get('bananabox.sidebar').resolveWebviewView(view, { state: undefined }, {});
    assert.equal(view.webview.html, 'v2.1.0');

    const handle = globalThis[Symbol.for('techneoncode.bananabox.loader')];
    assert.equal(handle.swappable('9.9.9'), undefined);
    const v2 = handle.swappable('2.2.0');
    assert.ok(v2);
    await handle.swap(v2);

    assert.deepEqual(globalThis.__deactivated, ['2.1.0']);
    assert.equal(commands.get('bananabox.version')(), `2.2.0@2.2.0@${v2}`);
    assert.equal(view.webview.html, 'v2.2.0', 'the open sidebar shows the new version without VS Code resolving it again');
    [...listeners].forEach((fn) => fn({}));
    assert.deepEqual(globalThis.__answers, ['2.2.0'], 'messages reach only the new version');
    assert.equal(viewProviders.size, 1, 'VS Code keeps one provider registration');
  } finally {
    Module._load = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

