import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-admin-token';
const persist = mkdtempSync(join(tmpdir(), 'bananabox-worker-'));
const WRANGLER = join(import.meta.dirname, '..', 'node_modules', '.bin', 'wrangler');
let server;

const call = (method, path, body, token) => fetch(BASE + path, {
  method,
  headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, headers: r.headers, json: await r.json() }));
const nonce = async () => (await call('POST', '/v1/nonce')).json.data.nonce;
const id = () => crypto.randomUUID().replaceAll('-', '');

before(async () => {
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'bananabox', '--local', '--persist-to', persist], { stdio: 'ignore' });
  server = spawn(WRANGLER, ['dev', '--local', '--port', String(PORT), '--persist-to', persist, '--var', `ADMIN_TOKEN:${TOKEN}`], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/v1/config')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not start:\n${stderr.slice(-1500)}`);
});
// Kill the whole process group: wrangler spawns workerd, which would keep node:test alive.
after(() => { if (server) { server.stderr.destroy(); process.kill(-server.pid, 'SIGKILL'); } });

const ROOT = TOKEN;
const PASSWORD = 'correct horse battery';
let session;
let adminId;
const as = token => (m, p, b) => call(m, p, b, token);
const asAdmin = (m, p, b) => as(session)(m, p, b);
const root = as(ROOT);
const login = (email, password) => call('POST', '/v1/admin/login', { email, password });
const logs = async (query = '') => (await root('GET', `/v1/logs?limit=500${query}`)).json.data.items;

before(async () => {
  const created = await root('POST', '/v1/admins', { email: 'Admin.One@Epitech.eu', password: PASSWORD });
  adminId = created.json.data.id;
  session = (await login('admin.one@epitech.eu', PASSWORD)).json.data.token;
});

test('responses are uniform JSON and unknown routes or methods are rejected cleanly', async () => {
  const res = await call('GET', '/v1/config');
  assert.equal(res.json.ok, true);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(res.json.data).sort(), ['authorized', 'banned', 'latest', 'lens_active', 'my_api_active', 'version']);
  const missing = await call('GET', '/nope');
  assert.deepEqual([missing.status, missing.json.ok, missing.json.error.code], [404, false, 'not_found']);
  const method = await call('DELETE', '/v1/config');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET');
});

test('protected endpoints require authentication; root-only ones reject admin accounts', async () => {
  const adminRoutes = [['GET', '/v1/banned'], ['POST', '/v1/banned'], ['PUT', '/v1/banned/1'], ['DELETE', '/v1/banned/1'], ['GET', '/v1/authorized'], ['GET', '/v1/policy'], ['PUT', '/v1/policy'], ['GET', '/v1/stats'], ['GET', '/v1/versions'], ['GET', '/v1/updates'], ['GET', '/v1/admin/me']];
  const rootRoutes = [['GET', '/v1/admins'], ['POST', '/v1/admins'], ['DELETE', '/v1/admins/1'], ['PUT', '/v1/admins/1/password'], ['GET', '/v1/logs']];
  for (const [m, p] of [...adminRoutes, ...rootRoutes]) {
    assert.equal((await call(m, p, m === 'GET' || m === 'DELETE' ? undefined : { name: 'x' })).status, 401, `${m} ${p}`);
    assert.equal((await call(m, p, undefined, 'wrong')).status, 401, `${m} ${p} wrong token`);
  }
  for (const [m, p] of rootRoutes) {
    const res = await asAdmin(m, p, m === 'GET' || m === 'DELETE' ? undefined : { email: 'x@epitech.eu', password: PASSWORD });
    assert.deepEqual([res.status, res.json.error.code], [403, 'forbidden'], `${m} ${p}`);
  }
  assert.equal((await root('GET', '/v1/stats')).status, 200, 'root can do everything an admin can');
});

