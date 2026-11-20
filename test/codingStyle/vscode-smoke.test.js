// Loads the real extension against a minimal fake `vscode` API and drives one lint end to end.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const registered = {};
const diagSets = [];
const decorations = [];
const codeLensProviders = [];
const listeners = {};
const event = name => fn => {
    (listeners[name] ??= new Set()).add(fn);
    return { dispose: () => listeners[name].delete(fn) };
};
const fire = (name, value) => [...(listeners[name] ?? [])].forEach(fn => fn(value));
const noop = () => {};
const disposable = () => ({ dispose: noop });
class Emitter { constructor() { this.event = () => disposable(); } fire() {} dispose() {} }
class Position { constructor(l, c) { this.line = l; this.character = c; } isAfter(o) { return this.line > o.line || (this.line === o.line && this.character > o.character); } isBefore(o) { return o.isAfter(this); } compareTo(o) { return this.isBefore(o) ? -1 : this.isAfter(o) ? 1 : 0; } }
class Range { constructor(a, b, c, d) { if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } }
const state = { docs: [], active: undefined, collection: new Map() };

const vscode = {
    EventEmitter: Emitter,
    ThemeColor: class { constructor(id) { this.id = id; } },
    Position, Range,
    Selection: class extends Range { constructor(...args) { super(...args); this.anchor = this.start; this.active = this.end; this.isEmpty = this.start.line === this.end.line && this.start.character === this.end.character; } },
    CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } },
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticRelatedInformation: class {},
    Location: class {},
    MarkdownString: class { value = ''; appendMarkdown(text) { this.value += text; return this; } appendText(text) { this.value += text; return this; } appendCodeblock(code, lang) { this.value += '\n' + lang + '\n' + code + '\n'; return this; } },
    EndOfLine: { LF: 1, CRLF: 2 },
    ViewColumn: { Active: -1 },
    TextEdit: { replace: (range, newText) => ({ range, newText }), setEndOfLine: newEol => ({ newEol }) },
    WorkspaceEdit: class { delete() {} set(uri, edits) { this.uri = uri; this.edits = edits; } replace(uri, range, newText) { this.uri = uri; (this.edits ??= []).push({ range, newText }); } },
    Uri: { file: (p) => ({ fsPath: p, scheme: 'file', toString: () => `file://${p}` }), parse: (s) => ({ s }) },
    RelativePattern: class {},
    CodeActionKind: { QuickFix: 'quickfix' },
    StatusBarAlignment: { Left: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DecorationRangeBehavior: { ClosedClosed: 1, ClosedOpen: 3 },
    ConfigurationTarget: { Global: 1 },
    ProgressLocation: { Notification: 15 },
    TextEditorRevealType: { InCenter: 2, InCenterIfOutsideViewport: 3 },
    commands: { registerCommand: (name, fn) => { registered[name] = fn; return disposable(); }, executeCommand: noop },
    extensions: { getExtension: () => undefined, onDidChange: () => disposable() },
    languages: {
        createDiagnosticCollection: () => ({
            set: (uri, d) => { diagSets.push([uri.fsPath, d]); state.collection.set(uri.fsPath, d); },
            get: (uri) => state.collection.get(uri.fsPath), delete: (uri) => state.collection.delete(uri.fsPath),
            clear: () => state.collection.clear(), dispose: noop,
        }),
        registerCodeLensProvider: (_s, p) => { codeLensProviders.push(p); return disposable(); },
        registerCodeActionsProvider: () => disposable(),
    },
    window: {
        createOutputChannel: () => ({ appendLine: noop, show: noop, dispose: noop }),
        createStatusBarItem: () => ({ show: noop, hide: noop, dispose: noop }),
        createTextEditorDecorationType: () => ({ dispose: noop }),
        showWarningMessage: async () => undefined, showErrorMessage: async () => undefined, showInformationMessage: async () => undefined,
        onDidChangeActiveTextEditor: event('active'), onDidChangeVisibleTextEditors: event('visible'), onDidChangeTextEditorSelection: event('selection'),
        get visibleTextEditors() { return state.active ? [state.active] : []; },
        get activeTextEditor() { return state.active; },
    },
    workspace: {
        isTrusted: true,
        getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }),
        get textDocuments() { return state.docs; },
        getWorkspaceFolder: () => ({ uri: { fsPath: state.root } }),
        asRelativePath: (u) => path.relative(state.root, u.fsPath),
        registerTextDocumentContentProvider: () => disposable(),
        onWillSaveTextDocument: event('willSave'), onDidCloseTextDocument: event('close'),
        onDidSaveTextDocument: event('save'), onDidOpenTextDocument: event('open'), onDidChangeTextDocument: event('change'),
        onDidChangeConfiguration: event('config'), onDidGrantWorkspaceTrust: () => disposable(),
        onDidDeleteFiles: () => disposable(), onDidRenameFiles: () => disposable(),
        createFileSystemWatcher: () => ({ onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable, dispose: noop }),
    },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return request === 'vscode' ? 'vscode' : origResolve.call(this, request, ...rest); };
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };

