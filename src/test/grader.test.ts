import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraderService, pollDelay } from '../services/graderService';
import { RequestGuard } from '../api/requestGuard';
import { normalizeProject } from '../domain/projects';
import { EpitechClient } from '../api/client';
import type { ProjectService } from '../services/projectService';
import { normalizeDelivery } from '../domain/grader';
import { shortSha } from '../webview/format';
import { config } from '../util/config';
import * as vscode from 'vscode';

const project = normalizeProject({ id: 1, registrations: [{ id: 2 }], repoEnabled: true }, 'https://my.epitech.eu');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const projects = { learnRepo() {} } as unknown as ProjectService;
// Delivery fields and run/result relation captured in ta_list.har, without account data.
const delivery = {
  commit: '7bce58de06b87eb27454bb3563463ad31270ae52', branch: 'main', pushedAt: '2026-10-12T12:48:10.554Z',
  commitUrl: 'https://github.com/school/project/commit/7bce58de06b87eb27454bb3563463ad31270ae52',
};

test('rapid duplicate grader requests consume at most one token', async () => {
  const pending = deferred<Record<string, unknown>>(); let submissions = 0;
  const client = { startGrader: () => { submissions++; return pending.promise; } } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  try {
    const first = grader.run(project);
    assert.equal(grader.get(1)?.running, true);
    await assert.rejects(grader.run(project), /already in progress/);
    pending.resolve({ id: 4, state: 'submitted' });
    await first;
    assert.equal(submissions, 1);
    assert.equal(grader.get(1)?.runs[0].id, 4);
  } finally { grader.dispose(); }
});
test('logout invalidates in-flight grader responses', async () => {
  const pending = deferred<Record<string, unknown>>();
  const client = { graderRuns: () => pending.promise, testResults: async () => [] } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  const loading = grader.load(project);
  grader.clear();
  pending.resolve({ runs: [], quota: { total: 6, remaining: 3 }, lastDelivery: delivery });
  await loading;
  assert.equal(grader.get(1), undefined);
  grader.dispose();
});

test('Grader delivery uses the MyEpitech /ta response without GitHub authentication or repository lookup', async () => {
  const originalFetch = globalThis.fetch, originalSession = vscode.authentication.getSession;
  const calls: URL[] = [];
  let latestDelivery = delivery, clock = Date.now();
  const client = new EpitechClient({ baseUrl: () => 'https://my.epitech.eu', token: () => 'test-only', onUnauthorized() {}, userAgent: 'test', guard: new RequestGuard({ now: () => clock, minGapMs: 0 }) });
  const grader = new GraderService(client, projects);
  vscode.authentication.getSession = async () => { throw new Error('GitHub authentication must not be used'); };
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.hostname, 'my.epitech.eu');
    if (url.pathname.endsWith('/ta')) return Response.json({ runs: [{ id: 49093, state: 'completed', testRunId: '7926637' }], quota: { total: 1, consumed: 1, remaining: 0 }, lastDelivery: latestDelivery });
    return Response.json({ results: [{ id: 7926637, properties: { date: '2026-10-12T12:51:22Z', commit: delivery.commit } }] });
  };
  try {
    await grader.load(project);
    const remote = grader.get(1)?.remoteCommit;
    assert.equal(remote?.status, 'ready');
    assert.equal(shortSha(remote?.sha ?? null), '7bce58d');
    assert.equal(remote?.branch, 'main');
    assert.equal(remote?.commitUrl, delivery.commitUrl);
    assert.equal(remote?.pushedAt, delivery.pushedAt);
    assert.equal(grader.get(1)?.runs[0].resultId, '7926637');
    assert.equal(grader.get(1)?.history[0].commit, delivery.commit);
    latestDelivery = { ...delivery, commit: 'a'.repeat(40), branch: 'grading', commitUrl: `https://github.com/school/project/commit/${'a'.repeat(40)}` };
    // Within the cache window the same answer is reused: nothing is sent.
    await grader.load(project);
    assert.equal(calls.length, 2);
    clock += 5 * 60_000;
    await grader.load(project);
    assert.equal(grader.get(1)?.remoteCommit?.sha, latestDelivery.commit);
    assert.equal(grader.get(1)?.remoteCommit?.branch, 'grading');
    assert.equal(grader.get(1)?.history[0].commit, delivery.commit);
    // No token moved and no run finished: the results list is not read again.
    assert.equal(calls.length, 3);
    assert.ok(calls.at(-1)!.pathname.endsWith('/ta'));
  } finally { grader.dispose(); globalThis.fetch = originalFetch; vscode.authentication.getSession = originalSession; }
});

