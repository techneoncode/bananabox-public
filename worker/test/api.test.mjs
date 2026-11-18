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
const admin = (m, p, b) => call(m, p, b, TOKEN);
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

test('responses are uniform JSON and unknown routes or methods are rejected cleanly', async () => {
  const res = await call('GET', '/v1/config');
  assert.equal(res.json.ok, true);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(res.json.data).sort(), ['authorizedUsers', 'bannedFeatures', 'bannedUsers', 'latest', 'lens_active', 'my_api_active', 'version']);
  const missing = await call('GET', '/nope');
  assert.deepEqual([missing.status, missing.json.ok, missing.json.error.code], [404, false, 'not_found']);
  const method = await call('DELETE', '/v1/config');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET');
});

test('admin endpoints require the token', async () => {
  for (const [m, p] of [['GET', '/v1/banned'], ['POST', '/v1/banned'], ['DELETE', '/v1/banned/1'], ['GET', '/v1/authorized'], ['GET', '/v1/policy'], ['PUT', '/v1/policy'], ['GET', '/v1/stats'], ['GET', '/v1/versions'], ['GET', '/v1/updates']]) {
    assert.equal((await call(m, p, m === 'GET' || m === 'DELETE' ? undefined : { name: 'x' })).status, 401, `${m} ${p}`);
    assert.equal((await call(m, p, undefined, 'wrong')).status, 401, `${m} ${p} wrong token`);
  }
});

test('banned and authorized lists: add, duplicate, validate, list, delete, and public config', async () => {
  for (const kind of ['banned', 'authorized']) {
    const added = await admin('POST', `/v1/${kind}`, { name: 'mallory', reason: 'test' });
    assert.equal(added.status, 201);
    assert.equal((await admin('POST', `/v1/${kind}`, { name: 'mallory' })).status, 409);
    for (const name of ['', 'a b', 'x'.repeat(65), 5, undefined]) {
      assert.equal((await admin('POST', `/v1/${kind}`, { name })).status, 400, `name ${name}`);
    }
    assert.equal((await admin('POST', `/v1/${kind}`, { name: 'ok', reason: 'x'.repeat(201) })).status, 400);
    const cfg = (await call('GET', '/v1/config')).json.data;
    assert.ok(cfg[kind === 'banned' ? 'bannedUsers' : 'authorizedUsers'].includes('mallory'));
    assert.equal((await admin('DELETE', `/v1/${kind}/${added.json.data.id}`)).status, 200);
    assert.equal((await admin('DELETE', `/v1/${kind}/${added.json.data.id}`)).status, 404);
    assert.deepEqual((await admin('GET', `/v1/${kind}`)).json.data.items, []);
  }
  assert.equal((await admin('DELETE', '/v1/banned/abc')).status, 404);
});

test('policy: validated like the extension and reflected in the public config', async () => {
  const good = { lens_active: true, my_api_active: false, version: '1.4.0', latest: 'https://github.com/techneoncode/bananabox-public/releases/download/v1.4.0/bananabox-1.4.0.vsix', banned_features: ['lens_active'] };
  const put = await admin('PUT', '/v1/policy', good);
  assert.equal(put.status, 200);
  const cfg = (await call('GET', '/v1/config')).json.data;
  assert.deepEqual([cfg.version, cfg.my_api_active, cfg.bannedFeatures], ['1.4.0', false, ['lens_active']]);
  for (const bad of [{ ...good, version: '1.4' }, { ...good, latest: good.latest.replace('v1.4.0', 'v1.4.1') }, { ...good, latest: 'https://evil.example/x.vsix' }, { ...good, lens_active: 'yes' }, { ...good, banned_features: ['other'] }]) {
    assert.equal((await admin('PUT', '/v1/policy', bad)).status, 400);
  }
  assert.equal((await fetch(BASE + '/v1/policy', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{' })).status, 400);
  await admin('PUT', '/v1/policy', { ...good, version: '1.3.4', latest: good.latest.replaceAll('1.4.0', '1.3.4'), my_api_active: true });
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
  const beat = async (installId, version) => (await call('POST', '/v1/installs', { installId, nonce: await nonce(), version })).status;
  const base = (await admin('GET', '/v1/stats')).json.data;
  assert.equal(await beat(a, '1.3.0'), 200);
  assert.equal(await beat(a, '1.3.0'), 200);
  assert.equal(await beat(b, '1.3.4'), 200);
  const stats = (await admin('GET', '/v1/stats')).json.data;
  assert.equal(stats.installs - base.installs, 2);
  assert.equal(stats.active - base.active, 2);
  assert.equal(stats.launches - base.launches, 2, 'a repeat within 60 s is not a new launch');
  assert.equal(stats.obsolete_active - base.obsolete_active, 1);
  const old = stats.versions.find(r => r.version === '1.3.0');
  assert.deepEqual([old.installs, old.obsolete], [1, true]);
  assert.equal(stats.versions.find(r => r.version === '1.3.4').obsolete, false);
  assert.deepEqual(stats.versions.map(r => r.version), [...stats.versions.map(r => r.version)].sort((x, y) => y.localeCompare(x, undefined, { numeric: true })));
  assert.ok(!JSON.stringify(stats).includes(a));
  assert.equal((await admin('GET', '/v1/versions')).json.data.versions.length, stats.versions.length);
});

test('updates: need a registered install, deduplicate and appear in the history', async () => {
  const install = id();
  const send = async (body) => call('POST', '/v1/updates', { installId: install, nonce: await nonce(), ...body });
  assert.equal((await send({ from: '1.3.4', to: '1.4.0' })).status, 404);
  await call('POST', '/v1/installs', { installId: install, nonce: await nonce(), version: '1.4.0' });
  assert.equal((await send({ from: '1.4.0', to: '1.3.4' })).status, 400, 'downgrades are rejected');
  assert.equal((await send({ from: '1.3.4', to: '1.4.0' })).json.data.recorded, true);
  assert.equal((await send({ from: '1.3.4', to: '1.4.0' })).json.data.recorded, false);
  const history = (await admin('GET', '/v1/updates?limit=5')).json.data.items;
  assert.equal(history.filter(h => h.from_version === '1.3.4' && h.to_version === '1.4.0').length, 1);
  assert.equal(history[0].install.length, 8);
  assert.equal((await admin('GET', '/v1/updates?limit=0')).status, 400);
});

test('an install can only delete its own data, using its secret id', async () => {
  const [mine, other] = [id(), id()];
  for (const installId of [mine, other]) await call('POST', '/v1/installs', { installId, nonce: await nonce(), version: '1.3.4' });
  const before = (await admin('GET', '/v1/stats')).json.data.installs;
  assert.equal((await call('DELETE', '/v1/installs', { installId: mine, nonce: await nonce() })).status, 200);
  assert.equal((await admin('GET', '/v1/stats')).json.data.installs, before - 1);
  assert.equal((await call('DELETE', '/v1/installs', { installId: mine, nonce: await nonce() })).status, 200, 'idempotent');
  assert.equal((await admin('GET', '/v1/stats')).json.data.installs, before - 1, 'the other install is untouched');
});

test('oversized bodies are rejected', async () => {
  const res = await call('POST', '/v1/installs', { installId: id(), nonce: await nonce(), version: '1.3.4', pad: 'x'.repeat(3000) });
  assert.equal(res.status, 413);
});
