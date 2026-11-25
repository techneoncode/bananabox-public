/** Production adapter for the VS Code API surface used by BananaBox. No VS Code runtime is required. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { matchesAny } from '../../src/codingStyle/glob';
import { notify, request, handle } from './rpc';
import { Disposable, Document, EventEmitter, Position, Range, Selection, TextEdit, Uri, WorkspaceEdit, editedText } from './model';
export * from './model';

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const EndOfLine = { LF: 1, CRLF: 2 };
export const ViewColumn = { Active: -1, Beside: -2 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };
export const TextEditorRevealType = { InCenter: 1, InCenterIfOutsideViewport: 2 };
export const DecorationRangeBehavior = { ClosedClosed: 1, ClosedOpen: 2 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
export const CodeActionKind = { QuickFix: 'quickfix' };
export class Diagnostic { constructor(public range: Range, public message: string, public severity = 0) {} }
export class DiagnosticRelatedInformation { constructor(public location: Location, public message: string) {} }
export class Location { constructor(public uri: Uri, public range: Range) {} }
export class ThemeColor { constructor(public id: string) {} }
export class ThemeIcon { constructor(public id: string) {} }
export class CodeLens { constructor(public range: Range, public command: any) {} }
export class CodeAction { constructor(public title: string, public kind: string) {} }
export class TreeItem { constructor(public label: string, public collapsibleState = 0) {} }
export class MarkdownString {
  constructor(public value = '') {}
  appendText(text: string): this { this.value += text; return this; }
  appendMarkdown(text: string): this { this.value += text; return this; }
  appendCodeblock(code: string, language = ''): this { this.value += '\n```' + language + '\n' + code + '\n```\n'; return this; }
}
export class RelativePattern {
  baseUri: Uri;
  constructor(base: string | Uri | { uri: Uri }, public pattern: string) { this.baseUri = typeof base === 'string' ? Uri.file(base) : base instanceof Uri ? base : base.uri; }
}
export const FileSystemError = { FileNotFound: (uri?: Uri) => Object.assign(new Error(`File not found: ${uri ?? ''}`), { code: 'FileNotFound' }) };

const events = Object.fromEntries(['open', 'change', 'save', 'willSave', 'close', 'active', 'visible', 'configuration', 'folders', 'trust', 'delete', 'rename', 'extensions', 'focus', 'selection', 'terminal'].map(name => [name, new EventEmitter<any>()]));
const documents = new Map<string, Document>();
const editors = new Map<string, Editor>();
const registeredCommands = new Map<string, (...args: any[]) => any>();
const diagnosticCollections = new Set<Map<string, any[]>>();
const contentProviders = new Map<string, any>();
const lensProviders = new Set<any>();
const actionProviders = new Set<any>();
const watchers = new Set<Watcher>();
const views = new Map<string, Webview>();
const trees = new Map<string, any>();
const treeNodes = new Map<string, any>();
const pendingSaves = new Set<Promise<void>>();
let defaults: Record<string, any> = {};
let globalSettings: Record<string, any> = {};
let projectSettings: Record<string, any> = {};
let assetBase = '';
let extensionRoot = '';

class Editor {
  constructor(public document: Document) {}
  private selected = new Selection(0, 0, 0, 0);
  get selection(): Selection { return this.selected; }
  set selection(selection: Selection) { this.selected = selection; notify('editor.select', { uri: this.document.uri, selection }); }
  setSelection(selection: any): void {
    if (selection) this.selected = new Selection(new Position(selection.start.line, selection.start.character), new Position(selection.end.line, selection.end.character));
  }
  revealRange(range: Range): void { notify('editor.reveal', { uri: this.document.uri, range }); }
  setDecorations(type: any, decorations: any[]): void { notify('editor.decorations', { uri: this.document.uri, version: this.document.version, key: type.key, options: type.options, decorations }); }
}

function configuration(section = ''): any {
  const key = (name: string) => section ? `${section}.${name}` : name;
  return {
    get: (name: string, fallback?: any) => projectSettings[key(name)] ?? globalSettings[key(name)] ?? defaults[key(name)] ?? fallback,
    has: (name: string) => key(name) in projectSettings || key(name) in globalSettings || key(name) in defaults,
    inspect: (name: string) => ({ key: key(name), defaultValue: defaults[key(name)], globalValue: globalSettings[key(name)], workspaceValue: projectSettings[key(name)] }),
    update: async (name: string, value: unknown, target = 1) => {
      await request('settings.update', { key: key(name), value: value ?? null, target });
      const settings = target === 1 ? globalSettings : projectSettings;
      if (value === undefined || value === null) delete settings[key(name)]; else settings[key(name)] = value;
      events.configuration.fire({ affectsConfiguration: (query: string) => key(name) === query || key(name).startsWith(query + '.') });
    },
  };
}

class Watcher {
  change = new EventEmitter<Uri>(); create = new EventEmitter<Uri>(); delete = new EventEmitter<Uri>();
  onDidChange = this.change.event; onDidCreate = this.create.event; onDidDelete = this.delete.event;
  constructor(readonly pattern: string | RelativePattern) { watchers.add(this); }
  dispose(): void { watchers.delete(this); this.change.dispose(); this.create.dispose(); this.delete.dispose(); }
  matches(uri: Uri): boolean {
    const root = typeof this.pattern === 'string' ? workspace.workspaceFolders[0]?.uri.fsPath : this.pattern.baseUri.fsPath;
    return !!root && matchesAny([typeof this.pattern === 'string' ? this.pattern : this.pattern.pattern], path.relative(root, uri.fsPath));
  }
}

async function openDocument(value: Uri | string | { content: string; language?: string }): Promise<Document> {
  if (typeof value === 'object' && !(value instanceof Uri)) {
    const doc = new Document(Uri.parse(`untitled:/Bananabox-${randomUUID()}.${value.language === 'diff' ? 'diff' : 'txt'}`), value.content, value.language);
    documents.set(doc.uri.toString(), doc); return doc;
  }
  const uri = typeof value === 'string' ? Uri.file(value) : value;
  const key = uri.toString();
  const cached = documents.get(key);
  if (cached && !cached.isClosed) return cached;
  let text: string;
  if (uri.scheme === 'file') {
    const snapshot = await request('document.read', { uri });
    text = snapshot.text;
    const doc = new Document(uri, text);
    doc.update(text, snapshot.version, snapshot.dirty);
    documents.set(key, doc); events.open.fire(doc); return doc;
  }
  const provider = contentProviders.get(uri.scheme);
  if (!provider) throw new Error(`Unsupported document scheme: ${uri.scheme}`);
  text = await provider.provideTextDocumentContent(uri);
  const doc = new Document(uri, text); documents.set(key, doc); return doc;
}

async function applyEdit(edit: WorkspaceEdit, save = false): Promise<boolean> {
  const changes = [];
  for (const [key, edits] of edit.edits) {
    const doc = await openDocument(Uri.parse(key));
    changes.push({ uri: key, before: doc.getText(), version: doc.version, after: editedText(doc, edits) });
  }
  const snapshots = await request('documents.edit', { changes, save });
  if (!snapshots) return false;
  for (const snapshot of snapshots) updateDocument({ ...snapshot, event: 'change' });
  return true;
}

export const workspace: any = {
  workspaceFolders: [], isTrusted: false,
  get textDocuments() { return [...documents.values()].filter(doc => !doc.isClosed); },
  getConfiguration: configuration,
  getWorkspaceFolder: (uri: Uri) => workspace.workspaceFolders.find((folder: any) => { const rel = path.relative(folder.uri.fsPath, uri.fsPath); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); }),
  asRelativePath: (value: Uri | string) => { const uri = typeof value === 'string' ? Uri.file(value) : value; const folder = workspace.getWorkspaceFolder(uri); return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath; },
  onDidOpenTextDocument: events.open.event, onDidChangeTextDocument: events.change.event,
  onDidSaveTextDocument: events.save.event, onWillSaveTextDocument: events.willSave.event,
  onDidCloseTextDocument: events.close.event, onDidChangeConfiguration: events.configuration.event,
  onDidChangeWorkspaceFolders: events.folders.event, onDidGrantWorkspaceTrust: events.trust.event,
  onDidDeleteFiles: events.delete.event, onDidRenameFiles: events.rename.event,
  createFileSystemWatcher: (pattern: string | RelativePattern) => new Watcher(pattern),
  registerTextDocumentContentProvider: (scheme: string, provider: any) => { contentProviders.set(scheme, provider); return new Disposable(() => contentProviders.delete(scheme)); },
  openTextDocument: openDocument, applyEdit,
  saveAll: async () => {
    if (!await request('documents.save')) return false;
    await Promise.all([...pendingSaves]);
    return !workspace.textDocuments.some((doc: Document) => doc.isDirty);
  },
  updateWorkspaceFolders: (_start: number, _deleteCount: number, ...folders: any[]) => { folders.forEach(folder => void request('project.open', { uri: folder.uri, newWindow: true })); return true; },
  fs: {
    stat: async (uri: Uri) => {
      try { const stat = await fs.stat(uri.fsPath); return { type: stat.isDirectory() ? 2 : 1, ctime: stat.ctimeMs, mtime: stat.mtimeMs, size: stat.size }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw FileSystemError.FileNotFound(uri); throw error; }
    },
    readFile: (uri: Uri) => fs.readFile(uri.fsPath),
    writeFile: async (uri: Uri, bytes: Uint8Array) => { await fs.writeFile(uri.fsPath, bytes); notify('files.refresh', { uri }); },
  },
  findFiles: async (include: string | RelativePattern, exclude?: string, maxResults = Infinity, token?: any) => {
    const roots = typeof include === 'string' ? workspace.workspaceFolders.map((f: any) => f.uri.fsPath) : [include.baseUri.fsPath];
    const pattern = typeof include === 'string' ? include : include.pattern;
    const result: Uri[] = [];
    const walk = async (root: string, dir: string): Promise<void> => {
      if (token?.isCancellationRequested || result.length >= maxResults) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name), rel = path.relative(root, file).split(path.sep).join('/');
        if (exclude && matchesAny([exclude], rel)) continue;
        if (entry.isDirectory() && !['.git', '.idea', 'node_modules'].includes(entry.name) && !(exclude && matchesAny([exclude], rel + '/x'))) await walk(root, file);
        else if (entry.isFile() && matchesAny([pattern], rel)) result.push(Uri.file(file));
        if (token?.isCancellationRequested || result.length >= maxResults) break;
      }
    };
    for (const root of roots) await walk(root, root);
    return result;
  },
};

class Webview {
  options: any = {};
  private source = '';
  private received = new EventEmitter<any>();
  onDidReceiveMessage = this.received.event;
  constructor(readonly id: string) { views.set(id, this); }
  get cspSource(): string { return new URL(assetBase).origin; }
  asWebviewUri(uri: Uri): Uri {
    const rel = path.relative(extensionRoot, uri.fsPath).split(path.sep).join('/');
    if (!rel.startsWith('dist/webview/') && !rel.startsWith('images/')) throw new Error('Resource outside plugin assets');
    return Uri.parse(assetBase + rel.split('/').map(encodeURIComponent).join('/'));
  }
  set html(html: string) { this.source = html; notify('webview.html', { id: this.id, html, base: assetBase }); }
  get html(): string { return this.source; }
  postMessage(message: unknown): Promise<boolean> { notify('webview.message', { id: this.id, message }); return Promise.resolve(true); }
  receive(message: any): void { this.received.fire(message); }
  dispose(): void { views.delete(this.id); this.received.dispose(); }
}
const panels = new Map<string, any>();
function createPanel(_type: string, title: string, _column: unknown, options: any): any {
  const id = randomUUID(), disposed = new EventEmitter<void>();
  const panel: any = { webview: new Webview(id), title, viewColumn: -1, visible: true, onDidDispose: disposed.event,
    reveal: () => notify('webview.reveal', { id, title: panel.title }),
    dispose: () => { if (!panels.has(id)) return; panels.delete(id); disposed.fire(); panel.webview.dispose(); notify('webview.close', { id }); } };
  panel.webview.options = options;
  panels.set(id, panel); notify('webview.create', { id, title }); return panel;
}

function message(level: string, text: string, ...args: any[]): Promise<any> {
  const options = typeof args[0] === 'object' && !('title' in args[0]) ? args.shift() : {};
  return request<number>('dialog.message', { level, text, options, items: args.map(item => typeof item === 'string' ? item : item.title) }).then(index => index == null || index < 0 ? undefined : args[index]);
}
const progressTokens = new Map<string, any>();
export const window: any = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: events.active.event, onDidChangeVisibleTextEditors: events.visible.event, onDidChangeWindowState: events.focus.event,
  onDidChangeTextEditorSelection: events.selection.event,
  // CLion has no integrated terminal: the event exists for the shared code and never fires.
  onDidChangeActiveTerminal: events.terminal.event, terminals: [],
  createOutputChannel: (name: string) => {
    const append = (text: string) => notify('output.append', { name, text });
    return { appendLine: append, append, trace: append, debug: append, info: append, warn: append, error: append,
      show: () => notify('output.show', { name }), clear: () => notify('output.clear', { name }), dispose() {} };
  },
  showInformationMessage: (text: string, ...args: any[]) => message('info', text, ...args),
  showWarningMessage: (text: string, ...args: any[]) => message('warning', text, ...args),
  showErrorMessage: (text: string, ...args: any[]) => message('error', text, ...args),
  showInputBox: async (options: any = {}) => {
    let value = options.value, error: string | undefined;
    for (;;) {
      value = await request('dialog.input', { ...options, value, error });
      if (value === null || value === undefined) return undefined;
      const validation = await options.validateInput?.(value);
      error = typeof validation === 'string' ? validation : validation?.message;
      if (!error) return value;
    }
  },
  showQuickPick: async (items: any[] | Promise<any[]>, options: any = {}) => {
    const choices = await items;
    const indices = await request('dialog.pick', { items: choices.map(item => typeof item === 'string' ? { label: item } : item), options });
    if (indices === null || indices === undefined) return undefined;
    return options.canPickMany ? indices.map((index: number) => choices[index]) : choices[indices[0]];
  },
  showOpenDialog: async (options: any) => (await request<string[] | null>('dialog.open', options))?.map(value => Uri.file(value)),
  showSaveDialog: async (options: any) => { const value = await request('dialog.save', options); return value ? Uri.file(value) : undefined; },
  withProgress: async (options: any, task: any) => {
    const id = randomUUID(), cancelled = new EventEmitter<void>();
    const token = { isCancellationRequested: false, onCancellationRequested: cancelled.event, cancel() { this.isCancellationRequested = true; cancelled.fire(); } };
    progressTokens.set(id, token); notify('progress.start', { id, ...options });
    try { return await task({ report: (value: any) => notify('progress.update', { id, ...value }) }, token); }
    finally { progressTokens.delete(id); cancelled.dispose(); notify('progress.end', { id }); }
  },
  showTextDocument: async (document: Document | Uri, options: any = {}) => {
    const doc = document instanceof Uri ? await openDocument(document) : document;
    await request('editor.open', { uri: doc.uri, text: doc.uri.scheme !== 'file' ? doc.getText() : undefined, selection: options.selection });
    const editor = editors.get(doc.uri.toString()) ?? new Editor(doc); editors.set(doc.uri.toString(), editor); return editor;
  },
  createTextEditorDecorationType: (options: any) => { const key = randomUUID(); return { key, options, dispose: () => notify('editor.clearDecorations', { key }) }; },
  createStatusBarItem: () => {
    const id = randomUUID(); let visible = false;
    const values: any = { text: '', tooltip: '', command: '' };
    const update = () => notify('status', { id, visible, ...values });
    return new Proxy({ show() { visible = true; update(); }, hide() { visible = false; update(); }, dispose() { visible = false; update(); } }, {
      get: (target, key) => (target as any)[key] ?? values[key], set: (_target, key, value) => { values[key] = value; if (visible) update(); return true; },
    });
  },
  registerWebviewViewProvider: (id: string, provider: any) => {
    // The admin dashboard is not offered in CLion: only the sidebar app has a tool window.
    if (id !== 'bananabox.sidebar') return new Disposable(() => undefined);
    const disposed = new EventEmitter<void>();
    provider.resolveWebviewView({ webview: new Webview('sidebar'), visible: true, onDidDispose: disposed.event, onDidChangeVisibility: events.focus.event });
    return new Disposable(() => { disposed.fire(); views.get('sidebar')?.dispose(); });
  },
  createWebviewPanel: createPanel,
  createTreeView: (id: string, options: any) => {
    const provider = options.treeDataProvider;
    trees.set(id, provider);
    const sub = provider.onDidChangeTreeData?.(() => { treeNodes.clear(); notify('tree.refresh', { id }); });
    return new Disposable(() => { sub?.dispose(); trees.delete(id); });
  },
};

export const commands: any = {
  registerCommand: (id: string, callback: (...args: any[]) => any) => { registeredCommands.set(id, callback); return new Disposable(() => registeredCommands.delete(id)); },
  executeCommand: async (id: string, ...args: any[]) => {
    const callback = registeredCommands.get(id);
    if (callback) return callback(...args);
    switch (id) {
      case 'setContext': return notify('context', { key: args[0], value: args[1] });
      case 'vscode.open': return window.showTextDocument(await openDocument(args[0]));
      case 'vscode.openFolder': return request('project.open', { uri: args[0], newWindow: args[1]?.forceNewWindow ?? false });
      case 'vscode.diff': {
        const left = await openDocument(args[0]), right = await openDocument(args[1]);
        return request('editor.diff', { title: args[2], left: left.getText(), right: right.getText(), leftName: left.uri.path, rightName: right.uri.path });
      }
      case 'bananabox.commits.focus': return notify('tree.focus', { id: 'bananabox.commits' });
      case 'workbench.action.reloadWindow': return notify('ide.restart');
      case 'workbench.extensions.uninstallExtension': throw new Error('CLion cannot remove its own plugin: uninstall Bananabox from Settings > Plugins.');
      case 'workbench.action.openSettings': return notify('settings.open', { query: args[0] });
      case 'workbench.actions.view.problems': return notify('problems.show');
      default: throw new Error(`Unsupported CLion command: ${id}`);
    }
  },
};

function refreshLenses(): void {
  for (const editor of window.visibleTextEditors as Editor[]) {
    if (!['c', 'cpp'].includes(editor.document.languageId)) continue;
    const lenses = [...lensProviders].flatMap(provider => provider.provideCodeLenses(editor.document) ?? []);
    notify('editor.lenses', { uri: editor.document.uri, version: editor.document.version, lenses });
  }
}
export const languages: any = {
  createDiagnosticCollection: (name: string) => {
    const values = new Map<string, any[]>();
    diagnosticCollections.add(values);
    return {
      set(uri: Uri, diagnostics: any[]) { values.set(uri.toString(), diagnostics); notify('diagnostics', { name, uri, diagnostics, version: documents.get(uri.toString())?.version }); },
      get: (uri: Uri) => values.get(uri.toString()),
      delete(uri: Uri) { values.delete(uri.toString()); notify('diagnostics', { name, uri, diagnostics: [] }); },
      clear() { values.clear(); notify('diagnostics.clear', { name }); },
      dispose() { diagnosticCollections.delete(values); values.clear(); notify('diagnostics.clear', { name }); },
    };
  },
  getDiagnostics: (uri?: Uri) => {
    const entries = (key: string) => [...diagnosticCollections].flatMap(values => values.get(key) ?? []);
    if (uri) return entries(uri.toString());
    const keys = new Set([...diagnosticCollections].flatMap(values => [...values.keys()]));
    return [...keys].map(key => [Uri.parse(key), entries(key)]);
  },
  registerCodeLensProvider: (_selector: unknown, provider: any) => {
    lensProviders.add(provider); const sub = provider.onDidChangeCodeLenses?.(refreshLenses);
    return new Disposable(() => { sub?.dispose(); lensProviders.delete(provider); });
  },
  registerCodeActionsProvider: (_selector: unknown, provider: any) => { actionProviders.add(provider); return new Disposable(() => actionProviders.delete(provider)); },
};
export const extensions: any = { getExtension: () => undefined, onDidChange: events.extensions.event };
export const env: any = { language: 'en', appName: 'CLion', machineId: createHash('sha256').update(`bananabox-clion:${hostname()}:${homedir()}`).digest('hex'), clipboard: { writeText: (text: string) => request('clipboard', { text }) }, openExternal: (uri: Uri) => request('external.open', { uri }) };
export const authentication: any = { getSession: async (provider: string, _scopes: string[], options: any) => {
  if (provider !== 'github') throw new Error(`Unsupported authentication provider: ${provider}`);
  return await request('github.session', { interactive: !!options.createIfNone }) ?? undefined;
} };

export function updateDocument(snapshot: any): void {
  const uri = Uri.parse(snapshot.uri), key = uri.toString();
  let doc = documents.get(key); const isNew = !doc || doc.isClosed;
  if (isNew) { doc = new Document(uri, snapshot.text); documents.set(key, doc); }
  doc!.update(snapshot.text, snapshot.version, snapshot.dirty);
  if (snapshot.event === 'close') {
    doc!.isClosed = true; events.close.fire(doc); editors.delete(key); documents.delete(key);
  } else {
    if (isNew) events.open.fire(doc);
    if (snapshot.event === 'change') events.change.fire({ document: doc, contentChanges: [{ text: snapshot.text }] });
    if (snapshot.event === 'save') {
      const task = saved(doc!); pendingSaves.add(task);
      void task.catch(error => process.stderr.write(`${error}\n`)).finally(() => pendingSaves.delete(task));
    }
  }
}
async function saved(doc: Document): Promise<void> {
  const version = doc.version, waits: Promise<TextEdit[]>[] = [];
  events.willSave.fire({ document: doc, reason: 1, waitUntil: (value: Promise<TextEdit[]>) => waits.push(value) });
  const edits = (await Promise.all(waits)).flat();
  if (edits.length && doc.version === version && !doc.isClosed) {
    const edit = new WorkspaceEdit(); edit.set(doc.uri, edits); await applyEdit(edit, true);
  }
  events.save.fire(doc);
}

export function configure(init: any, base: string): any {
  extensionRoot = init.extensionRoot; assetBase = base;
  globalSettings = init.globalSettings ?? {}; projectSettings = init.projectSettings ?? {};
  defaults = Object.fromEntries(Object.entries(init.manifest.contributes.configuration.properties).map(([key, value]: [string, any]) => [key, value.default]));
  workspace.workspaceFolders = [{ uri: Uri.file(init.root), name: path.basename(init.root), index: 0 }];
  workspace.isTrusted = !!init.trusted; env.language = init.language || 'en';
  const memento = (scope: string, values: Record<string, any>): any => ({ get: (key: string, fallback: any) => values[key] ?? fallback,
    update: async (key: string, value: any) => { await request('state.update', { scope, key, value: value ?? null }); if (value === undefined) delete values[key]; else values[key] = value; }, keys: () => Object.keys(values) });
  return {
    subscriptions: [], extensionUri: Uri.file(extensionRoot), extensionPath: extensionRoot,
    extension: { packageJSON: init.manifest }, globalStorageUri: Uri.file(init.storage), storageUri: Uri.file(init.storage),
    globalState: memento('global', init.globalState ?? {}), workspaceState: memento('project', init.projectState ?? {}),
    secrets: { get: async (key: string) => (await request('secret.get', { key })) ?? undefined, store: (key: string, value: string) => request('secret.set', { key, value }), delete: (key: string) => request('secret.set', { key, value: null }) },
    asAbsolutePath: (file: string) => path.join(extensionRoot, file),
  };
}

handle('document', updateDocument);
handle('selection', params => {
  const editor = editors.get(Uri.parse(params.uri).toString());
  if (!editor) return;
  editor.setSelection(params.selection);
  events.selection.fire({ textEditor: editor, selections: [editor.selection], kind: undefined });
});
handle('editors', (params: any) => {
  for (const snapshot of params.documents) updateDocument(snapshot);
  window.visibleTextEditors = params.documents.map((snapshot: any) => {
    const key = Uri.parse(snapshot.uri).toString(); const editor = editors.get(key) ?? new Editor(documents.get(key)!);
    editor.setSelection(snapshot.selection); editors.set(key, editor); return editor;
  });
  window.activeTextEditor = params.active ? editors.get(Uri.parse(params.active).toString()) : undefined;
  events.visible.fire(window.visibleTextEditors); events.active.fire(window.activeTextEditor); refreshLenses();
});
handle('command', params => commands.executeCommand(params.id, ...(params.arguments ?? []).map((value: any) => typeof value === 'string' && /^(file|bananabox-commit|banana-correction):/.test(value) ? Uri.parse(value) : value)));
handle('webview', params => views.get(params.id)?.receive(params.message));
handle('webview.closed', params => panels.get(params.id)?.dispose());
handle('progress.cancel', params => progressTokens.get(params.id)?.cancel());
handle('focus', params => events.focus.fire(params));
handle('trust', params => { const previous = workspace.isTrusted; workspace.isTrusted = !!params.trusted; if (!previous && workspace.isTrusted) events.trust.fire({}); });
handle('settings.changed', params => { globalSettings = params.global; projectSettings = params.project; events.configuration.fire({ affectsConfiguration: () => true }); });
handle('files', params => {
  for (const entry of params.entries) {
    const uri = Uri.file(entry.path);
    for (const watcher of watchers) if (watcher.matches(uri)) (entry.kind === 'delete' ? watcher.delete : entry.kind === 'create' ? watcher.create : watcher.change).fire(uri);
    if (entry.kind === 'delete') events.delete.fire({ files: [uri] });
  }
});
handle('tree.children', async params => {
  const provider = trees.get(params.id); if (!provider) return [];
  const nodes = await provider.getChildren(params.node ? treeNodes.get(params.node) : undefined);
  return nodes.map((node: any) => { const id = randomUUID(); treeNodes.set(id, node); return { id, ...provider.getTreeItem(node) }; });
});
handle('codeActions', async params => {
  const doc = await openDocument(Uri.parse(params.uri));
  const range = new Range(params.line, 0, params.line, doc.lineAt(params.line).text.length);
  const actions = [...actionProviders].flatMap(provider => provider.provideCodeActions(doc, range, { diagnostics: params.diagnostics }));
  const picked = await window.showQuickPick(actions.map((action: any) => ({ label: action.title, action })), { title: 'Bananabox · Quick fixes' });
  return picked ? applyEdit(picked.action.edit) : false;
});
