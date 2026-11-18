import { ui } from './messages';

export type HunkKind =
    | 'header'
    | 'removeBlank'
    | 'addBlank'
    | 'trailing'
    | 'indent'
    | 'spacing'
    | 'layout'
    | 'finalNewline'
    | 'rewrite';

/**
 * A change inside one line: `remove` characters at `start` (0-based) are
 * replaced by `insert`.
 */
export interface InlineChange {
    start: number;
    remove: number;
    insert: string;
}

export interface Hunk {
    /** First line (0-based, in the text before) the hunk replaces. */
    start: number;
    /** Lines replaced (may be 0 for a pure insertion). */
    oldLines: string[];
    newLines: string[];
    /** Character offsets in the text before. */
    startOffset: number;
    endOffset: number;
    /** Replacement text, with `\n` line endings. */
    newText: string;
    kind: HunkKind;
    title: string;
    /**
     * For hunks pairing old and new lines one to one: what changes within
     * each line.
     */
    inline?: InlineChange[];
}

function splitKeep(text: string) {
    return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const body = (line: string) => line.replace(/\r?\n$/, '');
const same = (a: string, b: string) =>
    a.replace(/\r\n$/, '\n') === b.replace(/\r\n$/, '\n');

/**
 * Longest common subsequence of lines, trimmed to the differing middle;
 * falls back to one block when huge.
 */
function matches(a: string[], b: string[]): Array<[number, number]> {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length
        && same(a[prefix]!, b[prefix]!)) {
        prefix++;
    }
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix
        && same(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)) {
        suffix++;
    }

    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < prefix; i++) pairs.push([i, i]);
    const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
    if (n > 0 && m > 0 && n * m <= 4_000_000) {
        const table = Array.from(
            { length: n + 1 },
            () => new Uint32Array(m + 1),
        );
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                table[i]![j] = same(a[prefix + i]!, b[prefix + j]!)
                    ? table[i + 1]![j + 1]! + 1
                    : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
            }
        }
        for (let i = 0, j = 0; i < n && j < m;) {
            if (same(a[prefix + i]!, b[prefix + j]!)) {
                pairs.push([prefix + i, prefix + j]);
                i++;
                j++;
            } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
                i++;
            } else {
                j++;
            }
        }
    }
    for (let k = suffix; k > 0; k--) pairs.push([a.length - k, b.length - k]);
    return pairs;
}

function inlineChange(before: string, after: string): InlineChange {
    let start = 0;
    while (start < before.length && start < after.length
        && before[start] === after[start]) {
        start++;
    }
    let end = 0;
    while (end < before.length - start && end < after.length - start
        && before[before.length - 1 - end] === after[after.length - 1 - end]) {
        end++;
    }

    return {
        start,
        remove: before.length - start - end,
        insert: after.slice(start, after.length - end),
    };
}

const blank = (line: string) => !body(line).trim();
const squash = (lines: string[]) =>
    lines.map(body).join('').replace(/\s+/g, '');

function classify(
    oldLines: string[],
    newLines: string[],
    atStart: boolean,
    atEnd: boolean,
): { kind: HunkKind; title: string } {
    const plural = (n: number, one: string, many: string) =>
        (n === 1 ? ui(one) : ui(many, { n }));

    if (oldLines.length === 0 && atStart
        && /EPITECH PROJECT/.test(newLines.join(''))) {
        return { kind: 'header', title: ui('Add the Epitech header (C-G1)') };
    }
    if (newLines.length === 0 && oldLines.every(blank)) {
        return {
            kind: 'removeBlank',
            title: plural(
                oldLines.length,
                'Remove this blank line',
                'Remove {n} blank lines',
            ),
        };
    }
    if (oldLines.length === 0 && newLines.every(blank)) {
        return {
            kind: 'addBlank',
            title: plural(
                newLines.length,
                'Add a blank line',
                'Add {n} blank lines',
            ),
        };
    }
    if (oldLines.length === newLines.length) {
        if (atEnd && oldLines.length === 1
            && body(oldLines[0]!) === body(newLines[0]!)) {
            return { kind: 'finalNewline', title: ui('Add the final newline') };
        }
        const pairs = oldLines.map(
            (line, i) => [body(line), body(newLines[i]!)] as const,
        );
        if (pairs.every(([a, b]) => a.trimEnd() === b && a !== b)) {
            return { kind: 'trailing', title: ui('Remove trailing whitespace') };
        }
        if (pairs.every(([a, b]) => a.trim() === b.trim())) {
            const trailing = pairs.some(
                ([a, b]) => a.trimEnd() !== a && b.trimEnd() === b,
            );
            const indent = pairs.some(
                ([a, b]) => a.match(/^\s*/)![0] !== b.match(/^\s*/)![0],
            );
            if (indent) {
                return {
                    kind: 'indent',
                    title: trailing
                        ? ui('Fix indentation and trailing whitespace')
                        : plural(
                                oldLines.length,
                                'Fix indentation',
                                'Fix indentation of {n} lines',
                            ),
                };
            }
            return { kind: 'trailing', title: ui('Remove trailing whitespace') };
        }
        if (squash(oldLines) === squash(newLines)) {
            return { kind: 'spacing', title: ui('Fix spacing') };
        }
    }
    if (squash(oldLines) === squash(newLines)) {
        const braces = /[{}]/.test(oldLines.join(''))
            && newLines.some(line => /^\s*[{}]\s*$/.test(body(line)));
        return {
            kind: 'layout',
            title: braces
                ? ui('Put the brace on its own line')
                : newLines.length > oldLines.length
                    ? ui('Split into several lines')
                    : ui('Join these lines'),
        };
    }

    return { kind: 'rewrite', title: ui('Reformat this block') };
}

