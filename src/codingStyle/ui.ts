import * as vscode from 'vscode';
import { styleLevel, styleMessage, ui } from './messages';
import {
    BananaDiagnostic,
    DEFAULT_SETTINGS,
    LensColorGroup,
    Settings,
    Summary,
} from './types';

/** Languages the lens checks: C through epiclang, Makefiles statically. */
export const STYLE_LANGUAGES = new Set(['c', 'cpp', 'makefile']);

export interface FileView {
    summary: Summary;
    running: boolean;
    stale: boolean;
    durationMs: number;
    error?: string;
    detail?: string;
    command?: string;
}

export type ViewLookup = (uri: vscode.Uri) => FileView | undefined;

export const ERROR_LENS_ID = 'usernamehw.errorlens';

export function formatCounts(summary: Summary): string {
    const parts: string[] = [];
    const plural = (n: number, one: string, many: string) =>
        ui(n > 1 ? many : one, { n });
    if (summary.fatal) parts.push(ui('{n} fatal', { n: summary.fatal }));
    if (summary.major) {
        parts.push(plural(summary.major, '{n} major', '{n} majors'));
    }
    if (summary.minor) {
        parts.push(plural(summary.minor, '{n} minor', '{n} minors'));
    }
    if (summary.info) {
        parts.push(plural(summary.info, '{n} info', '{n} infos'));
    }
    if (summary.functions) {
        parts.push(plural(
            summary.functions,
            '{n} unauthorized function',
            '{n} unauthorized functions',
        ));
    }
    return parts.join(' · ');
}

export function worstBucket(
    summary: Summary,
): 'clean' | 'fatal' | 'function' | 'major' | 'minor' | 'info' {
    if (summary.fatal) return 'fatal';
    if (summary.functions) return 'function';
    if (summary.major) return 'major';
    if (summary.minor) return 'minor';
    if (summary.info) return 'info';
    return 'clean';
}

export function issueCount(summary: Summary): number {
    return summary.fatal + summary.major + summary.minor + summary.info
        + summary.other + (summary.functions ?? 0);
}

function issueLabel(count: number): string {
    return ui(count === 1 ? '{n} issue' : '{n} issues', { n: count });
}

export function summaryText(view: FileView | undefined): string {
    if (!view) return ui('Not checked');
    if (view.running) return ui('Checking…');
    if (view.error) return ui('Check unavailable');
    const counts = formatCounts(view.summary);
    const compiler = view.summary.other
        ? ui('{n} compiler', { n: view.summary.other })
        : '';
    const result = [counts, compiler].filter(Boolean).join(' · ')
        || ui('No issues');
    return `${result}${view.stale ? ` · ${ui('Pending check')}` : ''}`;
}

export function statusText(
    view: FileView | undefined,
    withIcons = true,
): string {
    const icon = !view ? 'circle-outline'
        : view.running ? 'sync~spin'
        : view.error ? 'warning'
        : view.stale ? 'clock'
        : issueCount(view.summary) ? 'list-unordered'
        : 'check';
    return `${withIcons ? `$(${icon}) ` : ''}${ui('Bananabox Style')} · ${summaryText(view)}`;
}

const correctionLabel = (mode: Settings['corrections']['mode']): string =>
    ui({ off: 'Off', suggest: 'Suggestion', onSave: 'Automatic' }[mode]);

function summaryDetails(
    view: FileView | undefined,
    settings: Settings,
): string {
    const details = [summaryText(view)];
    if (view && !view.running && !view.error) {
        details.push(ui('{count} in this file', {
            count: issueLabel(issueCount(view.summary)),
        }));
        details.push(
            ui('Fatal: {fatal} · Major: {major} · Minor: {minor} · Info: {info} · Compiler: {other} · Unauthorized functions: {functions}', {
                fatal: view.summary.fatal,
                major: view.summary.major,
                minor: view.summary.minor,
                info: view.summary.info,
                other: view.summary.other,
                functions: view.summary.functions,
            }),
        );
    }
    if (view?.stale) {
        details.push(
            ui('The displayed results precede the latest edit. Recheck to refresh them.'),
        );
    }
    if (view?.error) {
        details.push(ui('Last check: {error}. Open Bananabox Coding Style output for details.', { error: view.error }));
    }
    details.push(ui('Corrections: {mode}', {
        mode: correctionLabel(settings.corrections.mode),
    }));
    if (view?.durationMs) details.push(ui('Last check took {ms} ms', { ms: view.durationMs }));
    if (view?.detail) details.push(view.detail);
    return details.join('\n\n');
}