test('banned and authorized lists: add, duplicate, validate, list, delete, and public config', async () => {
  for (const kind of ['banned', 'authorized']) {
    const added = await asAdmin('POST', `/v1/${kind}`, { name: 'mallory', reason: 'test' });
    assert.equal(added.status, 201);
    assert.equal((await asAdmin('POST', `/v1/${kind}`, { name: 'mallory' })).status, 409);
    for (const name of ['', 'a b', 'x'.repeat(65), 5, undefined]) {
      assert.equal((await asAdmin('POST', `/v1/${kind}`, { name })).status, 400, `name ${name}`);
    }
    assert.equal((await asAdmin('POST', `/v1/${kind}`, { name: 'ok', reason: 'x'.repeat(201) })).status, 400);
    const cfg = (await call('GET', '/v1/config')).json.data;
    if (kind === 'banned') assert.deepEqual(cfg.banned, [{ user: 'mallory', features: ['lens_active', 'my_api_active'] }]);
    else assert.deepEqual(cfg.authorized, ['mallory']);
    assert.equal((await asAdmin('DELETE', `/v1/${kind}/${added.json.data.id}`)).status, 200);
    assert.equal((await asAdmin('DELETE', `/v1/${kind}/${added.json.data.id}`)).status, 404);
    assert.deepEqual((await asAdmin('GET', `/v1/${kind}`)).json.data.items, []);
  }
  assert.equal((await asAdmin('DELETE', '/v1/banned/abc')).status, 404);
});

test('bans restrict features per account and can be changed afterwards', async () => {
  const lens = await asAdmin('POST', '/v1/banned', { name: 'alice', features: ['lens_active'] });
  const my = await asAdmin('POST', '/v1/banned', { name: 'bob', features: ['my_api_active', 'my_api_active'] });
  assert.deepEqual([lens.json.data.features, my.json.data.features], [['lens_active'], ['my_api_active']]);
  assert.deepEqual((await call('GET', '/v1/config')).json.data.banned, [{ user: 'alice', features: ['lens_active'] }, { user: 'bob', features: ['my_api_active'] }]);
  for (const features of [[], ['other'], 'lens_active']) {
    assert.equal((await asAdmin('POST', '/v1/banned', { name: 'carol', features })).status, 400);
  }
  const updated = await asAdmin('PUT', `/v1/banned/${lens.json.data.id}`, { features: ['lens_active', 'my_api_active'], reason: 'worse' });
  assert.deepEqual([updated.status, updated.json.data.features, updated.json.data.reason], [200, ['lens_active', 'my_api_active'], 'worse']);
  assert.equal((await asAdmin('PUT', `/v1/banned/${lens.json.data.id}`, { features: [] })).status, 400);
  assert.equal((await asAdmin('PUT', '/v1/banned/999999', { features: ['lens_active'] })).status, 404);
  for (const entry of [lens, my]) await asAdmin('DELETE', `/v1/banned/${entry.json.data.id}`);
});

test('policy: validated like the extension and reflected in the public config', async () => {
  const good = { lens_active: true, my_api_active: false, version: '1.4.0', latest: 'https://github.com/techneoncode/bananabox-public/releases/download/v1.4.0/bananabox-1.4.0.vsix' };
  assert.equal((await asAdmin('PUT', '/v1/policy', good)).status, 200);
  const cfg = (await call('GET', '/v1/config')).json.data;
  assert.deepEqual([cfg.version, cfg.my_api_active], ['1.4.0', false]);
  for (const bad of [{ ...good, version: '1.4' }, { ...good, latest: good.latest.replace('v1.4.0', 'v1.4.1') }, { ...good, latest: 'https://evil.example/x.vsix' }, { ...good, lens_active: 'yes' }]) {
    assert.equal((await asAdmin('PUT', '/v1/policy', bad)).status, 400);
  }
  assert.equal((await fetch(BASE + '/v1/policy', { method: 'PUT', headers: { Authorization: `Bearer ${session}` }, body: '{' })).status, 400);
  await asAdmin('PUT', '/v1/policy', { ...good, version: '1.3.4', latest: good.latest.replaceAll('1.4.0', '1.3.4'), my_api_active: true });
});

