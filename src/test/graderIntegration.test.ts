import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteChangedFiles } from '../git/github';
import { resultTrace } from '../domain/graderEvidence';
import { triangulate } from '../domain/triangulation';
import { graderMakeCommands } from '../delivery/discovery';
import { GraderCommand } from '../services/graderCommand';
import { ReadinessService } from '../services/readinessService';
import { ReproductionService } from '../services/reproductionService';
import { gitBytes } from '../git/commitData';
import { createT } from '../shared/i18n';
import * as vscode from 'vscode';
import type { TestResultDetail, StyleScanVM } from '../shared/types';

test('GitHub comparison validates SHA and discards incomplete compare context', async () => {
  const original = globalThis.fetch, urls: string[] = [];
  let incomplete = false;
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return { ok: true, json: async () => url.includes('/compare/') ? { status: 'ahead', files: incomplete ? Array.from({ length: 300 }, () => ({ filename: 'x.c' })) : [{ filename: 'new.c', previous_filename: 'old.c' }] }
      : {} };
  }) as typeof fetch;
  try {
    assert.deepEqual(await remoteChangedFiles('https://github.com/school/project', 'a'.repeat(40), 'b'.repeat(40)), ['new.c', 'old.c']);
    assert.ok(urls.at(-1)?.endsWith(`/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`));
    incomplete = true;
    assert.equal(await remoteChangedFiles('https://github.com/school/project', 'a'.repeat(40), 'b'.repeat(40)), null);
    assert.equal(await remoteChangedFiles('https://github.com/school/project', 'invalid', 'b'.repeat(40)), null);
    await assert.rejects(remoteChangedFiles('https://example.org/school/project', 'a'.repeat(40), 'b'.repeat(40)));
  } finally { globalThis.fetch = original; }
});

test('normalised task traces preserve task names and missing verdicts never count as fixes', () => {
  const detail = (status: 'failed' | 'unknown'): Pick<TestResultDetail, 'tasks' | 'rawTrace'> => ({ rawTrace: null, tasks: [{ name: '01 - task01', status, trace: status === 'failed' ? '# Building...\nsrc/main.c:8:2: error: missing value' : '', count: 0, passed: 0, crashed: 0, mandatoryFailed: 0, steps: [] }] });
  const compared = triangulate(resultTrace(detail('failed')), resultTrace(detail('unknown')));
  assert.equal(compared.counts.fixed, 0);
  assert.equal(compared.tasks[0].transition, 'different');
});

test('grader make chains keep their order and folder, while unsupported commands remain unexecuted', () => {
  const project = { directory: 'cat', makefile: 'cat/Makefile', targets: ['all', 're', 'clean', 'fclean', 'tests_run'], name: 'cat', sources: ['cat.c'] };
  const commands = graderMakeCommands('# Building...\n~/cat> make re && make fclean && make && make clean\n# Executing all tests...\n~/cat> make tests_run\n~/cat> rm -rf .\n~/cat> make -f /tmp/untrusted\n', [project]);
  assert.deepEqual(commands.map(c => c.command), [['make', 're'], ['make', 'fclean'], ['make'], ['make', 'clean'], ['make', 'tests_run']]);
  assert.ok(commands.every(c => c.cwd === 'cat'));
  assert.deepEqual(graderMakeCommands('# Building...\n~/.> make -C cat && clang test_files/main.c', [project]).map(c => ({ command: c.command, cwd: c.cwd })), [{ command: ['make'], cwd: 'cat' }]);
});

test('manual grader command persists per project/account and rejects unsupported shell syntax', async () => {
  const data = new Map<string, unknown>(), storage = { get: <T>(key: string, fallback?: T) => (data.get(key) ?? fallback) as T, update: async (key: string, value: unknown) => { data.set(key, value); } };
  const commands = new GraderCommand(storage);
  await commands.set('alice', 1, 'make re && make tests_run');
  assert.equal(new GraderCommand(storage).get('alice', 1), 'make re && make tests_run');
  assert.equal(commands.get('alice', 2), ''); assert.equal(commands.get('bob', 1), '');
  await assert.rejects(commands.set('alice', 1, 'echo input | ./cat'));
  assert.equal(commands.get('alice', 1), 'make re && make tests_run');
});

test('readiness executes a manual first-attempt chain and stops when a step fails', async () => {
  Object.assign(vscode.workspace, { isTrusted: true, textDocuments: [] });
  const root = await mkdtemp(join(tmpdir(), 'bb-grader-chain-'));
  const style = (id: number): StyleScanVM => ({ projectId: id, status: 'done', files: 1, summary: { fatal: 0, major: 0, minor: 0, info: 0 }, issues: [], source: 'preflight', truncated: false, scannedAt: Date.now(), durationMs: 0, error: null });
  const service = new ReadinessService(async id => style(id), createT('en'));
  try {
    await gitBytes(root, ['init', '-b', 'main']);
    await writeFile(join(root, 'main.c'), 'int main(void){return 0;}');
    const good = await service.check(1, root, undefined, undefined, [], 'printf first && printf second');
    assert.equal(good?.commandSource, 'manual');
    assert.equal(good?.checks.find(c => c.id === 'build')?.status, 'pass');
    assert.match(good?.checks.find(c => c.id === 'build')?.output ?? '', /second/);
    const bad = await service.check(1, root, undefined, undefined, [], 'false && touch should-not-exist');
    assert.equal(bad?.checks.find(c => c.id === 'build')?.status, 'fail');
    await assert.rejects(import('node:fs/promises').then(fs => fs.stat(join(root, 'should-not-exist'))));
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('only output inferred from log blocks ignores a final newline during local reproduction', async () => {
  Object.assign(vscode.workspace, { isTrusted: true });
  const service = new ReproductionService(createT('en'));
  const root = await mkdtemp(join(tmpdir(), 'bb-grader-output-'));
  try {
    const recipe = { command: ['printf', 'OK\n'], expectedStdout: 'OK' };
    await service.run(1, root, 1, 'task', recipe);
    assert.equal(service.get(1)?.status, 'failed');
    await service.run(1, root, 1, 'task', { ...recipe, expectedFromLog: true });
    assert.equal(service.get(1)?.status, 'passed');
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});
