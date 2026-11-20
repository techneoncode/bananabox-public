import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityKind } from '../domain/activities';
import { milestoneChecks, projectMilestones } from '../domain/milestones';
import type { DeliveryCheck, ReadinessVM } from '../shared/deliveryTypes';
import type { ActivityVM, ProjectVM } from '../shared/types';

const now = Date.parse('2026-11-20T12:00:00Z');
const project = { endDate: '2026-12-10T23:00:00Z', midDate: '2026-11-30T10:00:00Z', midEstimated: false } as ProjectVM;
const session = (id: number, name: string, startDate: string): ActivityVM => ({
  id, name, kind: activityKind(name), startDate, endDate: startDate.replace('T09', 'T11'), mandatory: true, hasDocuments: false, status: null,
});
const t = (key: string) => key;
const done = { status: 'done' } as ReadinessVM;
const check = (id: DeliveryCheck['id'], status: DeliveryCheck['status'], extra: Partial<DeliveryCheck> = {}): DeliveryCheck => ({ id, status, detail: '', ...extra });

test('events come nearest first: next follow-up, mid-term, then the delivery', () => {
  const activities = [
    session(1, 'Follow-up 1', '2026-11-18T09:00:00Z'),
    session(2, 'Follow-up 2', '2026-11-25T09:00:00Z'),
    session(3, 'Midterm defense', '2026-11-28T09:00:00Z'),
  ];
  assert.deepEqual(projectMilestones(project, activities, now).map(e => [e.kind, e.name]), [
    ['followup', 'Follow-up 2'], ['midterm', 'Midterm defense'], ['delivery', undefined],
  ]);
  assert.deepEqual(projectMilestones(project, [], now).map(e => e.kind), ['midterm', 'delivery']);
  assert.deepEqual(projectMilestones(project, [], Date.parse('2026-12-20T00:00:00Z')).map(e => e.kind), ['delivery']);
});

test('each event asks for its own checks', () => {
  const checks = [
    check('style', 'pass'), check('build', 'pass'), check('tests', 'fail'), check('files', 'unknown'), check('functions', 'unknown'),
    check('valgrind', 'fail', { leakBytes: 200 }), check('binary', 'pass'), check('git', 'pass'), check('deadline', 'pass'), check('grader', 'pass'),
  ];
  const c = { c: true };
  assert.deepEqual(milestoneChecks('followup', checks, done, c, t).map(x => x.id), ['git', 'build', 'style', 'binary', 'deadline']);
  const midterm = milestoneChecks('midterm', checks, done, c, t);
  assert.deepEqual(midterm.map(x => [x.id, x.status]), [
    ['git', 'pass'], ['build', 'pass'], ['tests', 'pass'], ['valgrind', 'pass'], ['style', 'pass'], ['binary', 'pass'], ['deadline', 'pass'],
  ]);
  assert.equal(milestoneChecks('midterm', checks, done, { c: true, disabled: ['tests'] }, t).some(x => x.id === 'tests'), false);
  assert.equal(milestoneChecks('midterm', [check('valgrind', 'fail', { leakBytes: 5000 })], done, c, t)[0].status, 'fail');
  assert.equal(milestoneChecks('midterm', [check('tests', 'unknown')], done, c, t)[0].status, 'fail');
  assert.equal(milestoneChecks('delivery', checks, done, c, t).find(x => x.id === 'tests')?.status, 'fail');
  assert.deepEqual(milestoneChecks('followup', checks, done, { c: false }, t).map(x => x.id), ['git', 'deadline']);
});
