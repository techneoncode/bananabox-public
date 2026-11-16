import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { BananaCodeActions, trailingWhitespaceEdit } from './codeActions';
import { FormatterToolchain } from './toolchain';
import { Corrections } from './corrections';
import { CorrectionValidator } from './validation';
import {
    affectsAnalysis,
    clearSettingsCache,
    readSettings,
    setRemoteLensEnabled,
    isRemoteLensEnabled,
} from './config';
import {
    cleanupTempFiles,
    EpiclangNotFoundError,
    lintFile,
    LintResult,
} from './engine';
import { matchesAny } from './glob';
import { Limiter } from './limiter';
import { summarize } from './parser';
import { clearProjectCaches, detectProjectRoot } from './project';
import { computeRange } from './ranges';
import { ruleFamily } from './rules';
import { BananaDiagnostic, Settings, Summary } from './types';
import type {
    ProjectRules,
    ProjectRulesProvider,
    StyleApi,
    StyleScanIssue,
    StyleScanOptions,
    StyleScanResult,
} from './api';
import { ProjectNames, unauthorizedCalls } from './functions';
import {
    addDebugFlag,
    isMakefilePath,
    lintMakefile,
    makefileHasDebug,
    makefileVariable,
} from './makefile';
import { shellSplit } from './shell';
import {
    ByteUnit,
    errorColumn,
    errorFindings,
    formatBytes,
    GroupedError,
    groupErrors,
    groupLeaks,
    Leak,
    leakColumn,
    leakFindings,
    parseValgrindLog,
    spawnValgrind,
    valgrindInstalled,
} from './valgrind';
import type { ValgrindVM } from '../shared/types';
import {
    Decorations,
    ERROR_LENS_ID,
    FileView,
    STYLE_LANGUAGES,
    StatusBar,
    SummaryLensProvider,
    formatCounts,
} from './ui';

type Reason = 'open' | 'save' | 'type' | 'manual' | 'config';

interface FileState extends FileView {
    hash: string;
    stamp: string;
    items: BananaDiagnostic[];
}

const EMPTY: Summary = {
    fatal: 0,
    major: 0,
    minor: 0,
    info: 0,
    other: 0,
    functions: 0,
};

const sourceOf = (item: BananaDiagnostic): string =>
    item.bucket || item.kind ? 'Banana' : 'epiclang';

function staticResult(
    items: BananaDiagnostic[],
    projectRoot: string,
    detail: string,
    durationMs = 0,
): LintResult {
    return {
        items,
        aborted: false,
        timedOut: false,
        exitCode: 0,
        durationMs,
        projectRoot,
        source: 'bananabox',
        detail,
        command: '',
    };
}

/** C files a Makefile builds: its folder, minus hidden and excluded folders and those with their own Makefile. */
function makefileSources(root: string, exclude: readonly string[]): string[] {
    const found: string[] = [];
    let budget = 5000;
    const walk = (dir: string, rel: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        if (rel && entries.some(entry => entry.isFile()
            && /^(?:gnu)?makefile$/i.test(entry.name))) return;
        for (const entry of entries) {
            if (--budget < 0) return;
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.name.startsWith('.') || matchesAny(exclude, child)
                || (entry.isDirectory()
                    && matchesAny(exclude, `${child}/x`))) continue;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
            else if (entry.isFile() && entry.name.endsWith('.c'))
                found.push(child);
        }
    };
    walk(root, '');
    return found;
}

