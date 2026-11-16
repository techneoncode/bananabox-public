import { spawn } from 'node:child_process';
import { removeStatementBlankLines } from './blankLines';

/**
 * Whitespace only: never insert braces, rewrite declarations or reorder
 * includes.
 */
export const STYLE = {
    BasedOnStyle: 'LLVM', Language: 'Cpp', Standard: 'c++11',
    IndentWidth: 4, ContinuationIndentWidth: 4, TabWidth: 4, UseTab: 'Never',
    ColumnLimit: 79,
    AlignAfterOpenBracket: 'DontAlign', AlignOperands: 'DontAlign',
    BreakBeforeBinaryOperators: 'NonAssignment',
    BreakBeforeBraces: 'Custom',
    BraceWrapping: {
        AfterFunction: true,
        AfterControlStatement: 'Never',
        AfterStruct: false,
        AfterEnum: false,
        BeforeElse: false,
        BeforeWhile: false,
        SplitEmptyFunction: true,
    },
    AllowShortFunctionsOnASingleLine: 'None',
    AllowShortIfStatementsOnASingleLine: 'Never',
    AllowShortLoopsOnASingleLine: false, AllowShortBlocksOnASingleLine: 'Never',
    AllowShortEnumsOnASingleLine: false,
    AllowShortCaseLabelsOnASingleLine: false,
    PointerAlignment: 'Right', DerivePointerAlignment: false,
    SpaceBeforeParens: 'ControlStatements', SpaceAfterCStyleCast: true,
    SortIncludes: 'Never', SortUsingDeclarations: false, ReflowComments: false,
    IndentPPDirectives: 'BeforeHash', PPIndentWidth: 4,
    MaxEmptyLinesToKeep: 1, KeepEmptyLinesAtTheStartOfBlocks: false,
    SeparateDefinitionBlocks: 'Always', BreakStringLiterals: false,
};

const TOKEN =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?:u8|[LuU])?"(?:\\[^\n]|[^"\\\n])*"|(?:u8|[LuU])?'(?:\\[^\n]|[^'\\\n])*'|[A-Za-z_][A-Za-z_0-9]*|(?:\d|\.\d)(?:[eEpP][+-]|[\w.])*|>>=|<<=|\.\.\.|->|\+\+|--|&&|\|\||<=|>=|==|!=|\*=|\/=|%=|\+=|-=|<<|>>|&=|\^=|\|=|##|<:|:>|<%|%>|%:|[^\s]/g;

export function tokens(text: string): string[] | undefined {
    const result: string[] = [];
    const token = new RegExp(TOKEN.source, 'y');
    let offset = 0;
    while (offset < text.length) {
        if (/\s/.test(text[offset])) {
            offset++;
            continue;
        }
        if (text.startsWith('/*', offset)) {
            const end = text.indexOf('*/', offset + 2);
            if (end < 0) return undefined;
            result.push(text.slice(offset, end + 2));
            offset = end + 2;
            continue;
        }
        token.lastIndex = offset;
        const match = token.exec(text);
        if (!match || match[0] === '"' || match[0] === "'") return undefined;
        result.push(match[0]);
        offset = token.lastIndex;
    }

    return result;
}

export function safeCandidate(before: string, after: string): boolean {
    const originalTokens = tokens(before);
    const candidateTokens = tokens(after);
    if (!originalTokens || !candidateTokens
        || originalTokens.length !== candidateTokens.length) {
        return false;
    }
    if (originalTokens.some((token, i) => token !== candidateTokens[i])) {
        return false;
    }

    const originalDirectives = directives(before).map(line => line.trim());
    const candidateDirectives = directives(after).map(line => line.trim());

    return originalDirectives.length === candidateDirectives.length
        && originalDirectives.every(
            (line, i) => line === candidateDirectives[i],
        );
}

export interface FormatOptions {
    executable: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    whitespaceSensitiveMacros?: string[];
}