test('admin accounts: @epitech.eu only, strong password, unique, never exposes secrets', async () => {
  for (const email of ['x@gmail.com', 'x@epitech.eu.evil.com', '@epitech.eu', 'a b@epitech.eu', undefined, 5]) {
    assert.equal((await root('POST', '/v1/admins', { email, password: PASSWORD })).status, 400, `email ${email}`);
  }
  for (const password of ['short', 'x'.repeat(129), undefined, 12]) {
    assert.equal((await root('POST', '/v1/admins', { email: 'two@epitech.eu', password })).status, 400, `password ${password}`);
  }
  assert.equal((await root('POST', '/v1/admins', { email: 'ADMIN.one@epitech.eu', password: PASSWORD })).status, 409, 'case-insensitive duplicates');
  const list = await root('GET', '/v1/admins');
  assert.deepEqual(list.json.data.items.map(a => a.email), ['admin.one@epitech.eu']);
  assert.ok(!JSON.stringify(list.json).includes('pbkdf2'));
  assert.ok(!JSON.stringify(await logs()).includes('pbkdf2') && !JSON.stringify(await logs()).includes(PASSWORD));
});

test('login: wrong credentials are indistinguishable, repeated failures lock the account', async () => {
  const unknown = await login('nobody@epitech.eu', PASSWORD);
  const wrong = await login('admin.one@epitech.eu', 'wrong password!!');
  assert.deepEqual([unknown.status, wrong.status], [401, 401]);
  assert.deepEqual(unknown.json, wrong.json);
  assert.equal((await login('admin.one@gmail.com', PASSWORD)).status, 400);
  await root('POST', '/v1/admins', { email: 'lock.me@epitech.eu', password: PASSWORD });
  for (let i = 0; i < 5; i++) assert.equal((await login('lock.me@epitech.eu', 'bad password 12345')).status, 401);
  const locked = await login('lock.me@epitech.eu', PASSWORD);
  assert.deepEqual([locked.status, locked.json.error.code], [429, 'locked'], 'even the right password is refused while locked');
  const target = (await root('GET', '/v1/admins')).json.data.items.find(a => a.email === 'lock.me@epitech.eu');
  assert.equal((await root('PUT', `/v1/admins/${target.id}/password`, { password: 'a brand new password' })).status, 200, 'root reset unlocks');
  assert.equal((await login('lock.me@epitech.eu', 'a brand new password')).status, 200);
  await root('DELETE', `/v1/admins/${target.id}`);
});

test('sessions: logout invalidates the token, password change keeps only the current session', async () => {
  await root('POST', '/v1/admins', { email: 'sess@epitech.eu', password: PASSWORD });
  const [a, b] = await Promise.all([login('sess@epitech.eu', PASSWORD), login('sess@epitech.eu', PASSWORD)]);
  const [ta, tb] = [a.json.data.token, b.json.data.token];
  assert.match(ta, /^[0-9a-f]{64}$/);
  assert.equal((await as(ta)('GET', '/v1/admin/me')).json.data.email, 'sess@epitech.eu');
  const bad = await as(ta)('PUT', '/v1/admin/password', { current_password: 'nope nope nope', new_password: 'another long password' });
  assert.equal(bad.status, 401);
  assert.equal((await as(ta)('PUT', '/v1/admin/password', { current_password: PASSWORD, new_password: 'short' })).status, 400);
  assert.equal((await as(ta)('PUT', '/v1/admin/password', { current_password: PASSWORD, new_password: 'another long password' })).status, 200);
  assert.equal((await as(tb)('GET', '/v1/admin/me')).status, 401, 'other sessions are revoked');
  assert.equal((await login('sess@epitech.eu', PASSWORD)).status, 401, 'old password no longer works');
  assert.equal((await as(ta)('POST', '/v1/admin/logout')).status, 200);
  assert.equal((await as(ta)('GET', '/v1/admin/me')).status, 401);
  assert.equal((await root('GET', '/v1/admin/me')).json.data.type, 'root');
  assert.equal((await asAdmin('PUT', '/v1/admin/password', {})).status, 400);
  assert.equal((await root('PUT', '/v1/admin/password', { current_password: 'x', new_password: 'y'.repeat(14) })).status, 403);
});

