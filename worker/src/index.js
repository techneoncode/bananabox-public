import * as v from './validate.js';
import { HttpError } from './validate.js';
import { ANONYMOUS, LOCK_MS, MAX_FAILURES, SESSION_MS, audit, hashPassword, randomHex, sha256, verifyPassword } from './admin.js';

const DAY = 86_400_000;
const NONCE_TTL_MS = 5 * 60_000;
const NONCE_CAP = 10_000;
const MIN_LAUNCH_GAP_MS = 60_000;
const ACTIVE_MS = 30 * DAY;
const INSTALL_RETENTION_MS = 180 * DAY;
const UPDATE_RETENTION_MS = 365 * DAY;
const AUDIT_RETENTION_MS = 730 * DAY;
const MAX_BODY = 2048;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status, headers: JSON_HEADERS });
const fail = (status, code, message, headers) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers: { ...JSON_HEADERS, ...headers } });


async function isRoot(header, env) {
  if (!env.ADMIN_TOKEN) return false;
  const [given, want] = await Promise.all([sha256(header), sha256(`Bearer ${env.ADMIN_TOKEN}`)]);
  return crypto.subtle.timingSafeEqual(new TextEncoder().encode(given), new TextEncoder().encode(want));
}

/** The Cloudflare admin token is `root`; an admin account authenticates with a session token. */
async function authenticate(request, env) {
  const header = request.headers.get('Authorization') ?? '';
  if (await isRoot(header, env)) return { type: 'root' };
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header);
  if (!match) return null;
  const row = await env.DB.prepare('SELECT a.id, a.email FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(match[1]), Date.now()).first();
  return row ? { type: 'admin', id: row.id, email: row.email } : null;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'payload_too_large', `Body exceeds ${MAX_BODY} bytes.`);
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, 'invalid_json', 'Body must be a JSON object.');
}

/** A nonce is valid once: the DELETE succeeds for exactly one caller. */
async function consumeNonce(env, value) {
  const result = await env.DB.prepare('DELETE FROM nonces WHERE nonce = ? AND expires_at > ?')
    .bind(v.nonce(value), Date.now()).run();
  if (result.meta.changes !== 1) throw new HttpError(401, 'invalid_nonce', 'Nonce is unknown, expired or already used.');
}

const readPolicy = env => env.DB.prepare('SELECT * FROM policy WHERE id = 1').first();

const publicPolicy = row => ({
  lens_active: !!row.lens_active,
  my_api_active: !!row.my_api_active,
  version: row.version,
  latest: row.latest,
});

// Public configuration read by the extension.
async function config(env) {
  const [policy, users] = await Promise.all([
    readPolicy(env),
    env.DB.prepare('SELECT kind, name, features FROM users ORDER BY id').all(),
  ]);
  return {
    ...publicPolicy(policy),
    authorized: users.results.filter(u => u.kind === 'authorized').map(u => u.name),
    banned: users.results.filter(u => u.kind === 'banned').map(u => ({ user: u.name, features: JSON.parse(u.features) })),
  };
}

const entry = row => ({ ...row, features: JSON.parse(row.features) });

