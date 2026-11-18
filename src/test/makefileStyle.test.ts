import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyLine, isMakefilePath, lintMakefile, makefileHeader, type MakefileLintOptions } from '../codingStyle/makefile';
import { unauthorizedCalls } from '../codingStyle/functions';
import { parseSubjectMakefile } from '../domain/subjectMakefile';
import { SubjectFunctions } from '../services/subjectFunctions';
import type { ProjectVM } from '../shared/types';

const BASE: MakefileLintOptions = { baseRules: ['all', 'clean', 'fclean', 're'], main: true, maxLineLength: 80 };
const HEADER = makefileHeader('my_ls', 'Makefile', 2026);
const rules = (text: string, options: Partial<MakefileLintOptions> = {}) => lintMakefile('/p/Makefile', text, { ...BASE, ...options }).map(i => i.ruleId);

const CLEAN = `${HEADER}NAME = my_ls
SRC = $(wildcard src/*.c)
OBJ = $(SRC:.c=.o)

all: $(NAME)

$(NAME): $(OBJ)
\t$(CC) -o $(NAME) $(OBJ)

clean:
\trm -f $(OBJ)

fclean: clean
\trm -f $(NAME)

re: fclean all

.PHONY: all clean fclean re
`;

test('the example Makefile of the repository is clean apart from the binary the subject asks for', () => {
  const text = readFileSync('MakefileExample', 'utf8');
  assert.deepEqual(rules(text), []);
  const items = lintMakefile('/p/Makefile', text, { ...BASE, subject: { rules: ['re', 'clean', 'fclean', 'tests_run'], binary: 'my_ls', source: 'my_ls.pdf' } });
  assert.deepEqual(items.map(i => [i.ruleId, i.line]), [['M-R2', 12]]);
  assert.match(items[0]!.message, /setting_up.*my_ls/);
});

test('a clean Makefile has no finding, and the header quick-fix text passes the header check', () => {
  assert.deepEqual(rules(CLEAN), []);
  assert.deepEqual(rules(CLEAN, { subject: { rules: ['re'], binary: 'my_ls' } }), []);
});

test('header: missing, then malformed line by line', () => {
  assert.deepEqual(rules(CLEAN.slice(HEADER.length)), ['C-G1']);
  const bad = CLEAN.replace('## File description:', '## Description:');
  const items = lintMakefile('/p/Makefile', bad, BASE);
  assert.equal(items[0]!.ruleId, 'C-G1');
  assert.equal(items[0]!.line, 4);
});

test('lines longer than 80 columns are flagged with their range', () => {
  const text = CLEAN.replace('SRC = $(wildcard src/*.c)', `SRC = ${'a'.repeat(80)}`);
  const items = lintMakefile('/p/Makefile', text, BASE).filter(i => i.ruleId === 'C-F3');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.line, 9);
  assert.equal(items[0]!.column, 81);
  assert.equal(items[0]!.rangeLength, 6);
});

test('required rules: Epitech defaults and the subject ones, only for the main Makefile', () => {
  const text = CLEAN.replace('re: fclean all\n', '');
  const items = lintMakefile('/p/Makefile', text, { ...BASE, subject: { rules: ['tests_run'], source: 'my_ls.pdf' } });
  const missing = items.find(i => i.ruleId === 'M-R1')!;
  assert.equal(missing.bucket, 'fatal');
  assert.match(missing.message, /re, tests_run.*subject my_ls\.pdf/);
  assert.ok(!rules(text, { main: false }).includes('M-R1'));
});

test('.PHONY: missing, incomplete, or naming rules that do not exist', () => {
  assert.deepEqual(rules(CLEAN.replace('.PHONY: all clean fclean re\n', '')), ['M-P1']);
  const partial = lintMakefile('/p/Makefile', CLEAN.replace('.PHONY: all clean fclean re', '.PHONY: all clean'), BASE);
  assert.deepEqual(partial.map(i => i.ruleId), ['M-P2']);
  assert.match(partial[0]!.message, /fclean, re/);
  assert.deepEqual(rules(CLEAN.replace('.PHONY: all clean fclean re', '.PHONY: all clean fclean re bonus')), ['M-P3']);
  // Several .PHONY lines add up, and a phony variable is expanded.
  assert.deepEqual(rules(CLEAN.replace('.PHONY: all clean fclean re', 'PHONY = all clean\n.PHONY: $(PHONY)\n.PHONY: fclean re')), []);
});