test('deleting an admin account revokes its sessions immediately', async () => {
  await root('POST', '/v1/admins', { email: 'gone@epitech.eu', password: PASSWORD });
  const token = (await login('gone@epitech.eu', PASSWORD)).json.data.token;
  const id = (await root('GET', '/v1/admins')).json.data.items.find(a => a.email === 'gone@epitech.eu').id;
  assert.equal((await as(token)('GET', '/v1/admin/me')).status, 200);
  assert.equal((await root('DELETE', `/v1/admins/${id}`)).status, 200);
  assert.equal((await as(token)('GET', '/v1/admin/me')).status, 401);
  assert.equal((await login('gone@epitech.eu', PASSWORD)).status, 401);
  assert.equal((await root('DELETE', `/v1/admins/${id}`)).status, 404);
});

test('audit log: every administrative change is recorded with its actor, and only root can read it', async () => {
  const marker = `audited${Date.now() % 100000}`;
  const added = await asAdmin('POST', '/v1/banned', { name: marker, features: ['lens_active'], reason: 'because' });
  await asAdmin('PUT', `/v1/banned/${added.json.data.id}`, { features: ['my_api_active'] });
  await asAdmin('DELETE', `/v1/banned/${added.json.data.id}`);
  await root('POST', '/v1/authorized', { name: marker });
  const mine = (await logs()).filter(l => l.target === marker);
  assert.deepEqual(mine.map(l => l.action).reverse(), ['banned.add', 'banned.update', 'banned.delete', 'authorized.add']);
  const [rootEntry, , , addEntry] = mine;
  assert.deepEqual([addEntry.actor_type, addEntry.actor_email, addEntry.actor_id], ['admin', 'admin.one@epitech.eu', adminId]);
  assert.deepEqual(addEntry.detail, { reason: 'because', features: ['lens_active'] });
  assert.deepEqual([rootEntry.actor_type, rootEntry.actor_email], ['root', null]);
  const update = mine.find(l => l.action === 'banned.update');
  assert.deepEqual(update.detail.from.features, ['lens_active']);
  assert.deepEqual(update.detail.to.features, ['my_api_active']);

  const policy = (await asAdmin('GET', '/v1/policy')).json.data;
  await asAdmin('PUT', '/v1/policy', policy);
  const all = await logs();
  assert.ok(all.some(l => l.action === 'policy.update' && l.actor_email === 'admin.one@epitech.eu'));
  for (const action of ['admin.create', 'login.success', 'login.failure', 'login.locked', 'logout', 'password.change', 'password.change_failed', 'admin.delete', 'admin.password_reset']) {
    assert.ok(all.some(l => l.action === action), `missing ${action}`);
  }
  assert.ok(all.every(l => typeof l.at === 'number'));

  assert.equal((await asAdmin('GET', '/v1/logs')).status, 403);
  assert.equal((await call('GET', '/v1/logs')).status, 401);
  assert.equal((await root('POST', '/v1/banned', { name: 'a b' })).status, 400);
  assert.ok(!(await logs()).some(l => l.target === 'a b'), 'rejected requests change nothing and are not logged as changes');
});

test('audit log: filters and pagination', async () => {
  const byActor = await logs('&actor=admin.one@epitech.eu');
  assert.ok(byActor.length > 0 && byActor.every(l => l.actor_email === 'admin.one@epitech.eu'));
  const byAction = await logs('&action=banned.add');
  assert.ok(byAction.length > 0 && byAction.every(l => l.action === 'banned.add'));
  const first = (await root('GET', '/v1/logs?limit=2')).json.data;
  assert.equal(first.items.length, 2);
  const second = (await root('GET', `/v1/logs?limit=2&before=${first.next_before}`)).json.data;
  assert.ok(second.items.every(l => l.id < first.next_before));
  for (const query of ['limit=0', 'limit=501', 'before=0', 'before=abc']) assert.equal((await root('GET', `/v1/logs?${query}`)).status, 400, query);
});

test('nonces are single-use, validated, and tied to a well-formed install id', async () => {
  const install = id();
  const n = await nonce();
  assert.equal((await call('POST', '/v1/installs', { installId: install, nonce: n, version: '1.3.4' })).status, 200);
  const replay = await call('POST', '/v1/installs', { installId: install, nonce: n, version: '1.3.4' });
  assert.deepEqual([replay.status, replay.json.error.code], [401, 'invalid_nonce']);
  assert.equal((await call('POST', '/v1/installs', { installId: install, nonce: 'f'.repeat(32), version: '1.3.4' })).status, 401);
  for (const body of [{ installId: 'short', nonce: await nonce(), version: '1.3.4' }, { installId: install, nonce: 'nope', version: '1.3.4' }, { installId: install, nonce: await nonce(), version: 'x' }, { nonce: await nonce(), version: '1.3.4' }]) {
    assert.equal((await call('POST', '/v1/installs', body)).status, 400);
  }
});

