import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { AdminError, AdminService } from '../services/adminService';
import { parseRemoteConfig, remoteStatus, type RemoteConfig } from '../domain/remotePolicy';

interface Call { method: string; path: string; auth: string | null; body?: any }

const release = (version: string) => `https://github.com/techneoncode/bananabox-public/releases/download/v${version}/bananabox-${version}.vsix`;
const config: RemoteConfig = { lens_active: true, my_api_active: true, version: '1.4.0', latest: release('1.4.0'), authorized: [], banned: [] };

function setup(answer: (call: Call) => Response | Promise<Response>) {
  const store = new Map<string, string>();
  const calls: Call[] = [];
  const secrets = {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as vscode.SecretStorage;
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = { method: init.method!, path: new URL(url).pathname + new URL(url).search, auth: new Headers(init.headers).get('Authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return answer(call);
  }) as unknown as typeof fetch;
  return { store, calls, service: new AdminService(secrets, fetcher, 'https://api.test') };
}

const ok = (data: unknown) => Response.json({ ok: true, data });
const login = (call: Call) => call.path === '/v1/admin/login'
  ? ok({ token: 't'.repeat(64), expires_at: Date.now() + 3_600_000, email: 'a@epitech.eu', whoami: 'alice' })
  : undefined;

test('login keeps the token in the secret storage and exposes only the session', async () => {
  const { service, store, calls } = setup((call) => login(call)!);
  const session = await service.login('a@epitech.eu', 'a long password');
  assert.deepEqual(Object.keys(session).sort(), ['email', 'expiresAt', 'whoami']);
  assert.equal(session.whoami, 'alice');
  assert.deepEqual(calls[0].body, { email: 'a@epitech.eu', password: 'a long password' });
  assert.equal(calls[0].auth, null, 'login is anonymous');
  assert.ok(store.get('bananabox.adminSession.v1')!.includes('t'.repeat(64)));
  assert.ok(!JSON.stringify(await service.session()).includes('tttt'), 'the token never leaves the service');
  assert.ok(!store.get('bananabox.adminSession.v1')!.includes('a long password'), 'the password is not stored');
});

test('a failed login surfaces the Worker error code and stores nothing', async () => {
  const { service, store } = setup(() => Response.json({ ok: false, error: { code: 'invalid_credentials', message: 'Invalid email or password.' } }, { status: 401 }));
  await assert.rejects(service.login('a@epitech.eu', 'x'), (e: unknown) => e instanceof AdminError && e.code === 'invalid_credentials' && e.status === 401);
  assert.equal(store.size, 0);
});

test('an expired stored session is dropped without a request', async () => {
  const { service, store, calls } = setup(() => ok({}));
  store.set('bananabox.adminSession.v1', JSON.stringify({ token: 'x', email: 'a@epitech.eu', whoami: null, expiresAt: Date.now() - 1 }));
  assert.equal(await service.session(), undefined);
  assert.equal(store.size, 0);
  await assert.rejects(service.snapshot(), (e: unknown) => e instanceof AdminError && e.code === 'session_expired');
  assert.equal(calls.length, 0);
});

test('snapshot reads every dashboard endpoint with the bearer token', async () => {
  const data: Record<string, unknown> = {
    '/v1/stats': { installs: 3, users: [{ account: 'alice', promotion: null, cursus: null, campus: null }], versions: [], timeline: [] },
    '/v1/banned': { items: [{ id: 1, name: 'mallory', reason: null, features: ['lens_active'], created_at: 1 }] },
    '/v1/authorized': { items: [] },
    '/v1/policy': { lens_active: true, my_api_active: false, version: '1.4.0', latest: release('1.4.0') },
    '/v1/updates?limit=20': { items: [{ install: 'abcd1234', from_version: '1.3.4', to_version: '1.4.0', at: 5 }] },
  };
  const { service, calls } = setup((call) => login(call) ?? ok(data[call.path]));
  await service.login('a@epitech.eu', 'a long password');
  const snapshot = await service.snapshot();
  assert.equal(snapshot.stats.installs, 3);
  assert.equal(snapshot.banned[0].name, 'mallory');
  assert.equal(snapshot.policy.my_api_active, false);
  assert.equal(snapshot.updates[0].to_version, '1.4.0');
  const reads = calls.slice(1);
  assert.equal(reads.length, 5);
  assert.ok(reads.every((c) => c.method === 'GET' && c.auth === `Bearer ${'t'.repeat(64)}`));
});

test('changes use the matching endpoint and body', async () => {
  const { service, calls } = setup((call) => login(call) ?? ok(call.path === '/v1/policy' && call.method === 'GET'
    ? { lens_active: true, my_api_active: true, version: '1.4.0', latest: release('1.4.0') }
    : { id: 7 }));
  await service.login('a@epitech.eu', 'a long password');
  calls.length = 0;
  await service.ban({ name: 'mallory', scope: 'user', features: ['lens_active'], reason: 'spam' });
  await service.ban({ name: 'eve', scope: 'user', features: ['lens_active', 'my_api_active'] });
  await service.ban({ name: 'pge:2027', scope: 'promotion', features: ['my_api_active'], anonymous: true });
  await service.updateBan(7, { features: ['my_api_active'] });
  await service.unban(7);
  await service.authorize('alice', 'maintainer');
  await service.unauthorize(2);
  await service.setPolicy({ lens_active: false });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [
    ['POST', '/v1/banned', { name: 'mallory', scope: 'user', features: ['lens_active'], reason: 'spam' }],
    ['POST', '/v1/banned', { name: 'eve', scope: 'user', features: ['lens_active', 'my_api_active'] }],
    ['POST', '/v1/banned', { name: 'pge:2027', scope: 'promotion', features: ['my_api_active'], anonymous: true }],
    ['PUT', '/v1/banned/7', { features: ['my_api_active'] }],
    ['DELETE', '/v1/banned/7', undefined],
    ['POST', '/v1/authorized', { name: 'alice', reason: 'maintainer' }],
    ['DELETE', '/v1/authorized/2', undefined],
    ['GET', '/v1/policy', undefined],
    ['PUT', '/v1/policy', { lens_active: false, my_api_active: true, version: '1.4.0', latest: release('1.4.0') }],
  ]);
});