test('the binary name: NAME checked when present, a rule building it otherwise', () => {
  assert.deepEqual(rules(CLEAN, { subject: { rules: [], binary: 'my_top' } }), ['M-R2']);
  const noName = CLEAN.replace('NAME = my_ls\n', '').replaceAll('$(NAME)', 'my_ls');
  assert.deepEqual(rules(noName, { subject: { rules: [], binary: 'my_ls' } }), []);
  assert.deepEqual(rules(noName, { subject: { rules: [], binary: 'my_top' } }), ['M-R2']);
});

test('M-W1: each $(wildcard …) is an info when enabled, comments ignored', () => {
  assert.deepEqual(rules(CLEAN), []);
  const items = lintMakefile('/p/Makefile', `${CLEAN}# $(wildcard x)\nT = \${wildcard t/*.c}\n`, { ...BASE, wildcard: true }).filter(i => i.ruleId === 'M-W1');
  assert.deepEqual(items.map(i => [i.line, i.column, i.bucket, i.message]), [[9, 7, 'info', 'Unrecommended wildcard usage'], [27, 5, 'info', 'Unrecommended wildcard usage']]);
});

test('M-S1: project files no variable mentions are listed after the last SRC line, minus ignored ones', () => {
  const text = `${HEADER}NAME = a\nSRC = src/main.c \\\n\tsrc/b.c\nSRC += $(addprefix src/, c.c)\nLIB = $(wildcard lib/*.c)\nall: $(NAME)\n`;
  const sources = (files: string[], ignore: string[] = []) => lintMakefile('/p/Makefile', text, { ...BASE, sources: { files, ignore } }).filter(i => i.ruleId === 'M-S1');
  const found = sources(['src/main.c', 'src/b.c', 'src/c.c', 'lib/x.c', 'src/z.c', 'src/a.c', 'tests/t.c'], ['tests/*.c']);
  assert.deepEqual(found.map(i => [i.line, i.bucket, i.message]), [[11, 'info', 'Missing project files in SRC field: src/a.c, src/z.c']]);
  assert.deepEqual(sources(['src/main.c']), []);
  assert.deepEqual(lintMakefile('/p/Makefile', `${HEADER}SRC = $(shell find src -name '*.c')\n`, { ...BASE, sources: { files: ['x.c'], ignore: [] } }).filter(i => i.ruleId === 'M-S1'), []);
});

test('line classification follows GNU make: assignments, rules, substitution references', () => {
  assert.equal(classifyLine('OBJ = $(SRC:.c=.o)').kind, 'assign');
  assert.equal(classifyLine('CC := gcc').kind, 'assign');
  assert.equal(classifyLine('A ::= b').kind, 'assign');
  assert.equal(classifyLine('override CFLAGS += -g').kind, 'assign');
  assert.equal(classifyLine('$(NAME): $(OBJ)').kind, 'rule');
  assert.equal(classifyLine('%.o: %.c').kind, 'rule');
  assert.equal(classifyLine('debug: CFLAGS += -g3').kind, 'rule');
  assert.ok(isMakefilePath('/x/Makefile') && isMakefilePath('/x/GNUmakefile') && isMakefilePath('/x/rules.mk') && !isMakefilePath('/x/main.c'));
});

test('subject Makefile requirements: the usual phrasings and the binary name', () => {
  assert.deepEqual(parseSubjectMakefile('binary name: my_ls\nlanguage: C\ncompilation: via Makefile, including re, clean and fclean rules'),
    { rules: ['re', 'clean', 'fclean'], binary: 'my_ls' });
  assert.deepEqual(parseSubjectMakefile('Your Makefile must contain the following rules: all, clean,\nfclean, re and tests_run.').rules,
    ['all', 'clean', 'fclean', 're', 'tests_run']);
  assert.deepEqual(parseSubjectMakefile('Your repository must contain a Makefile with a\nunit_tests rule that builds the tests.').rules, ['unit_tests']);
  // Prose about something else is not read as rules.
  assert.deepEqual(parseSubjectMakefile('The Makefile is used to compile.\nRules of the game: be nice.'), { rules: [] });
});