test('extension activates, lints a document and publishes underlined diagnostics', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-smoke-'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'src'));
    const file = path.join(root, 'src/main.c');
    const text = '/*\n** EPITECH PROJECT, 2026\n*/\n\n    while (x) {\n}\n';
    fs.writeFileSync(file, text);
    state.root = root;
    const lines = text.split('\n');
    const doc = {
        uri: vscode.Uri.file(file), languageId: 'c', isUntitled: false, isDirty: false, lineCount: lines.length,
        getText: () => text, lineAt: (i) => ({ text: lines[i], lineNumber: i, range: new Range(i, 0, i, lines[i].length) }),
    };
    state.docs = [doc];
    state.active = { document: doc, setDecorations: (t, o) => decorations.push(o.length), selection: { active: new Position(0, 0) }, revealRange: noop };

    // fake epiclang reports line 3 col 5 with a 9-char range; we point it at line 5 of this file instead
    const script = path.join(root, 'epiclang');
    fs.writeFileSync(script, `#!/bin/sh\nfor last; do :; done\necho "$last:5:5: warning: [Banana] [Major] nested while statement at depth 3 (C-C1)" >&2\necho "   5 |     while (x) {" >&2\necho "     |     ^~~~~~~~~" >&2\n`, { mode: 0o755 });
    const getConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = () => ({ get: (k, d) => (k === 'compiler' ? script : d), update: async () => {} });

    const ext = require('../../dist-test/codingStyle/extension.js');
    const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(root, 'storage') } };
    const api = ext.activate(context);
    assert.ok(registered['bananabox.codingStyle.run'] && registered['bananabox.codingStyle.runWorkspace'] && registered['bananabox.codingStyle.showIssues']);

    await registered['bananabox.codingStyle.run']();
    const [, published] = diagSets.at(-1);
    assert.equal(published.length, 1);
    assert.equal(published[0].message, '[Major] nested while statement at depth 3');
    assert.equal(published[0].source, 'Banana');
    assert.equal(published[0].code, 'C-C1');
    assert.equal(published[0].severity, 0);
    assert.deepEqual([published[0].range.start.line, published[0].range.start.character, published[0].range.end.character], [4, 4, 13]);

    // recap CodeLens sits right after the header (line 3) and reports the finding
    const lenses = codeLensProviders.flatMap(p => p.provideCodeLenses(doc));
    assert.equal(lenses[0].range.start.line, 3);
    assert.equal(lenses[0].command.title, 'Bananabox Coding Style');
    assert.match(lenses[0].command.tooltip, /1 major/);
    assert.equal(lenses[0].command.command, 'bananabox.codingStyle.showIssues');
    assert.ok(lenses.some((l) => /Recheck/.test(l.command.title)));

    // A whole-project scan returns fresh findings even while an editor owns diagnostics.
    const findFiles = vscode.workspace.findFiles;
    vscode.workspace.findFiles = async () => [doc.uri];
    const scan = await api.scanProject(root);
    assert.equal(scan.files, 1);
    assert.equal(scan.summary.major, 1);
    assert.equal(scan.issues[0].file, file);
    const abort = new AbortController();
    abort.abort();
    assert.equal((await api.scanProject(root, { signal: abort.signal })).cancelled, true);
    fs.writeFileSync(script, '#!/bin/sh\necho "compiler crashed" >&2\nexit 2\n', { mode: 0o755 });
    const failed = await api.scanProject(root);
    assert.match(failed.error.message, /compiler crashed/);
    assert.equal(failed.summary.major, 0, 'do not reuse the previous successful findings');
    vscode.workspace.findFiles = findFiles;

    context.subscriptions.forEach((s) => s.dispose?.());
    vscode.workspace.getConfiguration = getConfiguration;
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function mutableDocument(file, initial) {
    let text = initial;
    const doc = {
        uri: vscode.Uri.file(file), languageId: 'c', isUntitled: false, isDirty: false, isClosed: false, version: 1, eol: 1,
        get lineCount() { return text.split('\n').length; },
        getText: () => text,
        lineAt: i => { const line = text.split('\n')[i]; return { text: line, lineNumber: i, range: new Range(i, 0, i, line.length) }; },
        positionAt: offset => { const lines = text.slice(0, offset).split('\n'); return new Position(lines.length - 1, lines.at(-1).length); },
        change: value => { text = value; doc.version++; doc.isDirty = true; fire('change', { document: doc, contentChanges: [{}] }); },
        offsetAt: pos => text.split('\n').slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character,
    };
    return doc;
}

