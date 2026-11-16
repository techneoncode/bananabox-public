import * as path from 'node:path';
import { BananaDiagnostic, Bucket, Severity, Summary } from './types';

const HEADER =
    /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning|remark|note):\s*(.*)$/;
const LEVEL =
    /\[(Blocker|Critical|Fatal|Major|Minor|Info|Information|Warning|Error)\]/i;
const BRACKET = /\[([^\]]+)\]/g;
const RULE = /\(([A-Za-z]-[A-Za-z]\d+)\)\s*$/;
const OPTION = /\[(-W[^\]]+)\]\s*$/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

interface Caret {
    length: number;
    before: number;
}

export function parseEpiclangOutput(
    output: string,
    baseDir: string,
    aliases: ReadonlyMap<string, string> = new Map(),
): BananaDiagnostic[] {
    const lines = output
        .replace(ANSI, '')
        .replace(/\r\n/g, '\n')
        .split('\n');
    const result: BananaDiagnostic[] = [];
    const seen = new Set<string>();
    let previous: BananaDiagnostic | undefined;

    for (let i = 0; i < lines.length; i++) {
        const match = HEADER.exec(lines[i]);
        if (!match) continue;

        const [, rawFile, lineNo, colNo, rawSeverity, rawMessage] = match;
        const file = normalizePath(rawFile, baseDir, aliases);
        const line = Number(lineNo);
        const column = Number(colNo);

        if (rawSeverity === 'note') {
            if (previous && previous.notes.length < 5) {
                previous.notes.push({
                    file,
                    line,
                    column,
                    message: rawMessage.trim(),
                });
            }
            continue;
        }

        const {
            message, clangOption, ruleId, level, plugin,
        } = parseMessage(rawMessage);
        const caret = parseCaret(lines[i + 1], lines[i + 2]);
        const bucket = bucketOf(level);

        const diagnostic: BananaDiagnostic = {
            file,
            line,
            column,
            severity: mapSeverity(rawSeverity, bucket),
            rawSeverity,
            message,
            level,
            bucket,
            ruleId,
            plugin,
            clangOption,
            notes: [],
        };
        if (caret && caret.length > 1) {
            diagnostic.rangeStartColumn = Math.max(1, column - caret.before);
            diagnostic.rangeLength = caret.length;
        }

        const key = `${file}:${line}:${column}:${ruleId ?? ''}:${message}`;
        if (seen.has(key)) {
            previous = undefined;
            continue;
        }
        seen.add(key);
        result.push(diagnostic);
        previous = diagnostic;
    }

    return result;
}

function parseMessage(rawMessage: string) {
    let message = rawMessage.trim();

    const optionMatch = OPTION.exec(message);
    const clangOption = optionMatch?.[1];
    if (optionMatch) message = message.slice(0, optionMatch.index).trimEnd();

    const ruleMatch = RULE.exec(message);
    const ruleId = ruleMatch?.[1]?.toUpperCase();
    if (ruleMatch) message = message.slice(0, ruleMatch.index).trimEnd();

    const levelMatch = LEVEL.exec(message);
    const level = levelMatch?.[1] ? capitalize(levelMatch[1]) : undefined;
    const plugin = [...message.matchAll(BRACKET)]
        .map(m => m[1])
        .find(value => value.toLowerCase()
            !== levelMatch?.[1]?.toLowerCase());
    if (plugin) message = message.replace(`[${plugin}]`, '');
    if (levelMatch) message = message.replace(levelMatch[0], '');
    message = message.replace(/\s{2,}/g, ' ').trim();

    return { message, clangOption, ruleId, level, plugin };
}

function parseCaret(
    source: string | undefined,
    caretLine: string | undefined,
): Caret | undefined {
    if (source === undefined || caretLine === undefined
        || HEADER.test(source)) {
        return undefined;
    }

    const gutter = /^\s*\|\s?(.*)$/.exec(caretLine);
    const body = gutter ? gutter[1] : caretLine;
    if (!/^ *[~^][~^ ]*$/.test(body)) return undefined;

    const caret = body.indexOf('^');
    if (caret < 0) return undefined;

    const first = body.search(/[~^]/);
    const lastMarker = Math.max(body.lastIndexOf('~'), body.lastIndexOf('^'));

    return { length: lastMarker - first + 1, before: caret - first };
}

export function bucketOf(level?: string): Bucket | undefined {
    switch (level?.toLowerCase()) {
        case 'blocker':
        case 'critical':
        case 'fatal':
            return 'fatal';
        case 'major':
        case 'error':
            return 'major';
        case 'minor':
        case 'warning':
            return 'minor';
        case 'info':
        case 'information':
            return 'info';
        default:
            return undefined;
    }
}

function mapSeverity(rawSeverity: string, bucket?: Bucket): Severity {
    if (bucket === 'fatal' || bucket === 'major') return 'error';
    if (bucket === 'minor') return 'warning';
    if (bucket === 'info') return 'information';

    switch (rawSeverity) {
        case 'fatal error':
        case 'error':
            return 'error';
        case 'warning':
            return 'warning';
        default:
            return 'information';
    }
}

function normalizePath(
    file: string,
    baseDir: string,
    aliases: ReadonlyMap<string, string>,
): string {
    const cleaned = file.trim().replace(/^\.\//, '');
    const absolutePath = path.normalize(
        path.isAbsolute(cleaned) ? cleaned : path.join(baseDir, cleaned),
    );

    return aliases.get(absolutePath) ?? absolutePath;
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function summarize(items: readonly BananaDiagnostic[]): Summary {
    const summary = {
        fatal: 0,
        major: 0,
        minor: 0,
        info: 0,
        other: 0,
        functions: 0,
    };
    for (const item of items) {
        if (item.kind === 'function') {
            summary.functions++;
        } else if (item.bucket) {
            summary[item.bucket]++;
        } else {
            summary.other++;
        }
    }

    return summary;
}