test('installs: launches deduplicate within a minute, versions and stats are tracked, no raw id is exposed', async () => {
  const [a, b] = [id(), id()];
  const beat = async (installId, version, account) => (await call('POST', '/v1/installs', { installId, nonce: await nonce(), version, account })).status;
  const base = (await asAdmin('GET', '/v1/stats')).json.data;
  assert.equal(await beat(a, '1.3.0', 'stats-alice'), 200);
  assert.equal(await beat(a, '1.3.0', 'stats-alice'), 200);
  assert.equal(await beat(b, '1.3.4', 'not a valid name!'), 200, 'an unusable account name does not fail the report');
  const stats = (await asAdmin('GET', '/v1/stats')).json.data;
  assert.ok(stats.users.includes('stats-alice'));
  assert.ok(!stats.users.includes('not a valid name!'));
  assert.equal(stats.installs - base.installs, 2);
  assert.equal(stats.active - base.active, 2);
  assert.equal(stats.launches - base.launches, 2, 'a repeat within 60 s is not a new launch');
  assert.equal(stats.obsolete_active - base.obsolete_active, 1);
  const old = stats.versions.find(r => r.version === '1.3.0');
  assert.deepEqual([old.installs, old.obsolete], [1, true]);
  assert.equal(stats.versions.find(r => r.version === '1.3.4').obsolete, false);
  assert.deepEqual(stats.versions.map(r => r.version), [...stats.versions.map(r => r.version)].sort((x, y) => y.localeCompare(x, undefined, { numeric: true })));
  assert.ok(!JSON.stringify(stats).includes(a));
  assert.equal((await asAdmin('GET', '/v1/versions')).json.data.versions.length, stats.versions.length);
});

test('updates: need a registered install, deduplicate and appear in the history', async () => {
  const install = id();
  const send = async (body) => call('POST', '/v1/updates', { installId: install, nonce: await nonce(), ...body });
  assert.equal((await send({ from: '1.3.4', to: '1.4.0' })).status, 404);
  await call('POST', '/v1/installs', { installId: install, nonce: await nonce(), version: '1.4.0' });
  assert.equal((await send({ from: '1.4.0', to: '1.3.4' })).status, 400, 'downgrades are rejected');
  assert.equal((await send({ from: '1.3.4', to: '1.4.0' })).json.data.recorded, true);
  assert.equal((await send({ from: '1.3.4', to: '1.4.0' })).json.data.recorded, false);
  const history = (await asAdmin('GET', '/v1/updates?limit=5')).json.data.items;
  assert.equal(history.filter(h => h.from_version === '1.3.4' && h.to_version === '1.4.0').length, 1);
  assert.equal(history[0].install.length, 8);
  assert.equal((await asAdmin('GET', '/v1/updates?limit=0')).status, 400);
});

test('an install can only delete its own data, using its secret id', async () => {
  const [mine, other] = [id(), id()];
  for (const installId of [mine, other]) await call('POST', '/v1/installs', { installId, nonce: await nonce(), version: '1.3.4' });
  const before = (await asAdmin('GET', '/v1/stats')).json.data.installs;
  assert.equal((await call('DELETE', '/v1/installs', { installId: mine, nonce: await nonce() })).status, 200);
  assert.equal((await asAdmin('GET', '/v1/stats')).json.data.installs, before - 1);
  assert.equal((await call('DELETE', '/v1/installs', { installId: mine, nonce: await nonce() })).status, 200, 'idempotent');
  assert.equal((await asAdmin('GET', '/v1/stats')).json.data.installs, before - 1, 'the other install is untouched');
});

test('oversized bodies are rejected', async () => {
  const res = await call('POST', '/v1/installs', { installId: id(), nonce: await nonce(), version: '1.3.4', pad: 'x'.repeat(3000) });
  assert.equal(res.status, 413);
});