function isInside(file: string, root: string): boolean {
    const rel = path.relative(root, file);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function contentHash(text: string): string {
    return crypto.createHash('sha1').update(text).digest('hex');
}

class BananaLens implements vscode.Disposable {
    private settings: Settings = readSettings();
    private readonly output = vscode.window.createOutputChannel(
        'Bananabox Coding Style',
    );
    private readonly collection = vscode.languages.createDiagnosticCollection(
        'bananalens',
    );
    private readonly decorations = new Decorations();
    private readonly statusBar = new StatusBar();
    private readonly lens = new SummaryLensProvider(
        (uri) => this.states.get(uri.fsPath),
        (uri) => readSettings(uri),
    );
    private readonly states = new Map<string, FileState>();
    private readonly inflight = new Map<string, AbortController>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly limiter = new Limiter(this.concurrency());
    private readonly validator = new CorrectionValidator(this.limiter);
    private readonly workspaceScans = new Set<AbortController>();
    private notFoundShown = false;
    private lastConfigError = '';
    private refreshTimer: NodeJS.Timeout | undefined;
    private readonly inlineModes = new Map<string, 'compact' | 'full'>();
    private corrections?: Corrections;
    private rulesProvider?: ProjectRulesProvider;
    private readonly projectNames = new ProjectNames();
    /** Leaks of the last valgrind run per file, with the hash of the text they were found on. */
    private readonly leaks = new Map<
        string,
        { hash: string; leaks: Leak[]; errors: GroupedError[] }
    >();
    private readonly valgrindRuns = new vscode.EventEmitter<{
        root: string;
        run: ValgrindVM;
    }>();
    readonly onDidValgrind = this.valgrindRuns.event;
    /** Checks in flight, by project root, to stop them from the project page. */
    private readonly valgrindAborts = new Map<string, AbortController>();

    refreshAvailability(): void {
        this.settings = readSettings();
        this.corrections?.invalidate();
        this.refreshAll(true);
    }

    readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.disposables.push(
            this.output,
            this.collection,
            this.decorations,
            this.statusBar,
            this.lens,
            this.valgrindRuns,
        );
    }

    dispose(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        for (const t of this.timers.values()) clearTimeout(t);
        for (const c of this.inflight.values()) c.abort();
        for (const c of this.workspaceScans) c.abort();
        this.disposables.forEach((d) => d.dispose());
        cleanupTempFiles();
    }

    start(): void {
        const selector = [
            { language: 'c', scheme: 'file' },
            { language: 'cpp', scheme: 'file' },
            { language: 'makefile', scheme: 'file' },
        ];
        const corrections = new Corrections(
            message => this.output.appendLine(message),
            new FormatterToolchain(
                this.context.globalStorageUri.fsPath,
                message => this.output.appendLine(message),
            ),
            this.validator,
        );
        this.corrections = corrections;
        this.context.subscriptions.push(
            this,
            corrections,
            vscode.languages.registerCodeLensProvider(selector, this.lens),
            vscode.languages.registerCodeActionsProvider(
                selector,
                new BananaCodeActions(),
                BananaCodeActions.metadata,
            ),

            vscode.workspace.onDidSaveTextDocument((d) => {
                this.cancelScheduledLint(d.uri.fsPath);
                if (readSettings(d.uri).runOnSave) void this.lint(d, 'save');
            }),
            vscode.workspace.onDidCloseTextDocument((d) => this.forget(d.uri)),
            vscode.workspace.onDidOpenTextDocument((d) => {
                if (readSettings(d.uri).runOnOpen) {
                    this.schedule(d, 150, 'open');
                }
            }),
            vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
            vscode.window.onDidChangeActiveTextEditor((e) => {
                this.renderEditor(e);
                if (e && readSettings(e.document.uri).runOnOpen) {
                    this.schedule(e.document, 80, 'open');
                }
            }),
            vscode.window.onDidChangeVisibleTextEditors(() => {
                this.decorations.releaseHidden(
                    vscode.window.visibleTextEditors,
                );
                vscode.window.visibleTextEditors
                    .forEach(e => this.renderEditor(e));
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('errorLens')) this.renderAll();
                if (!e.affectsConfiguration('bananalens')) return;

                clearSettingsCache();
                this.settings = readSettings();
                this.limiter.setMax(this.concurrency());
                if (e.affectsConfiguration('bananalens.valgrind.unit')) {
                    this.showLeaks(this.leaks.keys());
                }
                if (affectsAnalysis(e)) {
                    this.refreshAll(true);
                } else {
                    this.scheduleUiRefresh();
                }
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(() =>
                this.refreshAll(true)),
            vscode.extensions.onDidChange(() => this.renderAll()),
            vscode.workspace.onDidDeleteFiles((e) =>
                e.files.forEach((f) => this.forget(f))),
            vscode.workspace.onDidRenameFiles((e) =>
                e.files.forEach((f) => this.forget(f.oldUri))),
        );

        this.watchProjectFiles(corrections);
        this.registerCommands(corrections);
        this.refreshAll(false);
    }

    private watchProjectFiles(corrections: Corrections): void {
        const buildWatcher = vscode.workspace.createFileSystemWatcher(
            '**/{Makefile,makefile,GNUmakefile,*.mk,compile_commands.json,.bananalens.json,bananalens.json}',
        );
        const headerWatcher = vscode.workspace
            .createFileSystemWatcher('**/*.{h,hpp,hh}');
        const sourceWatcher = vscode.workspace
            .createFileSystemWatcher('**/*.c');
        const forgetNames = (uri: vscode.Uri): void =>
            this.projectNames.invalidate(uri.fsPath);
        const invalidate = (uri: vscode.Uri): void => {
            forgetNames(uri);
            clearProjectCaches();
            corrections.invalidate();
            for (const state of this.states.values()) state.stamp = '';
        };
        const sourcesChanged = (uri: vscode.Uri): void => {
            forgetNames(uri);
            for (const doc of vscode.workspace.textDocuments) {
                if (doc.languageId !== 'makefile'
                    || !this.shouldLint(doc)) continue;
                const state = this.states.get(doc.uri.fsPath);
                if (state) state.stamp = '';
                this.schedule(doc, 300, 'config');
            }
        };
        const rebuild = (uri: vscode.Uri): void => {
            invalidate(uri);
            this.refreshAll(true);
        };
        this.context.subscriptions.push(
            buildWatcher,
            headerWatcher,
            sourceWatcher,
            sourceWatcher.onDidChange(forgetNames),
            sourceWatcher.onDidCreate(sourcesChanged),
            sourceWatcher.onDidDelete(sourcesChanged),
            buildWatcher.onDidChange(rebuild),
            buildWatcher.onDidCreate(rebuild),
            buildWatcher.onDidDelete(rebuild),
            headerWatcher.onDidChange(invalidate),
            headerWatcher.onDidCreate(invalidate),
            headerWatcher.onDidDelete(invalidate),
        );
    }

    private registerCommands(corrections: Corrections): void {
        const register = (
            name: string,
            handler: (...args: any[]) => unknown,
        ): void => {
            this.context.subscriptions.push(vscode.commands.registerCommand(
                `epibox.codingStyle.${name}`,
                (...args: any[]) => {
                    if (!isRemoteLensEnabled()) return;
                    return handler(...args);
                },
            ));
        };
        register('run', (uri?: vscode.Uri) => {
            if (!uri) return this.withActive((d) => this.lint(d, 'manual'));
            const document = vscode.workspace.textDocuments.find(
                d => d.uri.toString() === uri.toString(),
            );
            if (document) return this.lint(document, 'manual');
        });
        register('runWorkspace', () => this.runProject());
        register('refreshBuildConfiguration', () => {
            clearProjectCaches();
            corrections.invalidate();
            return this.withActive(document => this.lint(document, 'manual'));
        });
        register('showIssues', (uri?: vscode.Uri) => this.showIssues(uri));
        register('nextIssue', () => this.jump(1));
        register('previousIssue', () => this.jump(-1));
        register('fixTrailingWhitespace', () => this.withActive(
            async document => {
                await vscode.workspace.applyEdit(
                    trailingWhitespaceEdit(document),
                );
            },
        ));
        register('clear', () => this.clearAll());
        register('toggle', async () => {
            const cfg = vscode.workspace.getConfiguration('bananalens');
            await cfg.update(
                'enabled',
                !this.settings.enabled,
                vscode.ConfigurationTarget.Global,
            );
        });
        register('toggleInline', async () => {
            const uri = vscode.window.activeTextEditor?.document.uri;
            const cfg = vscode.workspace.getConfiguration('bananalens', uri);
            const inspected = cfg.inspect<string>('inline.mode');
            const target = inspected?.workspaceFolderValue !== undefined
                ? vscode.ConfigurationTarget.WorkspaceFolder
                : inspected?.workspaceValue !== undefined
                    ? vscode.ConfigurationTarget.Workspace
                    : vscode.ConfigurationTarget.Global;
            const key = `${target}:${target === vscode.ConfigurationTarget.WorkspaceFolder ? vscode.workspace.getWorkspaceFolder(uri!)?.uri.toString() : ''}`;
            const current = cfg.get<string>('inline.mode', 'full');
            if (current === 'compact' || current === 'full') {
                this.inlineModes.set(key, current);
            }
            await cfg.update(
                'inline.mode',
                current === 'off'
                    ? this.inlineModes.get(key) ?? 'full'
                    : 'off',
                target,
            );
        });
        register('configureAppearance', async () => {
            const { showAppearance } = await import('./appearance');
            showAppearance(this.context);
        });
        register('showOutput', () => this.output.show(true));
        register('valgrind', () => this.valgrindFromEditor(
            root => this.runValgrind(root)
                .then(run => this.reportValgrind(root, run)),
        ));
        register('configureValgrind', () => this.valgrindFromEditor(
            root => this.editValgrindCommand(root),
        ));
        register('locateEpiclang', () => this.locateCompiler());
    }

    private concurrency(): number {
        const configured = readSettings().maxConcurrency;
        return configured > 0
            ? configured
            : Math.max(
                1,
                Math.min(4, Math.floor(os.availableParallelism() / 2)),
            );
    }

    private shouldLint(doc: vscode.TextDocument): boolean {
        const settings = readSettings(doc.uri);
        if (!settings.enabled || !vscode.workspace.isTrusted) return false;
        if (doc.isClosed || doc.isUntitled || doc.uri.scheme !== 'file'
            || !STYLE_LANGUAGES.has(doc.languageId)) return false;
        if (doc.languageId === 'makefile'
            && !settings.makefile.enabled) return false;
        const rel = vscode.workspace.asRelativePath(doc.uri, false);
        return !matchesAny(settings.exclude, rel);
    }

    private onChange(event: vscode.TextDocumentChangeEvent): void {
        const doc = event.document;
        if (event.contentChanges.length === 0
            || !this.shouldLint(doc)) return;
        this.inflight.get(doc.uri.fsPath)?.abort();
        this.cancelScheduledLint(doc.uri.fsPath);
        const state = this.states.get(doc.uri.fsPath);
        if (state && !state.stale) {
            state.stale = true;
            this.scheduleUiRefresh();
        }
        const settings = readSettings(doc.uri);
        if (settings.runOnType) {
            const delay = Math.max(
                100,
                Number.isFinite(settings.debounceMs)
                    ? settings.debounceMs
                    : 600,
            );
            this.schedule(doc, delay, 'type');
        }
    }

    private cancelScheduledLint(file: string): void {
        clearTimeout(this.timers.get(file));
        this.timers.delete(file);
    }

    private schedule(
        doc: vscode.TextDocument,
        delay: number,
        reason: Reason,
    ): void {
        if (!this.shouldLint(doc)) return;
        const key = doc.uri.fsPath;
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            void this.lint(doc, reason);
        }, delay));
    }

    private refreshAll(force: boolean): void {
        if (!this.settings.enabled || !vscode.workspace.isTrusted) {
            this.clearAll();
            return;
        }
        for (const doc of vscode.workspace.textDocuments) {
            if (!this.shouldLint(doc)) continue;
            const visible = vscode.window.visibleTextEditors
                .some((e) => e.document === doc);
            if (force ? visible : readSettings(doc.uri).runOnOpen) {
                this.schedule(doc, 200, force ? 'config' : 'open');
            }
        }
        this.renderAll();
    }

    private async withActive(
        fn: (doc: vscode.TextDocument) => unknown,
    ): Promise<void> {
        const doc = vscode.window.activeTextEditor?.document;
        if (doc && doc.uri.scheme === 'file'
            && STYLE_LANGUAGES.has(doc.languageId)) await fn(doc);
    }

    private stamp(
        settings: Settings = this.settings,
        rules?: ProjectRules,
    ): string {
        return JSON.stringify([
            rules ?? null,
            settings.functions,
            settings.makefile,
            settings.compiler,
            settings.extraArgs,
            settings.includePaths,
            settings.autoIncludes,
            settings.useCompileCommands,
            settings.useMakefile,
            settings.makeDryRun,
            settings.ignoreWarnings,
            settings.configFile,
        ]);
    }

    private async lint(
        doc: vscode.TextDocument,
        reason: Reason,
    ): Promise<void> {
        if (!this.shouldLint(doc)) return;
        const key = doc.uri.fsPath;
        this.cancelScheduledLint(key);
        const version = doc.version;
        const dirty = doc.isDirty;
        if (dirty && reason !== 'type' && reason !== 'manual') return;

        const text = doc.getText();
        const hash = contentHash(text);
        const settings = readSettings(doc.uri);
        const rules = this.rulesFor(key);
        const stamp = this.stamp(settings, rules);
        const previous = this.states.get(key);
        if (reason !== 'manual' && previous && previous.hash === hash
            && previous.stamp === stamp
            && !previous.error && !previous.running) {
            if (previous.stale) {
                previous.stale = false;
                this.renderAll();
            }
            return;
        }

        if (doc.languageId === 'makefile') {
            const started = Date.now();
            const items = this.checkMakefile(key, text, settings, rules);
            this.applyResult(
                doc.uri,
                text.split(/\r?\n/),
                hash,
                stamp,
                staticResult(
                    items,
                    rules?.root ?? path.dirname(key),
                    rules?.makefile
                        ? `Makefile · rules from ${rules.source ?? 'the subject'}`
                        : 'Makefile',
                    Date.now() - started,
                ),
                reason === 'manual',
            );
            return;
        }

        this.inflight.get(key)?.abort();
        const controller = new AbortController();
        this.inflight.set(key, controller);
        this.patchState(key, { running: true });
        const extra = this.functionFindings(key, text, settings, rules)
            .catch(() => [] as BananaDiagnostic[]);

        try {
            const result = await this.limiter.run(
                () => controller.signal.aborted
                    ? Promise.resolve(undefined)
                    : lintFile({
                        file: key,
                        workspaceRoot: vscode.workspace
                            .getWorkspaceFolder(doc.uri)?.uri.fsPath,
                        content: dirty ? text : undefined,
                        settings,
                        signal: controller.signal,
                        log: (l) => this.output.appendLine(l),
                    }),
                controller.signal,
                true,
            );
            if (!result || controller.signal.aborted || result.aborted
                || doc.isClosed || doc.version !== version) return;
            if (settings.corrections.mode !== 'off') {
                this.validator.remember({
                    file: key,
                    workspaceRoot: vscode.workspace
                        .getWorkspaceFolder(doc.uri)?.uri.fsPath,
                    settings,
                }, text, result);
            }
            const functions = await extra;
            if (controller.signal.aborted || doc.isClosed
                || doc.version !== version) return;
            this.applyResult(
                doc.uri,
                text.split(/\r?\n/),
                hash,
                stamp,
                { ...result, items: [...result.items, ...functions] },
                reason === 'manual',
            );
        } catch (error) {
            if (controller.signal.aborted) return;
            const functions = await extra;
            if (functions.length && !doc.isClosed && doc.version === version) {
                this.applyResult(
                    doc.uri,
                    text.split(/\r?\n/),
                    hash,
                    '',
                    staticResult(
                        functions,
                        rules?.root ?? path.dirname(key),
                        'Unauthorized functions only',
                    ),
                    false,
                );
            }
            this.handleError(key, error, reason === 'manual');
        } finally {
            if (this.inflight.get(key) === controller) {
                this.inflight.delete(key);
                if (this.states.has(key)) {
                    this.patchState(key, { running: false });
                }
            }
        }
    }

    /** The subject's requirements for the project holding `file`, when the Bananabox account knows that project. */
    private rulesFor(file: string): ProjectRules | undefined {
        const rules = this.rulesProvider?.(file);
        if (!rules) return undefined;
        const relative = path.relative(rules.root, file);
        return relative && !relative.startsWith('..')
            && !path.isAbsolute(relative) ? rules : undefined;
    }

    private checkMakefile(
        file: string,
        text: string,
        settings: Settings,
        rules: ProjectRules | undefined,
    ): BananaDiagnostic[] {
        const dir = path.resolve(path.dirname(file));
        const workspace = vscode.workspace
            .getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath;
        const main = path.basename(file).toLowerCase() !== 'makefile'
                && path.basename(file) !== 'GNUmakefile'
            ? false
            : rules
                ? dir === path.resolve(rules.root)
                : dir === (workspace && path.resolve(workspace))
                    || fs.existsSync(path.join(dir, '.git'));
        return lintMakefile(file, text, {
            baseRules: settings.makefile.requiredRules,
            subject: main && rules?.makefile
                ? { ...rules.makefile, source: rules.source }
                : undefined,
            main,
            maxLineLength: settings.makefile.maxLineLength,
            wildcard: settings.makefile.wildcard,
            sources: settings.makefile.missingSources
                ? {
                    files: makefileSources(dir, settings.exclude),
                    ignore: settings.makefile.missingSourcesIgnore,
                }
                : undefined,
        });
    }

    private async functionFindings(
        file: string,
        text: string,
        settings: Settings,
        rules: ProjectRules | undefined,
    ): Promise<BananaDiagnostic[]> {
        if (!settings.functions.enabled
            || !rules?.allowedFunctions?.length) return [];
        return unauthorizedCalls(
            file,
            text,
            rules.root,
            rules.allowedFunctions,
            await this.projectNames.get(rules.root),
        );
    }

    /** Called when a project's subject requirements change: recheck what is open. */
    refreshProjectRules(): void {
        for (const state of this.states.values()) state.stamp = '';
        this.projectNames.invalidate();
        this.refreshAll(true);
    }

    useProjectRules(provider: ProjectRulesProvider): void {
        this.rulesProvider = provider;
        this.refreshProjectRules();
    }

    private applyResult(
        uri: vscode.Uri,
        lines: string[],
        hash: string,
        stamp: string,
        result: LintResult,
        manual: boolean,
    ): void {
        const key = uri.fsPath;
        if (result.skipped) {
            this.forget(uri);
            return;
        }

        if (result.configError && result.configError !== this.lastConfigError) {
            this.lastConfigError = result.configError;
            this.output.appendLine(`[config] ${result.configError}`);
            void vscode.window.showWarningMessage(
                `Bananabox Coding Style: ${result.configError}`,
            );
        }
        if (result.timedOut) {
            this.output.appendLine(
                `[timeout] ${key} exceeded ${this.settings.timeoutMs} ms`,
            );
        }

        const items = [
            ...result.items.filter(item => item.plugin !== 'valgrind'),
            ...this.valgrindItems(key, hash, lines),
        ];
        this.states.set(key, {
            hash, stamp, items,
            summary: summarize(items),
            running: false,
            stale: false,
            durationMs: result.durationMs,
            detail: result.detail,
            command: result.command,
            error: result.timedOut ? 'timed out' : undefined,
        });

        if (this.settings.problems) {
            this.collection.set(
                uri,
                items.map((i) => this.toDiagnostic(i, lines)),
            );
        } else {
            this.collection.delete(uri);
        }

        this.output.appendLine(`${new Date().toLocaleTimeString()}  ${path.basename(key)}  ${items.length} finding(s)  ${result.durationMs} ms  [${result.detail}]`);
        if (this.settings.verbose) this.output.appendLine(`  $ ${result.command}`);
        if (result.unparsed) {
            this.output.appendLine(`  epiclang exited with ${result.exitCode} and no parsable diagnostic:\n${result.unparsed}`);
            if (manual) {
                void vscode.window.showWarningMessage(`Bananabox Coding Style: epiclang returned ${result.exitCode} but no diagnostic could be parsed. See the Bananabox Coding Style output.`);
            }
        }
        this.scheduleUiRefresh();
    }

    private handleError(key: string, error: unknown, manual: boolean): void {
        this.output.appendLine(
            `[error] ${path.basename(key)}: ${String(error)}`,
        );
        this.patchState(key, {
            running: false,
            error: error instanceof EpiclangNotFoundError
                ? 'epiclang not found'
                : 'failed',
        });
        if (error instanceof EpiclangNotFoundError) {
            if (!this.notFoundShown || manual) {
                this.notFoundShown = true;
                void vscode.window
                    .showErrorMessage(
                        error.message,
                        'Locate epiclang…',
                        'Open settings',
                    )
                    .then((choice) => {
                        if (choice === 'Locate epiclang…') {
                            void this.locateCompiler();
                        } else if (choice === 'Open settings') {
                            void vscode.commands.executeCommand(
                                'workbench.action.openSettings',
                                'bananalens.compiler',
                            );
                        }
                    });
            }
        } else if (manual) {
            void vscode.window.showErrorMessage(
                `Bananabox Coding Style: ${String(error)}`,
            );
        }
    }

    private async locateCompiler(): Promise<void> {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            title: 'Select the epiclang executable',
            openLabel: 'Use this executable',
        });
        if (!picked?.[0]) return;
        await vscode.workspace
            .getConfiguration('bananalens')
            .update(
                'compiler',
                picked[0].fsPath,
                vscode.ConfigurationTarget.Global,
            );
        this.notFoundShown = false;
    }

    /** The coding style engine is usable (enabled in settings and the workspace is trusted). */
    isEnabled(): boolean {
        return this.settings.enabled && vscode.workspace.isTrusted;
    }

    /** C sources and headers of a project. Uses the workspace index when possible, the disk otherwise (e.g. a remembered clone). */
    private async listSources(root: string): Promise<vscode.Uri[]> {
        if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))) {
            const exclude = `{${this.settings.exclude.join(',')}}`;
            return vscode.workspace.findFiles(
                new vscode.RelativePattern(root, this.settings.projectScanGlob),
                exclude,
            );
        }
        const found: vscode.Uri[] = [];
        const walk = async (dir: string): Promise<void> => {
            const entries = await fs.promises.readdir(dir, {
                withFileTypes: true,
            });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                const rel = path.relative(root, full)
                    .split(path.sep)
                    .join('/');
                if (entry.isDirectory()) {
                    if (!matchesAny(this.settings.exclude, rel)
                        && !matchesAny(this.settings.exclude, `${rel}/x`)) {
                        await walk(full);
                    }
                } else if (entry.isFile()
                    && matchesAny([this.settings.projectScanGlob], rel)
                    && !matchesAny(this.settings.exclude, rel)) {
                    found.push(vscode.Uri.file(full));
                }
            }
        };
        await walk(root);
        return found;
    }

    /**
     * Checks every C file of a project and returns the coding style findings. Results also feed the Problems
     * panel and the inline lens, so the user can fix them right away.
     */
    async scanProject(
        root: string,
        options: StyleScanOptions = {},
    ): Promise<StyleScanResult> {
        const started = Date.now();
        const empty: Summary = { ...EMPTY };
        if (!this.isEnabled()) {
            return {
                root,
                files: 0,
                summary: empty,
                issues: [],
                durationMs: 0,
                cancelled: false,
                error: {
                    message: 'Coding style is disabled or the workspace is not trusted.',
                    notFound: false,
                },
            };
        }
        const files = await this.listSources(root);
        const makefile = ['Makefile', 'makefile', 'GNUmakefile']
            .map(name => path.join(root, name))
            .find(file => fs.existsSync(file));
        if (makefile && this.settings.makefile.enabled
            && !files.some(uri => uri.fsPath === makefile)) {
            files.push(vscode.Uri.file(makefile));
        }
        if (!this.isEnabled()) {
            return {
                root,
                files: 0,
                summary: empty,
                issues: [],
                durationMs: 0,
                cancelled: true,
            };
        }
        const workspaceRoot = vscode.workspace
            .getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath ?? root;
        const controller = new AbortController();
        const forward = (): void => controller.abort();
        options.signal?.addEventListener('abort', forward, { once: true });
        if (options.signal?.aborted) controller.abort();
        this.workspaceScans.add(controller);
        let failure: unknown;
        let done = 0;
        const findings: BananaDiagnostic[] = [];
        try {
            await Promise.all(files.map((uri) => this.limiter.run(async () => {
                if (controller.signal.aborted) return;
                try {
                    findings.push(
                        ...await this.lintProjectFile(
                            uri,
                            workspaceRoot,
                            controller.signal,
                        ),
                    );
                } catch (e) {
                    failure ??= e;
                    controller.abort();
                } finally {
                    options.onProgress?.(++done, files.length);
                }
            })));
        } finally {
            options.signal?.removeEventListener('abort', forward);
            this.workspaceScans.delete(controller);
        }

        const summary: Summary = { ...EMPTY };
        const issues: StyleScanIssue[] = [];
        for (const item of findings) {
            if (!item.bucket) continue;
            summary[item.bucket]++;
            issues.push({
                file: item.file,
                line: item.line,
                column: item.column,
                bucket: item.bucket,
                ruleId: item.ruleId,
                message: item.message,
            });
        }
        const durationMs = Date.now() - started;
        if (failure) {
            this.handleError(root, failure, options.manual === true);
            return {
                root,
                files: files.length,
                summary,
                issues,
                durationMs,
                cancelled: false,
                error: {
                    message: failure instanceof Error
                        ? failure.message
                        : String(failure),
                    notFound: failure instanceof EpiclangNotFoundError,
                },
            };
        }
        return {
            root,
            files: files.length,
            summary,
            issues,
            durationMs,
            cancelled: controller.signal.aborted,
        };
    }

    private async runProject(): Promise<void> {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage(
                'Bananabox Coding Style is disabled in untrusted workspaces.',
            );
            return;
        }
        const active = vscode.window.activeTextEditor?.document.uri;
        const folder = (active && vscode.workspace.getWorkspaceFolder(active))
            ?? vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        const root = active?.scheme === 'file'
            ? detectProjectRoot(active.fsPath, folder.uri.fsPath)
            : folder.uri.fsPath;

        const holder: { result?: StyleScanResult } = {};
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Bananabox Coding Style: checking ${path.basename(root)}`,
            cancellable: true,
        }, async (progress, token) => {
            const controller = new AbortController();
            const cancellation = token.onCancellationRequested(
                () => controller.abort(),
            );
            try {
                holder.result = await this.scanProject(root, {
                    manual: true,
                    signal: controller.signal,
                    onProgress: (done, total) => progress.report({
                        increment: 100 / Math.max(total, 1),
                        message: `${done}/${total}`,
                    }),
                });
            } finally {
                cancellation.dispose();
            }
        });

        const result = holder.result;
        if (!result || result.error || result.cancelled) return;
        if (result.files === 0) {
            void vscode.window.showInformationMessage(
                'Bananabox Coding Style: no C source or header found in this project.',
            );
            return;
        }
        const counts = formatCounts(result.summary);
        const message = counts
            ? `Bananabox Coding Style: ${counts} in ${result.files} files (${(result.durationMs / 1000).toFixed(1)} s)`
            : `Bananabox Coding Style: no infractions in ${result.files} files 🎉`;
        const choice = await vscode.window.showInformationMessage(
            message,
            ...(counts ? ['Show problems'] : []),
        );
        if (choice) {
            void vscode.commands.executeCommand(
                'workbench.actions.view.problems',
            );
        }
    }

    private async lintProjectFile(
        uri: vscode.Uri,
        workspaceRoot: string,
        signal: AbortSignal,
    ): Promise<BananaDiagnostic[]> {
        const document = vscode.workspace.textDocuments.find(
            open => open.uri.toString() === uri.toString(),
        );
        const version = document?.version;
        const text = document
            ? document.getText()
            : await fs.promises.readFile(uri.fsPath, 'utf8');
        const rules = this.rulesFor(uri.fsPath);
        if (isMakefilePath(uri.fsPath)) {
            const items = this.checkMakefile(
                uri.fsPath,
                text,
                this.settings,
                rules,
            );
            if (!this.inflight.has(uri.fsPath)) {
                this.applyResult(
                    uri,
                    text.split(/\r?\n/),
                    contentHash(text),
                    this.stamp(this.settings, rules),
                    staticResult(
                        items,
                        rules?.root ?? path.dirname(uri.fsPath),
                        'Makefile',
                    ),
                    false,
                );
            }
            return items;
        }
        const functions = this.functionFindings(
            uri.fsPath,
            text,
            this.settings,
            rules,
        ).catch(() => [] as BananaDiagnostic[]);
        const result = await lintFile({
            file: uri.fsPath,
            workspaceRoot,
            content: document?.isDirty ? text : undefined,
            settings: this.settings,
            signal,
        });

        if (result.aborted || signal.aborted || !this.isEnabled()) return [];
        if (result.timedOut || result.truncated || result.unparsed
            || result.configError) {
            throw new Error(`${uri.fsPath}: ${result.configError ?? result.unparsed ?? (result.timedOut ? 'Compiler timed out' : 'Compiler output was truncated')}`);
        }
        if (document && (document.isClosed || document.version !== version)) {
            throw new Error(`${uri.fsPath}: file changed during the scan; run the check again.`);
        }
        const items = [...result.items, ...await functions];
        if (!this.inflight.has(uri.fsPath)) {
            this.applyResult(
                uri,
                text.split(/\r?\n/),
                contentHash(text),
                this.stamp(this.settings, rules),
                { ...result, items },
                false,
            );
        }
        return items;
    }

    private toDiagnostic(
        item: BananaDiagnostic,
        lines: string[],
    ): vscode.Diagnostic {
        const lineIndex = Math.min(
            Math.max(item.line - 1, 0),
            Math.max(lines.length - 1, 0),
        );
        const { start, end } = computeRange(lines[lineIndex] ?? '', item);
        const severity = item.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : item.severity === 'warning'
                ? vscode.DiagnosticSeverity.Warning
                : item.severity === 'information'
                    ? vscode.DiagnosticSeverity.Information
                    : vscode.DiagnosticSeverity.Hint;
        const label = item.level
            ? `[${item.level}] ${item.message}`
            : item.message;
        const d = new vscode.Diagnostic(
            new vscode.Range(lineIndex, start, lineIndex, end),
            label,
            severity,
        );
        d.source = sourceOf(item);
        const code = item.ruleId ?? item.clangOption;
        if (code && item.ruleId && this.settings.ruleDocUrl) {
            d.code = {
                value: code,
                target: vscode.Uri.parse(
                    this.settings.ruleDocUrl.replace(
                        '{rule}',
                        encodeURIComponent(code),
                    ),
                ),
            };
        } else if (code) {
            d.code = code;
        }
        if (item.notes.length > 0) {
            d.relatedInformation = item.notes.map((n) =>
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(
                        vscode.Uri.file(n.file),
                        new vscode.Position(
                            Math.max(0, n.line - 1),
                            Math.max(0, n.column - 1),
                        ),
                    ),
                    n.message,
                ));
        }
        return d;
    }

    private patchState(key: string, patch: Partial<FileState>): void {
        const current = this.states.get(key) ?? {
            hash: '',
            stamp: '',
            items: [],
            summary: { ...EMPTY },
            running: false,
            stale: false,
            durationMs: 0,
        };
        this.states.set(key, { ...current, ...patch });
        this.scheduleUiRefresh();
    }

    private scheduleUiRefresh(): void {
        if (this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.renderAll();
        }, 60);
    }

    private renderAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.renderEditor(editor);
        }
        const activeEditor = vscode.window.activeTextEditor;
        const uri = activeEditor?.document.uri;
        const view = uri?.scheme === 'file'
            ? this.states.get(uri.fsPath)
            : undefined;
        this.statusBar.update(activeEditor, view, readSettings(uri));
        this.lens.refresh();
    }

    private renderEditor(editor: vscode.TextEditor | undefined): void {
        if (!editor) return;
        if (editor.document.uri.scheme !== 'file'
            || !STYLE_LANGUAGES.has(editor.document.languageId)) return;
        const state = this.states.get(editor.document.uri.fsPath);
        const settings = readSettings(editor.document.uri);
        const errorLens = vscode.workspace
            .getConfiguration('errorLens', editor.document.uri);
        const externalInline = settings.inline.preferErrorLens
            && vscode.extensions.getExtension(ERROR_LENS_ID)?.isActive
            && errorLens.get('enabled', true);
        const excluded = errorLens.get<string[]>('excludeBySource', []);
        const items = state?.items ?? [];
        const ownItems = externalInline ? items.filter(item => {
            const source = sourceOf(item);
            const code = item.ruleId ?? item.clangOption;
            return excluded.includes(source)
                || !!code && excluded.includes(`${source}(${code})`);
        }) : items;
        this.decorations.renderInline(
            editor,
            ownItems.length === items.length ? items : ownItems,
            settings,
        );
        this.decorations.renderStatusLens(editor, state, settings);
        if (editor === vscode.window.activeTextEditor) {
            this.statusBar.update(editor, state, settings);
        }
    }

    private valgrindItems(
        file: string,
        hash: string,
        lines: readonly string[],
    ): BananaDiagnostic[] {
        const entry = this.leaks.get(file);
        if (entry?.hash !== hash) return [];
        const lineText = (line: number): string => lines[line - 1] ?? '';
        return [
            ...leakFindings(
                entry.leaks,
                readSettings(vscode.Uri.file(file)).valgrind.unit,
                lineText,
            ),
            ...errorFindings(entry.errors, lineText),
        ];
    }

    private textOf(file: string): string | undefined {
        const open = vscode.workspace.textDocuments.find(
            doc => doc.uri.scheme === 'file' && doc.uri.fsPath === file,
        );
        if (open) return open.getText();
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
    }

    /** Re-applies the files' results so their leaks (or the lack of them) show in the lens and Problems. */
    private showLeaks(files: Iterable<string>): void {
        for (const file of new Set(files)) {
            const state = this.states.get(file);
            const text = this.textOf(file);
            if (text === undefined
                || (!state && !this.leaks.has(file))) continue;
            const hash = contentHash(text);
            const fresh = state?.hash === hash ? state : undefined;
            this.applyResult(
                vscode.Uri.file(file),
                text.split(/\r?\n/),
                hash,
                fresh?.stamp ?? '',
                {
                    ...staticResult(
                        fresh?.items ?? [],
                        path.dirname(file),
                        fresh?.detail ?? 'Valgrind',
                        fresh?.durationMs,
                    ),
                    command: fresh?.command ?? '',
                },
                false,
            );
        }
    }

    private valgrindLasts(): Record<string, ValgrindVM> {
        return this.context.globalState
            .get<Record<string, ValgrindVM>>('bananalens.valgrindLast') ?? {};
    }

    /** The project's last finished check, kept across sessions (with the current history). */
    valgrindLast(root: string): ValgrindVM | undefined {
        const last = this.valgrindLasts()[path.resolve(root)];
        return last && {
            ...last,
            history: this.valgrindHistory(
                root,
                readSettings(vscode.Uri.file(root)).valgrind.unit,
            ),
        };
    }

    private valgrindRecords(): Record<string, Array<{
        at: number;
        bytes: number;
        errors?: number;
        run?: ValgrindVM;
    }>> {
        return this.context.globalState.get<
            Record<string, Array<{
                at: number;
                bytes: number;
                errors?: number;
                run?: ValgrindVM;
            }>>
        >('bananalens.valgrindHistory') ?? {};
    }

    /** The project's checks; `light` leaves the reports out (a run in flight posts a few times a second). */
    valgrindHistory(
        root: string,
        unit: ByteUnit,
        light = false,
    ): ValgrindVM['history'] {
        return (this.valgrindRecords()[path.resolve(root)] ?? [])
            .map(({ run, ...entry }) => ({
                ...entry,
                ...(light ? {} : { run }),
                lost: formatBytes(entry.bytes, unit),
            }));
    }

    /** A project's checks: the last 24 for the chart, the last 10 with their whole report, kept across sessions. */
    private async recordValgrind(root: string, run: ValgrindVM): Promise<void> {
        const records = this.valgrindRecords();
        const entry = {
            at: run.at,
            bytes: run.bytes,
            errors: run.errors?.reduce((n, e) => n + e.count, 0) ?? 0,
            run: { ...run, history: [] },
        };
        records[path.resolve(root)] = [
            ...(records[path.resolve(root)] ?? []),
            entry,
        ]
            .slice(-24)
            .map((check, i, all) => i < all.length - 10
                ? { at: check.at, bytes: check.bytes, errors: check.errors }
                : check);
        await this.context.globalState.update(
            'bananalens.valgrindHistory',
            records,
        );
    }

    private valgrindCommands(): Record<string, string> {
        return this.context.globalState
            .get<Record<string, string>>('bananalens.valgrindCommands') ?? {};
    }

    private makefileOf(
        root: string,
    ): { file: string; text: string } | undefined {
        for (const name of ['GNUmakefile', 'makefile', 'Makefile']) {
            const file = path.join(root, name), text = this.textOf(file);
            if (text !== undefined) return { file, text };
        }
        return undefined;
    }

    /** Whether the project's Makefile builds with `-g`; null without a Makefile. */
    valgrindDebug(root: string): boolean | null {
        const makefile = this.makefileOf(root);
        return makefile ? makefileHasDebug(makefile.text) : null;
    }

    /** Adds `-g` to the Makefile (saved through the editor, so an open copy stays in sync), then runs `make re`. */
    async addDebugFlag(
        root: string,
    ): Promise<{ ok: boolean; detail: string | null }> {
        const makefile = this.makefileOf(root);
        if (!makefile) {
            return { ok: false, detail: 'No Makefile in the project folder.' };
        }
        if (!makefileHasDebug(makefile.text)) {
            const doc = await vscode.workspace.openTextDocument(makefile.file);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                doc.uri,
                new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length),
                ),
                addDebugFlag(doc.getText()),
            );
            if (!await vscode.workspace.applyEdit(edit)
                || !await doc.save()) {
                return {
                    ok: false,
                    detail: 'The Makefile could not be saved.',
                };
            }
        }
        this.output.appendLine(`\n$ make re    (in ${root})`);
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'make re (with -g)',
            cancellable: true,
        }, (_progress, token) =>
            new Promise(resolve => {
                const controller = new AbortController();
                token.onCancellationRequested(() => controller.abort());
                let tail = '';
                const child = spawn('make', ['re'], {
                    cwd: root,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    signal: controller.signal,
                });
                const log = (chunk: Buffer): void => {
                    this.output.append(chunk.toString());
                    tail = (tail + chunk.toString()).slice(-2000);
                };
                child.stdout.on('data', log);
                child.stderr.on('data', log);
                child.on('error', error => resolve({
                    ok: false,
                    detail: controller.signal.aborted ? null : error.message,
                }));
                child.on('close', code => resolve({
                    ok: code === 0,
                    detail: code === 0
                        ? null
                        : tail.split('\n')
                            .map(line => line.trim())
                            .filter(Boolean)
                            .at(-1) ?? `make re exited with ${code}`,
                }));
            }));
    }

    /** The command saved for this project, else the setting, else `./NAME` from its Makefile. */
    valgrindCommand(root: string): string {
        const saved = this.valgrindCommands()[path.resolve(root)]
            ?? readSettings(vscode.Uri.file(root)).valgrind.command;
        if (saved) return saved;
        const makefile = this.makefileOf(root)?.text;
        const name = makefile !== undefined
            ? makefileVariable(makefile, 'NAME')
            : undefined;
        return name && !/[\s$]/.test(name)
            ? (name.includes('/') ? name : `./${name}`)
            : '';
    }

    async editValgrindCommand(root: string): Promise<string | undefined> {
        const value = await vscode.window.showInputBox({
            title: 'Valgrind command',
            prompt: 'Program and arguments to run from the project folder. Leave empty to run ./NAME from the Makefile.',
            placeHolder: './my_program arg1 arg2',
            value: this.valgrindCommand(root),
        });
        if (value === undefined) return undefined;
        await this.setValgrindCommand(root, value);
        return this.valgrindCommand(root);
    }

    async setValgrindCommand(root: string, command: string): Promise<void> {
        const commands = {
            ...this.valgrindCommands(),
            [path.resolve(root)]: command.trim(),
        };
        if (!command.trim()) delete commands[path.resolve(root)];
        await this.context.globalState.update(
            'bananalens.valgrindCommands',
            commands,
        );
    }

    /** Runs the project's program under valgrind and shows each leak on the project line that allocated it. */
    async runValgrind(root: string): Promise<ValgrindVM> {
        const unit = readSettings(vscode.Uri.file(root)).valgrind.unit;
        const command = this.valgrindCommand(root);
        const vm = (patch: Partial<ValgrindVM>): ValgrindVM => {
            const run: ValgrindVM = {
                status: 'error',
                command,
                leaks: [],
                lost: formatBytes(0, unit),
                bytes: 0,
                heap: null,
                durationMs: 0,
                omitted: 0,
                unlocated: 0,
                signal: null,
                exitCode: null,
                error: null,
                detail: null,
                at: Date.now(),
                history: this.valgrindHistory(
                    root,
                    unit,
                    patch.status === 'running',
                ),
                ...patch,
            };
            this.valgrindRuns.fire({ root, run });
            if (run.status === 'done') {
                void this.context.globalState.update(
                    'bananalens.valgrindLast',
                    { ...this.valgrindLasts(), [path.resolve(root)]: run },
                );
            }
            return run;
        };
        if (!await valgrindInstalled()) return vm({ error: 'not_installed' });
        const argv = shellSplit(command);
        if (!argv.length) return vm({ error: 'no_command' });
        if (this.valgrindAborts.has(path.resolve(root))) {
            return {
                status: 'running',
                command,
                leaks: [],
                lost: formatBytes(0, unit),
                bytes: 0,
                heap: null,
                durationMs: 0,
                omitted: 0,
                unlocated: 0,
                signal: null,
                exitCode: null,
                error: null,
                detail: null,
                at: Date.now(),
                history: this.valgrindHistory(root, unit),
            };
        }
        const started = Date.now();
        vm({ status: 'running', at: started });
        let tail = '', logged = 0, flush: NodeJS.Timeout | undefined;
        const stream = (text: string): void => {
            if (logged < 65_536) {
                this.output.append(text.slice(0, 65_536 - logged));
                logged += text.length;
                if (logged >= 65_536) {
                    this.output.appendLine(
                        '\n[… output truncated, valgrind keeps running …]',
                    );
                }
            }
            tail = (tail + text).slice(-4000);
            flush ??= setTimeout(() => {
                flush = undefined;
                const lines = tail.split(/\r?\n/)
                    .filter(line => line.trim() && !/^==\d+==/.test(line))
                    .slice(-6)
                    .map(line => line.slice(0, 240));
                vm({ status: 'running', at: started, tail: lines });
            }, 300);
        };
        const controller = new AbortController();
        this.valgrindAborts.set(path.resolve(root), controller);

        const logFile = path.join(
            os.tmpdir(),
            `bananabox-valgrind-${process.pid}-${crypto.randomUUID()}.log`,
        );
        this.output.appendLine(
            `\n$ valgrind --leak-check=full ${command}    (in ${root})`,
        );
        try {
            const outcome = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: `Valgrind: ${command}`,
            }, async () => {
                const result = await spawnValgrind(
                    argv,
                    root,
                    logFile,
                    controller.signal,
                    stream,
                );
                return { ...result, cancelled: controller.signal.aborted };
            });
            if (outcome.cancelled) return vm({ error: 'cancelled' });
            const log = await fs.promises
                .readFile(logFile, 'utf8')
                .catch(() => '');
            const report = parseValgrindLog(log, root);
            this.output.append(log.slice(-65_536));
            if (!report.finished) {
                const detail = `${log}\n${outcome.stderrTail}`
                    .split('\n')
                    .map(line => line.replace(/^==\d+==\s*/, '').trim())
                    .filter(Boolean)
                    .at(-1) ?? null;
                return vm({
                    error: 'not_started',
                    exitCode: outcome.exitCode,
                    detail,
                });
            }

            const previous = [...this.leaks.keys()]
                .filter(file => isInside(file, root));
            previous.forEach(file => this.leaks.delete(file));
            const errors = groupErrors(report.errors);
            const entryOf = (file: string) => {
                const entry = this.leaks.get(file) ?? {
                    hash: contentHash(this.textOf(file) ?? ''),
                    leaks: [],
                    errors: [],
                };
                this.leaks.set(file, entry);
                return entry;
            };
            for (const leak of report.leaks)
                entryOf(leak.file).leaks.push(leak);
            for (const error of errors)
                entryOf(error.file).errors.push(error);
            this.showLeaks([
                ...previous,
                ...report.leaks.map(leak => leak.file),
                ...errors.map(error => error.file),
            ]);

            const grouped = groupLeaks(report.leaks);
            const relative = (file: string): string =>
                path.relative(root, file).split(path.sep).join('/');
            const frame = (f: { fn: string; file: string; line: number }) => ({
                ...f,
                file: relative(f.file),
            });
            const bytes = report.bytes;
            const at = Date.now();
            const done: ValgrindVM = {
                status: 'done',
                command,
                omitted: report.omitted,
                unlocated: report.unlocated,
                signal: report.signal ?? null,
                exitCode: outcome.exitCode,
                error: null,
                detail: null,
                at,
                errorsOmitted: report.errorsOmitted,
                lost: formatBytes(bytes, unit),
                bytes,
                history: [],
                durationMs: at - started,
                errors: errors.slice(0, 100).map(error => {
                    const code = (this.textOf(error.file)
                        ?.split(/\r?\n/)[error.line - 1] ?? '').slice(0, 400);
                    return {
                        kind: error.kind,
                        what: error.what,
                        file: relative(error.file),
                        line: error.line,
                        column: errorColumn(code, error.via),
                        fn: error.fn,
                        via: error.via,
                        detail: error.detail,
                        origin: error.origin && frame(error.origin),
                        stack: error.stack.map(frame),
                        count: error.count,
                        code,
                    };
                }),
                heap: report.heap ? {
                    ...report.heap,
                    allocated: formatBytes(report.heap.bytes, unit),
                    ...(report.heap.inUse !== undefined ? {
                        freed: formatBytes(
                            Math.max(0, report.heap.bytes - report.heap.inUse),
                            unit,
                        ),
                        reachable: formatBytes(
                            Math.max(0, report.heap.inUse - bytes),
                            unit,
                        ),
                    } : {}),
                } : null,
                leaks: grouped.map(leak => {
                    const code = (this.textOf(leak.file)
                        ?.split(/\r?\n/)[leak.line - 1] ?? '').slice(0, 400);
                    return {
                        file: relative(leak.file),
                        line: leak.line,
                        column: leakColumn(code, leak.allocator),
                        lost: formatBytes(leak.bytes, unit),
                        bytes: leak.bytes,
                        code,
                        allocator: leak.allocator,
                    };
                }),
            };
            await this.recordValgrind(root, done);
            return vm({ ...done, history: this.valgrindHistory(root, unit) });
        } catch (error) {
            return vm({
                error: 'not_started',
                detail: error instanceof Error ? error.message : String(error),
            });
        } finally {
            clearTimeout(flush);
            this.valgrindAborts.delete(path.resolve(root));
            void fs.promises.rm(logFile, { force: true });
        }
    }

    /** Stops the project's check in flight, if any. */
    cancelValgrind(root: string): void {
        this.valgrindAborts.get(path.resolve(root))?.abort();
    }

    private async valgrindFromEditor(
        action: (root: string) => Promise<unknown>,
    ): Promise<void> {
        const doc = vscode.window.activeTextEditor?.document;
        const folder = doc
            ? vscode.workspace.getWorkspaceFolder(doc.uri)
            : vscode.workspace.workspaceFolders?.[0];
        const root = doc?.uri.scheme === 'file'
            ? this.rulesFor(doc.uri.fsPath)?.root
                ?? detectProjectRoot(doc.uri.fsPath, folder?.uri.fsPath)
            : folder?.uri.fsPath;
        if (!root) {
            void vscode.window.showWarningMessage(
                'Open a file of the project to check with valgrind.',
            );
            return;
        }
        await action(root);
    }

    /** Toasts for runs started from the editor (the project page shows its own). */
    private async reportValgrind(root: string, run: ValgrindVM): Promise<void> {
        const edit = 'Edit command', output = 'Show output';
        const errors = run.errors?.reduce((n, e) => n + e.count, 0) ?? 0;
        const choice = run.error === 'not_installed'
            ? await vscode.window.showErrorMessage(
                'Valgrind is not installed on this machine (e.g. sudo apt install valgrind).',
            )
            : run.error === 'no_command'
                ? await vscode.window.showWarningMessage(
                    'No program to run: the Makefile has no NAME. Set the command valgrind runs.',
                    edit,
                )
                : run.error === 'not_started'
                    ? await vscode.window.showErrorMessage(
                        `Valgrind could not run "${run.command}"${run.detail ? `: ${run.detail}` : ''}`,
                        edit,
                        output,
                    )
                    : run.error ? undefined
                        : run.signal
                            ? await vscode.window.showWarningMessage(
                                `"${run.command}" crashed (${run.signal}). Check its arguments. ${run.leaks.length} leak(s), ${run.lost} lost.`,
                                edit,
                                output,
                            )
                            : await vscode.window.showInformationMessage(
                                run.bytes || errors
                                    ? `Valgrind: ${run.lost} lost${errors ? `, ${errors} memory error(s)` : ''}${run.unlocated ? ` (${run.unlocated} without a line: build with -g)` : ''}.`
                                    : 'Valgrind: no leak, no memory error.',
                                output,
                            );
        if (choice === edit) await this.editValgrindCommand(root);
        if (choice === output) this.output.show(true);
    }

    private forget(uri: vscode.Uri): void {
        if (uri.scheme !== 'file') return;
        this.cancelScheduledLint(uri.fsPath);
        this.inflight.get(uri.fsPath)?.abort();
        this.states.delete(uri.fsPath);
        this.collection.delete(uri);
        this.renderAll();
    }

    private clearAll(): void {
        for (const c of this.workspaceScans) c.abort();
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        for (const c of this.inflight.values()) c.abort();
        this.inflight.clear();
        this.states.clear();
        this.collection.clear();
        for (const e of vscode.window.visibleTextEditors) {
            this.decorations.clear(e);
        }
        this.renderAll();
    }

    private async showIssues(uri?: vscode.Uri): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const target = uri ?? editor?.document.uri;
        if (!target) return;
        const diagnostics = [...(this.collection.get(target) ?? [])].sort(
            (a, b) => a.severity - b.severity
                || a.range.start.line - b.range.start.line,
        );
        if (diagnostics.length === 0) {
            void vscode.window.showInformationMessage(
                'Bananabox Coding Style: no infractions found in this file.',
            );
            return;
        }
        const icon = (s: vscode.DiagnosticSeverity): string => (
            s === vscode.DiagnosticSeverity.Error ? '$(error)'
                : s === vscode.DiagnosticSeverity.Warning ? '$(warning)'
                    : '$(info)'
        );
        const picked = await vscode.window.showQuickPick(
            diagnostics.map((d) => {
                const rule = typeof d.code === 'object'
                    ? String(d.code.value)
                    : d.code === undefined ? '' : String(d.code);
                return {
                    label: `${icon(d.severity)} ${d.message}`,
                    description: rule,
                    detail: `Line ${d.range.start.line + 1}${ruleFamily(rule) ? ` · ${ruleFamily(rule)}` : ''}`,
                    range: d.range,
                };
            }),
            {
                title: `Banana · ${diagnostics.length} finding${diagnostics.length > 1 ? 's' : ''}`,
                matchOnDescription: true,
                matchOnDetail: true,
            },
        );
        if (!picked) return;
        const shown = await vscode.window.showTextDocument(target, {
            selection: picked.range,
        });
        shown.revealRange(picked.range, vscode.TextEditorRevealType.InCenter);
    }

    private jump(direction: 1 | -1): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const diagnostics = [
            ...(this.collection.get(editor.document.uri) ?? []),
        ].sort((a, b) => a.range.start.compareTo(b.range.start));
        if (diagnostics.length === 0) return;
        const cursor = editor.selection.active;
        const next = direction === 1
            ? diagnostics.find((d) => d.range.start.isAfter(cursor))
                ?? diagnostics[0]!
            : [...diagnostics].reverse()
                .find((d) => d.range.start.isBefore(cursor))
                ?? diagnostics[diagnostics.length - 1]!;
        editor.selection = new vscode.Selection(
            next.range.start,
            next.range.start,
        );
        editor.revealRange(
            next.range,
            vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
    }
}

export function activate(context: vscode.ExtensionContext, remote?: {
    enabled(): boolean;
    onDidChange(listener: () => void): vscode.Disposable;
}): StyleApi {
    let enabled = remote?.enabled() ?? true;
    setRemoteLensEnabled(enabled);
    clearSettingsCache();
    const lens = new BananaLens(context);
    lens.start();
    if (remote) context.subscriptions.push(remote.onDidChange(() => {
        if (enabled === remote.enabled()) return;
        enabled = remote.enabled();
        setRemoteLensEnabled(enabled);
        lens.refreshAvailability();
    }));
    return {
        isEnabled: () => lens.isEnabled(),
        scanProject: (root, options) => lens.scanProject(root, options),
        useProjectRules: provider => lens.useProjectRules(provider),
        refreshProjectRules: () => lens.refreshProjectRules(),
        runValgrind: root => lens.runValgrind(root),
        cancelValgrind: root => lens.cancelValgrind(root),
        valgrindDebug: root => lens.valgrindDebug(root),
        addDebugFlag: root => lens.addDebugFlag(root),
        valgrindCommand: root => lens.valgrindCommand(root),
        valgrindLast: root => lens.valgrindLast(root),
        valgrindHistory: root => lens.valgrindHistory(
            root,
            readSettings(vscode.Uri.file(root)).valgrind.unit,
        ),
        editValgrindCommand: root => lens.editValgrindCommand(root),
        setValgrindCommand: (root, command) =>
            lens.setValgrindCommand(root, command),
        onDidValgrind: lens.onDidValgrind,
    };
}