function summaryAnchor(
    document: vscode.TextDocument,
    settings: Settings,
): number {
    return settings.summary.position === 'top'
        ? 0
        : findSummaryAnchorLine(document);
}

function hasSummarySpace(
    document: vscode.TextDocument,
    settings: Settings,
): boolean {
    return document.lineCount > 0
        && !document.lineAt(summaryAnchor(document, settings)).text.trim();
}

export class SummaryLensProvider implements vscode.CodeLensProvider {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.emitter.event;

    constructor(
        private readonly views: ViewLookup,
        private readonly settings: (uri?: vscode.Uri) => Settings,
    ) {}

    refresh(): void { this.emitter.fire(); }
    dispose(): void { this.emitter.dispose(); }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const settings = this.settings(document.uri);
        if (document.uri.scheme !== 'file' || !settings.enabled
            || !settings.summary.enabled || document.lineCount === 0) {
            return [];
        }

        const line = summaryAnchor(document, settings);
        const range = new vscode.Range(line, 0, line, 0);
        const view = this.views(document.uri);
        const hasIssues = !!view && !view.error && issueCount(view.summary) > 0;
        const banner = settings.statusLens
            && hasSummarySpace(document, settings);
        const lenses = [
            new vscode.CodeLens(range, {
                title: banner ? ui('Bananabox Coding Style') : statusText(view),
                tooltip: summaryDetails(view, settings),
                command: view?.error || view?.running
                    ? 'bananabox.codingStyle.showOutput'
                    : hasIssues
                        ? 'bananabox.codingStyle.showIssues'
                        : 'bananabox.codingStyle.run',
                arguments: [document.uri],
            }),
        ];
        if (hasIssues && banner) {
            lenses.push(new vscode.CodeLens(range, {
                title: ui('Review {count}', {
                    count: issueLabel(issueCount(view!.summary)),
                }),
                tooltip: ui('Browse this file’s diagnostics, grouped by severity and rule'),
                command: 'bananabox.codingStyle.showIssues',
                arguments: [document.uri],
            }));
        }
        if (!view?.running) {
            lenses.push(new vscode.CodeLens(range, {
                title: view
                    ? ui('$(refresh) Recheck')
                    : ui('$(play) Check file'),
                tooltip: ui('Check this file'),
                command: 'bananabox.codingStyle.run',
                arguments: [document.uri],
            }));
        }
        if (document.languageId !== 'makefile') {
            lenses.push(new vscode.CodeLens(range, {
                title: ui('Corrections: {mode}', {
                    mode: correctionLabel(settings.corrections.mode),
                }),
                tooltip: ui('Choose Off, Suggestion or Automatic corrections for this workspace'),
                command: 'bananabox.codingStyle.configureCorrections',
                arguments: [document.uri],
            }));
        }
        if (settings.summary.attribution) {
            lenses.push(new vscode.CodeLens(range, {
                title: 'by techneon',
                command: 'bananabox.codingStyle.showOutput',
            }));
        }
        return lenses;
    }
}

