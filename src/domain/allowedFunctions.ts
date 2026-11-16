import { maskC } from './forbiddenFunctions';

const IDENT = /^[A-Za-z_]\w*$/;
const HEADING =
  /^\s*(?:authori[sz]ed|allowed|permitted)\s+(?:system\s+calls?\s+and\s+)?(?:libc\s+)?functions?\b\s*:?\s*(.*)$/i;
const BULLET = /^\s*(?:[✓✔•◦▪▸►\-*]|\d(?=\s))\s*/;

/**
 * `write(2)`, `malloc()`, `time (only with srand)` and `printf` all name one
 * function; `(f)open` names `open` and `fopen`.
 */
function cleanNames(raw: string): string[] {
  const name = raw.trim()
    .replace(/\(\s*\d*\s*\)$/, '')
    .replace(/\s+\([^()]*\)$/, '')
    .trim();
  const pair = /^\(([A-Za-z_]\w*)\)(\w+)$/.exec(name);
  if (pair) return [pair[2], pair[1] + pair[2]];
  return name ? [name] : [];
}

function listItems(line: string): string[] | null {
  const parts = line.split(/\s*,\s*/).flatMap(cleanNames);
  return parts.length && parts.every(p => IDENT.test(p)) ? parts : null;
}

const MATH = [
  'acos', 'asin', 'atan', 'atan2', 'cos', 'sin', 'tan', 'acosh', 'asinh',
  'atanh', 'cosh', 'sinh', 'tanh', 'exp', 'exp2', 'expm1', 'log', 'log10',
  'log2', 'log1p', 'logb', 'ilogb', 'frexp', 'ldexp', 'modf', 'scalbn', 'pow',
  'sqrt', 'cbrt', 'hypot', 'fabs', 'ceil', 'floor', 'round', 'lround',
  'llround', 'trunc', 'rint', 'lrint', 'nearbyint', 'fmod', 'remainder',
  'remquo', 'copysign', 'nan', 'nextafter', 'fdim', 'fmax', 'fmin', 'fma',
  'erf', 'erfc', 'tgamma', 'lgamma',
].flatMap(f => [f, `${f}f`, `${f}l`]);

const NCURSES = [
  'initscr', 'endwin', 'refresh', 'wrefresh', 'clear', 'wclear', 'erase',
  'werase', 'getch', 'wgetch', 'mvprintw', 'mvwprintw', 'printw', 'wprintw',
  'move', 'wmove', 'keypad', 'noecho', 'echo', 'cbreak', 'nocbreak', 'raw',
  'noraw', 'curs_set', 'getmaxyx', 'getmaxx', 'getmaxy', 'newwin', 'delwin',
  'box', 'nodelay', 'timeout', 'halfdelay', 'start_color', 'has_colors',
  'init_pair', 'attron', 'attroff', 'wattron', 'wattroff', 'mvaddch', 'addch',
  'mvaddstr', 'addstr', 'mvwaddch', 'mvwaddstr', 'COLOR_PAIR',
  'use_default_colors', 'resizeterm', 'getstr', 'mvgetch',
];

/**
 * What "All functions" of a library allows. A trailing `*` allows every name
 * with that prefix (all CSFML functions start with `sf`).
 * shortcut: libraries missing here stay unexpanded; add them as subjects name
 * them.
 */
const LIBRARIES: Array<[RegExp, string[]]> = [
  [/^c?sfml$/i, ['sf*']],
  [/^(?:math|libm|m)$/i, MATH],
  [/^n?curses$/i, NCURSES],
];
const FROM_LIBRARY = /^from\s+the\s+(\S+)\s+(?:library|lib)\b\s*:?\s*(.*)$/i;
const ALL = /^all(?:\s+(?:the|its|of\s+its))?\s+functions?\b/i;
const libraryNames = (lib: string) =>
  LIBRARIES.find(([re]) => re.test(lib))?.[1] ?? [];

/**
 * Whether `name` is allowed: listed, or under a library prefix such as `sf*`.
 */
export function isAllowedName(
  name: string,
  allowed: ReadonlySet<string>,
): boolean {
  if (allowed.has(name)) return true;
  for (const entry of allowed) {
    if (entry.endsWith('*') && name.startsWith(entry.slice(0, -1))) return true;
  }
  return false;
}

/**
 * The functions a subject allows, from its "Authorized functions" section; null
 * when the subject has none (or words it so that no list can be read safely).
 */
export function parseAuthorizedFunctions(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = HEADING.exec(lines[i]);
    if (!head) continue;
    const names: string[] = [];
    const inline = listItems(
      head[1].replace(BULLET, '').replace(/[.;]\s*$/, ''),
    );
    if (inline) names.push(...inline);

    let started = names.length > 0;
    let prose = 0;
    let open = /,\s*$/.test(head[1]);
    let library = '';
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const raw = lines[j].trim();
      if (!raw) {
        if (started) open = false;
        continue;
      }
      const from = FROM_LIBRARY.exec(raw);
      if (from) {
        library = from[1];
        if (ALL.test(from[2])) {
          names.push(...libraryNames(library));
          started = true;
        }
        continue;
      }
      if (ALL.test(raw)) {
        if (library) {
          names.push(...libraryNames(library));
          started = true;
        }
        continue;
      }
      const bulleted = BULLET.test(raw);
      const body = raw.replace(BULLET, '').replace(/[.;]$/, '');
      const items = listItems(body);
      if (items && (bulleted || body.includes(',') || open)) {
        names.push(...items);
        started = true;
        open = /,\s*$/.test(raw);
        continue;
      }
      if (started) break;
      if (++prose > 3) break;
    }
    if (names.length) return [...new Set(names)];
  }
  return null;
}