function userRoutes(kind) {
  const withFeatures = kind === 'banned';
  const list = async env =>
    ok({ items: (await env.DB.prepare('SELECT id, name, reason, features, created_at FROM users WHERE kind = ? ORDER BY id').bind(kind).all()).results.map(entry) });

  const add = async (request, env, _id, actor) => {
    const body = await readBody(request);
    const name = v.name(body.name);
    const reason = v.reason(body.reason);
    const features = withFeatures ? v.features(body.features) : v.features(undefined);
    const [inserted] = await env.DB.batch([
      env.DB.prepare('INSERT INTO users (kind, name, reason, features, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id, name, reason, features, created_at')
        .bind(kind, name, reason, JSON.stringify(features), Date.now()),
      audit(env, actor, `${kind}.add`, name, { reason, ...(withFeatures && { features }) }, true),
    ]);
    if (!inserted.results.length) throw new HttpError(409, 'conflict', `"${name}" is already in ${kind}.`);
    return ok(entry(inserted.results[0]), 201);
  };

  const find = async (env, id) => {
    const row = await env.DB.prepare('SELECT id, name, reason, features FROM users WHERE kind = ? AND id = ?').bind(kind, Number(id)).first();
    if (!row) throw new HttpError(404, 'not_found', `No ${kind} entry with id ${id}.`);
    return row;
  };

  const remove = async (_request, env, id, actor) => {
    const row = await find(env, id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM users WHERE kind = ? AND id = ?').bind(kind, row.id),
      audit(env, actor, `${kind}.delete`, row.name, { reason: row.reason, features: JSON.parse(row.features) }, true),
    ]);
    return ok({ deleted: row.id });
  };

  // Changes the restricted features and/or the reason of a ban.
  const update = async (request, env, id, actor) => {
    const body = await readBody(request);
    const row = await find(env, id);
    const features = body.features === undefined ? JSON.parse(row.features) : v.features(body.features);
    const reason = body.reason === undefined ? row.reason : v.reason(body.reason);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET features = ?, reason = ? WHERE id = ?').bind(JSON.stringify(features), reason, row.id),
      audit(env, actor, `${kind}.update`, row.name, { from: { features: JSON.parse(row.features), reason: row.reason }, to: { features, reason } }, true),
    ]);
    return ok(entry(await env.DB.prepare('SELECT id, name, reason, features, created_at FROM users WHERE id = ?').bind(row.id).first()));
  };
  return { list, add, remove, update };
}

async function stats(env) {
  const now = Date.now();
  const [policy, rows, totals, accounts] = await Promise.all([
    readPolicy(env),
    env.DB.prepare('SELECT version, COUNT(*) AS installs, SUM(last_seen >= ?) AS active FROM installs GROUP BY version').bind(now - ACTIVE_MS).all(),
    env.DB.prepare('SELECT COUNT(*) AS installs, COALESCE(SUM(launches), 0) AS launches FROM installs').first(),
    env.DB.prepare('SELECT DISTINCT account FROM installs WHERE account IS NOT NULL ORDER BY account').all(),
  ]);
  const versions = rows.results
    .map(r => ({ version: r.version, installs: r.installs, active: r.active ?? 0, obsolete: v.compareVersions(r.version, policy.version) < 0 }))
    .sort((a, b) => v.compareVersions(b.version, a.version));
  const active = versions.reduce((n, r) => n + r.active, 0);
  return {
    current_version: policy.version,
    active_window_days: ACTIVE_MS / DAY,
    installs: totals.installs,
    active,
    inactive: totals.installs - active,
    obsolete_active: versions.filter(r => r.obsolete).reduce((n, r) => n + r.active, 0),
    launches: totals.launches,
    users: accounts.results.map(r => r.account),
    versions,
  };
}

async function heartbeat(request, env) {
  const body = await readBody(request);
  const id = v.installId(body.installId);
  const version = v.semver(body.version, 'version');
  await consumeNonce(env, body.nonce);
  const now = Date.now();
  // SET expressions read the pre-update row: launches only grows after a gap.
  await env.DB.prepare(`INSERT INTO installs (id_hash, first_seen, last_seen, launches, version, account) VALUES (?1, ?2, ?2, 1, ?3, ?5)
    ON CONFLICT (id_hash) DO UPDATE SET
      launches = launches + (excluded.last_seen - last_seen >= ?4),
      last_seen = excluded.last_seen,
      version = excluded.version,
      account = excluded.account`)
    .bind(await sha256(id), now, version, MIN_LAUNCH_GAP_MS, v.account(body.account)).run();
  return ok({ recorded: true });
}