export function findSummaryAnchorLine(document: vscode.TextDocument): number {
    let firstNonEmpty = -1;
    for (let i = 0; i < Math.min(document.lineCount, 20); i++) {
        if (document.lineAt(i).text.trim().length > 0) {
            firstNonEmpty = i;
            break;
        }
    }
    if (firstNonEmpty < 0) return 0;
    if (document.lineAt(firstNonEmpty).text.startsWith('##')) {
        let i = firstNonEmpty;
        while (i < document.lineCount - 1 && i < firstNonEmpty + 30
            && document.lineAt(i).text.startsWith('##')) {
            i++;
        }
        return i;
    }
    if (!document.lineAt(firstNonEmpty).text.trim().startsWith('/*')) {
        return firstNonEmpty;
    }

    const limit = Math.min(document.lineCount, firstNonEmpty + 30);
    for (let i = firstNonEmpty; i < limit; i++) {
        const text = document.lineAt(i).text;
        const end = text.indexOf('*/');
        if (end >= 0) {
            return text.slice(end + 2).trim()
                ? i
                : Math.min(i + 1, document.lineCount - 1);
        }
    }

    return firstNonEmpty;
}

type SummaryBucket = ReturnType<typeof worstBucket> | 'neutral';
const BUCKET_COLORS: Record<SummaryBucket, string> = {
    clean: 'testing.iconPassed',
    fatal: 'bananalens.inline.fatalForeground',
    function: 'bananalens.inline.functionForeground',
    major: 'bananalens.inline.majorForeground',
    minor: 'bananalens.inline.minorForeground',
    info: 'bananalens.inline.infoForeground',
    neutral: 'descriptionForeground',
};

function summaryBucket(view: FileView | undefined): SummaryBucket {
    if (!view || view.running || view.stale) return 'neutral';
    if (view.error) return 'fatal';
    const bucket = worstBucket(view.summary);
    return bucket === 'clean' && view.summary.other ? 'info' : bucket;
}

const INLINE_PRIORITY: Record<LensColorGroup, number> = {
    fatal: 0,
    function: 1,
    major: 2,
    minor: 3,
    info: 4,
};

function inlineBucket(item: BananaDiagnostic): LensColorGroup {
    if (item.kind === 'function') return 'function';
    return item.bucket ?? (
        item.severity === 'error' ? 'fatal'
            : item.severity === 'warning' ? 'major' : 'info'
    );
}

interface InlineCacheEntry {
    items: readonly BananaDiagnostic[];
    version: number;
    settings: Settings['inline'];
    enabled: boolean;
    cursorLines: string;
}

interface EditorDecorationTypes {
    signature: string;
    types: Map<string, vscode.TextEditorDecorationType>;
}

export class Decorations implements vscode.Disposable {
    private inlineCache = new WeakMap<vscode.TextEditor, InlineCacheEntry>();
    private statusCache = new WeakMap<vscode.TextEditor, string>();
    private readonly editors =
        new Map<vscode.TextEditor, EditorDecorationTypes>();
    private readonly statusTypes =
        new Map<string, vscode.TextEditorDecorationType>();

    dispose(): void {
        for (const entry of this.editors.values()) {
            for (const type of entry.types.values()) type.dispose();
        }
        for (const type of this.statusTypes.values()) type.dispose();
        this.editors.clear();
        this.statusTypes.clear();
    }

    clear(editor: vscode.TextEditor): void {
        this.inlineCache.delete(editor);
        this.statusCache.delete(editor);
        const types = [
            ...(this.editors.get(editor)?.types.values() ?? []),
            ...this.statusTypes.values(),
        ];
        for (const t of types) editor.setDecorations(t, []);
    }

    /** Forget what was painted, so the next render paints it afresh. */
    invalidateInline(editor: vscode.TextEditor): void {
        this.inlineCache.delete(editor);
    }

    releaseHidden(visible: readonly vscode.TextEditor[]): void {
        for (const [editor, entry] of this.editors) {
            if (visible.includes(editor)) continue;
            for (const type of entry.types.values()) type.dispose();
            this.editors.delete(editor);
            this.inlineCache.delete(editor);
        }
    }