test('save corrections: off, suggest, preview, accept, stale edit, onSave and exclusions', async () => {
    if (require('child_process').spawnSync('clang-format', ['--version']).status !== 0) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-correct-'));
    fs.mkdirSync(path.join(root, '.git'));
    state.root = root;
    const doc = mutableDocument(path.join(root, 'main.c'), 'int f(void){return(0);}');
    state.docs = [doc];
    const suggestions = [];
    state.active = { document: doc, setDecorations: (_type, items) => suggestions.push(...items), revealRange: noop };
    const compiler = path.join(root, 'epiclang');
    fs.writeFileSync(compiler, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const settings = { compiler, runOnOpen: false, runOnSave: false, runOnType: false };
    vscode.workspace.getConfiguration = () => ({ get: (k, d) => settings[k] ?? d });
    const commands = [];
    vscode.commands.executeCommand = async (...args) => commands.push(args);
    let applied = 0;
    vscode.workspace.applyEdit = async edit => {
        applied++;
        const e = edit.edits.find(e => e.range);
        const before = doc.getText();
        doc.change(before.slice(0, doc.offsetAt(e.range.start)) + e.newText + before.slice(doc.offsetAt(e.range.end)));
        return true;
    };
    const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(root, 'storage') } };
    require('../../dist-test/codingStyle/extension').activate(context);
    const allLenses = () => codeLensProviders.flatMap(p => p.provideCodeLenses(doc)).filter(l => /Correction/.test(l.command.command) && l.command.command !== 'bananabox.codingStyle.configureCorrections');
    const lenses = () => allLenses().filter(l => l.command.command === 'bananabox.codingStyle.acceptCorrection');
    const titles = () => allLenses().map(l => l.command.title);
    const save = async () => { fire('save', doc); await delay(100); };
    await save();
    assert.equal(lenses().length, 0);
    settings['corrections.mode'] = 'suggest';
    fire('config', { affectsConfiguration: () => true });
    await save();
    // One hunk at a time, with a precise title, Tab to accept, and the rest reachable.
    assert.equal(applied, 0);
    assert.equal(titles()[0], '$(sparkle) Add the Epitech header (C-G1) · fixes C-G1');
    assert.ok(titles().includes('Accept (Tab)'));
    assert.ok(titles().includes(`Accept all 2 (${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'} + Alt + Enter)`));
    assert.ok(titles().includes('‹ 1/2 ›'));
    assert.ok(suggestions.some(s => /Epitech header/.test(s.renderOptions?.after?.contentText ?? '')));
    assert.ok(commands.some(c => c[0] === 'setContext' && c[1] === 'bananabox.codingStyle.hasCorrections' && c[2] === true));
    await registered['bananabox.codingStyle.nextCorrection']();
    assert.equal(titles()[0], '$(sparkle) Put the brace on its own line');
    assert.ok(suggestions.some(s => /⟶ int f\(void\) ⏎ \{ ⏎ return \(0\); ⏎ \}/.test(s.renderOptions?.after?.contentText ?? '')));
    await registered['bananabox.codingStyle.dismissCorrections']();
    assert.equal(lenses().length, 0);
    assert.equal(applied, 0);
    assert.ok(commands.some(c => c[0] === 'setContext' && c[1] === 'bananabox.codingStyle.hasCorrections' && c[2] === false));
    await save();
    await registered['bananabox.codingStyle.previewCorrections']();
    assert.ok(commands.some(c => c[0] === 'vscode.diff'));
    // Accepting one hunk keeps the other one proposed, re-anchored on the new text.
    await registered['bananabox.codingStyle.acceptCorrection']();
    assert.equal(applied, 1);
    assert.match(doc.getText(), /^\/\*\n\*\* EPITECH PROJECT, \d{4}\n/);
    assert.ok(doc.getText().endsWith('int f(void){return(0);}'));
    assert.equal(titles()[0], '$(sparkle) Put the brace on its own line');
    assert.ok(!titles().some(t => t.startsWith('Accept all')));
    await registered['bananabox.codingStyle.acceptCorrection']();
    assert.equal(applied, 2);
    assert.ok(doc.getText().endsWith('int f(void)\n{\n    return (0);\n}\n'));
    assert.equal(lenses().length, 0);
    doc.change('int g(void){return 2;}');
    await save();
    doc.change('int g(void){return 3;}');
    await registered['bananabox.codingStyle.acceptCorrections']();
    await registered['bananabox.codingStyle.acceptCorrection']();
    assert.equal(applied, 2);
    settings['corrections.mode'] = 'onSave';
    fire('config', { affectsConfiguration: () => true });
    let pending;
    fire('willSave', { document: doc, waitUntil: p => { pending = p; } });
    const edits = await pending;
    assert.equal(edits.length, 1);
    assert.match(edits[0].newText, /EPITECH PROJECT/);
    fire('willSave', { document: doc, waitUntil: p => { pending = p; } });
    doc.change('int g(void){return 4;}');
    assert.deepEqual(await pending, []);
    settings.exclude = ['**/main.c'];
    fire('config', { affectsConfiguration: () => true });
    pending = undefined;
    fire('willSave', { document: doc, waitUntil: p => { pending = p; } });
    assert.equal(pending, undefined);
    context.subscriptions.forEach(s => s.dispose());
    fs.rmSync(root, { recursive: true, force: true });
});

test('typing is debounced; save coalesces pending scan and closing cancels it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-type-'));
    fs.mkdirSync(path.join(root, '.git'));
    const file = path.join(root, 'main.c');
    fs.writeFileSync(file, 'int x;\n');
    const log = path.join(root, 'runs');
    const script = path.join(root, 'epiclang');
    fs.writeFileSync(script, `#!/bin/sh\nprintf 'run\\n' >> '${log}'\n`, { mode: 0o755 });
    state.root = root;
    const doc = mutableDocument(file, 'int x;\n');
    state.docs = [doc];
    state.active = { document: doc, setDecorations: noop, selection: { active: new Position(99, 0) } };
    const settings = { compiler: script, runOnOpen: false, debounceMs: 100, 'corrections.mode': 'off' };
    vscode.workspace.getConfiguration = () => ({ get: (k, d) => settings[k] ?? d });
    const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(root, 'storage') } };
    require('../../dist-test/codingStyle/extension').activate(context);
    const count = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').length : 0;
    doc.change('int a;');
    await delay(50);
    doc.change('int b;');
    await delay(60);
    assert.equal(count(), 0);
    await delay(150);
    assert.equal(count(), 1);
    doc.change('int c;');
    doc.isDirty = false;
    fs.writeFileSync(file, doc.getText());
    fire('save', doc);
    await delay(200);
    assert.equal(count(), 2);
    doc.change('int d;');
    doc.isClosed = true;
    fire('close', doc);
    await delay(150);
    assert.equal(count(), 2);
    context.subscriptions.forEach(s => s.dispose());
    fs.rmSync(root, { recursive: true, force: true });
});

test('manifest exposes Off, Suggestion and Automatic with Off as the default', () => {
    const setting = require('../../package.json').contributes.configuration.properties['bananalens.corrections.mode'];
    assert.equal(setting.default, 'off');
    assert.deepEqual(setting.enumItemLabels, ['Off', 'Suggestion', 'Automatic']);
    assert.deepEqual(setting.enum, ['off', 'suggest', 'onSave']);
});