/**
 * C keywords and operators that look like calls (`if (`, `sizeof(`,
 * `__attribute__((…))`).
 */
const KEYWORDS = new Set([
  'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'return', 'sizeof',
  'typeof', '__typeof__', 'alignof', '_Alignof', '__alignof__',
  '_Static_assert', 'static_assert', '_Generic', 'defined', '__attribute__',
  '__asm__', 'asm', '__extension__', '__builtin_offsetof', 'goto',
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed',
  'unsigned', 'const', 'volatile', 'struct', 'union', 'enum', 'static',
  'extern', 'register', 'inline', 'restrict', '_Bool', 'bool', 'auto',
]);

/**
 * Preprocessor lines are not code that runs (`#define F(x) …`, `#if
 * defined(X)`): blanked, positions kept.
 */
const withoutPreprocessor = (masked: string) =>
  masked.replace(
    /^[ \t]*#(?:[^\n\\]|\\\n?)*$/gm,
    line => line.replace(/[^\r\n]/g, ' '),
  );

const MACRO_OF: Record<string, string> = {
  major: 'gnu_dev_major',
  minor: 'gnu_dev_minor',
  makedev: 'gnu_dev_makedev',
};

export interface CallViolation {
  file: string;
  line: number;
  column: number;
  message: string;
}

/**
 * Names the project itself provides, so calling them is never a violation: its
 * function definitions, its macros, prototypes in its own headers, and function
 * pointers it declares.
 */
export function projectNames(
  files: ReadonlyArray<{ file: string; text: string }>,
): Set<string> {
  const names = new Set<string>();
  for (const { file, text } of files) {
    const masked = maskC(text);
    for (const m of masked.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm)) {
      names.add(m[1]);
    }
    const code = withoutPreprocessor(masked);
    for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*\(((?:[^;{}()]|\([^()]*\))*)\)\s*(?:__attribute__\s*\(\([^)]*\)\)\s*)?\{/g)) {
      if (!KEYWORDS.has(m[1])) names.add(m[1]);
    }
    for (const m of code.matchAll(/\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\(/g)) {
      names.add(m[1]);
    }
    if (/\.h(?:h|pp)?$/i.test(file)) {
      for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*\((?:[^;{}()]|\([^()]*\))*\)\s*;/g)) {
        if (!KEYWORDS.has(m[1])) names.add(m[1]);
      }
    }
  }
  return names;
}

/**
 * Every call to a function the project does not provide and the allowed list
 * does not name. Macros spelled in capitals (`S_ISDIR`, `WEXITSTATUS`) are left
 * alone, as are calls through a struct (`ops->run(…)`).
 * `known` lists names the rest of the project provides, when only some of its
 * files are checked.
 */
export function findDisallowedCalls(
  files: ReadonlyArray<{ file: string; text: string }>,
  allowed: ReadonlySet<string>,
  forbidden: ReadonlySet<string> = new Set(),
  known: ReadonlySet<string> = new Set(),
): CallViolation[] {
  const own = projectNames(files);
  const result: CallViolation[] = [];
  for (const name of known) own.add(name);
  for (const { file, text } of files) {
    const code = withoutPreprocessor(maskC(text));
    for (const match of code.matchAll(/(\.|->)?\s*\b([A-Za-z_]\w*)\s*\(/g)) {
      const name = match[2];
      if (match[1] || KEYWORDS.has(name)) continue;
      if (!forbidden.has(name)
        && (isAllowedName(name, allowed)
          || own.has(name)
          || /^[A-Z_][A-Z0-9_]*$/.test(name)
          || (MACRO_OF[name] && allowed.has(MACRO_OF[name])))) {
        continue;
      }
      const at = match.index! + match[0].indexOf(name);
      const before = code.slice(Math.max(0, at - 80), at);
      if (/\b(?:[A-Za-z_]\w*[\s*]+)$/.test(before)
        && !/\b(?:return|else|case|do|goto)\s*$/.test(before)
        && !/[=,(!&|?:+\-/%<>]\s*\**\s*$/.test(before)) {
        continue;
      }
      const prefix = code.slice(0, at);
      result.push({
        file,
        line: prefix.split('\n').length,
        column: at - prefix.lastIndexOf('\n'),
        message: name,
      });
    }
  }
  return result;
}

/**
 * Whether a path is a test, not part of what is delivered and graded (`tests/`,
 * `test_*.c`, criterion files).
 */
export const isTestPath = (path: string) =>
  /(?:^|\/)(?:tests?|unit_?tests?|criterion)\//i.test(path)
  || /(?:^|\/)test_[^/]*\.c$/i.test(path);

/**
 * The subject to read the list from: never the bootstrap when the project has a
 * real subject too.
 */
export function pickSubjectForFunctions<
  T extends { name: string; folder?: string },
>(docs: readonly T[]): T | undefined {
  const real = docs.filter(d =>
    !/bootstrap/i.test(`${d.folder ?? ''} ${d.name}`));
  return real[0] ?? docs[0];
}
