import * as path from 'node:path';

const PATH_FLAGS = new Set([
    '-I', '-isystem', '-iquote', '-idirafter', '-include', '-imacros',
]);
const BUILD_FLAGS_WITH_VALUE = new Set([
    '-o', '-MF', '-MT', '-MQ', '-MJ', '-L', '-l', '-T', '-Xlinker',
]);
const BUILD_FLAGS = new Set([
    '-c', '-S', '-E', '-shared', '-static', '-pie', '-no-pie', '-pipe',
    '-rdynamic', '-MD', '-MMD', '-MP', '-MG', '-M', '-MM', '-w', '-v',
    '-save-temps', '-pg', '--coverage', '-coverage', '-s', '-fsyntax-only',
    '-Werror', '-pedantic-errors',
]);
const BUILD_FLAG_PREFIXES = [
    '-O', '-g', '-Wl,', '-Wa,', '-Wp,', '-Werror=', '-fsanitize', '-flto',
    '-fprofile', '-fcolor', '-fdiagnostics', '-march', '-mtune', '-m',
];
const SOURCE_OR_OBJECT_FILE = /\.(c|cc|cpp|cxx|o|a|so|obj)$/i;
const SAFE_FEATURE_FLAG = /^-f(no-)?(builtin|freestanding|ms-extensions|openmp|blocks|unsigned-char|signed-char|short-wchar|gnu-keywords|asm|exceptions|rtti)$/;

/**
 * Drops build outputs and resolves include paths before a compiler command is
 * reused.
 * Explicit configuration keeps unknown flags; discovered commands only keep
 * whitelisted ones.
 */
export function sanitizeFlags(
    tokens: readonly string[],
    cwd: string,
    strict: boolean,
): string[] {
    const flags: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (BUILD_FLAGS_WITH_VALUE.has(token)) {
            i++;
            continue;
        }
        if (BUILD_FLAGS.has(token) || token.startsWith('@')) continue;

        if (PATH_FLAGS.has(token)) {
            const value = tokens[++i];
            if (value !== undefined) {
                flags.push(token, path.resolve(cwd, value));
            }
            continue;
        }
        if (token.startsWith('-I') && token.length > 2) {
            flags.push(`-I${path.resolve(cwd, token.slice(2))}`);
            continue;
        }
        if (token === '-D' || token === '-U' || token === '-x') {
            const value = tokens[++i];
            if (value !== undefined) {
                flags.push(token, value);
            }
            continue;
        }
        if (/^-[DU]./.test(token) || token.startsWith('-std=')
            || token.startsWith('--sysroot')
            || token === '-pedantic' || token === '-ansi'
            || token === '-nostdinc') {
            flags.push(token);
            continue;
        }

        const buildPrefixed = BUILD_FLAG_PREFIXES.some(prefix =>
            token.startsWith(prefix)
            && !(prefix === '-m' && token.startsWith('-mi')));
        const joinedOutput = token.length > 2
            && (token.startsWith('-l')
                || token.startsWith('-L')
                || token.startsWith('-o'));
        if (buildPrefixed || joinedOutput) continue;

        if (token.startsWith('-W')) {
            flags.push(token);
        } else if (token.startsWith('-f')) {
            if (!strict || SAFE_FEATURE_FLAG.test(token)) flags.push(token);
        } else if (!strict && (token.startsWith('-')
            || !SOURCE_OR_OBJECT_FILE.test(token))) {
            flags.push(token);
        }
    }

    return flags;
}

export const SYNTAX_FLAGS = [
    '-fsyntax-only',
    '-fno-color-diagnostics',
    '-fdiagnostics-show-option',
    '-ferror-limit=0',
    '-Qunused-arguments',
];