test('a 401 on an authenticated call ends the session', async () => {
  const { service, store } = setup((call) => login(call) ?? Response.json({ ok: false, error: { code: 'unauthorized', message: 'Authentication required.' } }, { status: 401 }));
  await service.login('a@epitech.eu', 'a long password');
  await assert.rejects(service.unban(1), (e: unknown) => e instanceof AdminError && e.code === 'session_expired');
  assert.equal(store.size, 0);
});

test('network failures and malformed answers become typed errors', async () => {
  const down = setup(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(down.service.login('a@epitech.eu', 'x'), (e: unknown) => e instanceof AdminError && e.code === 'network');
  const html = setup(() => new Response('<html>', { status: 502 }));
  await assert.rejects(html.service.login('a@epitech.eu', 'x'), (e: unknown) => e instanceof AdminError && e.code === 'bad_response' && e.status === 502);
});

test('logout drops the local token even when the server is unreachable', async () => {
  let fail = false;
  const { service, store, calls } = setup((call) => { if (fail) throw new TypeError('offline'); return login(call) ?? ok({ loggedOut: true }); });
  await service.login('a@epitech.eu', 'a long password');
  fail = true;
  await service.logout();
  assert.equal(store.size, 0);
  assert.equal(calls.at(-1)!.path, '/v1/admin/logout');
  assert.equal(await service.session(), undefined);
});

test('the dashboard is offered only to an exact whoami listed as admin', () => {
  const admins = { ...config, admins: ['alice'] };
  assert.equal(remoteStatus(admins, '1.4.0', 'alice').admin, true);
  assert.equal(remoteStatus(admins, '1.4.0', 'Alice').admin, false, 'case-sensitive');
  assert.equal(remoteStatus(admins, '1.4.0', 'alice2').admin, false, 'no substring match, unlike bans');
  assert.equal(remoteStatus(admins, '1.4.0', '').admin, false);
  assert.equal(remoteStatus(config, '1.4.0', 'alice').admin, false, 'an API without the list shows no dashboard');
  assert.equal(remoteStatus(undefined, '1.4.0', 'alice').admin, false);
  assert.deepEqual(parseRemoteConfig(admins).admins, ['alice']);
  assert.deepEqual(parseRemoteConfig(config).admins, []);
  assert.throws(() => parseRemoteConfig({ ...config, admins: [1] }));
  assert.throws(() => parseRemoteConfig({ ...config, admins: 'alice' }));
});

test('root endpoints send the root token given for the call, and never store it', async () => {
  const { service, calls, store } = setup((call) => call.method === 'GET'
    ? ok({ items: [{ id: 1, email: 'a@epitech.eu', whoami: 'alice', created_at: 1, last_login: null }] })
    : ok({ id: 2 }));
  const admins = await service.admins('root-secret');
  assert.equal(admins[0].whoami, 'alice');
  await service.createAdmin('root-secret', { email: 'b@epitech.eu', whoami: 'bob', password: 'a long password' });
  await service.setAdminWhoami('root-secret', 2, 'bobby');
  await service.deleteAdmin('root-secret', 2);
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [
    ['GET', '/v1/admins', undefined],
    ['POST', '/v1/admins', { email: 'b@epitech.eu', whoami: 'bob', password: 'a long password' }],
    ['PUT', '/v1/admins/2', { whoami: 'bobby' }],
    ['DELETE', '/v1/admins/2', undefined],
  ]);
  assert.ok(calls.every((c) => c.auth === 'Bearer root-secret'));
  assert.equal(store.size, 0);
});