async function forget(request, env) {
  const body = await readBody(request);
  const hash = await sha256(v.installId(body.installId));
  await consumeNonce(env, body.nonce);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM updates WHERE id_hash = ?').bind(hash),
    env.DB.prepare('DELETE FROM installs WHERE id_hash = ?').bind(hash),
  ]);
  return ok({ deleted: true });
}

async function reportUpdate(request, env) {
  const body = await readBody(request);
  const hash = await sha256(v.installId(body.installId));
  const from = v.semver(body.from, 'from');
  const to = v.semver(body.to, 'to');
  if (v.compareVersions(from, to) >= 0) throw v.bad('to must be newer than from.');
  await consumeNonce(env, body.nonce);
  if (!await env.DB.prepare('SELECT 1 FROM installs WHERE id_hash = ?').bind(hash).first()) {
    throw new HttpError(404, 'unknown_install', 'Register the installation first.');
  }
  const result = await env.DB.prepare('INSERT OR IGNORE INTO updates (id_hash, from_version, to_version, at) VALUES (?, ?, ?, ?)')
    .bind(hash, from, to, Date.now()).run();
  return ok({ recorded: result.meta.changes === 1 });
}

async function issueNonce(env) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM nonces WHERE expires_at <= ?').bind(now).run();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM nonces').first();
  if (n >= NONCE_CAP) throw new HttpError(429, 'too_many_nonces', 'Too many pending nonces; retry later.');
  const value = randomHex();
  await env.DB.prepare('INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)').bind(value, now + NONCE_TTL_MS).run();
  return ok({ nonce: value, expires_in: NONCE_TTL_MS / 1000 }, 201);
}

async function putPolicy(request, env, _id, actor) {
  const p = v.policy(await readBody(request));
  const before = publicPolicy(await readPolicy(env));
  await env.DB.batch([
    env.DB.prepare('UPDATE policy SET lens_active = ?, my_api_active = ?, version = ?, latest = ?, updated_at = ? WHERE id = 1')
      .bind(+p.lens_active, +p.my_api_active, p.version, p.latest, Date.now()),
    audit(env, actor, 'policy.update', null, { from: before, to: p }),
  ]);
  return ok(publicPolicy(await readPolicy(env)));
}

async function updateHistory(request, env) {
  const raw = new URL(request.url).searchParams.get('limit');
  const limit = raw === null ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw v.bad('limit must be an integer between 1 and 500.');
  const rows = await env.DB.prepare('SELECT substr(id_hash, 1, 8) AS install, from_version, to_version, at FROM updates ORDER BY id DESC LIMIT ?').bind(limit).all();
  return ok({ items: rows.results });
}

const banned = userRoutes('banned');
const authorized = userRoutes('authorized');

async function login(request, env) {
  const body = await readBody(request);
  const email = v.email(body.email);
  const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
  const now = Date.now();
  const admin = await env.DB.prepare('SELECT * FROM admins WHERE email = ?').bind(email).first();
  const failed = async (action) => {
    await env.DB.batch([
      ...(admin ? [env.DB.prepare('UPDATE admins SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END WHERE id = ?').bind(MAX_FAILURES, now + LOCK_MS, admin.id)] : []),
      audit(env, ANONYMOUS, action, email),
    ]);
  };
  if (admin && admin.locked_until > now) {
    await env.DB.batch([audit(env, ANONYMOUS, 'login.locked', email)]);
    throw new HttpError(429, 'locked', 'Too many failed attempts; try again later.');
  }
  if (!await verifyPassword(password, admin?.password_hash ?? null)) {
    await failed('login.failure');
    throw new HttpError(401, 'invalid_credentials', 'Invalid email or password.');
  }
  const token = randomHex(32);
  const actor = { type: 'admin', id: admin.id, email };
  await env.DB.batch([
    env.DB.prepare('UPDATE admins SET failed_attempts = 0, locked_until = 0, last_login = ? WHERE id = ?').bind(now, admin.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), admin.id, now + SESSION_MS),
    audit(env, actor, 'login.success', email),
  ]);
  return ok({ token, expires_at: now + SESSION_MS, email });
}

