import { execFile, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BananaDiagnostic } from './types';

export type ByteUnit = 'auto' | 'B' | 'kB' | 'MB' | 'GB';

/**
 * A block the project allocated and never freed, at the line of the project
 * code that allocated it.
 */
export interface Leak {
    file: string;
    line: number;
    bytes: number;
    allocator: string;
}

export type MemErrorKind =
    | 'read'
    | 'write'
    | 'free'
    | 'uninit'
    | 'overlap'
    | 'other';

/** A frame of the project's own code: function, absolute file and line. */
export interface Frame {
    fn: string;
    file: string;
    line: number;
}

/**
 * A memcheck error (invalid read, uninitialised value...) at the project line
 * where it happened.
 */
export interface MemError {
    kind: MemErrorKind;
    /** Memcheck's own words: `Invalid read of size 4`. */
    what: string;
    file: string;
    line: number;
    fn: string;
    /**
     * The library function the project called, when the top frame is not the
     * project's (`strlen`).
     */
    via?: string;
    /**
     * `0 bytes after a block of size 40 alloc'd`, plus the project line that
     * allocated or freed it.
     */
    detail?: string;
    origin?: Frame;
    /** The project's frames, innermost first (at most 4). */
    stack: Frame[];
}

export interface ValgrindReport {
    leaks: Leak[];
    errors: MemError[];
    /** Errors that happened entirely inside other libraries, left out. */
    errorsOmitted: number;
    /**
     * Every byte definitely or indirectly lost, located or not: memcheck's LEAK
     * SUMMARY total.
     */
    bytes: number;
    /**
     * Leaks allocated by other libraries (SFML, X11, GL...): not the project's
     * to fix.
     */
    omitted: number;
    /**
     * Leaks and errors from the project's binary without file and line: it was
     * built without `-g`.
     */
    unlocated: number;
    /** Signal that killed the program, e.g. SIGSEGV. */
    signal?: string;
    /**
     * Valgrind ran the program to the end (false when it could not start it).
     */
    finished: boolean;
    /**
     * Blocks allocated and freed, bytes allocated and still in use at exit,
     * from the heap summary.
     */
    heap?: { allocs: number; frees: number; bytes: number; inUse?: number };
}

type RawFrame = { fn: string; file?: string; line?: number; obj?: string };

