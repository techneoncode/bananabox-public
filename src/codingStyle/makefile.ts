import * as path from 'node:path';
import { globToRegExp } from './glob';
import { BananaDiagnostic, Bucket, Severity } from './types';

/**
 * What the subject asks of the project's Makefile (read from the subject PDF).
 */
export interface MakefileRequirements {
    /** Rules the subject requires, on top of the Epitech defaults. */
    rules: string[];
    /** Binary the subject asks for (`binary name: my_ls`). */
    binary?: string;
    /** Name of the subject PDF the requirements come from, for messages. */
    source?: string;
}

export interface MakefileLintOptions {
    /**
     * Rules every main Makefile must define (default: all, clean, fclean, re).
     */
    baseRules: readonly string[];
    /** Subject requirements; only applied to the project's main Makefile. */
    subject?: MakefileRequirements;
    /**
     * Whether this is the project's main (root) Makefile. Sub-Makefiles
     * (lib/my/Makefile) skip rule requirements.
     */
    main: boolean;
    maxLineLength: number;
    /** Flag `$(wildcard …)` (M-W1, info). */
    wildcard?: boolean;
    /**
     * C files of the Makefile's directory (relative, `/`-separated) that SRC
     * should list (M-S1, info).
     */
    sources?: { files: readonly string[]; ignore: readonly string[] };
}

export const DEFAULT_MAKEFILE_RULES = ['all', 'clean', 'fclean', 're'];

/**
 * Targets that never produce a file of their name, so they belong in .PHONY
 * when defined.
 */
const CONVENTIONAL_PHONY = new Set([
    'all', 'clean', 'fclean', 're', 'tests_run', 'coverage', 'debug', 'bonus',
    'install', 'uninstall', 'lib', 'run', 'format', 'help',
]);

const MAKEFILE_NAMES = new Set(['makefile', 'gnumakefile']);

export function isMakefilePath(file: string): boolean {
    const base = path.basename(file);

    return MAKEFILE_NAMES.has(base.toLowerCase()) || /\.mk$/i.test(base);
}

interface Rule {
    targets: string[];
    prerequisites: string[];
    line: number;
}

interface Variable {
    value: string;
    line: number;
    end: number;
}

interface ParsedMakefile {
    variables: Map<string, Variable>;
    rules: Rule[];
    phony: { names: string[]; line: number }[];
}

interface LogicalLine {
    text: string;
    line: number;
    end: number;
    recipe: boolean;
}

/**
 * A logical line: physical lines joined on trailing backslashes, with the line
 * number it starts on.
 */
function logicalLines(lines: readonly string[]): LogicalLine[] {
    const result: LogicalLine[] = [];
    let inRule = false;
    for (let i = 0; i < lines.length; i++) {
        const start = i;
        let text = lines[i];
        while (/(^|[^\\])(\\\\)*\\$/.test(text) && i + 1 < lines.length) {
            text = `${text.slice(0, -1)} ${lines[++i].trimStart()}`;
        }

        const recipe = inRule && text.startsWith('\t');
        if (!recipe && text.trim() && !/^\s*#/.test(text)) inRule = false;
        result.push({ text, line: start + 1, end: i + 1, recipe });
        if (!recipe && classifyLine(stripComment(text)).kind === 'rule') {
            inRule = true;
        }
    }

    return result;
}

function stripComment(text: string): string {
    const at = text.search(/(?<!\\)#/);

    return at < 0 ? text : text.slice(0, at);
}

/**
 * Hides what is inside `$(…)` / `${…}` (same length) so `$(SRC:.c=.o)` is not
 * read as a rule or an assignment.
 */
function maskReferences(text: string): string {
    let out = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '$' && (text[i + 1] === '(' || text[i + 1] === '{')) {
            depth++;
            out += '$(';
            i++;
            continue;
        }
        if (depth > 0 && (c === '(' || c === '{')) depth++;
        if (depth > 0 && (c === ')' || c === '}')) {
            depth--;
            out += ')';
            continue;
        }
        out += depth > 0 ? 'x' : c;
    }

    return out;
}

type Line =
    | { kind: 'assign'; name: string; op: string; value: string }
    | { kind: 'rule'; targets: string; rest: string }
    | { kind: 'other' };

/**
 * GNU make's reading: whichever comes first, an assignment operator or a rule
 * colon.
 */
