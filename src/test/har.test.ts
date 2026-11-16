import { test } from 'node:test';
import assert from 'node:assert/strict';
import capture from './fixtures/har-contract.json';
import { normalizeProject } from '../domain/projects';
import { normalizeDetail, normalizeQuota, normalizeRun, normalizeSummary } from '../domain/grader';

test('sanitised HAR project preserves registration and API route coordinates', () => {
  const p = normalizeProject(capture.project, 'https://my.epitech.eu', Date.parse('2026-10-08T12:00Z'));
  assert.equal(p.status, 'ongoing');
  assert.equal(p.unitCode, 'G-CPE-100');
  assert.equal(p.instanceCode, 'STG-1');
  assert.equal(p.registrationId, 123);
  assert.equal(p.midEstimated, true);
});
test('sanitised HAR grader preserves the full six-run progression and test details', () => {
  const history = capture.history.map((r) => normalizeSummary(r));
  assert.equal(history.length, 6);
  assert.deepEqual(history.map((r) => r.score), [null, null, 0, 83.3, 100, 100]);
  const detail = normalizeDetail(capture.detail, 7858370);
  assert.equal(detail.total, 6);
  assert.equal(detail.passed, 6);
  assert.equal(detail.tasks.length, 6);
  assert.equal(normalizeQuota(capture.quota)?.remaining, 0);
  assert.equal(normalizeRun(capture.runs[0]).state, 'completed');
});
