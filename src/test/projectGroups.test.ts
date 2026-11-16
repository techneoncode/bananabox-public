import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject, separateGradesEligible, graderGroupRestriction } from '../domain/projects';
import { GraderService } from '../services/graderService';
import type { EpitechClient } from '../api/client';
import type { ProjectService } from '../services/projectService';

const raw = { id: 1, repoEnabled: true, isUserRegistered: true, groupSizeMax: 4,
  startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-11T00:00:00Z',
  registrations: [
    { id: 10, leader: { login: 'other' }, members: [{ login: 'other' }], repoLink: 'https://github.com/school/other' },
    { id: 20, leader: { login: 'chief' }, members: [{ login: 'chief' }, { login: 'mate' }], repoLink: 'https://github.com/school/ours' },
  ] };
const project = (login = 'mate') => normalizeProject(raw, 'https://my.epitech.eu', 0, login);
test('selects the signed-in student group, counts actual members, and recognises its leader', () => {
  const p = project();
  assert.equal(p.registrationId, 20);
  assert.equal(p.repoLink, 'https://github.com/school/ours');
  assert.equal(p.groupMemberCount, 2);
  assert.equal(p.isGroupLeader, false);
  assert.equal(project('CHIEF').isGroupLeader, true);
  const stranger = normalizeProject({ ...raw, registrations: [raw.registrations[0]] }, '', 0, 'mate');
  assert.equal(stranger.registrationId, null);
  assert.equal(stranger.repoLink, null);
});
test('separate grades stop at exactly 66%, and exclude solo, upcoming and invalid schedules', () => {
  const p = project(), start = Date.parse(p.startDate), end = Date.parse(p.endDate), cutoff = start + (end - start) * .66;
  assert.equal(separateGradesEligible(p, start), true);
  assert.equal(separateGradesEligible(p, cutoff - 1), true);
  assert.equal(separateGradesEligible(p, cutoff), false);
  assert.equal(separateGradesEligible(p, end), false);
  assert.equal(separateGradesEligible(p, start - 1), false);
  for (const groupMemberCount of [null, 0, 1]) assert.equal(separateGradesEligible({ ...p, groupMemberCount }, start), false);
  assert.equal(separateGradesEligible({ ...p, registered: false }, start), false);
  assert.equal(separateGradesEligible({ ...p, endDate: p.startDate }, start), false);
  assert.equal(separateGradesEligible({ ...p, startDate: 'invalid' }, start), false);
});
test('grader permits solo and group leaders; blocks other members and unknown group roles before POST', async () => {
  const p = project(); let submissions = 0;
  const client = { startGrader: async () => { submissions++; return { id: 1, state: 'completed' }; },
    graderRuns: async () => ({ runs: [] }), testResults: async () => [] } as unknown as EpitechClient;
  const service = new GraderService(client, { learnRepo() {} } as unknown as ProjectService);
  try {
    await service.load(p);
    assert.equal(service.get(1)?.canRun, false);
    assert.equal(service.get(1)?.reason, 'leader_only');
    await assert.rejects(service.run(p), /leader|chef/);
    await assert.rejects(service.run({ ...p, isGroupLeader: null }));
    assert.equal(submissions, 0);
    assert.equal(graderGroupRestriction({ ...p, groupMemberCount: 1 }), null);
    assert.equal(graderGroupRestriction({ ...p, groupMemberCount: null }), 'group_unknown');
    await service.run(project('chief'));
    assert.equal(submissions, 1);
  } finally { service.dispose(); }
});