export function classifyLine(text: string): Line {
    if (text.startsWith('\t')) return { kind: 'other' };

    const masked = maskReferences(text);
    const match = /(:{1,3}=|[?+!]?=)|(::?)/.exec(masked);
    if (!match) return { kind: 'other' };

    if (match[1]) {
        const name = text
            .slice(0, match.index)
            .replace(/^\s*(?:(?:override|export|private)\s+)*/, '')
            .trim();
        if (!/^[A-Za-z_][\w.-]*$/.test(name)) return { kind: 'other' };

        return {
            kind: 'assign',
            name,
            op: match[1],
            value: text.slice(match.index + match[1].length).trim(),
        };
    }

    const targets = text.slice(0, match.index).trim();

    if (!targets) return { kind: 'other' };

    return {
        kind: 'rule',
        targets,
        rest: text.slice(match.index + match[2].length),
    };
}

function parse(lines: readonly string[]): ParsedMakefile {
    const variables = new Map<string, Variable>();
    const rules: Rule[] = [];
    const phony: { names: string[]; line: number }[] = [];

    for (const logical of logicalLines(lines)) {
        if (logical.recipe) continue;

        const text = stripComment(logical.text);
        if (!text.trim()
            || /^\s*(?:ifn?eq|ifn?def|else|endif|include|-include|sinclude|define|endef|vpath|unexport)\b/.test(text)) {
            continue;
        }

        const line = classifyLine(text);
        if (line.kind === 'assign') {
            const previous = variables.get(line.name);
            const value = line.op === '+=' && previous
                ? `${previous.value} ${line.value}`
                : line.op === '?=' && previous
                    ? previous.value
                    : line.value;
            variables.set(line.name, {
                value,
                line: logical.line,
                end: logical.end,
            });
            continue;
        }
        if (line.kind !== 'rule') continue;

        const targets = line.targets.split(/\s+/).filter(Boolean);
        const prerequisites = classifyLine(line.rest).kind === 'assign'
            ? []
            : line.rest
                .replace(/;.*$/, '')
                .replace(/\|/g, ' ')
                .trim()
                .split(/\s+/)
                .filter(Boolean);
        if (targets.includes('.PHONY')) {
            phony.push({ names: prerequisites, line: logical.line });
            continue;
        }
        if (targets.every(t => t.startsWith('.'))) continue;

        rules.push({ targets, prerequisites, line: logical.line });
    }

    return { variables, rules, phony };
}

/**
 * Expands `$(VAR)` / `${VAR}` with the Makefile's own variables (a few levels,
 * enough for NAME = $(BIN)).
 */
function expand(
    value: string,
    variables: Map<string, Variable>,
    depth = 0,
): string {
    if (depth > 5) return value;

    return value.replace(/\$[({]([A-Za-z_][\w.-]*)[)}]/g, (whole, name: string) => {
        const variable = variables.get(name);

        return variable
            ? expand(variable.value, variables, depth + 1)
            : whole;
    });
}

/**
 * A variable's value as the Makefile defines it, its own `$(VARS)` expanded
 * (`NAME = $(BIN)`).
 */
export function makefileVariable(
    text: string,
    name: string,
): string | undefined {
    const { variables } = parse(text.split(/\r?\n/));
    const variable = variables.get(name);

    return variable && expand(variable.value, variables).trim();
}