function isInside(file: string, root: string): boolean {
    const rel = path.relative(root, file);

    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const count = (value: string) => Number(value.replace(/[,.]/g, ''));

const FRAME = /^\s+(?:at|by) 0x[0-9A-Fa-f]+: (.*) \((.*)\)$/;
const ERROR_HEADS: Array<[RegExp, MemErrorKind]> = [
    [/^Invalid read of size \d+$/, 'read'],
    [/^Invalid write of size \d+$/, 'write'],
    [/^(?:Invalid free\(\)|Mismatched free\(\)) \/ delete \/ delete ?\[\]/, 'free'],
    [/^Conditional jump or move depends on uninitialised value\(s\)$|^Use of uninitialised value of size \d+$|^Syscall param .* (?:points to|contains) uninitialised byte\(s\)$/, 'uninit'],
    [/^Source and destination overlap in /, 'overlap'],
    [/^Argument '\w+' of function \w+ has a fishy value/, 'other'],
];

/**
 * Reads a stack from `lines[i]` on: its frames, and the index of its last
 * line.
 */
function readStack(
    lines: readonly string[],
    i: number,
    root: string,
): { frames: RawFrame[]; end: number } {
    const frames: RawFrame[] = [];
    for (; i < lines.length; i++) {
        const frame = FRAME.exec(lines[i]!);
        if (!frame) break;

        const fn = frame[1]!;
        const where = frame[2]!;
        const obj = /^in (.+)$/.exec(where)?.[1];
        const located = obj ? undefined : /^(.+):(\d+)$/.exec(where);
        const inside = located && path.isAbsolute(located[1]!)
            && isInside(located[1]!, root);
        frames.push(inside
            ? { fn, file: located[1]!, line: Number(located[2]) }
            : { fn, obj });
    }

    return { frames, end: i - 1 };
}

const projectFrames = (frames: RawFrame[]): Frame[] =>
    frames.filter((f): f is Frame => f.file !== undefined);

/**
 * One memcheck error block from its head line; `unlocated` without a project
 * line, `omitted` when it never touched the project.
 */
function readError(
    lines: readonly string[],
    i: number,
    root: string,
    kind: MemErrorKind,
): {
    end: number;
    error?: MemError;
    outcome: 'error' | 'unlocated' | 'omitted';
} {
    const what = lines[i]!.trim();
    const main = readStack(lines, i + 1, root);
    let end = main.end;
    let detail: string | undefined, origin: Frame | undefined;

    const extra = /^\s*(?:Address 0x[0-9A-Fa-f]+ is (.+)|(Uninitialised value was created by .+)|(Block was alloc'd at))$/.exec(lines[end + 1] ?? '');
    if (extra) {
        detail = extra[1] ?? extra[2];
        const second = readStack(lines, end + 2, root);
        origin = projectFrames(second.frames)[0];
        end = second.end;
    }

    const stack = projectFrames(main.frames);
    const at = stack[0];
    if (!at) {
        return {
            end,
            outcome: main.frames.some(f => f.obj && isInside(f.obj, root))
                ? 'unlocated'
                : 'omitted',
        };
    }

    const top = main.frames[0]!;
    const via = top.file === undefined && top.fn !== '???'
        ? top.fn.replace(/^__/, '').replace(/_(?:avx2|sse2|evex|erms)\w*$/, '')
        : undefined;

    return {
        end,
        outcome: 'error',
        error: {
            kind,
            what,
            file: at.file,
            line: at.line,
            fn: at.fn,
            via,
            detail,
            origin,
            stack: stack.slice(0, 4),
        },
    };
}

/**
 * Reads memcheck's text log (run with `--fullpath-after=` so sources are
 * absolute) and keeps the leaks the project itself allocated. Text, not
 * `--xml=yes`: in XML mode memcheck leaves out the heap summary.
 */
export function parseValgrindLog(log: string, root: string): ValgrindReport {
    const lines = log
        .split(/\r?\n/)
        .map(line => line.replace(/^==\d+==\s?/, ''));
    const report: ValgrindReport = {
        leaks: [],
        errors: [],
        errorsOmitted: 0,
        bytes: 0,
        omitted: 0,
        unlocated: 0,
        finished: /HEAP SUMMARY:|ERROR SUMMARY:/.test(log),
        signal: /Process terminating with default action of signal \d+ \((SIG\w+)\)/.exec(log)?.[1],
        heap: parseHeapUsage(log),
    };

    for (let i = 0; i < lines.length; i++) {
        const kind = ERROR_HEADS.find(([head]) => head.test(lines[i]!))?.[1];
        if (kind) {
            const read = readError(lines, i, root, kind);
            if (read.error) {
                report.errors.push(read.error);
            } else if (read.outcome === 'unlocated') {
                report.unlocated++;
            } else {
                report.errorsOmitted++;
            }
            i = read.end;
            continue;
        }

        const head = /^([\d,]+) (?:\(([\d,]+) direct, [\d,]+ indirect\) )?bytes in [\d,]+ blocks are (definitely|indirectly) lost in loss record/.exec(lines[i]!);
        if (!head) continue;

        const bytes = count(head[2] ?? head[1]!);
        report.bytes += bytes;
        let allocator = 'malloc';
        let outcome: 'leak' | 'omitted' | 'unlocated' = 'omitted';
        for (i++; i < lines.length; i++) {
            const frame = FRAME.exec(lines[i]!);
            if (!frame) break;

            const fn = frame[1]!;
            const where = frame[2]!;
            const obj = /^in (.+)$/.exec(where)?.[1];
            const located = obj ? undefined : /^(.+):(\d+)$/.exec(where);
            if (located && path.isAbsolute(located[1]!)) {
                if (isInside(located[1]!, root)) {
                    report.leaks.push({
                        file: located[1]!,
                        line: Number(located[2]),
                        bytes,
                        allocator,
                    });
                    outcome = 'leak';
                    break;
                }
                if (!/vg_replace_|\/coregrind\//.test(located[1]!)) {
                    outcome = 'omitted';
                    break;
                }
                if (fn && fn !== '???') allocator = fn;
                continue;
            }
            if (obj && isInside(obj, root)) {
                outcome = 'unlocated';
                break;
            }
            if (obj && !/vgpreload|\/libc[.-]/.test(obj)) break;
            if (fn && fn !== '???') allocator = fn;
        }
        while (i + 1 < lines.length && /^\s+(?:at|by) 0x/.test(lines[i + 1]!)) {
            i++;
        }

        if (outcome === 'omitted') report.omitted++;
        if (outcome === 'unlocated') report.unlocated++;
    }

    return report;
}

export function formatBytes(bytes: number, unit: ByteUnit): string {
    const powers: Record<Exclude<ByteUnit, 'auto'>, number> = {
        B: 0,
        kB: 1,
        MB: 2,
        GB: 3,
    };
    const chosen = unit !== 'auto'
        ? unit
        : (['GB', 'MB', 'kB', 'B'] as const)
            .find(u => bytes >= 1000 ** powers[u]) ?? 'B';
    const value = bytes / 1000 ** powers[chosen];

    return `${chosen === 'B' ? value : Number(value.toFixed(2))} ${chosen}`;
}

/** Leaks of the same line (an allocation in a loop) added up, biggest first. */
export function groupLeaks(leaks: readonly Leak[]): Leak[] {
    const byLine = new Map<string, Leak>();
    for (const leak of leaks) {
        const key = `${leak.file}:${leak.line}`;
        const known = byLine.get(key);
        byLine.set(key, known
            ? { ...known, bytes: known.bytes + leak.bytes }
            : leak);
    }

    return [...byLine.values()].sort((a, b) => b.bytes - a.bytes);
}

/**
 * 1-based column of the allocator call on its line (`malloc(` in
 * `char *s = malloc(4);`), 1 when not found.
 */
export function leakColumn(lineText: string, allocator: string): number {
    const name = allocator.replace(/\W/g, '');
    const call = new RegExp(`\\b${name}\\s*\\(`);

    return lineText.search(call) + 1 || 1;
}

/** One Major finding per allocating line, on the allocator call. */
export function leakFindings(
    leaks: readonly Leak[],
    unit: ByteUnit,
    lineText: (line: number) => string,
): BananaDiagnostic[] {
    return groupLeaks(leaks).map(leak => {
        const column = leakColumn(lineText(leak.line), leak.allocator);

        return {
            file: leak.file,
            line: leak.line,
            column,
            rangeStartColumn: column,
            rangeLength: leak.allocator.length,
            severity: 'warning',
            rawSeverity: 'warning',
            level: 'Major',
            bucket: 'major',
            ruleId: 'VALGRIND',
            plugin: 'valgrind',
            notes: [],
            message: `${formatBytes(leak.bytes, unit)} never freed`,
        };
    });
}

export interface GroupedError extends MemError {
    count: number;
}

/**
 * Identical errors (same kind, same line: a loop) counted once, in the order
 * they first happened.
 */
export function groupErrors(errors: readonly MemError[]): GroupedError[] {
    const byKey = new Map<string, GroupedError>();
    for (const error of errors) {
        const key = `${error.kind}:${error.file}:${error.line}`;
        const known = byKey.get(key);
        if (known) {
            known.count++;
        } else {
            byKey.set(key, { ...error, count: 1 });
        }
    }

    return [...byKey.values()];
}

/**
 * 1-based column of the error on its line: the library call when there is one,
 * else the line's first character.
 */
export function errorColumn(lineText: string, via: string | undefined): number {
    const call = via ? leakColumn(lineText, via) : 1;

    return call > 1
        ? call
        : lineText.length - lineText.trimStart().length + 1;
}

/** One Major finding per erroring line. */
export function errorFindings(
    errors: readonly GroupedError[],
    lineText: (line: number) => string,
): BananaDiagnostic[] {
    return errors.map(error => {
        const text = lineText(error.line);
        const column = errorColumn(text, error.via);
        const length = error.via && column > 1
            ? error.via.length
            : Math.max(1, text.trimEnd().length - column + 1);

        return {
            file: error.file,
            line: error.line,
            column,
            rangeStartColumn: column,
            rangeLength: length,
            severity: 'warning',
            rawSeverity: 'warning',
            level: 'Major',
            bucket: 'major',
            ruleId: 'VALGRIND',
            plugin: 'valgrind',
            notes: [],
            message: `${error.what}${error.via ? ` in ${error.via}` : ''}${error.count > 1 ? ` (×${error.count})` : ''}`,
        };
    });
}

/** Resolves false when `valgrind` is not on the PATH (or not runnable). */
export function valgrindInstalled(): Promise<boolean> {
    return new Promise(resolve => execFile(
        'valgrind',
        ['--version'],
        { timeout: 10_000 },
        error => resolve(!error),
    ));
}

export interface ValgrindProcess {
    exitCode: number | null;
    stderrTail: string;
}

/**
 * `==1== total heap usage: 1,284 allocs, 1,279 frees, 52,345 bytes allocated`
 */
export function parseHeapUsage(text: string): ValgrindReport['heap'] {
    const match = /total heap usage: ([\d,.]+) allocs, ([\d,.]+) frees, ([\d,.]+) bytes allocated/.exec(text);
    if (!match) return undefined;

    const inUse = /in use at exit: ([\d,.]+) bytes/.exec(text);

    return {
        allocs: count(match[1]!),
        frees: count(match[2]!),
        bytes: count(match[3]!),
        ...(inUse ? { inUse: count(inUse[1]!) } : {}),
    };
}

/**
 * Runs `argv` under memcheck from `cwd`, its report going to `logFile` (the
 * program keeps its own stdout and stderr).
 * Stdin is closed so a program waiting for input ends instead of hanging;
 * `signal` kills it.
 */
export function spawnValgrind(
    argv: readonly string[],
    cwd: string,
    logFile: string,
    signal: AbortSignal,
    onOutput: (text: string) => void,
): Promise<ValgrindProcess> {
    return new Promise((resolve, reject) => {
        const child = spawn('valgrind', [
            '--leak-check=full',
            '--fullpath-after=',
            `--log-file=${logFile}`,
            ...argv,
        ], { cwd, stdio: ['ignore', 'pipe', 'pipe'], signal });

        let stderrTail = '';
        child.stdout.on('data', (chunk: Buffer) => onOutput(chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => {
            onOutput(chunk.toString());
            stderrTail = (stderrTail + chunk.toString()).slice(-2000);
        });
        child.on('error', error => {
            if (!signal.aborted) reject(error);
        });
        child.on('close', exitCode => resolve({ exitCode, stderrTail }));
    });
}