test('inline lenses prioritise severity, retain full hover text and clear stale decorations', () => {
    const { Decorations, inlineText } = require('../../dist-test/codingStyle/ui');
    const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
    const settings = { ...DEFAULT_SETTINGS, inline: { ...DEFAULT_SETTINGS.inline, maxMessageLength: 45, box: 'off' } };
    const create = vscode.window.createTextEditorDecorationType;
    const painted = new Map();
    const types = [];
    vscode.window.createTextEditorDecorationType = options => {
        const type = { options, disposed: false, dispose() { this.disposed = true; } };
        types.push(type);
        return type;
    };
    const renderer = new Decorations();
    try {
        const doc = mutableDocument('/tmp/lens.c', '    char *setter; int written;\n    if (setter ==NULL)\n');
        let calls = 0;
        const editor = { document: doc, setDecorations: (type, options) => { calls++; painted.set(type, options); }, selection: { active: new Position(99, 0) } };
        const minor = { file: '/tmp/lens.c', line: 1, column: 5, severity: 'warning', rawSeverity: 'warning', level: 'Minor', bucket: 'minor', ruleId: 'C-L3', message: 'missing space after binary operator', notes: [] };
        const major = { ...minor, level: 'Major', bucket: 'major', ruleId: 'C-L1', message: 'multiple statements on the same line' };
        const items = [minor, major, { ...minor, line: 2 }];
        renderer.renderInline(editor, items, settings);
        const majorType = types.find(t => t.options.after.color.id === 'bananalens.inline.majorForeground');
        const minorType = types.find(t => t.options.after.color.id === 'bananalens.inline.minorForeground');
        assert.ok(majorType && minorType);
        const lens = painted.get(majorType)[0];
        assert.match(lens.renderOptions.after.contentText, /^▪ \[Major\] C-L1:/);
        assert.ok(lens.renderOptions.after.contentText.includes('C-L1'));
        assert.equal(majorType.options.rangeBehavior, vscode.DecorationRangeBehavior.ClosedOpen);
        assert.match(lens.renderOptions.after.contentText, /… $/);
        assert.ok(lens.hoverMessage.value.includes(major.message));
        assert.ok(lens.hoverMessage.value.includes(minor.message));
        assert.ok(lens.hoverMessage.value.includes('C-L1'));
        assert.ok(lens.hoverMessage.value.includes('C-L3'));
        assert.deepEqual([lens.range.start.character, lens.range.end.character], [doc.lineAt(0).text.length, doc.lineAt(0).text.length]);
        assert.equal(majorType.options.backgroundColor, undefined);
        assert.equal(majorType.options.isWholeLine, undefined);
        assert.equal(majorType.options.after.fontWeight, '600');
        assert.equal(majorType.options.after.fontStyle, 'normal');
        assert.equal(majorType.options.borderWidth, '0 0 2px 0');
        assert.equal(inlineText(minor, 'compact'), '[Minor]');
        assert.equal(inlineText(minor, 'full'), '[Minor] C-L3: missing space after binary operator');
        assert.equal(inlineText({ ...minor, ruleId: undefined }, 'full'), '[Minor]: missing space after binary operator');
        const previousCalls = calls;
        renderer.renderInline(editor, items, settings);
        assert.equal(calls, previousCalls);
        renderer.renderInline(editor, items, { ...settings, inline: { ...settings.inline, mode: 'compact' } });
        assert.equal(painted.get(majorType)[0].renderOptions.after.contentText, '▪ [Major] · [Minor] ');
        assert.ok(painted.get(majorType)[0].hoverMessage.value.includes('C-L1'));
        renderer.renderInline(editor, [minor], settings);
        assert.deepEqual(painted.get(majorType), []);
        renderer.renderInline(editor, [minor], { ...settings, enabled: false });
        assert.ok([...painted.values()].every(options => options.length === 0));
        renderer.renderInline(editor, items, { ...settings, inline: { ...settings.inline, mode: 'off' } });
        assert.ok([...painted.values()].every(options => options.length === 0));
        renderer.renderInline(editor, [{ ...minor, bucket: undefined }], { ...settings, inline: { ...settings.inline, showClangWarnings: false } });
        assert.ok([...painted.values()].every(options => options.length === 0));
        renderer.dispose();
        assert.ok(types.every(t => t.disposed));
    } finally {
        renderer.dispose();
        vscode.window.createTextEditorDecorationType = create;
    }
});

test('inline defaults and severity colours are available in the manifest', () => {
    const manifest = require('../../package.json').contributes;
    const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
    assert.equal(manifest.configuration.properties['bananalens.inline.mode'].default, DEFAULT_SETTINGS.inline.mode);
    assert.equal(DEFAULT_SETTINGS.inline.mode, 'full');
    assert.deepEqual(manifest.configurationDefaults['errorLens.excludeBySource'], ['Banana', 'epiclang']);
    for (const bucket of ['fatal', 'major', 'minor', 'info']) {
        for (const suffix of ['Foreground', 'Background', 'Underline']) {
            const color = manifest.colors.find(c => c.id === `bananalens.inline.${bucket}${suffix}`);
            assert.ok(color, `${bucket}${suffix}`);
            for (const theme of ['dark', 'light', 'highContrast', 'highContrastLight']) assert.ok(color.defaults[theme]);
        }
    }
});

