import * as vscode from 'vscode';
import {
    DEFAULT_SETTINGS,
    Settings,
    LensColors,
    LensVisibility,
} from './types';

export function affectsAnalysis(
    event: vscode.ConfigurationChangeEvent,
): boolean {
    return [
        'enabled', 'compiler', 'extraArgs', 'includePaths', 'autoIncludes',
        'useCompileCommands', 'useMakefile', 'makeDryRun', 'makefileTarget',
        'configFile', 'ignoreWarnings', 'exclude', 'timeoutMs', 'functions',
        'makefile',
    ].some(key => event.affectsConfiguration(`bananalens.${key}`));
}

export function validColor(value: unknown): value is string {
    return typeof value === 'string'
        && /^(?:#[\da-fA-F]{6}(?:[\da-fA-F]{2})?)?$/.test(value);
}

const cache = new Map<string, Settings>();
let remoteEnabled = true;

export function isRemoteLensEnabled(): boolean {
    return remoteEnabled;
}

export function setRemoteLensEnabled(enabled: boolean): void {
    remoteEnabled = enabled;
    clearSettingsCache();
}

export function clearSettingsCache(): void {
    cache.clear();
}

/**
 * Reads the bananalens settings for a scope, clamping numbers and falling back
 * to defaults on bad values.
 */
export function readSettings(scope?: vscode.Uri): Settings {
    const key = scope?.toString() ?? '';
    const cached = cache.get(key);
    if (cached) return cached;

    const configuration = vscode.workspace.getConfiguration(
        'bananalens',
        scope,
    );
    const defaults = DEFAULT_SETTINGS;
    const mode = configuration.get<string>('inline.mode', defaults.inline.mode);
    const position = configuration.get<string>(
        'summary.position',
        defaults.summary.position,
    );
    const corrections = configuration.get<string>(
        'corrections.mode',
        defaults.corrections.mode,
    );

    const boundedInteger = (
        key: string,
        fallback: number,
        min: number,
        max: number,
    ): number => {
        const value = configuration.get<unknown>(key, fallback);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return fallback;
        }

        return Math.max(min, Math.min(max, Math.round(value)));
    };
    const visibility = (key: string): LensVisibility => {
        const value = configuration.get<string>(key, 'auto');

        return value === 'always' || value === 'never' ? value : 'auto';
    };

    const settings: Settings = {
        corrections: {
            mode: corrections === 'onSave' || corrections === 'suggest'
                ? corrections
                : 'off',
            clangFormat: configuration.get(
                'corrections.clangFormat',
                defaults.corrections.clangFormat,
            ).trim() || 'auto',
            whitespaceSensitiveMacros: configuration.get(
                'corrections.whitespaceSensitiveMacros',
                [],
            ),
        },
        enabled: remoteEnabled
            && configuration.get('enabled', defaults.enabled),
        compiler: configuration.get('compiler', defaults.compiler).trim()
            || defaults.compiler,
        extraArgs: configuration.get('extraArgs', defaults.extraArgs),
        includePaths: configuration.get('includePaths', defaults.includePaths),
        autoIncludes: configuration.get('autoIncludes', defaults.autoIncludes),
        useCompileCommands: configuration.get(
            'useCompileCommands',
            defaults.useCompileCommands,
        ),
        useMakefile: configuration.get('useMakefile', defaults.useMakefile),
        makeDryRun: configuration.get('makeDryRun', defaults.makeDryRun),
        makefileTarget: configuration.get(
            'makefileTarget',
            defaults.makefileTarget,
        ),
        configFile: configuration.get('configFile', defaults.configFile),
        ignoreWarnings: configuration.get(
            'ignoreWarnings',
            defaults.ignoreWarnings,
        ),
        exclude: configuration.get('exclude', defaults.exclude),
        timeoutMs: configuration.get('timeoutMs', defaults.timeoutMs),
        maxConcurrency: configuration.get(
            'maxConcurrency',
            defaults.maxConcurrency,
        ),
        runOnSave: configuration.get('runOnSave', defaults.runOnSave),
        runOnType: configuration.get('runOnType', defaults.runOnType),
        runOnOpen: configuration.get('runOnOpen', defaults.runOnOpen),
        debounceMs: configuration.get('debounceMs', defaults.debounceMs),
        inline: {
            mode: mode === 'compact' || mode === 'full' ? mode : 'off',
            showClangWarnings: configuration.get(
                'inline.showClangWarnings',
                defaults.inline.showClangWarnings,
            ),
            maxMessageLength: boundedInteger(
                'inline.maxMessageLength',
                defaults.inline.maxMessageLength,
                20,
                1000,
            ),
            preferErrorLens: configuration.get(
                'inline.preferErrorLens',
                defaults.inline.preferErrorLens,
            ),
            showLevel: configuration.get('inline.showLevel', true),
            showRuleId: visibility('inline.showRuleId'),
            showMessage: visibility('inline.showMessage'),
            showMarker: configuration.get('inline.showMarker', true),
            gap: boundedInteger('inline.gap', 4, 0, 16),
            maxPerLine: boundedInteger('inline.maxPerLine', 0, 0, 10),
            bold: configuration.get('inline.bold', true),
            italic: configuration.get('inline.italic', false),
            underline: configuration.get('inline.underline', true),
            background: configuration.get('inline.background', true),
            colors: readColors(configuration),
        },
        functions: {
            enabled: configuration.get(
                'functions.enabled',
                defaults.functions.enabled,
            ),
        },
        makefile: {
            enabled: configuration.get(
                'makefile.enabled',
                defaults.makefile.enabled,
            ),
            requiredRules: ruleNames(
                configuration.get<unknown>(
                    'makefile.requiredRules',
                    defaults.makefile.requiredRules,
                ),
                defaults.makefile.requiredRules,
            ),
            maxLineLength: boundedInteger(
                'makefile.maxLineLength',
                defaults.makefile.maxLineLength,
                40,
                400,
            ),
            wildcard: configuration.get(
                'makefile.wildcard',
                defaults.makefile.wildcard,
            ),
            missingSources: configuration.get(
                'makefile.missingSources',
                defaults.makefile.missingSources,
            ),
            missingSourcesIgnore: stringList(
                configuration.get<unknown>('makefile.missingSourcesIgnore', []),
            ),
        },
        valgrind: {
            command: configuration.get(
                'valgrind.command',
                defaults.valgrind.command,
            ).trim(),
            unit: (['B', 'kB', 'MB', 'GB'] as const).find(
                unit => unit === configuration.get<string>('valgrind.unit'),
            ) ?? 'auto',
        },
        problems: configuration.get('problems.enabled', defaults.problems),
        summary: {
            enabled: configuration.get(
                'summary.enabled',
                defaults.summary.enabled,
            ),
            position: position === 'top' ? 'top' : 'afterHeader',
            attribution: configuration.get(
                'summary.attribution',
                defaults.summary.attribution,
            ),
        },
        statusLens: configuration.get(
            'statusLens.enabled',
            defaults.statusLens,
        ),
        statusBar: configuration.get('statusBar.enabled', defaults.statusBar),
        ruleDocUrl: configuration.get('ruleDocUrl', defaults.ruleDocUrl),
        projectScanGlob: configuration.get(
            'projectScanGlob',
            defaults.projectScanGlob,
        ),
        verbose: configuration.get('verbose', defaults.verbose),
    };

    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, settings);

    return settings;
}

function ruleNames(value: unknown, fallback: string[]): string[] {
    return Array.isArray(value)
        && value.every(v => typeof v === 'string'
            && /^[\w.\-$()]{1,64}$/.test(v))
        ? [...new Set(value as string[])]
        : fallback;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string'
            && v.trim() !== '')
        : [];
}

function readColors(
    configuration: vscode.WorkspaceConfiguration,
): LensColors {
    const colors = {} as LensColors;
    const severities = ['fatal', 'major', 'minor', 'info', 'function'] as const;
    for (const severity of severities) {
        colors[severity] = { foreground: '', background: '', underline: '' };
        for (const part of ['foreground', 'background', 'underline'] as const) {
            const value = configuration.get<unknown>(
                `inline.colors.${severity}.${part}`,
                '',
            );
            colors[severity][part] = validColor(value) ? value : '';
        }
    }

    return colors;
}
