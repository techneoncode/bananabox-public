import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrace, compareInsights, reportInsights } from '../domain/graderInsights';
import type { TestResultDetail, TestTask } from '../shared/types';
import { detailChoiceKey } from '../webview/sections';

const task = (name: string, trace: string): TestTask => ({ name, trace, status: 'failed', count: 2, passed: 0, crashed: 0, mandatoryFailed: 0, steps: [] });
const report = (tasks: TestTask[], extra: Partial<TestResultDetail> = {}): TestResultDetail => ({ id: 1, date: '', commit: null, score: 0, passed: 0, total: 2,
  flags: [], style: { fatal: 0, major: 0, minor: 0, info: 0 }, prerequisitesMark: null, skills: [], tasks, rawTrace: null,
  staticTrace: null, coverage: { lines: null, branches: null, log: null }, makeError: null, deliveryError: null, bannedFunctions: null, ...extra });

test('recognises failure categories with source locations and preserves evidence', () => {
  const log = '\x1b[31msrc/main.c:12:4: error: undeclared identifier\x1b[0m\n' +
    'ld: undefined reference to `foo`\nSegmentation fault (core dumped)\n' +
    'ERROR: AddressSanitizer: heap-buffer-overflow on address 0x1234\n' +
    'Process timed out after 3 seconds\n[----] test.c:20: Assertion failed: values differ\n' +
    'wrong output\nExpected: hello\nActual: goodbye\nmain.c:3: C-F4 coding style major\n' +
    'forbidden function: printf\n[FAIL] suite::basic: (0.01s)';
  const analysis = analyzeTrace(log);
  assert.deepEqual(new Set(analysis.diagnostics.map(d => d.kind)), new Set(['build', 'linker', 'crash', 'memory', 'timeout', 'assertion', 'output', 'style', 'forbidden', 'test']));
  assert.deepEqual({ file: analysis.diagnostics[0].file, line: analysis.diagnostics[0].line, column: analysis.diagnostics[0].column }, { file: 'src/main.c', line: 12, column: 4 });
  assert.match(analysis.diagnostics.find(d => d.kind === 'output')!.evidence, /Expected: hello\nActual: goodbye/);
  assert.deepEqual(analysis.tests.map(t => [t.name, t.status]), [['suite::basic', 'failed']]);
});

test('ignores quoted expected output, compiler source listings and aggregate test counts', () => {
  const log = 'Expected: error: timeout\nActual: Segmentation fault\n[----] Expected: error: missing\n' +
    '  12 | printf("error: timeout");\n+error: fake stdout diff\n[PASS] 4 tests\n# OK\n# KO';
  const analysis = analyzeTrace(log);
  assert.equal(analysis.tests.length, 0);
  assert.equal(analysis.diagnostics.length, 1);
  assert.equal(analysis.diagnostics[0].message, '# KO');
  const passing = analyzeTrace('[PASS] suite::test_timeout\ntests/a.py::test_SIGSEGV PASSED [100%]\n[RUN] suite::timeout\n# Testing SIGSEGV behaviour...\nRunning AddressSanitizer');
  assert.equal(passing.diagnostics.length, 0);
});

test('compares evidence across line shifts and volatile memory addresses without losing actual values', () => {
  const a = analyzeTrace('main.c:10:3: error: missing value\nAddressSanitizer: heap-buffer-overflow at 0x123\nExpected 42 but got 41');
  const b = analyzeTrace('main.c:20:9: error: missing value\nAddressSanitizer: heap-buffer-overflow at 0x456\nExpected 42 but got 40');
  const delta = compareInsights(a, b);
  assert.equal(delta.persisting.length, 2);
  assert.equal(delta.introduced.length, 1);
  assert.equal(delta.noLongerObserved.length, 1);
  assert.match(delta.introduced[0].message, /40/);
});

test('tracks explicitly named Criterion, pytest and TAP test transitions; absence never becomes a pass', () => {
  const a = analyzeTrace('[FAIL] suite::one: (0.01s)\ntests/a.py::test_a PASSED [ 50%]\nnot ok 3 - handles empty input\n[FAIL] missing_test');
  const b = analyzeTrace('[PASS] suite::one: (0.02s)\nFAILED tests/a.py::test_a - AssertionError\nok 3 - handles empty input');
  const delta = compareInsights(a, b);
  assert.deepEqual(delta.tests.map(t => [t.name, t.before, t.after]), [
    ['suite::one', 'failed', 'passed'], ['tests/a.py::test_a', 'passed', 'failed'], ['handles empty input', 'failed', 'passed']]);
  assert.ok(!delta.tests.some(t => t.name === 'missing_test'));
  assert.equal(compareInsights(a, analyzeTrace('')).tests.length, 0);
  assert.equal(analyzeTrace('ok 1 - unfinished # TODO implement\nok 2 - unsupported # SKIP').tests.length, 0);
});

test('keeps repeated failing test evidence and finds the first explicitly failing grader step', () => {
  const analysis = analyzeTrace('# Building...\n# OK\n# Executing tests...\n[FAIL] suite::one\n# KO\n[PASS] suite::one');
  assert.equal(analysis.tests[0].status, 'failed');
  assert.equal(analysis.steps.find(s => s.ok === false)?.label, 'Executing tests');
});

test('report analysis works without raw logs, keeps task provenance and separates same-named tests', () => {
  const r = report([task('task01', 'main.c:1: error: missing\n[FAIL] suite::basic'), task('task02', 'main.c:2: error: missing\n[PASS] suite::basic')],
    { makeError: 'Build stopped', deliveryError: 'Missing archive', bannedFunctions: ['printf'] });
  const analysis = reportInsights(r);
  assert.ok(analysis.diagnostics.some(d => d.kind === 'delivery'));
  assert.ok(analysis.diagnostics.some(d => d.kind === 'forbidden'));
  const compiler = analysis.diagnostics.find(d => d.message.includes('error: missing'))!;
  assert.deepEqual(compiler.tasks, ['task01', 'task02']);
  assert.deepEqual(analysis.tests.map(t => t.name), ['task01 / suite::basic', 'task02 / suite::basic']);
});

test('caps huge logs and diagnostics, marking partial analysis', () => {
  const analysis = analyzeTrace(Array.from({ length: 150 }, (_, i) => `main.c:${i + 1}: error: missing value_${i}`).join('\n'));
  assert.equal(analysis.diagnostics.length, 100); assert.equal(analysis.truncated, true);
  assert.equal(analyzeTrace('x'.repeat(1_000_001)).truncated, true);
});

test('section choices use stable identities regardless of inserted panels', () => {
  assert.equal(detailChoiceKey('p1', 'readiness', '', 1, 'box'), detailChoiceKey('p1', 'readiness', '', 9, 'box'));
  assert.notEqual(detailChoiceKey('p1', 'readiness', '', 1, 'box'), detailChoiceKey('p2', 'readiness', '', 1, 'box'));
});
