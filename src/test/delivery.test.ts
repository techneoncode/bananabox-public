import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { parseDeliveryConfig, saveDeliveryConfig } from '../delivery/config';
import { executeLocal } from '../delivery/process';
import { changes, snapshot, safeProjectPath } from '../delivery/git';
import { findForbiddenFunctions } from '../domain/forbiddenFunctions';
import { compareResults } from '../domain/graderComparison';
import { readinessVerdict } from '../domain/readiness';
import { ReadinessService } from '../services/readinessService';
import { ReproductionService } from '../services/reproductionService';
import { GuidedDelivery } from '../services/guidedDelivery';
import { gitBytes } from '../git/commitData';
import { createT } from '../shared/i18n';
import type { TestResultDetail, TestTask, StyleScanVM } from '../shared/types';
import type { DeliveryConfig } from '../shared/deliveryTypes';

Object.assign(vscode.workspace, { isTrusted: true, textDocuments: [] });
const t = createT('en');
const command = (code: string) => ({ command: [process.execPath, '-e', code], timeoutSeconds: 2 });
const configuration = (): DeliveryConfig => ({ version: 1, build: command('process.exit(0)'), tests: command('process.exit(0)'), requiredFiles: ['main.c'], forbiddenFunctions: ['system'], recipes: {} });
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'bb-delivery-'));
  await gitBytes(root, ['init', '-b', 'main']);
  await gitBytes(root, ['config', 'user.email', 'tests@example.invalid']);
  await gitBytes(root, ['config', 'user.name', 'Bananabox tests']);
  await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }\n');
  await saveDeliveryConfig(root, configuration());
  await gitBytes(root, ['add', '.']); await gitBytes(root, ['commit', '-m', 'initial']);
  return root;
}
const style = (id: number): StyleScanVM => ({ projectId: id, status: 'done', source: 'preflight', files: 1, summary: { fatal: 0, major: 0, minor: 0, info: 0 }, issues: [], truncated: false, scannedAt: Date.now(), durationMs: 1, error: null });
const task = (name: string, status: TestTask['status'], passed = status === 'passed' ? 3 : 1, count = 3): TestTask => ({ name, status, passed, count, crashed: 0, mandatoryFailed: 0, steps: [], trace: '' });
const detail = (tasks: TestTask[]) => ({ tasks } as TestResultDetail);

test('comparison reports improvements, regressions, changed coverage, additions and removals without inventing unknown verdicts', () => {
  const a = detail([task('fixed', 'failed'), task('regression', 'passed'), task('partial', 'failed', 2), task('remaining', 'failed'), task('gone', 'passed'), task('unknown', 'unknown', 0, 0), task('coverage', 'failed', 1, 2)]);
  const b = detail([task('fixed', 'passed'), task('regression', 'failed'), task('partial', 'failed', 1), task('remaining', 'failed'), task('new', 'passed'), task('unknown', 'unknown', 0, 0), task('coverage', 'failed', 2, 4)]);
  const changes = Object.fromEntries(compareResults(a, b).map(c => [c.name, c.kind]));
  assert.deepEqual(changes, { regression: 'regressed', partial: 'regressed', fixed: 'fixed', remaining: 'stillFailing', coverage: 'changed', new: 'added', gone: 'removed', unknown: 'unchanged' });
});

test('configuration validates commands, timeouts, local paths and recipe expectations', () => {
  assert.equal(parseDeliveryConfig(configuration()).version, 1);
  for (const invalid of [{ version: 2 }, { version: 1, build: { command: 'make' } }, { version: 1, requiredFiles: ['../secret'] },
    { version: 1, tests: { command: ['make'], timeoutSeconds: -1 } }, { version: 1, forbiddenFunctions: ['system()'] },
    { version: 1, recipes: { x: { command: ['foo'], expectedExitCode: 1.5 } } }]) assert.throws(() => parseDeliveryConfig(invalid));
  assert.equal(parseDeliveryConfig({ version: 1, recipes: { '__proto__': undefined, x: { command: ['foo'], stdin: '', expectedStdout: '' } } }).recipes.x.expectedStdout, '');
});

