import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FunctionRules } from '../services/functionRules';
import { mergeFunctionNames, parseFunctionNames } from '../domain/functionRules';
import { gitReadinessDetail } from '../domain/readiness';
import { createT } from '../shared/i18n';
import { Controller } from '../controller';

test('function input accepts lists and empty parentheses, rejects invalid identifiers and deduplicates', () => {
  assert.deepEqual(parseFunctionNames('write, printf; write\n_exit() printf ()'), ['write', 'printf', '_exit']);
  assert.deepEqual(parseFunctionNames(''), []);
  assert.equal(parseFunctionNames('printf(42)'), null);
  assert.equal(parseFunctionNames('foo; $(command)'), null);
  assert.equal(parseFunctionNames('a'.repeat(129)), null);
  assert.deepEqual(mergeFunctionNames(['write', 'printf'], ['printf', 'system']), ['write', 'printf', 'system']);
});

test('function preferences persist across service recreation and stay scoped to project and account', async () => {
  const data = new Map<string, unknown>();
  const storage = { get: <T>(key: string, fallback?: T) => (data.get(key) ?? fallback) as T,
    update: async (key: string, value: unknown) => { data.set(key, value); } };
  const rules = new FunctionRules(storage);
  await rules.set('api|alice', 1, ['write', 'printf', 'printf']);
  assert.deepEqual(new FunctionRules(storage).get('api|alice', 1), ['write', 'printf']);
  assert.deepEqual(rules.get('api|alice', 2), []);
  assert.deepEqual(rules.get('api|bob', 1), []);
  await assert.rejects(rules.set('api|alice', 1, ['bad()']));
  assert.deepEqual(rules.get('api|alice', 1), ['write', 'printf']);
  await rules.set('api|alice', 1, ['printf']); assert.deepEqual(rules.get('api|alice', 1), ['printf']);
  await rules.set('api|alice', 1, []); assert.deepEqual(rules.get('api|alice', 1), []);
});

test('Git explanation distinguishes uncommitted work, unpushed commits and a clean pushed copy', () => {
  const t = createT('en');
  assert.match(gitReadinessDetail({ dirty: 8, ahead: 0, hasUpstream: true }, t), /8 file\(s\) awaiting commit · 0 commit\(s\) awaiting push\nThese local changes are not included/);
  assert.match(gitReadinessDetail({ dirty: 0, ahead: 2, hasUpstream: true }, t), /still need to be pushed/);
  assert.match(gitReadinessDetail({ dirty: 0, ahead: 0, hasUpstream: true }, t), /working copy is clean/);
  assert.match(gitReadinessDetail({ dirty: 0, ahead: 0, hasUpstream: false }, t), /not been pushed yet/);
});

test('webview rule messages save preferences, invalidate checks and acknowledge rejected edits during a run', async () => {
  const data = new Map<string, unknown>(), rules = new FunctionRules({ get: <T>(key: string, fallback?: T) => (data.get(key) ?? fallback) as T,
    update: async (key: string, value: unknown) => { data.set(key, value); } });
  const messages: any[] = [], controller: any = Object.create(Controller.prototype);
  let status = 'done', invalidated = 0;
  const reads: Array<[number, boolean]> = [];
  // termsAccepted is a getter on Controller: define it rather than assign it.
  Object.defineProperty(controller, 'termsAccepted', { value: true });
  Object.assign(controller, { auth: { isSignedIn: true, snapshot: { login: 'alice' } }, functionRules: rules,
    graderCommand: { get: () => '' },
    subjectFunctions: { get: () => ({ status: 'found', names: ['opendir'], doc: 'my_ls.pdf' }), ensure: async (_s: string, p: { id: number }, force: boolean) => { reads.push([p.id, force]); return { status: 'found', names: [] }; } },
    projects: { get: (id: number) => id === 1 ? { id } : undefined }, guided: { get: () => undefined }, reproduction: { get: () => undefined },
    readiness: { get: () => ({ status }), invalidateFunctions: () => { invalidated++; } },
    post: (message: unknown) => messages.push(message), toast() {} });
  await controller.handle({}, { type: 'setFunctionRules', projectId: 1, names: ['write', 'printf'] });
  assert.equal(invalidated, 1);
  assert.deepEqual(messages.find(m => m.type === 'functionRules').names, ['write', 'printf']);
  status = 'running'; messages.length = 0;
  await controller.handle({}, { type: 'setFunctionRules', projectId: 1, names: ['system'] });
  assert.equal(invalidated, 1);
  assert.deepEqual(messages.find(m => m.type === 'functionRules').names, ['write', 'printf']);
  status = 'done'; messages.length = 0;
  await controller.handle({}, { type: 'setFunctionRules', projectId: 1, names: [] });
  assert.equal(invalidated, 2);
  assert.deepEqual(messages.find(m => m.type === 'functionRules').names, []);
  await controller.handle({}, { type: 'setFunctionRules', projectId: 2, names: ['system'] });
  assert.equal(invalidated, 2);
  // The subject's list rides along with the student's; "Read again" forces a new read and invalidates the check.
  assert.deepEqual(messages.find(m => m.type === 'functionRules').subject, { status: 'found', names: ['opendir'], doc: 'my_ls.pdf' });
  await controller.handle({}, { type: 'readSubjectFunctions', projectId: 1 });
  assert.deepEqual(reads, [[1, true]]);
  assert.equal(invalidated, 3);
});