    renderInline(
        editor: vscode.TextEditor,
        items: readonly BananaDiagnostic[],
        settings: Settings,
    ): void {
        const cursorLines = settings.inline.box === 'cursorLine'
            ? String(editor.selection.active.line)
            : '';
        const cached = this.inlineCache.get(editor);
        if (cached?.items === items
            && cached.version === editor.document.version
            && cached.settings === settings.inline
            && cached.enabled === settings.enabled
            && cached.cursorLines === cursorLines) {
            return;
        }
        this.inlineCache.set(editor, {
            items,
            version: editor.document.version,
            settings: settings.inline,
            enabled: settings.enabled,
            cursorLines,
        });
        const inlineTypes = this.typesForEditor(editor, settings.inline);
        if (!settings.enabled || settings.inline.mode === 'off') {
            for (const t of inlineTypes.values()) editor.setDecorations(t, []);
            return;
        }

        const perLine = new Map<number, BananaDiagnostic[]>();
        for (const item of items) {
            if (!item.bucket && !item.kind
                && !settings.inline.showClangWarnings) {
                continue;
            }
            const line = Math.min(
                Math.max(item.line - 1, 0),
                editor.document.lineCount - 1,
            );
            const list = perLine.get(line) ?? [];
            list.push(item);
            perLine.set(line, list);
        }

        const grouped = new Map<string, vscode.DecorationOptions[]>();
        for (const [line, list] of perLine) {
            list.sort((a, b) =>
                INLINE_PRIORITY[inlineBucket(a)]
                - INLINE_PRIORITY[inlineBucket(b)]);
            const stacked = list.length > 1 && (
                settings.inline.box === 'always'
                || settings.inline.box === 'cursorLine'
                && editor.selection.active.line === line
            );
            const rows = stacked
                ? inlineBox(
                    editor.document,
                    line,
                    list,
                    settings.inline,
                    Number(editor.options?.tabSize) || 4,
                )
                : inlineDecoration(
                    editor.document,
                    line,
                    list,
                    // Collapsed: worst message only, the rest is a +N counter.
                    settings.inline.box === 'off' || list.length < 2
                        ? settings.inline
                        : { ...settings.inline, maxPerLine: 1 },
                );
            for (const row of rows) {
                const bucket = grouped.get(row.severity) ?? [];
                // Published diagnostics already bring VS Code's own hover
                // over the same range; a second card would repeat them.
                bucket.push(settings.problems
                    ? { ...row.options, hoverMessage: undefined }
                    : row.options);
                grouped.set(row.severity, bucket);
            }
        }
        for (const [severity, type] of inlineTypes) {
            if (!grouped.has(severity)) editor.setDecorations(type, []);
        }
        for (const [severity, options] of grouped) {
            editor.setDecorations(
                this.inlineType(
                    severity as LensColorGroup,
                    inlineTypes,
                    settings.inline,
                ),
                options,
            );
        }
    }

    renderStatusLens(
        editor: vscode.TextEditor,
        view: FileView | undefined,
        settings: Settings,
    ): void {
        const signature = JSON.stringify([
            editor.document.version,
            settings.enabled,
            settings.statusLens,
            settings.summary,
            settings.corrections.mode,
            settings.inline.colors,
            view,
        ]);
        if (this.statusCache.get(editor) === signature) return;
        this.statusCache.set(editor, signature);
        for (const t of this.statusTypes.values()) editor.setDecorations(t, []);
        const doc = editor.document;
        if (!settings.enabled || !settings.statusLens
            || !settings.summary.enabled
            || !hasSummarySpace(doc, settings)) {
            return;
        }

        const anchor = summaryAnchor(doc, settings);
        const hover = new vscode.MarkdownString();
        hover.appendText(summaryDetails(view, settings));
        const bucket = summaryBucket(view);
        const custom = bucket in settings.inline.colors
            ? settings.inline.colors[bucket as LensColorGroup]
            : undefined;
        editor.setDecorations(this.statusType(bucket), [{
            range: new vscode.Range(anchor, 0, anchor, 0),
            renderOptions: {
                after: {
                    contentText: ` ▪ ${summaryText(view)} `,
                    ...(custom?.foreground ? { color: custom.foreground } : {}),
                    ...(custom?.background
                        ? { backgroundColor: custom.background }
                        : {}),
                },
            },
            hoverMessage: hover,
        }]);
    }