test('unauthorized functions: calls outside the allowed list and the project, test files skipped', () => {
  const text = '#include <stdio.h>\nstatic int helper(void)\n{\n    return 0;\n}\n\nint main(void)\n{\n    printf("%d", helper());\n    my_putstr("é");\n    write(1, "a", 1);\n    return S_ISDIR(0);\n}\n';
  const items = unauthorizedCalls('/p/src/main.c', text, '/p', ['write', 'malloc'], new Set(['my_putstr']));
  assert.deepEqual(items.map(i => [i.message, i.line, i.column, i.kind, i.severity]),
    [["printf() is not in the subject's allowed functions.", 9, 5, 'function', 'error']]);
  assert.deepEqual(unauthorizedCalls('/p/tests/test_main.c', text, '/p', ['write'], new Set()), []);
  // Columns are UTF-8 bytes, like clang's.
  const utf8 = unauthorizedCalls('/p/a.c', 'void f(void)\n{\n    char *s = "é"; puts(s);\n}\n', '/p', ['write'], new Set());
  assert.equal(utf8[0]!.column, 'char *s = "é"; '.length + 5 + 1);
});

test('the subject read also stores the Makefile requirements, and older stored lists are read once more for them', async () => {
  const data = new Map<string, unknown>();
  const storage = { get: <T>(key: string, fallback?: T) => (data.get(key) ?? fallback) as T, update: async (key: string, value: unknown) => { data.set(key, value); } };
  let reads = 0;
  const service = new SubjectFunctions(storage, async () => { reads++; return { name: 'my_ls.pdf', bytes: new Uint8Array() }; },
    async () => 'binary name: my_ls\ncompilation: via Makefile, including re, clean and fclean rules\nAuthorized functions: write, malloc', () => {});
  const project = { id: 7 } as ProjectVM;
  data.set('bananabox.subjectFunctions.v1:s:7', { names: ['write'], doc: 'my_ls.pdf', at: 1 });
  const vm = await service.ensure('s', project);
  assert.equal(reads, 1);
  assert.deepEqual(vm.makefile, { rules: ['re', 'clean', 'fclean'], binary: 'my_ls' });
  assert.deepEqual(vm.names, ['write', 'malloc']);
  await service.ensure('s', project);
  assert.equal(reads, 1);
  assert.deepEqual(service.get('s', 7).makefile, { rules: ['re', 'clean', 'fclean'], binary: 'my_ls' });
});

test('-g is detected anywhere and added to CFLAGS, or after the header when there is none', async () => {
  const { makefileHasDebug, addDebugFlag } = await import('../codingStyle/makefile');
  assert.equal(makefileHasDebug('CFLAGS = -Wall -Wextra\n'), false);
  assert.equal(makefileHasDebug('CFLAGS = -Wall -g3\n'), true);
  assert.equal(makefileHasDebug('all:\n\tgcc -ggdb main.c\n'), true);
  assert.equal(makefileHasDebug('# CFLAGS += -g\nCFLAGS = -Wall\n'), false);
  assert.equal(makefileHasDebug('LDFLAGS = -lgcov\n'), false);
  assert.equal(addDebugFlag('NAME = a\nCFLAGS = -Wall \\\n\t-Wextra  # strict\n\nall:\n'), 'NAME = a\nCFLAGS = -Wall \\\n\t-Wextra -g # strict\n\nall:\n');
  assert.equal(addDebugFlag('##\n## EPITECH PROJECT, 2026\n##\n\nNAME = a\n'), '##\n## EPITECH PROJECT, 2026\n##\n\nCFLAGS += -g\n\nNAME = a\n');
  assert.ok(makefileHasDebug(addDebugFlag('CFLAGS = -Wall\r\nall:\r\n')));
});

test('M-S2: literal SRC entries that are not files are flagged', () => {
  const text = `${HEADER}SRC = src/main.c \\\n\tsrc/gone.c \\\n\t$(addprefix lib/, x.c)\nall:\n`;
  const found = lintMakefile('/p/Makefile', text, { ...BASE, sources: { files: [], ignore: [], isFile: f => f === 'src/main.c' } }).filter(i => i.ruleId === 'M-S2');
  assert.deepEqual(found.map(i => [i.line, i.bucket, i.message]), [[9, 'major', 'SRC entry is not a file.']]);
});