test('summary occupies header whitespace, keeps code clear and exposes file-scoped actions', () => {
    const { Decorations, SummaryLensProvider, summaryText, statusText } = require('../../dist-test/codingStyle/ui');
    const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
    const settings = { ...DEFAULT_SETTINGS, summary: { ...DEFAULT_SETTINGS.summary, attribution: false } };
    const doc = mutableDocument('/tmp/summary.c', '/*\n** EPITECH PROJECT, 2026\n*/\n\nint x;\n');
    const zero = { fatal: 0, major: 0, minor: 0, info: 0, other: 0 };
    let view = { summary: { ...zero, major: 1, minor: 2 }, running: false, stale: false, durationMs: 42 };
    const provider = new SummaryLensProvider(() => view, () => settings);
    const create = vscode.window.createTextEditorDecorationType;
    vscode.window.createTextEditorDecorationType = options => ({ options, dispose: noop });
    const decorations = new Decorations();
    const painted = new Map();
    const editor = { document: doc, setDecorations: (type, ranges) => painted.set(type, ranges) };
    const visible = () => [...painted.entries()].filter(([, ranges]) => ranges.length);
    try {
        const lenses = provider.provideCodeLenses(doc);
        assert.equal(lenses[0].range.start.line, 3);
        assert.equal(lenses[0].command.title, 'Bananabox Coding Style');
        assert.ok(lenses.some(l => l.command.title === 'Review 3 issues'));
        assert.ok(lenses.some(l => l.command.title === 'Corrections: Off'));
        assert.ok(lenses.every(l => l.command.arguments[0] === doc.uri));
        assert.ok(!lenses.some(l => /42 ms|techneon/.test(l.command.title)));
        assert.match(lenses[0].command.tooltip, /42 ms/);
        decorations.renderStatusLens(editor, view, settings);
        let [type, ranges] = visible()[0];
        assert.equal(type.options.after.color.id, 'bananalens.inline.majorForeground');
        assert.equal(type.options.after.fontWeight, '600');
        assert.equal(ranges[0].range.start.line, 3);
        assert.match(ranges[0].renderOptions.after.contentText, /1 major · 2 minors/);
        assert.match(ranges[0].hoverMessage.value, /Corrections: Off/);
        view = { ...view, stale: true };
        decorations.renderStatusLens(editor, view, settings);
        [type, ranges] = visible()[0];
        assert.equal(type.options.after.color.id, 'descriptionForeground');
        assert.match(ranges[0].renderOptions.after.contentText, /Pending check/);
        assert.equal(summaryText({ ...view, running: true }), 'Checking…');
        assert.equal(summaryText({ ...view, error: 'timed out' }), 'Check unavailable');
        assert.equal(summaryText(undefined), 'Not checked');
        assert.equal(summaryText({ ...view, stale: false, summary: zero }), 'No issues');
        const compiler = { ...view, stale: false, summary: { ...zero, other: 2 } };
        assert.equal(summaryText(compiler), '2 compiler');
        assert.ok(!statusText(compiler).includes('$(check)'));
        decorations.renderStatusLens(editor, compiler, settings);
        assert.equal(visible()[0][0].options.after.color.id, 'bananalens.inline.infoForeground');
        doc.change('int x;\n');
        decorations.renderStatusLens(editor, view, settings);
        assert.equal(visible().length, 0);
        assert.match(provider.provideCodeLenses(doc)[0].command.title, /Bananabox Style · 1 major/);
        assert.equal(provider.provideCodeLenses(doc)[0].range.start.line, 0);
        doc.change('/* header */ int x;\n');
        assert.equal(provider.provideCodeLenses(doc)[0].range.start.line, 0);
        settings.summary.enabled = false;
        assert.deepEqual(provider.provideCodeLenses(doc), []);
        decorations.renderStatusLens(editor, view, settings);
        assert.equal(visible().length, 0);
    } finally {
        provider.dispose();
        decorations.dispose();
        vscode.window.createTextEditorDecorationType = create;
    }
});

test('appearance controls validate values and match contributed settings', () => {
    const { APPEARANCE_FIELDS, validAppearanceValue } = require('../../dist-test/codingStyle/appearance');
    const properties = require('../../package.json').contributes.configuration.properties;
    for (const field of APPEARANCE_FIELDS) {
        const setting = properties[`bananalens.${field.key}`];
        assert.ok(setting, field.key);
        assert.ok(validAppearanceValue(field.key, setting.default), field.key);
        assert.ok(validAppearanceValue(field.key, null));
    }
    assert.equal(validAppearanceValue('compiler', '/tmp/executable'), false);
    assert.equal(validAppearanceValue('inline.colors.major.foreground', '#abcdef80'), true);
    for (const bad of ['red', '#abc', '#000000; display:none', {}, 123]) {
        assert.equal(validAppearanceValue('inline.colors.major.foreground', bad), false);
    }
    for (const bad of [-1, 17, 1.5, Infinity, '4']) assert.equal(validAppearanceValue('inline.gap', bad), false);
});

