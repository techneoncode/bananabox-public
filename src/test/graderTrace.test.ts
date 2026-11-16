import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeGraderTrace, splitChain, repoRelative } from '../domain/graderTrace';
import { diffLines, firstDifference } from '../domain/textDiff';

// Real grader traces captured from my.epitech.eu (G-CPE-100 pool days, rush1).
const fx = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'test', 'fixtures', 'grader-traces.json'), 'utf8')) as Record<string, { trace: string }>;
const task = (id: string, name: RegExp) => analyzeGraderTrace(fx[id]!.trace).tasks.find(t => name.test(t.name))!;

test('sections, verdicts and the command the grader ran are extracted', () => {
  const a = analyzeGraderTrace(fx['7918165']!.trace);
  assert.equal(a.tasks.length, 4);
  assert.deepEqual(a.tasks.map(t => t.status), ['success', 'success', 'success', 'success']);
  assert.deepEqual(a.tasks.slice(0, 2).map(t => t.name), ['task01', 'task02 - testing cat']);
  const t1 = a.tasks[0]!;
  assert.equal(t1.build.ok, true);
  assert.equal(t1.forbidden.ok, true);
  assert.deepEqual(t1.forbidden.allowed, ['open', 'read', 'write', 'close', 'memset']);
  assert.equal(t1.run.ok, true);
  assert.equal(t1.cause, null);
  assert.equal(t1.commands[0]!.cwd, 'cat');
  assert.equal(t1.commands[0]!.text, 'make re && make fclean && make && make clean');
  assert.deepEqual(t1.commands[0]!.chain, [['make', 're'], ['make', 'fclean'], ['make'], ['make', 'clean']]);
  const crit = a.tasks[1]!.run.criterion;
  assert.deepEqual(crit, { tested: 6, passing: 6, failing: 0, crashing: 0 });
});

test('"# Got: … # But expected: …" is parsed, and a coverage gate is recognised as such', () => {
  const t = task('7912265', /task02/);
  assert.equal(t.status, 'failure');
  assert.equal(t.cause?.phase, 'run');
  assert.equal(t.cause?.kind, 'coverage');
  const f = t.run.failures[0]!;
  assert.equal(f.got, 'KO: line coverage below 30%');
  assert.equal(f.expected, 'OK');
  assert.equal(t.commands[0]!.text, 'make tests_run');
});

test('multi-line outputs keep their exact lines (rush1)', () => {
  const t = task('7866920', /Small sizes/);
  const f = t.run.failures[0]!;
  assert.equal(f.kind, 'invalid_output');
  assert.equal(f.got, 'o--o\n|  |\no--o');
  assert.equal(f.expected, 'o-o\n| |\no-o');
  assert.equal(t.cause?.kind, 'invalid_output');
  assert.deepEqual(t.commands[0]!.cwd, 'rush-1-1');
  const d = firstDifference(f.expected!, f.got!)!;
  assert.deepEqual([d.line, d.column, d.kind, d.deltaChars], [1, 3, 'content', 1]);
});

test('empty Got versus expected message', () => {
  const trace = '====================\n task\n====================\n\n# Building...\n# OK\n\n# Executing all tests...\n# Got:\n\n# But expected:\nInvalid size\n# Test failed: invalid output.\n\ntask: FAILURE\n';
  const f = analyzeGraderTrace(trace).tasks[0]!.run.failures[0]!;
  assert.equal(f.got, '');
  assert.equal(f.expected, 'Invalid size');
});

test('exit status failures carry the code', () => {
  const t = analyzeGraderTrace(fx['7911695']!.trace).tasks.find(x => x.name === 'task05_bis')!;
  assert.equal(t.cause?.kind, 'invalid_exit_status');
  assert.equal(t.run.failures[0]!.exitCode, 84);
  assert.equal(t.cause?.signature, 'run:invalid_exit_status:84');
});