test('forbidden function scan ignores comments and literals and preserves source locations', () => {
  const findings = findForbiddenFunctions('// system("no");\nchar *s = "system()";\n/* system() */\nint f(void) {\n  system("yes");\n  ecosystem();\n}\n', ['system']);
  assert.deepEqual(findings, [{ line: 5, column: 3, message: 'system' }]);
});

test('local recipes preserve arguments, feed stdin, close stdin, enforce timeout and cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-process-'));
  try {
    const marker = join(root, 'must-not-exist');
    const literal = `$(touch ${marker})`;
    const result = await executeLocal(root, { command: [process.execPath, '-e', 'const fs=require("fs"); fs.writeSync(1, fs.readFileSync(0)); fs.writeSync(1, process.argv[1]+"\\n");', literal], stdin: 'input\n' });
    assert.equal(result.code, 0); assert.equal(result.stdout, `input\n${literal}\n`);
    await assert.rejects(readFile(marker));
    const timed = await executeLocal(root, { ...command('setInterval(() => {}, 1000)'), timeoutSeconds: 0.05 });
    assert.equal(timed.timedOut, true);
    const abort = new AbortController();
    const pending = executeLocal(root, command('setInterval(() => {}, 1000)'), abort.signal);
    abort.abort(); assert.equal((await pending).cancelled, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('snapshot notices dirty-to-dirty edits and includes untracked files, but excludes ignored build outputs', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, '.gitignore'), '*.o\n');
    const a = await snapshot(root);
    await writeFile(join(root, 'main.c'), 'int main(void) { return 1; }');
    const b = await snapshot(root);
    await writeFile(join(root, 'main.c'), 'int main(void) { return 2; }');
    const c = await snapshot(root);
    assert.notEqual(a.fingerprint, b.fingerprint); assert.notEqual(b.fingerprint, c.fingerprint);
    await writeFile(join(root, 'main.o'), 'ignored'); assert.equal((await snapshot(root)).fingerprint, c.fingerprint);
    await writeFile(join(root, 'new.c'), 'new'); assert.notEqual((await snapshot(root)).fingerprint, c.fingerprint);
    assert.ok((await changes(root)).includes('new.c'));
    const outside = await mkdtemp(join(tmpdir(), 'bb-outside-'));
    try { await writeFile(join(outside, 'private'), 'private'); await symlink(join(outside, 'private'), join(root, 'escape')); await assert.rejects(safeProjectPath(root, 'escape'), /outside/); }
    finally { await rm(outside, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('readiness runs configured checks, reports failing output, detects missing files and forbidden references', async () => {
  const root = await repository();
  const service = new ReadinessService(async id => style(id), t);
  try {
    const first = await service.check(1, root);
    assert.equal(first?.status, 'done'); assert.equal(first?.stale, false);
    assert.ok(first?.checks.filter(c => c.id !== 'git').every(c => c.status === 'pass'));
    const cfg = configuration(); cfg.tests = command('require("fs").writeSync(2, "assertion failed"); process.exit(2)'); cfg.requiredFiles.push('missing.h');
    await saveDeliveryConfig(root, cfg); await writeFile(join(root, 'main.c'), 'int f(void) { system("x"); }');
    const failed = await service.check(1, root);
    assert.equal(failed?.checks.find(c => c.id === 'tests')?.status, 'fail');
    assert.match(failed?.checks.find(c => c.id === 'tests')?.output ?? '', /assertion failed/);
    assert.equal(failed?.checks.find(c => c.id === 'files')?.status, 'fail');
    assert.equal(failed?.checks.find(c => c.id === 'functions')?.files?.[0].file, 'main.c');
    assert.equal(readinessVerdict(failed!, failed!.checks), 'blocked');
    service.invalidate(1); assert.equal(readinessVerdict(service.get(1), failed!.checks), 'stale');
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('readiness never reports an unconfigured or interrupted check as ready', async () => {
  const root = await repository();
  const service = new ReadinessService(async id => style(id), t);
  try {
    await rm(join(root, '.bananabox.json'));
    const unknown = await service.check(1, root);
    assert.equal(unknown?.configured, false);
    assert.equal(unknown?.checks.find(c => c.id === 'build')?.status, 'unknown');
    const cfg = configuration(); cfg.build = command('setInterval(() => {}, 1000)'); await saveDeliveryConfig(root, cfg);
    const pending = service.check(1, root);
    setTimeout(() => service.cancel(1), 40);
    assert.equal((await pending)?.status, 'cancelled');
    const again = service.check(1, root); service.clear(); assert.equal(await again, null); assert.equal(service.get(1), undefined);
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('reproduction compares exact stdout and exit code, and stops when build fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-reproduce-'));
  const service = new ReproductionService(t);
  try {
    const recipe = { ...command('require("fs").writeSync(1, "answer\\n")'), expectedStdout: 'answer\n' };
    await service.run(1, root, 2, 'task', recipe); assert.equal(service.get(1)?.status, 'passed');
    await service.run(1, root, 2, 'task', { ...recipe, expectedStdout: 'other\n' }); assert.equal(service.get(1)?.status, 'failed');
    await service.run(1, root, 2, 'task', recipe, command('require("fs").writeSync(2, "build error"); process.exit(1)'));
    assert.equal(service.get(1)?.status, 'error'); assert.match(service.get(1)?.stderr ?? '', /build error/);
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('allowed functions: every call outside the list fails the check, without a configuration file; edits invalidate old results', async () => {
  const root = await repository(), service = new ReadinessService(async id => style(id), t);
  try {
    await rm(join(root, '.bananabox.json'));
    await writeFile(join(root, 'main.c'), 'static int g(void) { return 0; }\nvoid f(void) { printf("write()"); write(1, "x", 1); g(); }\n');
    const vm = await service.check(1, root, undefined, undefined, ['write']);
    assert.equal(vm?.configured, false);
    assert.equal(vm?.checks.find(c => c.id === 'functions')?.status, 'fail');
    assert.deepEqual(vm?.checks.find(c => c.id === 'functions')?.files?.map(f => f.message), ['printf']);
    assert.deepEqual(vm?.disallowed, ['printf']);
    await assert.rejects(readFile(join(root, '.bananabox.json')));
    service.invalidateFunctions(1);
    assert.equal(service.get(1)?.stale, true);
    assert.equal(service.get(1)?.checks.find(c => c.id === 'functions')?.status, 'unknown');
    // No list at all: nothing to judge against.
    await service.check(1, root, undefined, undefined, []);
    assert.equal(service.get(1)?.checks.find(c => c.id === 'functions')?.status, 'unknown');
    // The list may still be arriving (read from the subject): it is awaited when the functions are checked.
    const allowed = await service.check(1, root, undefined, undefined, Promise.resolve(['write', 'printf']));
    assert.equal(allowed?.checks.find(c => c.id === 'functions')?.status, 'pass');
    // A name the configuration forbids stays forbidden even if the list allows it.
    await saveDeliveryConfig(root, { ...configuration(), forbiddenFunctions: ['write'] });
    const merged = await service.check(1, root, undefined, undefined, ['printf', 'write']);
    assert.deepEqual(merged?.inheritedForbiddenFunctions, ['write']);
    assert.deepEqual(merged?.checks.find(c => c.id === 'functions')?.files?.map(f => f.message), ['write']);
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('guided delivery pauses on failure, rechecks when resumed and never reaches grader before every step succeeds', async () => {
  const service = new GuidedDelivery(), calls: string[] = [];
  await service.start(1, { valid: () => true, execute: async step => { calls.push(step); return step !== 'check'; } });
  assert.deepEqual(calls, ['save', 'check']); assert.equal(service.get(1)?.status, 'paused');
  calls.length = 0;
  await service.start(1, { valid: () => true, execute: async step => { calls.push(step); return true; } });
  assert.deepEqual(calls, ['save', 'check', 'review', 'commit', 'push', 'grader']); assert.equal(service.get(1)?.status, 'done');
  calls.length = 0;
  await service.start(1, { valid: () => true, execute: async step => { calls.push(step); if (step === 'review') service.pause(1); return true; } });
  assert.deepEqual(calls, ['save', 'check', 'review']); assert.equal(service.get(1)?.status, 'paused'); service.dispose();
});