export function isCorrectionSource(source: string): boolean {
    if (Buffer.byteLength(source) > 256 * 1024) return false;
    if (/\\[ \t]*\r?\n|<:|:>|<%|%>|%:|\\[uU][0-9a-fA-F]|\?\?[=/\'()!<>-]|\b__LINE__\b|^\s*#\s*line\b|clang-format\s+(?:off|on)/m.test(source)) {
        return false;
    }

    return !!tokens(source) && !/\bR"/.test(source);
}

export async function formatC(
    source: string,
    options: FormatOptions,
): Promise<string | undefined> {
    if (!source || options.signal?.aborted
        || !isCorrectionSource(source)) {
        return undefined;
    }

    const input = source.replace(/\r\n/g, '\n');
    const macros = protectedMacroNames(
        input,
        options.whitespaceSensitiveMacros,
    );
    if (!hasSupportedDirectiveDepth(input)) return undefined;

    const output = await runFormatter(input, macros, options);
    const restored = restoreDirectives(input, output);
    const candidate = removeStatementBlankLines(restored, macros)
        .replace(/^(?:[ \t]*\n)+/, '')
        .replace(/\n*$/, '\n');

    return candidate !== source && safeCandidate(input, candidate)
        ? candidate
        : undefined;
}

function protectedMacroNames(
    source: string,
    configured: readonly string[] = [],
): Set<string> {
    const macros = new Set<string>(configured);
    for (const match of source.matchAll(/^\s*#\s*define\s+(\w+)\(/gm)) {
        macros.add(match[1]);
    }
    for (const match of source.matchAll(/\b([A-Z_][A-Z_0-9]*)\s*\(/g)) {
        macros.add(match[1]);
    }

    return macros;
}

function hasSupportedDirectiveDepth(source: string): boolean {
    let nesting = 0;
    for (const line of source.split('\n')) {
        if (/^\s*#\s*(?:if|ifdef|ifndef)\b/.test(line)) nesting++;
        if (/^\s*#\s*endif\b/.test(line)) nesting--;
        if (nesting > 64) return false;
    }

    return true;
}

function runFormatter(
    input: string,
    macros: ReadonlySet<string>,
    options: FormatOptions,
): Promise<string> {
    const style = { ...STYLE, WhitespaceSensitiveMacros: [...macros] };

    return new Promise<string>((resolve, reject) => {
        const args = [
            '--assume-filename=banana.c',
            '--fail-on-incomplete-format',
            `--style=${JSON.stringify(style)}`,
        ];
        const child = spawn(options.executable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let finished = false;

        const finish = (error?: Error): void => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            if (error) {
                child.kill();
                reject(error);
            } else {
                resolve(stdout);
            }
        };
        const abort = (): void => finish(new Error('Formatting cancelled'));
        const timer = setTimeout(
            () => finish(new Error(
                'Formatting exceeded the 900 ms save budget',
            )),
            options.timeoutMs ?? 900,
        );
        options.signal?.addEventListener('abort', abort, { once: true });
        child.on('error', error => finish(error));
        child.stdin.on('error', error => finish(error));
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += chunk.toString();
            if (stdout.length > 1024 * 1024) {
                finish(new Error('Formatter output too large'));
            }
        });
        child.stderr.on('data', chunk => {
            if (stderr.length < 4096) stderr += chunk.toString();
        });
        child.on('close', code => finish(code === 0
            ? undefined
            : new Error(stderr || `clang-format exited with ${code}`)));
        child.stdin.end(input);
        if (options.signal?.aborted) abort();
    });
}

function directives(source: string): string[] {
    return source.split('\n').filter(line => /^\s*#/.test(line));
}

function restoreDirectives(input: string, output: string): string {
    const originalDirectives = directives(input);
    let directive = 0;
    let depth = 0;

    return output.split('\n').map(line => {
        if (!/^\s*#/.test(line)) return line;

        const original = (originalDirectives[directive++] ?? '').trim();
        const kind = /^#\s*(\w+)/.exec(original)?.[1];
        if (kind === 'endif' || kind === 'else' || kind === 'elif') {
            depth = Math.max(0, depth - 1);
        }
        const result = ' '.repeat(depth * 4) + original;
        if (kind === 'if' || kind === 'ifdef' || kind === 'ifndef'
            || kind === 'else' || kind === 'elif') {
            depth++;
        }

        return result;
    }).join('\n');
}