const DEBUG_FLAG = /(?:^|[\s"'])-g(?:gdb)?\d?(?=[\s"']|$)/;

/**
 * Whether the Makefile compiles with debug info (`-g`, `-g3`, `-ggdb`)
 * anywhere: CFLAGS, a recipe, a target variable.
 */
export function makefileHasDebug(text: string): boolean {
    return text
        .split(/\r?\n/)
        .some(line => DEBUG_FLAG.test(stripComment(line)));
}

/**
 * The Makefile with `-g` added: at the end of its CFLAGS definition, or as
 * `CFLAGS += -g` after the header when it has none (the implicit `%.o: %.c`
 * rule and most recipes use CFLAGS).
 */
export function addDebugFlag(text: string): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const cflags = parse(lines).variables.get('CFLAGS');
    if (cflags) {
        const index = cflags.end - 1;
        const line = lines[index];
        const comment = line.length - stripComment(line).length;
        const code = line.slice(0, line.length - comment).replace(/\s+$/, '');
        lines[index] = `${code} -g${comment ? ` ${line.slice(line.length - comment)}` : ''}`;

        return lines.join(eol);
    }

    let at = 0;
    while (at < lines.length && /^\s*(#.*)?$/.test(lines[at])) at++;
    lines.splice(at, 0, 'CFLAGS += -g', ...(at < lines.length ? [''] : []));

    return lines.join(eol);
}

const HEADER = [
    { pattern: /^##$/, expected: '##' },
    {
        pattern: /^## EPITECH PROJECT, \d{4}$/,
        expected: '## EPITECH PROJECT, <year>',
    },
    { pattern: /^## \S.*$/, expected: '## <project name>' },
    { pattern: /^## File description:$/, expected: '## File description:' },
    { pattern: /^## \S.*$/, expected: '## <description>' },
    { pattern: /^##$/, expected: '##' },
];

export function hasMakefileHeader(text: string): boolean {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    return /^(?:#[^\n]*\n){0,3}#+[^\n]*EPITECH\s+PROJECT/i.test(body);
}

export function makefileHeader(
    project: string,
    description: string,
    year = new Date().getFullYear(),
): string {
    const clean = (value: string) => value
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 74);

    return [
        '##',
        `## EPITECH PROJECT, ${year}`,
        `## ${clean(project) || 'Project'}`,
        '## File description:',
        `## ${clean(description) || 'Makefile'}`,
        '##',
        '',
        '',
    ].join('\n');
}

const SEVERITY: Record<Bucket, Severity> = {
    fatal: 'error',
    major: 'warning',
    minor: 'warning',
    info: 'information',
};
const LEVEL: Record<Bucket, string> = {
    fatal: 'Fatal',
    major: 'Major',
    minor: 'Minor',
    info: 'Info',
};

function finding(
    file: string,
    line: number,
    bucket: Bucket,
    ruleId: string,
    message: string,
    column = 1,
    rangeLength?: number,
): BananaDiagnostic {
    return {
        file,
        line,
        column,
        rangeStartColumn: column,
        rangeLength,
        severity: SEVERITY[bucket],
        rawSeverity: SEVERITY[bucket],
        message,
        level: LEVEL[bucket],
        bucket,
        ruleId,
        plugin: 'makefile',
        notes: [],
    };
}

/**
 * Epitech coding style checks for a Makefile, without epiclang: the `##` file
 * header (C-G1), the 80 columns limit (C-F3), the required rules (Epitech
 * defaults plus those the subject asks for), the binary name from the subject,
 * and a .PHONY declaration that lists every rule not producing a file.
 */
export function lintMakefile(
    file: string,
    text: string,
    options: MakefileLintOptions,
): BananaDiagnostic[] {
    const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
        .split(/\r?\n/);
    const items: BananaDiagnostic[] = [];

    if (!hasMakefileHeader(text)) {
        items.push(finding(
            file,
            1,
            'major',
            'C-G1',
            'Missing Epitech header: the Makefile must start with the "## EPITECH PROJECT, <year>" block.',
        ));
    } else {
        const bad = HEADER.findIndex((part, index) =>
            !part.pattern.test((lines[index] ?? '').trimEnd()));
        if (bad >= 0) {
            items.push(finding(
                file,
                bad + 1,
                'major',
                'C-G1',
                `Malformed Epitech header: line ${bad + 1} should be "${HEADER[bad].expected}".`,
            ));
        }
    }

    lines.forEach((line, index) => {
        if (line.length > options.maxLineLength) {
            items.push(finding(
                file,
                index + 1,
                'major',
                'C-F3',
                `Line too long (${line.length} > ${options.maxLineLength} columns).`,
                options.maxLineLength + 1,
                line.length - options.maxLineLength,
            ));
        }
    });

    const parsed = parse(lines);
    const defined = new Map<string, number>();
    for (const rule of parsed.rules) {
        for (const target of rule.targets) {
            const name = expand(target, parsed.variables);
            for (const part of name.split(/\s+/)) {
                if (part && !defined.has(part)) defined.set(part, rule.line);
            }
            if (!defined.has(target)) defined.set(target, rule.line);
        }
    }
    const anchor = Math.min(lines.length, HEADER.length + 1);

    if (options.main) {
        const required = [...new Set([
            ...options.baseRules,
            ...(options.subject?.rules ?? []),
        ])];
        const missing = required.filter(rule => !defined.has(rule));
        if (missing.length) {
            const fromSubject = missing
                .filter(rule => options.subject?.rules.includes(rule));
            const source = options.subject?.source;
            const why = fromSubject.length
                ? ` (required by the subject${source ? ` ${source}` : ''})`
                : '';
            items.push(finding(
                file,
                anchor,
                'fatal',
                'M-R1',
                `Missing rule${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}${why}.`,
            ));
        }

        const binary = options.subject?.binary;
        if (binary && !binary.includes('*')) {
            const name = parsed.variables.get('NAME');
            const produced = name
                ? expand(name.value, parsed.variables).trim()
                : undefined;
            if (produced !== undefined
                && path.posix.basename(produced) !== binary
                && produced !== binary) {
                items.push(finding(
                    file,
                    name!.line,
                    'major',
                    'M-R2',
                    `NAME is "${produced}" but the subject asks for a binary named "${binary}".`,
                ));
            } else if (produced === undefined && !defined.has(binary)) {
                items.push(finding(
                    file,
                    anchor,
                    'major',
                    'M-R2',
                    `No rule builds "${binary}", the binary name the subject asks for.`,
                ));
            }
        }
    }

    const phony = new Set(parsed.phony.flatMap(p => p.names
        .map(n => expand(n, parsed.variables))
        .flatMap(n => n.split(/\s+/))));
    const shouldBePhony = [...defined.keys()].filter(name =>
        CONVENTIONAL_PHONY.has(name)
        || (options.main
            && (options.baseRules.includes(name)
                || (options.subject?.rules.includes(name) ?? false))
            && name !== options.subject?.binary));
    if (parsed.phony.length === 0) {
        if (shouldBePhony.length) {
            const last = lines.length > 0 && !lines[lines.length - 1]
                ? Math.max(1, lines.length - 1)
                : lines.length;
            items.push(finding(
                file,
                last,
                'major',
                'M-P1',
                `Missing .PHONY: declare ${shouldBePhony.join(' ')}.`,
            ));
        }
    } else {
        const at = parsed.phony[parsed.phony.length - 1].line;
        const undeclared = shouldBePhony.filter(name => !phony.has(name));
        if (undeclared.length) {
            items.push(finding(
                file,
                at,
                'minor',
                'M-P2',
                `Not declared in .PHONY: ${undeclared.join(', ')}.`,
            ));
        }
        const unknown = [...phony]
            .filter(name => name && !defined.has(name) && !name.includes('$'));
        if (unknown.length) {
            items.push(finding(
                file,
                at,
                'minor',
                'M-P3',
                `.PHONY lists ${unknown.length > 1 ? 'rules' : 'a rule'} the Makefile does not define: ${unknown.join(', ')}.`,
            ));
        }
    }

    if (options.wildcard) {
        lines.forEach((line, index) => {
            for (const match of stripComment(line).matchAll(/\$[({]wildcard\b/g)) {
                items.push(finding(
                    file,
                    index + 1,
                    'info',
                    'M-W1',
                    'Unrecommended wildcard usage',
                    match.index + 1,
                    match[0].length,
                ));
            }
        });
    }

    if (options.sources) {
        const missing = missingSources(parsed, options.sources);
        if (missing?.files.length) {
            items.push(finding(
                file,
                missing.line,
                'info',
                'M-S1',
                `Missing project files in SRC field: ${missing.files.join(', ')}`,
            ));
        }
    }

    return items;
}

const SOURCE_VARIABLES = ['SRC', 'SRCS', 'SOURCES'];

/**
 * Project C files no variable or prerequisite of the Makefile mentions,
 * anchored on the last line of SRC.
 */
function missingSources(
    parsed: ParsedMakefile,
    sources: NonNullable<MakefileLintOptions['sources']>,
): { files: string[]; line: number } | undefined {
    const src = SOURCE_VARIABLES
        .map(name => parsed.variables.get(name))
        .find(Boolean);
    if (!src) return undefined;

    const values = [
        ...[...parsed.variables.values()].map(v => v.value),
        ...parsed.rules.flatMap(r => r.prerequisites),
    ].map(value => expand(value, parsed.variables));
    if (values.some(value => /\$[({]shell\s/.test(value))) return undefined;

    const mentioned = values
        .join(' ')
        .replace(/[$(){},]/g, ' ')
        .split(/\s+/)
        .filter(token => token.endsWith('.c'))
        .map(token => token.replace(/^\.\//, ''));
    const listed = (file: string): boolean => mentioned.some(token =>
        token === file
        || (/[*?]/.test(token) && globToRegExp(token).test(file))
        || (!token.includes('/') && token === path.posix.basename(file)));
    const ignored = (file: string): boolean => sources.ignore
        .some(glob => globToRegExp(glob).test(file));

    return {
        files: sources.files
            .filter(file => !listed(file) && !ignored(file))
            .sort(),
        line: src.end,
    };
}