    private typesForEditor(
        editor: vscode.TextEditor,
        settings: Settings['inline'],
    ): Map<string, vscode.TextEditorDecorationType> {
        const signature = JSON.stringify([
            settings.gap, settings.bold, settings.italic,
            settings.background, settings.underline, settings.colors,
        ]);
        let entry = this.editors.get(editor);
        if (!entry || entry.signature !== signature) {
            if (entry) {
                for (const type of entry.types.values()) type.dispose();
            }
            entry = { signature, types: new Map() };
            this.editors.set(editor, entry);
        }

        return entry.types;
    }

    private inlineType(
        severity: LensColorGroup,
        types: Map<string, vscode.TextEditorDecorationType>,
        settings: Settings['inline'],
    ): vscode.TextEditorDecorationType {
        let type = types.get(severity);
        if (!type) {
            type = vscode.window.createTextEditorDecorationType({
                borderStyle: 'solid',
                borderWidth: settings.underline ? '0 0 2px 0' : '0',
                borderColor: settings.colors[severity].underline
                    || new vscode.ThemeColor(
                        `bananalens.inline.${severity}Underline`,
                    ),
                // `after`, not `before`: with `before` the cursor stops behind
                // the text, so End and the arrow keys would land after the lens.
                after: {
                    color: settings.colors[severity].foreground
                        || new vscode.ThemeColor(
                            `bananalens.inline.${severity}Foreground`,
                        ),
                    backgroundColor: settings.background
                        ? settings.colors[severity].background
                            || new vscode.ThemeColor(
                                `bananalens.inline.${severity}Background`,
                            )
                        : 'transparent',
                    margin: `0 0 0 ${settings.gap}ch`,
                    fontWeight: settings.bold ? '600' : 'normal',
                    fontStyle: settings.italic ? 'italic' : 'normal',
                    textDecoration: 'none',
                },
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
            });
            types.set(severity, type);
        }
        return type;
    }

    private statusType(
        bucket: keyof typeof BUCKET_COLORS,
    ): vscode.TextEditorDecorationType {
        let type = this.statusTypes.get(bucket);
        if (!type) {
            type = vscode.window.createTextEditorDecorationType({
                after: {
                    color: new vscode.ThemeColor(BUCKET_COLORS[bucket]),
                    backgroundColor: new vscode.ThemeColor(
                        bucket === 'clean' || bucket === 'neutral'
                            ? 'textCodeBlock.background'
                            : `bananalens.inline.${bucket}Background`,
                    ),
                    fontWeight: '600',
                    margin: '0',
                },
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            });
            this.statusTypes.set(bucket, type);
        }
        return type;
    }
}

/**
 * Messages identical but for their last word are said once:
 * `[warning]: unused parameter 'argc', 'argv'`.
 * Order is kept; each merged message takes the place of its first occurrence.
 */
export function mergeInlineTexts(texts: readonly string[]): string[] {
    const groups = new Map<string, string[]>();
    const out: Array<string | { head: string }> = [];
    for (const text of texts) {
        const cut = text.trimEnd().lastIndexOf(' ');
        if (cut <= 0) {
            out.push(text);
            continue;
        }
        const head = text.slice(0, cut);
        const tail = text.slice(cut + 1).trim();
        const tails = groups.get(head);
        if (tails) {
            if (!tails.includes(tail)) tails.push(tail);
            continue;
        }
        groups.set(head, [tail]);
        out.push({ head });
    }

    return out.map(item => typeof item === 'string'
        ? item
        : `${item.head} ${groups.get(item.head)!.join(', ')}`);
}

type InlineRow = {
    severity: LensColorGroup;
    options: vscode.DecorationOptions;
};

