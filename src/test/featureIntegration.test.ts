import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Controller } from '../controller';
import { StyleService } from '../services/styleService';
import { DeadlineService } from '../services/deadlineService';
import { ActivityService } from '../services/activityService';
import type { StyleScanResult } from '../codingStyle/api';
import type { ProjectVM } from '../shared/types';
import type { EpitechClient } from '../api/client';

const result = (major = 1): StyleScanResult => ({ root: '/tmp/project', files: 1,
  summary: { fatal: 0, major, minor: 0, info: 0, other: 0, functions: 0 }, issues: major ? [
    { file: '/tmp/project/main.c', line: 3, column: 1, bucket: 'major', message: 'bad style' }] : [],
  durationMs: 1, cancelled: false });
const project = { id: 4, name: 'Project', registered: true, status: 'ongoing', endDate: new Date(Date.now() + 2 * 3_600_000).toISOString() } as ProjectVM;

Object.assign(vscode.window, {
  withProgress: async (_options: unknown, fn: any) => fn({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
  showErrorMessage: async () => undefined,
});

test('grader preflight: fix, ignore, dismiss, compiler failure and cancellation control token submission', async () => {
  for (const mode of ['fix', 'ignore', 'dismiss', 'error', 'cancel', 'clean'] as const) {
    const style = new StyleService();
    style.api = { isEnabled: () => true, scanProject: async () => mode === 'error'
      ? { ...result(), error: { message: 'compiler missing', notFound: true } }
      : mode === 'cancel' ? { ...result(), cancelled: true } : result(mode === 'clean' ? 0 : 1) };
    let submissions = 0, revealed = 0;
    Object.assign(vscode.window, {
      showWarningMessage: async (_message: string, _options: unknown, ...items: any[]) =>
        mode === 'fix' ? items.find(i => i.value === 'fix') : mode === 'ignore' ? items.find(i => i.value === 'ignore') : undefined,
      showInformationMessage: async (_message: string, _options: unknown, ...items: any[]) => items.find(i => i.value === 'run'),
    });
    const controller: any = Object.create(Controller.prototype);
    Object.assign(controller, {
      style, projects: { get: () => project, resolveResources: async () => project }, auth: { isSignedIn: true, accessToken: 'session' },
      preparingGrader: new Set(), grader: { load: async () => {}, get: () => ({ canRun: true, quota: { remaining: 2, total: 2 } }), run: async () => submissions++ },
      localRoot: async () => '/tmp/project', localGitState: async () => undefined, toast() {},
      refreshRemoteCommit: async () => {},
      revealFirstIssue: async () => revealed++,
    });
    await controller.runGrader(project.id);
    assert.equal(submissions, mode === 'ignore' || mode === 'clean' ? 1 : 0, mode);
    assert.equal(revealed, mode === 'fix' ? 1 : 0, mode);
    assert.equal(controller.preparingGrader.size, 0);
    style.dispose();
  }
});

test('style scan clearing aborts pending work and prevents stale results from a previous session', async () => {
  const service = new StyleService();
  let complete!: (r: StyleScanResult) => void;
  let signal: AbortSignal | undefined;
  service.api = { isEnabled: () => true, scanProject: async (_root, options) => {
    signal = options?.signal;
    return new Promise(resolve => { complete = resolve; });
  } };
  const first = service.scan(1, '/tmp/project', 'manual');
  assert.equal(service.scan(1, '/tmp/project', 'preflight'), first);
  service.clear();
  assert.equal(signal?.aborted, true);
  complete(result());
  assert.equal(await first, null);
  assert.equal(service.get(1), undefined);
  service.dispose();
});

test('cancelled style scan restores the previous result and emits an update', async () => {
  const service = new StyleService();
  service.api = { isEnabled: () => true, scanProject: async () => result() };
  const previous = await service.scan(1, '/tmp/project', 'manual');
  service.api.scanProject = async () => ({ ...result(), cancelled: true });
  assert.equal(await service.scan(1, '/tmp/project', 'preflight'), null);
  assert.equal(service.get(1), previous);
  service.dispose();
});

test('cancelling a preflight joined to a manual scan cancels the grader wait', async () => {
  const service = new StyleService();
  let complete!: (r: StyleScanResult) => void;
  service.api = { isEnabled: () => true, scanProject: () => new Promise(resolve => { complete = resolve; }) };
  const manual = service.scan(1, '/tmp/project', 'manual');
  const abort = new AbortController();
  const preflight = service.scan(1, '/tmp/project', 'preflight', { signal: abort.signal });
  abort.abort();
  assert.equal(await preflight, null);
  complete(result());
  assert.equal((await manual)?.status, 'done');
  service.dispose();
});

test('deadline notifications persist across restarts, honour mute, and only concern registered current projects', () => {
  const store = new Map();
  const memory = { keys: () => [...store.keys()], get: (k: string, d?: unknown) => store.get(k) ?? d, update: async (k: string, v: unknown) => { store.set(k, v); } } as vscode.Memento;
  const notified: number[] = [];
  const make = () => new DeadlineService(memory, (_project, h) => notified.push(h));
  make().check(project, false);
  make().check({ ...project, registered: false }, true);
  assert.deepEqual(notified, []);
  make().check(project, true);
  make().check(project, true);
  assert.deepEqual(notified, [3]);
  const next = { ...project, endDate: new Date(Date.now() + 23 * 3_600_000).toISOString() };
  const service = make();
  service.check(next, true);
  service.mute(next);
  make().check(next, true, Date.parse(next.endDate) - 2 * 3_600_000);
  assert.deepEqual(notified, [3, 24]);
});

test('activities clearing prevents an old account response from populating the new session', async () => {
  let complete!: (r: unknown) => void;
  const client = { myActivities: async () => new Promise(resolve => { complete = resolve; }) } as unknown as EpitechClient;
  const service = new ActivityService(client);
  const load = service.load(4);
  assert.equal(service.load(4), load);
  service.clear();
  complete([{ id: 1, name: 'Kick-off', startDate: '2026-10-12', endDate: '2026-10-13' }]);
  await load;
  assert.equal(service.get(4), undefined);
  service.dispose();
});

test('grader command refuses a non-leader before preflight or confirmation', async () => {
  const controller: any = Object.create(Controller.prototype);
  let submissions = 0, preflights = 0;
  Object.assign(controller, {
    projects: { get: () => project, resolveResources: async () => project },
    auth: { isSignedIn: true, accessToken: 'session' }, preparingGrader: new Set(),
    grader: { load: async () => {}, get: () => ({ canRun: false, reason: 'leader_only' }), run: async () => submissions++ },
    toast() {}, preflight: async () => { preflights++; return true; },
  });
  assert.equal(await controller.runGrader(project.id), false);
  assert.equal(submissions, 0);
  assert.equal(preflights, 0);
  assert.equal(controller.preparingGrader.size, 0);
});