test('custom lens styles stay bounded, retain overflow details and support independent editors', () => {
    const { Decorations, inlineText } = require('../../dist-test/codingStyle/ui');
    const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
    const create = vscode.window.createTextEditorDecorationType;
    const types = [], painted = new Map();
    vscode.window.createTextEditorDecorationType = options => {
        const type = { options, disposed: false, dispose() { this.disposed = true; } };
        types.push(type); return type;
    };
    const renderer = new Decorations();
    try {
        const doc = mutableDocument('/tmp/custom.c', 'int x;\n');
        const editor = { document: doc, setDecorations: (type, options) => painted.set(type, options), selection: { active: new Position(99, 0) } };
        const other = { document: doc, setDecorations: noop, selection: { active: new Position(99, 0) } };
        const minor = { file: doc.uri.fsPath, line: 1, column: 1, severity: 'warning', rawSeverity: 'warning', bucket: 'minor', level: 'Minor', ruleId: 'C-L3', message: 'spacing', notes: [] };
        const major = { ...minor, bucket: 'major', level: 'Major', ruleId: 'C-L1', message: 'statements' };
        const settings = { ...DEFAULT_SETTINGS, inline: { ...DEFAULT_SETTINGS.inline,
            showLevel: false, showMarker: false, showMessage: 'never', maxPerLine: 1, gap: 1, box: 'off',
            bold: false, italic: true, underline: false, background: false,
            colors: { ...DEFAULT_SETTINGS.inline.colors, major: { foreground: '#123456', background: '#65432180', underline: '#abcdef' } } } };
        renderer.renderInline(editor, [minor, major], settings);
        const type = types[0];
        assert.equal(type.options.after.color, '#123456');
        assert.equal(type.options.after.margin, '0 0 0 1ch');
        assert.equal(type.options.after.fontWeight, 'normal');
        assert.equal(type.options.after.fontStyle, 'italic');
        assert.equal(type.options.after.backgroundColor, 'transparent');
        assert.equal(type.options.borderWidth, '0');
        assert.equal(painted.get(type)[0].renderOptions.after.contentText, 'C-L1 (+1) ');
        assert.match(painted.get(type)[0].hoverMessage.value, /C-L3[\s\S]*spacing/);
        const items = [minor, major];
        for (let i = 0; i < 100; i++) renderer.renderInline(editor, items, settings);
        assert.equal(types.length, 1);
        renderer.renderInline(other, items, DEFAULT_SETTINGS);
        assert.equal(types.length, 2);
        assert.equal(types[1].options.after.color.id, 'bananalens.inline.majorForeground');
        renderer.renderInline(editor, items, { ...settings, inline: { ...settings.inline, gap: 2 } });
        assert.equal(type.disposed, true);
        assert.equal(types[1].disposed, false);
        renderer.releaseHidden([other]);
        assert.equal(types[2].disposed, true);
        assert.equal(inlineText(minor, 'compact', { ...settings.inline, showRuleId: 'always' }), 'C-L3');
    } finally { renderer.dispose(); vscode.window.createTextEditorDecorationType = create; }
});

test('corrections are offered and cached only after validation; cancellation and failure produce no edit', async () => {
    const { Corrections } = require('../../dist-test/codingStyle/corrections');
    const { clearSettingsCache } = require('../../dist-test/codingStyle/config');
    if (require('child_process').spawnSync('clang-format', ['--version']).status !== 0) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-verify-'));
    fs.mkdirSync(path.join(root, '.git'));
    state.root = root;
    const doc = mutableDocument(path.join(root, 'main.c'), 'int f(void){return 0;}');
    state.docs = [];
    const config = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = () => ({ get: (key, fallback) => key === 'corrections.mode' ? 'onSave' : fallback });
    clearSettingsCache();
    let valid = false, scans = 0;
    const corrections = new Corrections(noop, undefined, { validate: async () => { scans++; return valid; }, clear: noop, forget: noop });
    try {
        assert.deepEqual(await corrections.edits(doc), []);
        valid = true;
        assert.equal((await corrections.edits(doc)).length, 1);
        const count = scans;
        assert.equal((await corrections.edits(doc)).length, 1);
        assert.equal(scans, count);
        doc.change('int f(void){return 1;}');
        corrections.validator.validate = async (_req, _before, _after, signal) => {
            await delay(25);
            doc.change('int f(void){return 2;}');
            assert.equal(signal.aborted, true);
            return true;
        };
        assert.deepEqual(await corrections.edits(doc), []);
        corrections.validator.validate = async () => { throw new Error('missing compiler'); };
        assert.deepEqual(await corrections.edits(doc), []);
        corrections.validator.validate = async () => new Promise(() => {});
        const start = Date.now();
        assert.deepEqual(await corrections.edits(doc), []);
        assert.ok(Date.now() - start < 1600, 'save verification must return within its budget');
    } finally {
        corrections.dispose(); vscode.workspace.getConfiguration = config; clearSettingsCache();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('appearance panel loads on demand, validates messages and releases listeners', async () => {
    const { showAppearance } = require('../../dist-test/codingStyle/appearance');
    const originalCreate = vscode.window.createWebviewPanel;
    const originalConfig = vscode.workspace.getConfiguration;
    const originalColumn = vscode.ViewColumn;
    const originalFolders = vscode.workspace.workspaceFolders;
    const properties = require('../../package.json').contributes.configuration.properties;
    let receive, disposeCallback, created = 0, revealed = 0, options, contents;
    const messages = [], writes = [];
    vscode.ViewColumn = { Active: -1 };
    vscode.workspace.workspaceFolders = [];
    vscode.workspace.getConfiguration = () => ({
        inspect: key => ({ defaultValue: properties[`bananalens.${key}`].default }),
        update: async (...args) => writes.push(args),
    });
    vscode.window.createWebviewPanel = (_type, _title, _column, settings) => {
        created++; options = settings;
        return {
            reveal: () => revealed++,
            onDidDispose: callback => { disposeCallback = callback; },
            dispose: () => disposeCallback(),
            webview: {
                set html(value) { contents = value; },
                postMessage: async message => messages.push(message),
                onDidReceiveMessage: callback => { receive = callback; return disposable(); },
            },
        };
    };
    const context = { subscriptions: [] };
    try {
        showAppearance(context); showAppearance(context);
        assert.equal(created, 1); assert.equal(revealed, 1);
        assert.deepEqual(options.localResourceRoots, []);
        assert.equal(options.retainContextWhenHidden, undefined);
        assert.match(contents, /type="color"/);
        assert.match(contents, /default-src 'none'/);
        const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(contents)[1];
        new (require('node:vm').Script)(script); // Verify the generated script, not just its TypeScript wrapper.
        await receive({ type: 'ready' });
        assert.equal(messages.at(-1).values['inline.gap'], 4);
        await receive({ type: 'apply', values: { compiler: 'malicious' } });
        assert.equal(writes.length, 0);
        assert.equal(messages.at(-1).type, 'error');
        await receive({ type: 'apply', values: { 'inline.colors.major.foreground': '#123456', 'inline.gap': 2 } });
        assert.equal(writes.length, 2);
        assert.equal(messages.at(-1).type, 'saved');
        await receive({ type: 'apply', values: { 'inline.colors.major.foreground': null } });
        assert.equal(writes.at(-1)[1], undefined);
    } finally {
        context.subscriptions.forEach(s => s.dispose());
        vscode.window.createWebviewPanel = originalCreate;
        vscode.workspace.getConfiguration = originalConfig;
        vscode.ViewColumn = originalColumn;
        vscode.workspace.workspaceFolders = originalFolders;
    }
});

test('appearance-only configuration changes never request a compiler scan', async () => {
    const { clearSettingsCache } = require('../../dist-test/codingStyle/config');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-appearance-'));
    fs.mkdirSync(path.join(root, '.git'));
    const compiler = path.join(root, 'epiclang'), log = path.join(root, 'runs');
    fs.writeFileSync(compiler, `#!/bin/sh\nprintf run >> '${log}'\n`, { mode: 0o755 });
    state.root = root;
    const doc = mutableDocument(path.join(root, 'main.c'), 'int x;\n');
    fs.writeFileSync(doc.uri.fsPath, doc.getText());
    state.docs = [doc]; state.active = { document: doc, setDecorations: noop, selection: { active: new Position(99, 0) } };
    const config = vscode.workspace.getConfiguration;
    const settings = { compiler, runOnOpen: false, 'corrections.mode': 'off' };
    vscode.workspace.getConfiguration = () => ({ get: (key, fallback) => settings[key] ?? fallback });
    clearSettingsCache();
    const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(root, 'storage') } };
    try {
        require('../../dist-test/codingStyle/extension').activate(context);
        settings['inline.colors.major.foreground'] = '#112233';
        fire('config', { affectsConfiguration: key => key === 'bananalens' || key === 'bananalens.inline' || key === 'bananalens.inline.colors.major.foreground' });
        await delay(180);
        assert.equal(fs.existsSync(log), false);
    } finally {
        context.subscriptions.forEach(s => s.dispose());
        vscode.workspace.getConfiguration = config; clearSettingsCache();
        state.docs = []; state.active = undefined;
        fs.rmSync(root, { recursive: true, force: true });
    }
});


test('historical commit documents do not expose coding-style lenses', () => {
    const { SummaryLensProvider } = require('../../dist-test/codingStyle/ui');
    const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
    const doc = mutableDocument('/tmp/historical.c', 'int x;\n');
    doc.uri = { ...doc.uri, scheme: 'bananabox-commit' };
    const provider = new SummaryLensProvider(() => undefined, () => DEFAULT_SETTINGS);
    try { assert.deepEqual(provider.provideCodeLenses(doc), []); }
    finally { provider.dispose(); }
});

test('inline lens shortcut restores compact mode without disabling diagnostics', async () => {
    const previous = vscode.workspace.getConfiguration;
    const previousTargets = vscode.ConfigurationTarget;
    const previousActive = state.active;
    const updates = [];
    let mode = 'compact';
    vscode.ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
    state.active = undefined;
    vscode.workspace.getConfiguration = () => ({
        get: (key, fallback) => key === 'inline.mode' ? mode : fallback,
        inspect: () => ({ workspaceValue: mode }),
        update: async (key, value, target) => { updates.push({ key, value, target }); mode = value; },
    });
    const context = { subscriptions: [], globalStorageUri: { fsPath: os.tmpdir() } };
    try {
        require('../../dist-test/codingStyle/extension').activate(context);
        await registered['bananabox.codingStyle.toggleInline']();
        await registered['bananabox.codingStyle.toggleInline']();
        assert.deepEqual(updates, [{ key: 'inline.mode', value: 'off', target: 2 }, { key: 'inline.mode', value: 'compact', target: 2 }]);
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).contributes;
        assert.ok(manifest.keybindings.some(k => k.command === 'bananabox.codingStyle.toggleInline' && k.key === 'ctrl+alt+l' && k.mac === 'cmd+alt+l'));
    } finally {
        context.subscriptions.forEach(s => s.dispose?.());
        vscode.workspace.getConfiguration = previous;
        vscode.ConfigurationTarget = previousTargets;
        state.active = previousActive;
    }
});