function lineRanges(
    document: vscode.TextDocument,
    line: number,
): { whole: vscode.Range; end: vscode.Range } {
    const length = document.lineAt(line).text.length;
    return {
        whole: new vscode.Range(line, 0, line, length),
        end: new vscode.Range(line, length, line, length),
    };
}

function inlineDecoration(
    document: vscode.TextDocument,
    line: number,
    diagnostics: BananaDiagnostic[],
    settings: Settings['inline'],
): InlineRow[] {
    const shown = settings.maxPerLine > 0
        ? diagnostics.slice(0, settings.maxPerLine)
        : diagnostics;
    const texts = shown
        .map(item => inlineText(item, settings.mode, settings))
        .filter(Boolean);
    const text = mergeInlineTexts(texts)
        .join('  ·  ')
        .replace(/\s+/g, ' ');
    const overflow = shown.length < diagnostics.length
        ? ` (+${diagnostics.length - shown.length})`
        : '';
    const maxLength = Math.max(20, settings.maxMessageLength);
    const label = text.length > maxLength
        ? `${text.slice(0, maxLength - 1)}…`
        : text;
    const marker = settings.showMarker ? '▪ ' : '';
    const hover = richHover(diagnostics, settings);
    const { whole, end } = lineRanges(document, line);
    const severity = inlineBucket(diagnostics[0]);

    return [
        {
            severity,
            options: {
                range: end,
                hoverMessage: hover,
                renderOptions: {
                    after: { contentText: `${marker}${label}${overflow} ` },
                },
            },
        },
        // Underline only: a hover on the code would open at the line start.
        { severity, options: { range: whole } },
    ];
}

/** Colour of a message in the hover: the user's own, else the theme's. */
function hoverColor(
    severity: LensColorGroup,
    settings: Settings['inline'],
): string {
    return settings.colors[severity].foreground
        || `var(--vscode-bananalens-inline-${severity}Foreground)`;
}

/**
 * The hover card: one block per message, with its level and rule in the
 * severity colour as a heading, then the message itself.
 */
function richHover(
    diagnostics: readonly BananaDiagnostic[],
    settings: Settings['inline'],
): vscode.MarkdownString {
    const hover = new vscode.MarkdownString(undefined, true);
    hover.supportHtml = true;
    const blocks = diagnostics.map(item => {
        const color = hoverColor(inlineBucket(item), settings);
        const level = styleLevel(String(item.level ?? item.rawSeverity))
            .replace(/[<>&"']/g, '');
        const rule = item.ruleId
            ? ` &nbsp;\`${item.ruleId.replace(/[`<>&]/g, '')}\``
            : '';
        const message = new vscode.MarkdownString()
            .appendText(styleMessage(item.message))
            .value;

        return `### <span style="color:${color};">$(circle-filled) ${level}</span>${rule}\n\n${message}`;
    });
    hover.appendMarkdown(blocks.join('\n\n---\n\n'));

    return hover;
}

/**
 * One row per message, stacked under the first one. Rows are absolutely
 * positioned, so they all start where the line's text ends and the
 * editor's line heights stay untouched.
 */
