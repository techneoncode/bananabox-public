import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareResults } from '../domain/graderComparison';
import { normalizeDetail } from '../domain/grader';
import type { TestTask, TestResultDetail } from '../shared/types';

const task = (name: string, passed: number, count: number, status: TestTask['status'] = 'unknown'): TestTask =>
  ({ name, passed, count, status, crashed: 0, mandatoryFailed: 0, steps: [], trace: '' });
const detail = (...tasks: TestTask[]) => ({ tasks } as TestResultDetail);

test('25% to 100% and the reverse are detected from authoritative counts despite stale trace verdicts', () => {
  const a = detail(task('01 - task01', 1, 4, 'passed'));
  const b = detail(task('task01', 4, 4, 'passed'));
  assert.equal(compareResults(a, b)[0].kind, 'fixed');
  assert.equal(compareResults(b, a)[0].kind, 'regressed');
  assert.equal(compareResults(a, a)[0].kind, 'stillFailing');
});
test('a changing number of tests does not hide a changed success rate', () => {
  assert.equal(compareResults(detail(task('task01', 1, 4)), detail(task('task01', 4, 8)))[0].kind, 'fixed');
  assert.equal(compareResults(detail(task('task01', 4, 8)), detail(task('task01', 1, 4)))[0].kind, 'regressed');
  assert.equal(compareResults(detail(task('task01', 1, 4)), detail(task('task01', 2, 8)))[0].kind, 'changed');
});
test('normalization and comparison preserve numeric evolution from actual API-shaped reports', () => {
  const report = (passed: number) => normalizeDetail({ skills: [{ BreakdownSkillReport: { name: '01 - task01', breakdown: { passed, count: 4 } } }],
    poolTrace: '=====\ntask01\n=====\n# Building...\n# OK\ntask01: SUCCESS' });
  assert.equal(compareResults(report(1), report(4))[0].kind, 'fixed');
});
test('ambiguous names and unknown verdicts do not invent resolved tasks', () => {
  assert.equal(compareResults(detail(task('task01', 0, 0)), detail(task('task01', 0, 0)))[0].kind, 'unchanged');
  const rows = compareResults(detail(task('01 - task01', 0, 1), task('02 - task01', 0, 1)), detail(task('task01', 1, 1)));
  assert.deepEqual(rows.map(r => r.kind).sort(), ['added', 'removed', 'removed']);
});
