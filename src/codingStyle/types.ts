import type { ByteUnit } from './valgrind';

export type Severity = 'error' | 'warning' | 'information' | 'hint';
/**
 * Normalised Epitech severity bucket. Blocker/Critical/Fatal all count as
 * "fatal".
 */
export type Bucket = 'fatal' | 'major' | 'minor' | 'info';
export type LensVisibility = 'auto' | 'always' | 'never';
/**
 * Inline colour groups: the four severities, plus calls to functions the
 * subject does not allow.
 */
export type LensColorGroup = Bucket | 'function';
export type LensColors = Record<LensColorGroup, {
    foreground: string;
    background: string;
    underline: string;
}>;

export interface DiagnosticNote {
    file: string;
    line: number;
    column: number;
    message: string;
}

export interface BananaDiagnostic {
    file: string;
    line: number;
    /** 1-based UTF-8 byte column, as printed by clang. */
    column: number;
    /**
     * Start (1-based byte column) of the highlighted range, when clang printed
     * one (`~~~^~~`).
     */
    rangeStartColumn?: number;
    /** Length of the highlighted range in characters (only set when > 1). */
    rangeLength?: number;
    severity: Severity;
    rawSeverity: string;
    message: string;
    level?: string;
    bucket?: Bucket;
    ruleId?: string;
    plugin?: string;
    clangOption?: string;
    /**
     * `function`: a call to a function missing from the subject's allowed
     * list (found without epiclang).
     */
    kind?: 'function';
    notes: DiagnosticNote[];
}

export interface Summary {
    fatal: number;
    major: number;
    minor: number;
    info: number;
    /** Regular clang diagnostics (not coding style). */
    other: number;
    /** Calls to functions the subject does not allow. */
    functions: number;
}

export interface BananaLensProjectConfig {
    /** Compiler executable (default: epiclang). */
    compiler?: string;
    /**
     * Full command template. `{file}`, `{fileBasename}`, `{workspace}`,
     * `{project}` are expanded.
     */
    command?: string;
    /**
     * Legacy: explicit flags. Disables auto-detection of include directories.
     */
    args?: string[];
    /** Extra flags appended to the auto-detected ones. */
    extraArgs?: string[];
    /** Extra include directories (relative to the project root). */
    includePaths?: string[];
    /** Set to false to disable include-directory auto-discovery. */
    autoIncludes?: boolean;
    env?: Record<string, string>;
    make?: { enabled?: boolean; target?: string };
    inline?: { showClangWarnings?: boolean; maxMessageLength?: number };
    ignoreWarnings?: string[];
    /**
     * Globs (relative to the project root) of files Bananabox Coding Style must
     * not check.
     */
    exclude?: string[];
}

export interface Settings {
    enabled: boolean;
    corrections: {
        mode: 'off' | 'suggest' | 'onSave';
        clangFormat: string;
        whitespaceSensitiveMacros: string[];
    };
    compiler: string;
    extraArgs: string[];
    includePaths: string[];
    autoIncludes: boolean;
    useCompileCommands: boolean;
    useMakefile: boolean;
    makeDryRun: boolean;
    makefileTarget: string;
    configFile: string;
    ignoreWarnings: string[];
    exclude: string[];
    timeoutMs: number;
    maxConcurrency: number;
    runOnSave: boolean;
    runOnType: boolean;
    runOnOpen: boolean;
    debounceMs: number;
    inline: {
        mode: 'off' | 'compact' | 'full';
        showClangWarnings: boolean;
        maxMessageLength: number;
        preferErrorLens: boolean;
        showLevel: boolean;
        showRuleId: LensVisibility;
        showMessage: LensVisibility;
        showMarker: boolean;
        gap: number;
        maxPerLine: number;
        bold: boolean;
        italic: boolean;
        underline: boolean;
        background: boolean;
        colors: LensColors;
    };
    functions: { enabled: boolean };
    makefile: {
        enabled: boolean;
        requiredRules: string[];
        maxLineLength: number;
        wildcard: boolean;
        missingSources: boolean;
        missingSourcesIgnore: string[];
    };
    valgrind: { command: string; unit: ByteUnit };
    problems: boolean;
    summary: {
        enabled: boolean;
        position: 'afterHeader' | 'top';
        attribution: boolean;
    };
    statusLens: boolean;
    statusBar: boolean;
    ruleDocUrl: string;
    projectScanGlob: string;
    verbose: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    enabled: true,
    corrections: {
        mode: 'off',
        clangFormat: 'auto',
        whitespaceSensitiveMacros: [],
    },
    compiler: 'epiclang',
    extraArgs: [],
    includePaths: [],
    autoIncludes: true,
    useCompileCommands: true,
    useMakefile: true,
    makeDryRun: false,
    makefileTarget: '',
    configFile: '.bananalens.json',
    ignoreWarnings: ['unused-command-line-argument', 'linker input unused'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/.vscode/**'],
    timeoutMs: 30000,
    maxConcurrency: 0,
    runOnSave: true,
    runOnType: true,
    runOnOpen: true,
    debounceMs: 600,
    inline: {
        mode: 'full',
        showClangWarnings: true,
        maxMessageLength: 140,
        preferErrorLens: true,
        showLevel: true,
        showRuleId: 'auto',
        showMessage: 'auto',
        showMarker: true,
        gap: 4,
        maxPerLine: 0,
        bold: true,
        italic: false,
        underline: true,
        background: true,
        colors: {
            fatal: { foreground: '', background: '', underline: '' },
            major: { foreground: '', background: '', underline: '' },
            minor: { foreground: '', background: '', underline: '' },
            info: { foreground: '', background: '', underline: '' },
            function: { foreground: '', background: '', underline: '' },
        },
    },
    functions: { enabled: true },
    makefile: {
        enabled: true,
        requiredRules: ['all', 'clean', 'fclean', 're'],
        maxLineLength: 80,
        wildcard: true,
        missingSources: true,
        missingSourcesIgnore: [],
    },
    valgrind: { command: '', unit: 'auto' },
    problems: true,
    summary: { enabled: true, position: 'afterHeader', attribution: false },
    statusLens: true,
    statusBar: true,
    ruleDocUrl: '',
    projectScanGlob: '**/*.{c,h}',
    verbose: false,
};