function inlineBox(
    document: vscode.TextDocument,
    line: number,
    diagnostics: BananaDiagnostic[],
    settings: Settings['inline'],
    tabSize: number,
): InlineRow[] {
    // Where the code ends on screen, in character cells (tabs expanded).
    // Rows below the first are placed from there, not from their DOM
    // neighbours, because VS Code does not keep decorations in row order.
    let columns = 0;
    for (const char of document.lineAt(line).text) {
        columns += char === '\t' ? tabSize - columns % tabSize : 1;
    }
    const maxLength = Math.max(20, settings.maxMessageLength);
    const marker = settings.showMarker ? '▪ ' : '';
    const rows = diagnostics.map(item => {
        const text = inlineText(item, settings.mode, settings)
            .replace(/\s+/g, ' ');
        return `${marker}${text.length > maxLength
            ? `${text.slice(0, maxLength - 1)}…`
            : text}`;
    });
    const width = Math.max(...rows.map(row => row.length)) + 2;
    const { whole, end } = lineRanges(document, line);

    const boxed = rows.map((row, index): InlineRow => {
        const severity = inlineBucket(diagnostics[index]);
        // Rows may sit on top of other lines' text, so the editor background
        // goes underneath the (often translucent) severity colour.
        const tint = settings.colors[severity].background
            || `var(--vscode-bananalens-inline-${severity}Background)`;
        const background = settings.background
            ? `linear-gradient(${tint}, ${tint}), `
                + 'var(--vscode-editor-background)'
            : 'var(--vscode-editor-background)';
        return {
            severity,
            options: {
                range: end,
                // Every row shares the same range and VS Code merges their
                // hovers, so each row carries only its own message.
                hoverMessage: richHover([diagnostics[index]], settings),
                renderOptions: {
                    after: {
                        contentText: row,
                        // The first row stays in the text flow: it pushes
                        // other end-of-line text (GitLens blame) after the box.
                        // VS Code has no multi-line decoration, so the extra
                        // CSS rides along in textDecoration.
                        textDecoration: 'none;'
                            + (index === 0
                                ? ' display: inline-block; vertical-align: top; position: relative;'
                                : ' position: absolute;'
                                    + ` top: ${index * 100}%;`
                                    // The type's margin already adds the gap.
                                    + ` left: ${columns}ch;`)
                            + ` height: 100%; width: ${width}ch;`
                            + ' box-sizing: border-box; padding: 0 1ch;'
                            + ' white-space: pre; z-index: 10;'
                            + ` background: ${background};`
                            + ' border: 0 solid var(--vscode-editorWidget-border, #888);'
                            + ` border-width: ${index === 0 ? 1 : 0}px 1px`
                            + ` ${index === rows.length - 1 ? 1 : 0}px 1px;`
                            + ` border-radius: ${index === 0 ? '4px 4px' : '0 0'}`
                            + ` ${index === rows.length - 1 ? '4px 4px' : '0 0'};`,
                    },
                },
            },
        };
    });

    return [
        ...boxed,
        {
            severity: boxed[0].severity,
            options: { range: whole },
        },
    ];
}

export function inlineText(
    item: BananaDiagnostic,
    mode: 'compact' | 'full' | 'off',
    options: Settings['inline'] = DEFAULT_SETTINGS.inline,
): string {
    const visible = (value: 'auto' | 'always' | 'never') =>
        value === 'always' || value === 'auto' && mode === 'full';
    const prefix = [
        options.showLevel ? `[${styleLevel(String(item.level ?? item.rawSeverity))}]` : '',
        visible(options.showRuleId) ? item.ruleId : '',
    ].filter(Boolean).join(' ');
    const message = visible(options.showMessage)
        ? styleMessage(item.message)
        : '';
    return prefix && message ? `${prefix}: ${message}` : prefix || message;
}

export class StatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(
        'bananalens.status',
        vscode.StatusBarAlignment.Left,
        50,
    );

    constructor() {
        this.item.name = ui('Bananabox Coding Style');
        this.item.command = 'bananabox.codingStyle.showIssues';
    }

    dispose(): void { this.item.dispose(); }

    update(
        editor: vscode.TextEditor | undefined,
        view: FileView | undefined,
        settings: Settings,
    ): void {
        if (!editor || editor.document.uri.scheme !== 'file'
            || !settings.enabled || !settings.statusBar
            || !STYLE_LANGUAGES.has(editor.document.languageId)) {
            this.item.hide();
            return;
        }
        this.item.text = statusText(view);
        this.item.backgroundColor = undefined;
        this.item.color = new vscode.ThemeColor(
            BUCKET_COLORS[summaryBucket(view)],
        );
        const tip = new vscode.MarkdownString();
        tip.appendText(
            `${ui('Bananabox Coding Style')}\n\n${summaryDetails(view, settings)}`,
        );
        this.item.tooltip = tip;
        this.item.show();
    }
}