test('a missing task directory is a delivery problem, ahead of everything else', () => {
  const t = task('7912504', /task03/);
  assert.equal(t.cause?.phase, 'delivery');
  assert.equal(t.cause?.kind, 'task_missing');
});

test('linker errors are summarised by symbol and file, not as a wall of text', () => {
  const t = task('7911546', /task01/);
  assert.equal(t.cause?.phase, 'build');
  assert.equal(t.cause?.kind, 'multiple_definition');
  assert.equal(t.cause?.params.symbol, 'main');
  assert.ok(t.build.linker.some(l => l.kind === 'undefined' && l.symbol === 'cat_main'));
  assert.ok(String(t.cause?.params.files).includes('cat.c'));
});

test('Banana style warnings are located (repo-relative) and bucketed, grader-provided files are flagged', () => {
  const t = analyzeGraderTrace(fx['7866920']!.trace).tasks[0]!;
  const w = t.build.style.find(i => i.rule === 'C-F3')!;
  assert.deepEqual([w.file, w.line, w.column, w.bucket, w.external], ['test_files/my_putchar.c', 2, 81, 'major', true]);
  assert.ok(t.build.style.length > 20);
  const day11 = analyzeGraderTrace(fx['7906248']!.trace).tasks[0]!;
  const own = day11.build.style.find(i => i.file === 'my_params_to_list.c' && i.rule === 'C-L6')!;
  assert.equal(own.external, false);
  assert.equal(own.bucket, 'minor');
  assert.equal(day11.build.style.some(i => i.bucket === 'info'), true);
});

test('truncated traces are flagged and never throw; empty input is fine', () => {
  assert.equal(analyzeGraderTrace(fx['7906248']!.trace).truncated, true);
  assert.deepEqual(analyzeGraderTrace('').tasks, []);
  assert.doesNotThrow(() => analyzeGraderTrace('garbage\n====\n\u0000\n'));
});

test('command chains: only shell-free sequences become runnable argv', () => {
  assert.deepEqual(splitChain('make -C lib/my && clang -Wall -o a.out *.c'), [['make', '-C', 'lib/my'], ['clang', '-Wall', '-o', 'a.out', '*.c']]);
  assert.deepEqual(splitChain('echo "a b" ; ls'), [['echo', 'a b'], ['ls']]);
  assert.equal(splitChain('cat x | grep y'), null);
  assert.equal(splitChain('ls > out'), null);
  assert.equal(splitChain('echo $(id)'), null);
  assert.equal(repoRelative('/usr/local/bugs/run/lib/my/my_putstr.c'), 'lib/my/my_putstr.c');
});

test('line diff and first difference', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nx\nc').map(o => o.kind), ['same', 'removed', 'added', 'same']);
  assert.equal(firstDifference('a\nb', 'a\nb'), null);
  assert.equal(firstDifference('abc', 'abc\n')!.kind, 'whitespace'); // exact comparison names a missing/extra final newline
  assert.equal(firstDifference('abc', 'abc\n', { ignoreTrailingNewline: true }), null);
  assert.equal(firstDifference('a', 'a\nb')!.kind, 'extra_line');
  assert.equal(firstDifference('a\nb', 'a')!.kind, 'missing_line');
  assert.equal(firstDifference('a b', 'ab')!.kind, 'whitespace');
});

import { triangulate } from '../domain/triangulation';

test('triangulation: coverage gate fixed, then a missing task directory fixed (real runs)', () => {
  const t1 = triangulate(fx['7912265']!.trace, fx['7912504']!.trace);
  assert.equal(t1.tasks.find(t => /task02/.test(t.task))!.transition, 'fixed');
  const t2 = triangulate(fx['7912504']!.trace, fx['7918165']!.trace);
  const t3 = t2.tasks.find(t => /task03/.test(t.task))!;
  assert.equal(t3.transition, 'fixed');
  assert.equal(t3.before?.kind, 'task_missing');
  assert.equal(t2.counts.fixed >= 1, true);
});