async function logout(request, env, _id, actor) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  const stmts = [audit(env, actor, 'logout', actor.email)];
  if (token) stmts.unshift(env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)));
  await env.DB.batch(stmts);
  return ok({ loggedOut: true });
}

async function me(_request, env, _id, actor) {
  return ok(actor.type === 'root' ? { type: 'root' } : { type: 'admin', id: actor.id, email: actor.email });
}

async function changeOwnPassword(request, env, _id, actor) {
  if (actor.type !== 'admin') throw new HttpError(403, 'forbidden', 'Only an admin account has a password; root uses PUT /v1/admins/:id/password.');
  const body = await readBody(request);
  const next = v.password(body.new_password);
  const admin = await env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?').bind(actor.id).first();
  if (!await verifyPassword(typeof body.current_password === 'string' ? body.current_password : '', admin.password_hash)) {
    await env.DB.batch([audit(env, actor, 'password.change_failed', actor.email)]);
    throw new HttpError(401, 'invalid_credentials', 'Current password is incorrect.');
  }
  const current = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '')[1];
  await env.DB.batch([
    env.DB.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), actor.id),
    env.DB.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').bind(actor.id, await sha256(current)),
    audit(env, actor, 'password.change', actor.email),
  ]);
  return ok({ changed: true });
}

const adminRow = 'id, email, created_at, last_login';

