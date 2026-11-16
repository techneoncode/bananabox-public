import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { matchesAny } from './glob';
import {
    buildInvocation,
    EpiclangNotFoundError,
    resolveExecutable,
} from './invocation';
import { parseEpiclangOutput } from './parser';
import { detectProjectRoot, loadProjectConfigFile } from './project';
import { runProcess } from './runner';
import { BananaDiagnostic, Settings } from './types';

export interface LintRequest {
    file: string;
    workspaceRoot?: string;
    /**
     * Unsaved buffer content. When set, it is checked through a temporary copy
     * of the file.
     */
    content?: string;
    /**
     * Correction verification includes diagnostics in headers and ignored
     * warnings.
     */
    verification?: boolean;
    settings: Settings;
    signal?: AbortSignal;
    log?: (line: string) => void;
}

export interface LintResult {
    items: BananaDiagnostic[];
    /**
     * Unfiltered diagnostics, retained for exact-buffer correction
     * verification.
     */
    allItems?: BananaDiagnostic[];
    skipped?: boolean;
    aborted: boolean;
    timedOut: boolean;
    truncated?: boolean;
    exitCode: number;
    durationMs: number;
    projectRoot: string;
    source: string;
    detail: string;
    command: string;
    configError?: string;
    /**
     * Last stderr lines when the compiler failed without any parsable
     * diagnostic.
     */
    unparsed?: string;
}

const TMP_ROOT = path.join(
    os.tmpdir(),
    `banana-lens-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
);

export function cleanupTempFiles(): void {
    try {
        fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    } catch {}
}

export async function lintFile(request: LintRequest): Promise<LintResult> {
    const started = Date.now();
    const projectRoot = detectProjectRoot(request.file, request.workspaceRoot);
    const loaded = loadProjectConfigFile(
        projectRoot,
        request.settings.configFile,
    );
    const config = loaded.config;
    const base = {
        aborted: false,
        timedOut: false,
        exitCode: 0,
        projectRoot,
        source: '',
        detail: '',
        command: '',
        configError: loaded.error,
    };

    const relativeFile = path.relative(projectRoot, request.file);
    if (config.exclude && matchesAny(config.exclude, relativeFile)) {
        return { ...base, items: [], skipped: true, durationMs: 0 };
    }

    if (request.signal?.aborted) {
        return { ...base, items: [], aborted: true, durationMs: 0 };
    }
    const configuredExecutable = resolveExecutable(
        config.compiler ?? request.settings.compiler,
    );

    let target = request.file;
    let temporaryDirectory: string | undefined;
    try {
        const aliases = new Map<string, string>();
        let extraIncludeDirs: string[] | undefined;
        if (request.content !== undefined) {
            const directory = path.join(TMP_ROOT, crypto.randomUUID());
            temporaryDirectory = directory;
            target = path.join(directory, path.basename(request.file));
            await fs.promises.mkdir(directory, {
                recursive: true,
                mode: 0o700,
            });
            await fs.promises.writeFile(target, request.content);
            aliases.set(path.normalize(target), path.normalize(request.file));
            extraIncludeDirs = [path.dirname(request.file)];
        }

        const invocation = await buildInvocation({
            file: target,
            realFile: request.file,
            projectRoot,
            workspaceRoot: request.workspaceRoot,
            settings: request.settings,
            config,
            extraIncludeDirs,
        });
        const executable = invocation.compiler
            === (config.compiler ?? request.settings.compiler)
            ? configuredExecutable
            : resolveExecutable(invocation.compiler);
        const command = [executable, ...invocation.args].join(' ');

        const res = await runProcess(executable, invocation.args, {
            cwd: invocation.cwd,
            env: invocation.env,
            timeoutMs: request.settings.timeoutMs,
            signal: request.signal,
        });

        if (res.aborted) {
            return {
                ...base,
                items: [],
                aborted: true,
                durationMs: Date.now() - started,
            };
        }

        const ignore = [
            ...request.settings.ignoreWarnings,
            ...(config.ignoreWarnings ?? []),
        ].map(fragment => fragment.toLowerCase());
        const normalizedFile = path.normalize(request.file);
        const parsed = parseEpiclangOutput(
            `${res.stdout}\n${res.stderr}`,
            invocation.cwd,
            aliases,
        );
        const items = parsed.filter(diagnostic => {
            if (request.verification) return true;
            if (path.normalize(diagnostic.file) !== normalizedFile) {
                return false;
            }

            const haystack = `${diagnostic.message} ${diagnostic.clangOption ?? ''}`
                .toLowerCase();

            return !ignore.some(fragment => haystack.includes(fragment));
        });

        const lastLines = `${res.stderr}`.trim().split('\n').slice(-3)
            .join('\n');

        return {
            ...base,
            items,
            allItems: parsed,
            aborted: res.aborted,
            timedOut: res.timedOut,
            truncated: res.truncated,
            exitCode: res.code,
            durationMs: Date.now() - started,
            source: invocation.source,
            detail: invocation.detail,
            command,
            unparsed: res.code !== 0 && parsed.length === 0 && lastLines
                ? lastLines
                : undefined,
        };
    } finally {
        if (temporaryDirectory) {
            await fs.promises
                .rm(temporaryDirectory, { recursive: true, force: true })
                .catch(() => {});
        }
    }
}

export { EpiclangNotFoundError };