test('triangulation: a regression is traced to the file that both fails and changed', () => {
  // task01 built fine in 7912265; in 7911546 the linker reports `main` defined twice (cat.c and main.c).
  const result = triangulate(fx['7912265']!.trace, fx['7911546']!.trace, { changedFiles: ['cat/main.c', 'README.md', 'other/unrelated.c'] });
  const t = result.tasks.find(x => /task01/.test(x.task))!;
  assert.equal(t.transition, 'regressed');
  assert.equal(t.after?.kind, 'multiple_definition');
  assert.equal(t.suspects[0]!.file, 'cat/main.c');
  assert.deepEqual(t.suspects[0]!.reasons, ['linker_symbol', 'changed_since']);
  assert.equal(t.confidence, 'high');
  assert.ok(t.suspects.some(s => s.file === 'cat/cat.c'));
  assert.deepEqual(result.otherChanges, ['other/unrelated.c']);
});

test('triangulation: without history the answer stays honest (medium, no invented suspects)', () => {
  const result = triangulate(fx['7912265']!.trace, fx['7911546']!.trace);
  const t = result.tasks.find(x => /task01/.test(x.task))!;
  assert.equal(t.confidence, 'medium');
  assert.equal(result.changedFiles, null);
  const unknown = triangulate(fx['7912265']!.trace, fx['7866920']!.trace);
  assert.ok(unknown.tasks.some(x => x.transition === 'new'));
});

test('triangulation: output mismatch distance shows whether we got closer', () => {
  const closer = '====================\n t\n====================\n# Building...\n# OK\n# Executing all tests...\n# Got:\nA\nB\nX\n# But expected:\nA\nB\nC\n# Test failed: invalid output.\n\nt: FAILURE\n';
  const far = '====================\n t\n====================\n# Building...\n# OK\n# Executing all tests...\n# Got:\nQ\nR\nS\n# But expected:\nA\nB\nC\n# Test failed: invalid output.\n\nt: FAILURE\n';
  const r = triangulate(far, closer);
  assert.equal(r.tasks[0]!.transition, 'progress');
  assert.equal(r.tasks[0]!.mismatch!.distance, 2);
  assert.equal(r.tasks[0]!.previousMismatch!.distance, 6);
  assert.equal(r.tasks[0]!.mismatch!.first!.line, 3);
});

test('triangulation: causes repeated across tasks are reported once as shared', () => {
  const sec = (n: string) => `====================\n ${n}\n====================\n# Building...\n~/x> make\n/usr/local/bugs/run/lib/a.c:3:1: error: use of undeclared identifier 'z'\n# Build failed.\n\n${n}: FAILURE\n\n`;
  const r = triangulate('', sec('t1') + sec('t2') + sec('t3'));
  assert.equal(r.shared.length, 1);
  assert.deepEqual(r.shared[0]!.tasks, ['t1', 't2', 't3']);
});

test('triangulation: banana style issues are compared by file+rule (line shifts are ignored), info and grader files are skipped', () => {
  const mk = (line: number, extra = '') => `====================\n t\n====================\n# Building...\n~/.> make\n/usr/local/bugs/run/a.c:${line}:1: warning: [Banana] [Minor] tab (C-L3)\n/usr/local/bugs/run/test_files/m.c:1:1: warning: [Banana] [Minor] tab (C-L3)\n/usr/local/bugs/run/a.c:9:1: warning: [Banana] [Info] eof (C-A3)\n${extra}# OK\n\nt: SUCCESS\n`;
  const r = triangulate(mk(3), mk(7, '/usr/local/bugs/run/b.c:2:1: warning: [Banana] [Major] long line (C-F3)\n'));
  assert.deepEqual(r.style.introduced.map(i => `${i.file}:${i.rule}`), ['b.c:C-F3']);
  assert.equal(r.style.persisting, 1);
  assert.equal(r.style.resolved.length, 0);
});