async function createAdmin(request, env, _id, actor) {
  const body = await readBody(request);
  const email = v.email(body.email);
  const hash = await hashPassword(v.password(body.password));
  const [inserted] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING ${adminRow}`).bind(email, hash, Date.now()),
    audit(env, actor, 'admin.create', email, null, true),
  ]);
  if (!inserted.results.length) throw new HttpError(409, 'conflict', `An admin with email ${email} already exists.`);
  return ok(inserted.results[0], 201);
}

async function findAdmin(env, id) {
  const row = await env.DB.prepare(`SELECT ${adminRow} FROM admins WHERE id = ?`).bind(Number(id)).first();
  if (!row) throw new HttpError(404, 'not_found', `No admin with id ${id}.`);
  return row;
}

async function deleteAdmin(_request, env, id, actor) {
  const row = await findAdmin(env, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE admin_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(row.id),
    audit(env, actor, 'admin.delete', row.email, null, true),
  ]);
  return ok({ deleted: row.id });
}

async function resetAdminPassword(request, env, id, actor) {
  const row = await findAdmin(env, id);
  const hash = await hashPassword(v.password((await readBody(request)).password));
  await env.DB.batch([
    env.DB.prepare('UPDATE admins SET password_hash = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?').bind(hash, row.id),
    env.DB.prepare('DELETE FROM sessions WHERE admin_id = ?').bind(row.id),
    audit(env, actor, 'admin.password_reset', row.email),
  ]);
  return ok({ reset: true });
}

async function logs(request, env) {
  const q = new URL(request.url).searchParams;
  const limit = q.has('limit') ? Number(q.get('limit')) : 100;
  const before = q.has('before') ? Number(q.get('before')) : Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw v.bad('limit must be an integer between 1 and 500.');
  if (!Number.isInteger(before) || before < 1) throw v.bad('before must be a positive integer.');
  const actor = q.get('actor');
  const rows = await env.DB.prepare(
    `SELECT id, at, actor_type, actor_id, actor_email, action, target, detail FROM audit_log
     WHERE id < ?1 AND (?2 IS NULL OR actor_email = ?2) AND (?3 IS NULL OR action = ?3) ORDER BY id DESC LIMIT ?4`,
  ).bind(before, actor, q.get('action'), limit).all();
  const items = rows.results.map(r => ({ ...r, detail: r.detail && JSON.parse(r.detail) }));
  return ok({ items, next_before: items.length === limit ? items.at(-1).id : null });
}

// [method, pattern, access, handler]. access: public, admin (admin account or root), root (Cloudflare admin token only).
const ROUTES = [
  ['GET', '/v1/config', 'public', (_r, env) => config(env).then(ok)],
  ['POST', '/v1/nonce', 'public', (_r, env) => issueNonce(env)],
  ['POST', '/v1/installs', 'public', heartbeat],
  ['DELETE', '/v1/installs', 'public', forget],
  ['POST', '/v1/updates', 'public', reportUpdate],
  ['POST', '/v1/admin/login', 'public', login],
  ['POST', '/v1/admin/logout', 'admin', logout],
  ['GET', '/v1/admin/me', 'admin', me],
  ['PUT', '/v1/admin/password', 'admin', changeOwnPassword],
  ['GET', '/v1/policy', 'admin', (_r, env) => readPolicy(env).then(r => ok(publicPolicy(r)))],
  ['PUT', '/v1/policy', 'admin', putPolicy],
  ['GET', '/v1/banned', 'admin', (_r, env) => banned.list(env)],
  ['POST', '/v1/banned', 'admin', banned.add],
  ['PUT', '/v1/banned/:id', 'admin', banned.update],
  ['DELETE', '/v1/banned/:id', 'admin', banned.remove],
  ['GET', '/v1/authorized', 'admin', (_r, env) => authorized.list(env)],
  ['POST', '/v1/authorized', 'admin', authorized.add],
  ['DELETE', '/v1/authorized/:id', 'admin', authorized.remove],
  ['GET', '/v1/stats', 'admin', (_r, env) => stats(env).then(ok)],
  ['GET', '/v1/versions', 'admin', (_r, env) => stats(env).then(s => ok({ current_version: s.current_version, versions: s.versions }))],
  ['GET', '/v1/updates', 'admin', updateHistory],
  ['GET', '/v1/admins', 'root', (_r, env) => env.DB.prepare(`SELECT ${adminRow} FROM admins ORDER BY id`).all().then(r => ok({ items: r.results }))],
  ['POST', '/v1/admins', 'root', createAdmin],
  ['DELETE', '/v1/admins/:id', 'root', deleteAdmin],
  ['PUT', '/v1/admins/:id/password', 'root', resetAdminPassword],
  ['GET', '/v1/logs', 'root', logs],
];

function match(method, path) {
  const allowed = new Set();
  for (const route of ROUTES) {
    const m = new RegExp(`^${route[1].replace(':id', '(\\d{1,12})')}$`).exec(path);
    if (!m) continue;
    if (route[0] === method) return { route, id: m[1] };
    allowed.add(route[0]);
  }
  return { allowed: [...allowed] };
}

export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      const hit = match(request.method, pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname);
      if (!hit.route) {
        return hit.allowed.length
          ? fail(405, 'method_not_allowed', 'Method not allowed.', { Allow: hit.allowed.join(', ') })
          : fail(404, 'not_found', 'Unknown endpoint.');
      }
      const [, , access, handler] = hit.route;
      let actor = ANONYMOUS;
      if (access !== 'public') {
        actor = await authenticate(request, env);
        if (!actor) return fail(401, 'unauthorized', 'Authentication required.', { 'WWW-Authenticate': 'Bearer' });
        if (access === 'root' && actor.type !== 'root') return fail(403, 'forbidden', 'Only the Cloudflare admin token can do this.');
      }
      return await handler(request, env, hit.id, actor);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.code, error.message);
      console.error(error);
      return fail(500, 'internal', 'Internal error.');
    }
  },

  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM nonces WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM installs WHERE last_seen < ?').bind(now - INSTALL_RETENTION_MS),
      env.DB.prepare('DELETE FROM updates WHERE at < ? OR id_hash NOT IN (SELECT id_hash FROM installs)').bind(now - UPDATE_RETENTION_MS),
      env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(now - AUDIT_RETENTION_MS),
    ]);
  },
};
