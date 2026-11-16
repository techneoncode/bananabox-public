import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, matchProjectToRemotes, midpoint, normalizeProject } from '../domain/projects';
import { parseRemote, toCloneUrl } from '../domain/git';
import { normalizeDetail, normalizeQuota, normalizeSummary, splitTrace } from '../domain/grader';
import { cleanToken, inspectToken } from '../domain/jwt';
import { h } from '../webview/dom';

const raw = { id: 1, name: 'Day04', startDate: '2026-09-24T08:00:00Z', endDate: '2026-09-25T08:00:00Z', repoLink: 'https://github.com/school/project-15', unitInstance: { unitCode: 'G-CPE-100', code: 'STG-1' }, registrations: [{ id: 99 }], repoEnabled: true };
test('dates classify past, current and future and preserve an explicit mid', () => {
  assert.equal(classify(raw.startDate, raw.endDate, Date.parse('2026-09-23')), 'upcoming');
  assert.equal(classify(raw.startDate, raw.endDate, Date.parse('2026-09-24T12:00Z')), 'ongoing');
  assert.equal(classify(raw.startDate, raw.endDate, Date.parse('2026-09-26')), 'past');
  const p = normalizeProject({ ...raw, midDate: '2026-09-24T18:00Z' }, 'https://my.epitech.eu');
  assert.equal(p.midEstimated, false);
  assert.equal(p.registrationId, 99);
  assert.equal(midpoint('', ''), '');
});
test('SSH and HTTPS remotes match, unique forks match by name, ambiguous names do not', () => {
  const p = normalizeProject(raw, 'https://my.epitech.eu');
  assert.equal(matchProjectToRemotes([p], ['git@github.com:school/project-15.git'])?.id, 1);
  assert.equal(matchProjectToRemotes([p], ['git@github.com:student/project-15.git'])?.id, 1);
  assert.equal(matchProjectToRemotes([p, { ...p, id: 2 }], ['git@github.com:student/project-15.git']), null);
  assert.equal(parseRemote('git@github.com:school/project-15.git')?.repo, 'project-15');
  assert.throws(() => toCloneUrl('--upload-pack=bad', 'ssh'));
});
test('grader distinguishes missing tests from a zero score and normalises quota', () => {
  assert.equal(normalizeSummary({}).score, null);
  assert.equal(normalizeSummary({ skillBreakdowns: { task: { count: 6, passed: 5 } } }).score, 83.3);
  assert.equal(normalizeSummary({ skillBreakdowns: { task: { count: 6, passed: 0 } } }).score, 0);
  assert.deepEqual(normalizeQuota({ total: 6, consumed: 2 }), { total: 6, consumed: 2, remaining: 4, override: null });
});
test('grader task output is attached to the matching skill', () => {
  const trace = '=====\ntask01\n=====\n# Building...\n# OK\ntask01: SUCCESS\n=====\ntask02\n=====\n# Running...\n# KO\ntask02: FAILED';
  assert.equal(splitTrace(trace).length, 2);
  const detail = normalizeDetail({ poolTrace: trace, skills: [{ BreakdownSkillReport: { name: '01 - task01', breakdown: { count: 1, passed: 1 } } }] }, 12);
  assert.equal(detail.id, 12);
  assert.equal(detail.tasks[0].status, 'passed');
  assert.equal(detail.tasks[1].status, 'failed');
  assert.match(detail.tasks[1].trace, /# KO/);
});
test('token handling accepts Bearer input and never requires a JWT', () => {
  assert.equal(cleanToken(' Bearer abcdef '), 'abcdef');
  assert.equal(inspectToken('opaque-token').expiresAt, null);
});

// Minimal DOM boundary: exercises the recursive child behaviour used throughout every screen.
class FakeNode {
  children: FakeNode[] = [];
  text = '';
  className = '';
  classList = { add: (...names: string[]) => { this.className += ' ' + names.join(' '); } };
  append(node: FakeNode) { this.children.push(node); }
  setAttribute() {}
  get textContent(): string { return this.text + this.children.map((n) => n.textContent).join(''); }
}
test('component helper renders nested lists, not object strings or numeric attributes', () => {
  const savedNode = globalThis.Node, savedDocument = globalThis.document;
  Object.assign(globalThis, { Node: FakeNode, document: {
    createElement: () => new FakeNode(),
    createTextNode: (text: string) => Object.assign(new FakeNode(), { text }),
  } });
  try {
    const list = h('div', [h('span', 'one'), [h('span', 'two'), false, null, 0]]);
    assert.equal(list.textContent, 'onetwo0');
    assert.equal(list.children.length, 3);
  } finally { Object.assign(globalThis, { Node: savedNode, document: savedDocument }); }
});
