import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sanitizeFlags, SYNTAX_FLAGS } from './flags';
import {
    discoverIncludeDirs,
    findCompileCommandsEntry,
    harvestMakefileFlags,
} from './project';
import { shellSplit, splitCommandChain } from './shell';
import { BananaLensProjectConfig, Settings } from './types';

export type InvocationSource =
    | 'config'
    | 'compile_commands'
    | 'makefile'
    | 'auto';

export interface Invocation {
    compiler: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    source: InvocationSource;
    detail: string;
}

export interface InvocationInput {
    /** File handed to the compiler (may be a temp copy). */
    file: string;
    /** The real file on disk. */
    realFile: string;
    projectRoot: string;
    workspaceRoot?: string;
    settings: Settings;
    config: BananaLensProjectConfig;
    /**
     * Extra `-I` directories (used for the temp copy so `"local.h"` still
     * resolves).
     */
    extraIncludeDirs?: string[];
}

export async function buildInvocation(
    input: InvocationInput,
): Promise<Invocation> {
    const { settings, config, projectRoot, file, realFile } = input;
    const compiler = config.compiler ?? settings.compiler;
    const env = config.env ?? {};
    const extraFlags = [
        ...settings.extraArgs,
        ...(config.extraArgs ?? []),
        ...[
            ...settings.includePaths,
            ...(config.includePaths ?? []),
        ].map(dir => `-I${path.resolve(projectRoot, dir)}`),
        ...(input.extraIncludeDirs ?? []).map(dir => `-I${dir}`),
    ];
    const assemble = (
        flags: string[],
        source: InvocationSource,
        detail: string,
        cwd = projectRoot,
        exe = compiler,
    ): Invocation => ({
        compiler: exe,
        args: [...SYNTAX_FLAGS, ...flags, ...extraFlags, file],
        cwd,
        env,
        source,
        detail,
    });

    if (config.command) {
        const expanded = shellSplit(config.command).map(token => token
            .replaceAll('{file}', realFile)
            .replaceAll('{fileBasename}', path.basename(realFile))
            .replaceAll('{workspace}', input.workspaceRoot ?? projectRoot)
            .replaceAll('{project}', projectRoot));
        const [exe = compiler, ...rest] = expanded;

        return assemble(
            sanitizeFlags(rest, projectRoot, false),
            'config',
            '.bananalens.json (command)',
            projectRoot,
            exe,
        );
    }
    if (config.args) {
        return assemble(
            sanitizeFlags(config.args, projectRoot, false),
            'config',
            '.bananalens.json (args)',
        );
    }

    if (settings.useCompileCommands) {
        const entry = findCompileCommandsEntry(projectRoot, realFile);
        if (entry) {
            return assemble(
                sanitizeFlags(entry.tokens, entry.directory, true),
                'compile_commands',
                'compile_commands.json',
                entry.directory,
            );
        }
    }

    const makeEnabled = config.make?.enabled ?? settings.makeDryRun;
    if (makeEnabled) {
        const tokens = await dryRunMake(
            projectRoot,
            realFile,
            config.make?.target ?? settings.makefileTarget,
        );
        if (tokens) {
            return assemble(
                sanitizeFlags(tokens, projectRoot, true),
                'makefile',
                'make -nB',
            );
        }
    }

    const flags: string[] = [];
    const parts: string[] = [];
    const includeDirs: string[] = [];
    if (settings.useMakefile) {
        const harvested = harvestMakefileFlags(projectRoot);
        includeDirs.push(...harvested.includeDirs);
        flags.push(...harvested.defines);
        if (harvested.std) flags.push(harvested.std);
        if (harvested.includeDirs.length || harvested.defines.length) {
            parts.push('Makefile flags');
        }
    }
    if (settings.autoIncludes && config.autoIncludes !== false) {
        for (const dir of await discoverIncludeDirs(projectRoot)) {
            if (!includeDirs.includes(dir)) includeDirs.push(dir);
        }
    }
    flags.unshift(...includeDirs.map(dir => `-I${dir}`));

    const count = includeDirs.length;
    parts.push(`${count} include dir${count === 1 ? '' : 's'}`);

    return assemble(flags, 'auto', `auto-detected (${parts.join(', ')})`);
}

function dryRunMake(
    root: string,
    sourceFile: string,
    target: string,
): Promise<string[] | undefined> {
    return new Promise(resolve => {
        const args = [
            '-nB',
            '--no-print-directory',
            ...(target.trim() ? [target.trim()] : []),
        ];
        const options = {
            cwd: root,
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
            timeout: 15000,
        };
        cp.execFile('make', args, options, (_e, stdout, stderr) => {
            resolve(findMakeCommand(`${stdout}\n${stderr}`, sourceFile));
        });
    });
}

function findMakeCommand(
    output: string,
    sourceFile: string,
): string[] | undefined {
    const basename = path.basename(sourceFile);
    const compilerName =
        /(^|\/)(epiclang|clang(-\d+)?|gcc(-\d+)?|g\+\+|cc|c\+\+)$/;
    for (const line of output.split(/\r?\n/)) {
        for (const command of splitCommandChain(line)) {
            const tokens = shellSplit(command);
            if (tokens.length < 2 || !compilerName.test(tokens[0])) continue;

            const usesSource = tokens.some(token => token === basename
                || token.endsWith(`/${basename}`));
            if (usesSource) return tokens.slice(1);
        }
    }

    return undefined;
}

export class EpiclangNotFoundError extends Error {
    constructor(override readonly name: string) {
        super(
            `Cannot find "${name}". Install epiclang or set "bananalens.compiler" to its full path.`,
        );
    }
}

const EXTRA_BIN_DIRS = [
    '/usr/local/bin',
    '/usr/bin',
    '/opt/homebrew/bin',
    '/opt/epiclang/bin',
    path.join(os.homedir(), '.local', 'bin'),
];

export function resolveExecutable(
    name: string,
    envPath: string | undefined = process.env.PATH,
): string {
    if (name.includes('/') || name.includes('\\')) {
        const abs = path.resolve(name.replace(/^~(?=\/)/, os.homedir()));
        if (isExecutable(abs)) return abs;

        throw new EpiclangNotFoundError(name);
    }

    const dirs = [
        ...(envPath ?? '').split(path.delimiter),
        ...EXTRA_BIN_DIRS,
    ].filter(Boolean);
    const exts = process.platform === 'win32'
        ? ['', '.exe', '.cmd', '.bat']
        : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = path.join(dir, name + ext);
            if (isExecutable(candidate)) return candidate;
        }
    }

    throw new EpiclangNotFoundError(name);
}

function isExecutable(file: string): boolean {
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}
