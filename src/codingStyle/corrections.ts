import * as path from 'node:path';
import * as vscode from 'vscode';
import { affectsAnalysis, clearSettingsCache, readSettings } from './config';
import { FormatterToolchain } from './toolchain';
import { describeCorrections } from './correctionDescriptions';
import {
    computeHunks,
    Hunk,
    hunkDiff,
    hunkEndLine,
    hunkNear,
} from './correctionHunks';
import { formatC } from './formatter';
import { addEpitechHeader } from './header';
import { matchesAny } from './glob';
import { detectProjectRoot, loadProjectConfigFile } from './project';
import { CorrectionValidator } from './validation';
import { Limiter } from './limiter';
import { ui } from './messages';

/**
 * A verified correction of a whole file, split into hunks. In Suggestion mode
 * the hunk nearest the cursor is shown inline; Tab accepts it, Alt+] / Alt+[
 * move to the next / previous one, Esc dismisses, Ctrl+Alt+Enter accepts all.
 */
interface Proposal {
    document: vscode.TextDocument;
    version: number;
    before: string;
    after: string;
    descriptions: string[];
    hunks: Hunk[];
    active: number;
}

const MOD = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
const visible = (text: string) =>
    text.replace(/ /g, '·').replace(/\t/g, '→');
const clip = (text: string, max = 90) =>
    (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export class Corrections
    implements
        vscode.Disposable,
        vscode.CodeLensProvider,
        vscode.TextDocumentContentProvider {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.changed.event;
    private readonly proposals = new Map<string, Proposal>();
    private readonly running = new Map<string, AbortController>();
    private readonly previews = new Map<string, string>();
    private readonly expected = new Map<string, string>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private lastError = '';
    private readonly cache = new Map<
        string,
        { version: number; proposal?: Proposal }
    >();
    private readonly setupStatus = vscode.window.createStatusBarItem(
        'bananalens.formatter',
        vscode.StatusBarAlignment.Left,
        49,
    );
    private readonly removedText =
        vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor(
                'diffEditor.removedTextBackground',
            ),
            textDecoration: 'line-through',
        });
    private readonly removedLine =
        vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor(
                'diffEditor.removedLineBackground',
            ),
            overviewRulerColor: new vscode.ThemeColor(
                'editorOverviewRuler.deletedForeground',
            ),
            overviewRulerLane: vscode.OverviewRulerLane?.Left,
        });
    private readonly inserted = vscode.window.createTextEditorDecorationType({
        before: {
            color: new vscode.ThemeColor('editorGhostText.foreground'),
            backgroundColor: new vscode.ThemeColor(
                'diffEditor.insertedTextBackground',
            ),
        },
        after: {
            color: new vscode.ThemeColor('editorGhostText.foreground'),
            backgroundColor: new vscode.ThemeColor(
                'diffEditor.insertedTextBackground',
            ),
            margin: '0 0 0 1ch',
        },
    });
    private readonly pending = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerColor: new vscode.ThemeColor(
            'editorOverviewRuler.modifiedForeground',
        ),
        overviewRulerLane: vscode.OverviewRulerLane?.Left,
    });

    constructor(
        private readonly log: (message: string) => void,
        private readonly toolchain?: FormatterToolchain,
        private readonly validator = new CorrectionValidator(new Limiter(1)),
    ) {
        this.subscriptions.push(
            this.removedText,
            this.removedLine,
            this.inserted,
            this.pending,
            this.setupStatus,
            vscode.workspace.onDidOpenTextDocument(
                document => this.warm(document),
            ),
            vscode.workspace.onDidGrantWorkspaceTrust(
                () => this.warmOpenDocuments(),
            ),
            vscode.window.onDidChangeVisibleTextEditors(() => this.update()),
            vscode.languages.registerCodeLensProvider(
                { language: 'c', scheme: 'file' },
                this,
            ),
            vscode.workspace.registerTextDocumentContentProvider(
                'banana-correction',
                this,
            ),
            vscode.workspace.onWillSaveTextDocument(event => {
                if (this.mode(event.document) === 'onSave') {
                    event.waitUntil(this.edits(event.document));
                }
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (this.mode(document) === 'suggest') {
                    void this.suggest(document);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (!event.contentChanges.length) return;
                const key = event.document.uri.toString();
                if (this.expected.get(key) === event.document.getText()) {
                    this.expected.delete(key);
                    this.rebase(event.document);
                    return;
                }
                this.clear(event.document.uri);
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                this.clear(document.uri);
                this.cache.delete(document.uri.toString());
                this.validator.forget(document.uri.fsPath);
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('bananalens')) {
                    clearSettingsCache();
                }
                if (affectsAnalysis(event)
                    || event.affectsConfiguration('bananalens.corrections')) {
                    this.reset();
                    this.warmOpenDocuments();
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(() => this.update()),
            vscode.window.onDidChangeTextEditorSelection?.(
                event => this.follow(event.textEditor),
            ) ?? { dispose() {} },
            vscode.commands.registerCommand(
                'bananabox.codingStyle.configureCorrections',
                (uri?: vscode.Uri) =>
                    readSettings(uri).enabled ? this.configure(uri) : undefined,
            ),
            vscode.commands.registerCommand(
                'bananabox.codingStyle.previewCorrections',
                (uri?: vscode.Uri) => this.preview(uri),
            ),
            vscode.commands.registerCommand(
                'bananabox.codingStyle.acceptCorrections',
                (uri?: vscode.Uri) => this.accept(uri),
            ),
            vscode.commands.registerCommand(
                'bananabox.codingStyle.acceptCorrection',
                (uri?: vscode.Uri, index?: number) =>
                    this.acceptOne(uri, index),
            ),
            vscode.commands.registerCommand(
                'bananabox.codingStyle.nextCorrection',
                (uri?: vscode.Uri) => this.move(uri, 1),
            ),
            vscode.commands.registerCommand(
                'bananabox.codingStyle.previousCorrection',
                (uri?: vscode.Uri) => this.move(uri, -1),
            ),
            vscode.commands.registerCommand(
                'bananabox.codingStyle.dismissCorrections',
                (uri?: vscode.Uri) => {
                    const target = uri
                        ?? vscode.window.activeTextEditor?.document.uri;
                    if (target) this.clear(target);
                },
            ),
        );
        this.warmOpenDocuments();
    }

    private warmOpenDocuments() {
        for (const document of vscode.workspace.textDocuments) {
            this.warm(document);
        }
    }

    private warm(document: vscode.TextDocument) {
        if (this.mode(document) === 'off' || !this.toolchain
            || this.toolchain.peek(this.executable(document))) {
            return;
        }
        this.setupStatus.name = ui('Bananabox Coding Style formatter');
        this.setupStatus.text =
            ui('$(sync~spin) Bananabox Coding Style: preparing corrections');
        this.setupStatus.tooltip =
            ui('Preparing the formatter automatically. Editing and saving remain available.');
        this.setupStatus.command = 'bananabox.codingStyle.showOutput';
        this.setupStatus.show();
        void this.toolchain
            .prepare(this.executable(document))
            .then(() => this.setupStatus.hide(), () => {
                this.setupStatus.text =
                    ui('$(warning) Bananabox Coding Style: corrections unavailable');
                this.setupStatus.tooltip =
                    ui('Click for details. Preparation retries on the next save after a one-minute cooldown.');
            });
    }

    private async configure(uri?: vscode.Uri) {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        const selected = await vscode.window.showQuickPick(
            [
                {
                    label: ui('$(circle-slash) Off'),
                    description: ui('Default'),
                    detail: ui('Keep Banana scans without automatic corrections.'),
                    mode: 'off',
                },
                {
                    label: ui('$(lightbulb) Suggestion'),
                    description: ui('Review before applying'),
                    detail: ui('Each fix appears inline after saving: Tab accepts it, Alt+] goes to the next one, Esc dismisses.'),
                    mode: 'suggest',
                },
                {
                    label: ui('$(check) Automatic'),
                    description: ui('Automatic'),
                    detail: ui('Apply safe layout corrections while saving.'),
                    mode: 'onSave',
                },
            ],
            {
                title: ui('Bananabox Coding Style · correction mode'),
                placeHolder: ui('Choose how corrections should work'),
            },
        );
        if (!selected) return;
        const scope = vscode.workspace.workspaceFolders?.length
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        await vscode.workspace
            .getConfiguration('bananalens', target)
            .update('corrections.mode', selected.mode, scope);
    }

    private executable(document: vscode.TextDocument) {
        return readSettings(document.uri).corrections.clangFormat;
    }

    private mode(document: vscode.TextDocument): string {
        const settings = readSettings(document.uri);
        if (!settings.enabled || !vscode.workspace.isTrusted
            || document.isClosed || document.languageId !== 'c'
            || document.uri.scheme !== 'file' || document.isUntitled
            || matchesAny(
                settings.exclude,
                vscode.workspace.asRelativePath(document.uri, false),
            )) {
            return 'off';
        }

        return settings.corrections.mode;
    }

    private async compute(
        document: vscode.TextDocument,
    ): Promise<Proposal | undefined> {
        const key = document.uri.toString();
        const cached = this.cache.get(key);
        if (cached?.version === document.version
            && this.mode(document) !== 'off') {
            return cached.proposal;
        }
        this.clear(document.uri);
        if (this.running.size >= 2 || this.mode(document) === 'off') {
            return undefined;
        }

        const settings = readSettings(document.uri);
        const root = detectProjectRoot(
            document.uri.fsPath,
            vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
        );
        const project = loadProjectConfigFile(root, settings.configFile);
        if (project.error
            || matchesAny(
                project.config.exclude ?? [],
                path.relative(root, document.uri.fsPath),
            )) {
            return undefined;
        }

        const controller = new AbortController();
        this.running.set(key, controller);
        const version = document.version;
        const before = document.getText();
        let budget: NodeJS.Timeout | undefined;
        try {
            const configured = this.executable(document);
            let executable = this.toolchain?.peek(configured);
            if (!executable && this.toolchain) {
                const pending = this.toolchain.prepare(configured);
                if (this.mode(document) === 'onSave') {
                    this.warm(document);
                    void pending.catch(() => {});
                    return undefined;
                }
                executable = await pending;
                this.setupStatus.hide();
            }
            if (controller.signal.aborted || document.version !== version) {
                return undefined;
            }

            const budgetMs = this.mode(document) === 'onSave' ? 1000 : 3000;
            budget = setTimeout(() => controller.abort(), budgetMs);
            const formatted = await formatC(before, {
                executable: executable
                    ?? (configured === 'auto' ? 'clang-format' : configured),
                signal: controller.signal,
                whitespaceSensitiveMacros:
                    settings.corrections.whitespaceSensitiveMacros,
            });
            if (controller.signal.aborted
                || !this.isCurrent(document, version)) {
                return undefined;
            }

            const body = formatted ?? before;
            const after = addEpitechHeader(body, document.uri.fsPath, root);
            const descriptions = formatted
                ? describeCorrections(before, formatted)
                : [];
            if (after !== body) {
                descriptions.unshift(ui('Adding the Epitech file header (C-G1)'));
            }
            if (after !== before) {
                const validation = this.validator.validate(
                    {
                        file: document.uri.fsPath,
                        workspaceRoot: vscode.workspace
                            .getWorkspaceFolder(document.uri)?.uri.fsPath,
                        settings,
                    },
                    before,
                    after,
                    controller.signal,
                );
                const valid = await waitForValidation(
                    validation,
                    controller.signal,
                );
                if (!valid || controller.signal.aborted
                    || !this.isCurrent(document, version)) {
                    if (!controller.signal.aborted) {
                        this.log(
                            ui('Corrections skipped: verification was incomplete or introduced a diagnostic.'),
                        );
                    }
                    return undefined;
                }
            }

            const hunks = computeHunks(before, after);
            const proposal = after !== before
                ? {
                    document,
                    version,
                    before,
                    after,
                    descriptions,
                    hunks,
                    active: 0,
                }
                : undefined;
            if (this.cache.size >= 32) {
                this.cache.delete(this.cache.keys().next().value!);
            }
            this.cache.set(key, { version, proposal });

            return proposal;
        } catch (error) {
            if (!controller.signal.aborted) {
                const message =
                    ui('Corrections skipped: {error}. See the Bananabox Coding Style output for formatter preparation details.', { error: String(error) });
                if (message !== this.lastError) {
                    this.lastError = message;
                    this.log(message);
                }
            }
            return undefined;
        } finally {
            if (budget) clearTimeout(budget);
            if (this.running.get(key) === controller) {
                this.running.delete(key);
            }
        }
    }

    private isCurrent(document: vscode.TextDocument, version: number) {
        return !document.isClosed && document.version === version
            && this.mode(document) !== 'off';
    }

    private async edits(
        document: vscode.TextDocument,
    ): Promise<vscode.TextEdit[]> {
        const proposal = await this.compute(document);
        if (!proposal || proposal.version !== document.version
            || document.isClosed || this.mode(document) !== 'onSave') {
            return [];
        }

        return replacements(proposal);
    }

    private async suggest(document: vscode.TextDocument) {
        const proposal = await this.compute(document);
        if (proposal && proposal.version === document.version
            && !document.isClosed && this.mode(document) === 'suggest'
            && proposal.hunks.length) {
            const editor = vscode.window.visibleTextEditors.find(
                e => e.document === document,
            );
            proposal.active = hunkNear(
                proposal.hunks,
                editor?.selection?.active.line ?? 0,
            );
            this.proposals.set(document.uri.toString(), proposal);
            this.update();
        }
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const proposal = this.get(document.uri);
        if (!proposal) return [];

        const hunk = proposal.hunks[proposal.active]!;
        const line = Math.min(
            hunk.oldLines.length ? hunk.start : hunkEndLine(hunk),
            Math.max(0, document.lineCount - 1),
        );
        const range = new vscode.Range(line, 0, line, 0);
        const rules = this.fixedRules(proposal, hunk);
        const count = proposal.hunks.length;
        const lens = (
            title: string,
            command: string,
            tooltip: string,
            ...extra: unknown[]
        ) =>
            new vscode.CodeLens(range, {
                title,
                tooltip,
                command: `bananabox.codingStyle.${command}`,
                arguments: [document.uri, ...extra],
            });
        return [
            lens(
                `$(sparkle) ${hunk.title}${rules.length ? ` · ${ui('fixes {rules}', { rules: rules.join(', ') })}` : ''}`,
                'acceptCorrection',
                ui('Accept this correction'),
                proposal.active,
            ),
            lens(
                ui('Accept (Tab)'),
                'acceptCorrection',
                ui('Accept this correction'),
                proposal.active,
            ),
            ...(count > 1
                ? [
                        lens(
                            ui('Accept all {count} ({key} + Alt + Enter)', { count, key: MOD }),
                            'acceptCorrections',
                            proposal.descriptions.join(' · '),
                        ),
                        lens(
                            `‹ ${proposal.active + 1}/${count} ›`,
                            'nextCorrection',
                            ui('Next correction (Alt+]) · previous (Alt+[)'),
                        ),
                    ]
                : []),
            lens(
                ui('View diff'),
                'previewCorrections',
                ui('Compare the whole file with every correction applied'),
            ),
            lens(
                ui('Dismiss (Esc)'),
                'dismissCorrections',
                ui('Hide these suggestions until the next save'),
            ),
        ];
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.previews.get(uri.toString()) ?? '';
    }

    private get(uri?: vscode.Uri): Proposal | undefined {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        const proposal = target && this.proposals.get(target.toString());
        return proposal && proposal.version === proposal.document.version
            && proposal.hunks.length
            && this.mode(proposal.document) === 'suggest'
            ? proposal
            : undefined;
    }

    /** Coding style rules reported on the lines a hunk changes. */
    private fixedRules(proposal: Proposal, hunk: Hunk): string[] {
        const diagnostics =
            vscode.languages.getDiagnostics?.(proposal.document.uri) ?? [];
        const first = hunk.oldLines.length ? hunk.start : hunkEndLine(hunk);
        const last = hunkEndLine(hunk);
        const rules = diagnostics
            .filter(d => d.source === 'Banana'
                && d.range.start.line >= first && d.range.start.line <= last)
            .map(d => String(
                typeof d.code === 'object' ? d.code.value : d.code ?? '',
            ))
            .filter(code => /^[A-Z]-[A-Z]\d+$/.test(code));
        if (hunk.kind === 'header') rules.push('C-G1');

        return [...new Set(rules)];
    }

    private async preview(uri?: vscode.Uri) {
        const proposal = this.get(uri);
        if (!proposal) return;
        const base = encodeURIComponent(proposal.document.uri.toString());
        const before = vscode.Uri.parse(
            `banana-correction:/${base}/before.c?v=${proposal.version}`,
        );
        const after = vscode.Uri.parse(
            `banana-correction:/${base}/after.c?v=${proposal.version}`,
        );
        if (this.previews.size >= 20) this.previews.clear();
        this.previews.set(before.toString(), proposal.before);
        this.previews.set(after.toString(), proposal.after);
        await vscode.commands.executeCommand(
            'vscode.diff',
            before,
            after,
            ui('Bananabox Coding Style · suggested corrections'),
        );
    }

    private async accept(uri?: vscode.Uri) {
        const proposal = this.get(uri);
        if (!proposal) return;
        const edit = new vscode.WorkspaceEdit();
        edit.set(proposal.document.uri, replacements(proposal));
        if (await vscode.workspace.applyEdit(edit)) {
            this.clear(proposal.document.uri);
        }
    }

    /**
     * Accepts one hunk; the others stay proposed, moved to where the text now
     * is.
     */
    private async acceptOne(uri?: vscode.Uri, index?: number) {
        const proposal = this.get(uri);
        if (!proposal) return;
        const hunk = proposal.hunks[
            typeof index === 'number' && proposal.hunks[index]
                ? index
                : proposal.active
        ]!;
        const document = proposal.document;
        const key = document.uri.toString();
        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const text = hunk.newText.replace(/\n/g, eol);
        this.expected.set(
            key,
            proposal.before.slice(0, hunk.startOffset)
                + text
                + proposal.before.slice(hunk.endOffset),
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(
                document.positionAt(hunk.startOffset),
                document.positionAt(hunk.endOffset),
            ),
            text,
        );
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            this.expected.delete(key);
        } else if (proposal.version !== document.version
            && this.proposals.get(key) === proposal) {
            this.rebase(document);
        }
    }

    /**
     * After one of our hunk edits: diff the new text against the same target
     * again.
     */
    private rebase(document: vscode.TextDocument) {
        const key = document.uri.toString();
        const proposal = this.proposals.get(key);
        if (!proposal || proposal.version === document.version) return;

        proposal.before = document.getText();
        proposal.version = document.version;
        proposal.hunks = computeHunks(proposal.before, proposal.after);
        if (!proposal.hunks.length) {
            this.clear(document.uri);
            return;
        }
        proposal.active = Math.min(proposal.active, proposal.hunks.length - 1);
        this.cache.set(key, { version: proposal.version, proposal });
        this.update();
    }

    private move(uri: vscode.Uri | undefined, direction: 1 | -1) {
        const proposal = this.get(uri);
        if (!proposal) return;
        proposal.active = (proposal.active + direction + proposal.hunks.length)
            % proposal.hunks.length;
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document === proposal.document,
        );
        const hunk = proposal.hunks[proposal.active]!;
        if (editor) {
            const line = Math.min(
                hunk.oldLines.length ? hunk.start : hunkEndLine(hunk),
                proposal.document.lineCount - 1,
            );
            const position = new vscode.Position(
                line,
                proposal.document.lineAt(line).text.length,
            );
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
        }
        this.update();
    }

    /** The suggestion follows the cursor, like next-edit suggestions. */
    private follow(editor: vscode.TextEditor) {
        const proposal = this.get(editor.document.uri);
        if (!proposal) return;
        const next = hunkNear(proposal.hunks, editor.selection.active.line);
        if (next !== proposal.active) {
            proposal.active = next;
            this.update();
        } else {
            this.updateContext();
        }
    }

    private clear(uri: vscode.Uri) {
        const key = uri.toString();
        this.running.get(key)?.abort();
        this.running.delete(key);
        this.expected.delete(key);
        if (this.proposals.delete(key)) this.update();
    }

    private update() {
        this.changed.fire();
        for (const editor of vscode.window.visibleTextEditors) {
            this.render(editor);
        }
        this.updateContext();
    }

    private updateContext() {
        const editor = vscode.window.activeTextEditor;
        const proposal = this.get(editor?.document.uri);
        let atCursor = false;
        if (proposal && editor?.selection) {
            const hunk = proposal.hunks[proposal.active]!;
            const line = editor.selection.active.line;
            atCursor = editor.selection.isEmpty !== false
                && line >= Math.max(0, hunk.start - 1)
                && line <= Math.max(hunkEndLine(hunk), hunk.start);
        }
        void vscode.commands.executeCommand(
            'setContext',
            'bananabox.codingStyle.hasCorrections',
            !!proposal,
        );
        void vscode.commands.executeCommand(
            'setContext',
            'bananabox.codingStyle.correctionAtCursor',
            atCursor,
        );
    }

    private render(editor: vscode.TextEditor) {
        const proposal = this.get(editor.document.uri);
        const removedText: vscode.DecorationOptions[] = [];
        const removedLine: vscode.DecorationOptions[] = [];
        const inserted: vscode.DecorationOptions[] = [];
        const pending: vscode.DecorationOptions[] = [];
        if (proposal) {
            const document = editor.document;
            const last = Math.max(0, document.lineCount - 1);
            proposal.hunks.forEach((hunk, index) => {
                const first = Math.min(hunk.start, last);
                if (index !== proposal.active) {
                    const end = Math.min(hunkEndLine(hunk), last);
                    for (let line = first; line <= end; line++) {
                        pending.push({
                            range: new vscode.Range(line, 0, line, 0),
                        });
                    }
                    return;
                }
                const hover = new vscode.MarkdownString();
                hover.appendMarkdown(
                    `**${hunk.title}** — ${ui('Tab to accept, Alt+] for the next one, Esc to dismiss')}\n\n`,
                );
                hover.appendCodeblock(hunkDiff(hunk), 'diff');
                if (hunk.inline && hunk.kind !== 'header') {
                    hunk.inline.forEach((change, k) => {
                        const line = hunk.start + k;
                        if (line > last) return;
                        if (change.remove > 0) {
                            removedText.push({
                                range: new vscode.Range(
                                    line,
                                    change.start,
                                    line,
                                    change.start + change.remove,
                                ),
                                hoverMessage: hover,
                            });
                        }
                        if (change.insert) {
                            const at = new vscode.Range(
                                line,
                                change.start + change.remove,
                                line,
                                change.start + change.remove,
                            );
                            inserted.push({
                                range: at,
                                hoverMessage: hover,
                                renderOptions: {
                                    before: {
                                        contentText: visible(change.insert),
                                    },
                                },
                            });
                        }
                    });
                    return;
                }
                const stop = Math.min(
                    hunk.start + hunk.oldLines.length,
                    last + 1,
                );
                for (let line = first; line < stop; line++) {
                    removedLine.push({
                        range: new vscode.Range(
                            line,
                            0,
                            line,
                            document.lineAt(line).text.length,
                        ),
                        hoverMessage: hover,
                    });
                }
                if (hunk.newLines.length) {
                    const anchor = Math.min(hunkEndLine(hunk), last);
                    const shown = hunk.kind === 'header'
                        ? `＋ ${ui('Epitech header ({n} lines)', { n: hunk.newLines.filter(l => l.trim()).length })}`
                        : hunk.newLines.every(line => !line.trim())
                            ? `＋ ${ui('blank line')}`
                            : `⟶ ${clip(hunk.newLines.map(line => line.trim()).filter(Boolean).join(' ⏎ '))}`;
                    const column = document.lineAt(anchor).text.length;
                    inserted.push({
                        range: new vscode.Range(anchor, column, anchor, column),
                        hoverMessage: hover,
                        renderOptions: { after: { contentText: ` ${shown} ` } },
                    });
                }
            });
        }

        editor.setDecorations(this.removedText, removedText);
        editor.setDecorations(this.removedLine, removedLine);
        editor.setDecorations(this.inserted, inserted);
        editor.setDecorations(this.pending, pending);
    }

    invalidate() {
        this.reset();
    }

    private reset() {
        this.validator.clear();
        for (const controller of this.running.values()) controller.abort();
        this.running.clear();
        this.proposals.clear();
        this.previews.clear();
        this.expected.clear();
        this.cache.clear();
        this.setupStatus.hide();
        this.update();
    }

    dispose() {
        this.toolchain?.dispose();
        this.reset();
        this.changed.dispose();
        for (const subscription of this.subscriptions) subscription.dispose();
    }
}

/**
 * Smallest contiguous replacement: avoid replacing unchanged headers and
 * trailing code.
 */
function replacement(proposal: Proposal): vscode.TextEdit {
    let start = 0;
    let endBefore = proposal.before.length;
    let endAfter = proposal.after.length;
    while (start < endBefore && start < endAfter
        && proposal.before[start] === proposal.after[start]) {
        start++;
    }
    while (endBefore > start && endAfter > start
        && proposal.before[endBefore - 1] === proposal.after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }

    const range = new vscode.Range(
        proposal.document.positionAt(start),
        proposal.document.positionAt(endBefore),
    );
    return vscode.TextEdit.replace(
        range,
        proposal.after.slice(start, endAfter),
    );
}

function replacements(proposal: Proposal): vscode.TextEdit[] {
    const edits = [replacement(proposal)];
    if (proposal.document.eol === vscode.EndOfLine.CRLF) {
        edits.push(vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF));
    }
    return edits;
}

async function waitForValidation(
    validation: Promise<boolean>,
    signal: AbortSignal,
): Promise<boolean> {
    let onAbort: () => void = () => {};
    const cancelled = new Promise<false>(resolve => {
        onAbort = () => resolve(false);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    try {
        return await Promise.race([validation, cancelled]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}