test('remote disable clears existing diagnostics, blocks commands and project scans, then restores Lens', async () => {
    const { clearSettingsCache, setRemoteLensEnabled } = require('../../dist-test/codingStyle/config');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-remote-'));
    fs.mkdirSync(path.join(root, '.git'));
    const compiler = path.join(root, 'epiclang'), log = path.join(root, 'runs');
    fs.writeFileSync(compiler, `#!/bin/sh\nprintf run >> '${log}'\nfor last; do :; done\necho "$last:1:1: warning: [Banana] [Major] test (C-C1)" >&2\n`, { mode: 0o755 });
    const previousConfig = vscode.workspace.getConfiguration;
    const previousRoot = state.root, previousDocs = state.docs, previousActive = state.active;
    let updates = 0, enabled = true, changed;
    const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(root, 'storage') } };
    state.root = root;
    const doc = mutableDocument(path.join(root, 'main.c'), 'int x;\n');
    fs.writeFileSync(doc.uri.fsPath, doc.getText());
    state.docs = [doc]; state.active = { document: doc, setDecorations: noop, selection: { active: new Position(99, 0) } };
    state.collection.clear();
    vscode.workspace.getConfiguration = () => ({
        get: (key, fallback) => key === 'compiler' ? compiler : key === 'runOnOpen' ? false : fallback,
        update: async () => { updates++; },
    });
    try {
        const api = require('../../dist-test/codingStyle/extension').activate(context, {
            enabled: () => enabled,
            onDidChange: callback => { changed = callback; return disposable(); },
        });
        await registered['bananabox.codingStyle.run']();
        assert.ok(state.collection.get(doc.uri.fsPath).length > 0);
        const before = fs.readFileSync(log, 'utf8');
        enabled = false; changed();
        assert.equal(api.isEnabled(), false);
        assert.equal(state.collection.size, 0);
        await registered['bananabox.codingStyle.run']();
        await registered['bananabox.codingStyle.toggle']();
        assert.equal((await api.scanProject(root)).error.notFound, false);
        assert.equal(fs.readFileSync(log, 'utf8'), before);
        assert.equal(updates, 0);
        enabled = true; changed();
        assert.equal(api.isEnabled(), true);
        await registered['bananabox.codingStyle.run']();
        assert.ok(state.collection.get(doc.uri.fsPath).length > 0);
    } finally {
        context.subscriptions.forEach(subscription => subscription.dispose());
        setRemoteLensEnabled(true); clearSettingsCache();
        vscode.workspace.getConfiguration = previousConfig;
        state.root = previousRoot; state.docs = previousDocs; state.active = previousActive;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Makefiles and unauthorized functions are checked without epiclang, with the subject rules of the project', async () => {
    const { clearSettingsCache } = require('../../dist-test/codingStyle/config');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-makefile-'));
    fs.mkdirSync(path.join(root, '.git'));
    const makefile = path.join(root, 'Makefile');
    const makeText = 'NAME = setting_up\n\nall: $(NAME)\n\nclean:\n\trm -f *.o\n';
    const source = path.join(root, 'main.c');
    const cText = '/*\n** EPITECH PROJECT, 2026\n*/\n\nint main(void)\n{\n    printf("hi");\n    return write(1, "a", 1);\n}\n';
    fs.writeFileSync(makefile, makeText);
    fs.writeFileSync(source, cText);
    const document = (file, text, languageId) => {
        const lines = text.split('\n');
        return { uri: vscode.Uri.file(file), languageId, isUntitled: false, isDirty: false, lineCount: lines.length, version: 1,
            getText: () => text, lineAt: i => ({ text: lines[i], lineNumber: i, range: new Range(i, 0, i, lines[i].length) }) };
    };
    const mk = document(makefile, makeText, 'makefile'), c = document(source, cText, 'c');
    const previous = { root: state.root, docs: state.docs, active: state.active, config: vscode.workspace.getConfiguration };
    state.root = root; state.docs = [mk, c];
    vscode.workspace.getConfiguration = () => ({ get: (k, d) => (k === 'compiler' ? path.join(root, 'missing-epiclang') : d), update: async () => {} });
    clearSettingsCache();
    const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(root, 'storage') } };
    try {
        const api = require('../../dist-test/codingStyle/extension').activate(context);
        api.useProjectRules(file => file.startsWith(root) ? { root, allowedFunctions: ['write'], makefile: { rules: ['tests_run'], binary: 'my_ls' }, source: 'my_ls.pdf' } : undefined);

        state.active = { document: mk, setDecorations: noop, selection: { active: new Position(0, 0) }, revealRange: noop };
        await registered['bananabox.codingStyle.run']();
        const codes = state.collection.get(makefile).map(d => d.code).sort();
        assert.deepEqual(codes, ['C-G1', 'M-P1', 'M-R1', 'M-R2']);
        assert.ok(state.collection.get(makefile).every(d => d.source === 'Banana'));
        assert.match(state.collection.get(makefile).find(d => d.code === 'M-R1').message, /fclean, re, tests_run/);

        // epiclang is missing: the unauthorized call is still reported.
        state.active = { document: c, setDecorations: noop, selection: { active: new Position(0, 0) }, revealRange: noop };
        await registered['bananabox.codingStyle.run']();
        const found = state.collection.get(source);
        assert.equal(found.length, 1);
        assert.equal(found[0].code, 'unauthorized-function');
        assert.equal(found[0].source, 'Banana');
        assert.match(found[0].message, /printf\(\) is not in the subject's allowed functions/);
        assert.deepEqual([found[0].range.start.line, found[0].range.start.character, found[0].range.end.character], [6, 4, 10]);
    } finally {
        context.subscriptions.forEach(subscription => subscription.dispose());
        vscode.workspace.getConfiguration = previous.config; clearSettingsCache();
        state.root = previous.root; state.docs = previous.docs; state.active = previous.active;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('several messages on the cursor line are stacked in a box, other lines show the worst one with a counter', () => {
    const { Decorations } = require('../../dist-test/codingStyle/ui');
    const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
    const painted = [];
    const renderer = new Decorations();
    const doc = mutableDocument('/tmp/box.c', 'int a;\nint b;\n');
    const at = line => ({ document: doc, selection: { active: new Position(line, 0) }, setDecorations: (_type, options) => painted.push(...options) });
    const minor = { file: '/tmp/box.c', line: 1, column: 1, severity: 'warning', rawSeverity: 'warning', level: 'Minor', bucket: 'minor', ruleId: 'C-L3', message: 'spacing', notes: [] };
    const major = { ...minor, level: 'Major', bucket: 'major', ruleId: 'C-L1', message: 'statements' };
    try {
        renderer.renderInline(at(0), [minor, major], DEFAULT_SETTINGS);
        assert.equal(painted.length, 3); // two rows plus the underline
        const rows = painted.filter(o => o.renderOptions);
        assert.ok(rows.some(o => /display: inline-block/.test(o.renderOptions.after.textDecoration)));
        assert.ok(rows.some(o => /top: 100%/.test(o.renderOptions.after.textDecoration)));
        painted.length = 0;
        renderer.renderInline(at(1), [minor, major], DEFAULT_SETTINGS);
        assert.equal(painted.length, 2); // label plus the underline
        assert.match(painted[0].renderOptions.after.contentText, /\(\+1\)/);
    } finally { renderer.dispose(); }
});