const HEADER = /^(?:\uFEFF)?\/\*\r?\n\*\* EPITECH PROJECT[\s\S]*?\*\/\r?\n(?:\r?\n)?/;

/**
 * Splits a whole-file correction into small hunks that can be reviewed and
 * accepted one at a time.
 */
export function computeHunks(before: string, after: string): Hunk[] {
    const header = HEADER.exec(after)?.[0];
    if (header && !HEADER.test(before)
        && !/^\s*\/\*[\s\S]{0,400}?EPITECH PROJECT/.test(before)) {
        const lines = splitKeep(header);
        return [
            {
                start: 0,
                oldLines: [],
                newLines: lines.map(body),
                startOffset: 0,
                endOffset: 0,
                newText: header.replace(/\r\n/g, '\n'),
                kind: 'header',
                title: ui('Add the Epitech header (C-G1)'),
            },
            ...computeHunks(before, after.slice(header.length)),
        ];
    }

    const a = splitKeep(before), b = splitKeep(after);
    const offsets = [0];
    for (const line of a) {
        offsets.push(offsets[offsets.length - 1]! + line.length);
    }
    const pairs = [...matches(a, b), [a.length, b.length] as [number, number]];
    const hunks: Hunk[] = [];
    let i = 0, j = 0;
    for (const [mi, mj] of pairs) {
        if (mi > i || mj > j) {
            const oldLines = a.slice(i, mi), newLines = b.slice(j, mj);
            const { kind, title } = classify(
                oldLines,
                newLines,
                i === 0,
                mi === a.length,
            );
            const hunk: Hunk = {
                start: i,
                oldLines: oldLines.map(body),
                newLines: newLines.map(body),
                startOffset: offsets[i]!,
                endOffset: offsets[mi]!,
                newText: newLines
                    .map(line => line.replace(/\r\n$/, '\n'))
                    .join(''),
                kind,
                title,
            };
            if (oldLines.length === newLines.length
                && kind !== 'finalNewline') {
                hunk.inline = oldLines.map((line, k) =>
                    inlineChange(body(line), body(newLines[k]!)));
            }
            hunks.push(hunk);
        }
        i = mi + 1;
        j = mj + 1;
    }
    return hunks;
}

/**
 * Last line (0-based, in the text before) a hunk touches; a pure insertion
 * is anchored on the line before it.
 */
export function hunkEndLine(hunk: Hunk): number {
    return hunk.oldLines.length
        ? hunk.start + hunk.oldLines.length - 1
        : Math.max(0, hunk.start - 1);
}

/**
 * The hunk to propose near `line`: the one containing it, else the next one,
 * else the last.
 */
export function hunkNear(hunks: readonly Hunk[], line: number): number {
    if (!hunks.length) return -1;
    const index = hunks.findIndex(hunk => hunkEndLine(hunk) >= line);
    return index < 0 ? hunks.length - 1 : index;
}

/** A unified diff of one hunk, for hovers. */
export function hunkDiff(hunk: Hunk): string {
    return [
        ...hunk.oldLines.map(line => `- ${line}`),
        ...hunk.newLines.map(line => `+ ${line}`),
    ].join('\n');
}