test('missing delivery clears stale commits and never infers the next commit from result history', async () => {
  let lastDelivery: typeof delivery | null | undefined = delivery;
  const client = { graderRuns: async () => ({ runs: [], lastDelivery }), testResults: async () => [{ id: 1, properties: { commit: 'b'.repeat(40) } }] } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  try {
    await grader.load(project);
    assert.equal(grader.get(1)?.remoteCommit?.sha, delivery.commit);
    for (lastDelivery of [null, undefined]) {
      await grader.load(project);
      assert.equal(grader.get(1)?.remoteCommit?.status, 'unavailable');
      assert.equal(grader.get(1)?.remoteCommit?.sha, null);
      assert.equal(grader.get(1)?.history[0].commit, 'b'.repeat(40));
      assert.equal(grader.get(1)?.error, null);
    }
  } finally { grader.dispose(); }
});

test('live polling updates the delivery reported by the Grader', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const newCommit = 'a'.repeat(40);
  let polling = false;
  const client = {
    startGrader: async () => ({ id: 1, state: 'submitted' }),
    graderRuns: async () => ({ runs: polling ? [{ id: 1, state: 'started' }] : [], lastDelivery: polling ? { ...delivery, commit: newCommit, branch: 'grading' } : delivery }),
    testResults: async () => [],
  } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  try {
    await grader.load(project);
    await grader.run(project);
    const updated = deferred<void>();
    grader.onDidChange(id => { if (grader.get(id)?.remoteCommit?.sha === newCommit) updated.resolve(); });
    polling = true;
    context.mock.timers.tick(pollDelay(0));
    await updated.promise;
    assert.equal(grader.get(1)?.remoteCommit?.branch, 'grading');
    assert.equal(grader.get(1)?.runs[0].state, 'started');
    assert.equal(grader.get(1)?.running, true);
  } finally { grader.dispose(); }
});

test('delivery errors clear stale commits and a subsequent refresh restores API delivery', async () => {
  let fail = false;
  const client = { graderRuns: async () => { if (fail) throw new Error('Grader unavailable'); return { runs: [], lastDelivery: delivery }; }, testResults: async () => [] } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  try {
    await grader.load(project);
    fail = true;
    await grader.load(project);
    assert.equal(grader.get(1)?.remoteCommit?.status, 'error');
    assert.equal(grader.get(1)?.remoteCommit?.sha, null);
    assert.equal(grader.get(1)?.error, 'Grader unavailable');
    fail = false;
    await grader.load(project);
    assert.equal(grader.get(1)?.remoteCommit?.sha, delivery.commit);
    assert.equal(grader.get(1)?.error, null);
  } finally { grader.dispose(); }
});

test('malformed delivery commits stay unavailable and unsafe or mismatched commit links are discarded', () => {
  for (const commit of ['', 'invalid', '0'.repeat(40)]) assert.equal(normalizeDelivery({ ...delivery, commit }).status, 'unavailable');
  for (const commitUrl of ['javascript:alert(1)', 'https://foreign.example/commit/' + delivery.commit, 'https://github.com/school/project/commit/' + 'a'.repeat(40)]) {
    const normalized = normalizeDelivery({ ...delivery, commitUrl });
    assert.equal(normalized.sha, delivery.commit);
    assert.equal(normalized.commitUrl, null);
  }
});
test('concurrent project loads share the same request', async () => {
  let calls = 0;
  const client = { graderRuns: async () => { calls++; return { runs: [] }; }, testResults: async () => [] } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  await Promise.all([grader.load(project), grader.load(project)]);
  assert.equal(calls, 1);
  grader.dispose();
});

test('following a run slows down: never under 5 s, then 10 s after a minute, 20 s after three', () => {
  assert.ok(pollDelay(0) >= 5_000);
  assert.ok(pollDelay(90_000) >= 10_000);
  assert.ok(pollDelay(240_000) >= 20_000);
});

test('the results list is re-read only when a token was spent, a run finished, or it is old', async () => {
  let results = 0, consumed = 1;
  const client = { graderRuns: async () => ({ runs: [], quota: { total: 5, consumed, remaining: 5 - consumed } }), testResults: async () => { results++; return []; } } as unknown as EpitechClient;
  const grader = new GraderService(client, projects);
  try {
    await grader.load(project);
    await grader.load(project);
    assert.equal(results, 1);
    consumed = 2;
    await grader.load(project);
    assert.equal(results, 2);
  } finally { grader.dispose(); }
});
