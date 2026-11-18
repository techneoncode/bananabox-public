import * as v from './validate.js';
import { HttpError } from './validate.js';

const DAY = 86_400_000;
const NONCE_TTL_MS = 5 * 60_000;
const NONCE_CAP = 10_000;
const MIN_LAUNCH_GAP_MS = 60_000;
const ACTIVE_MS = 30 * DAY;
const INSTALL_RETENTION_MS = 180 * DAY;
const UPDATE_RETENTION_MS = 365 * DAY;
const MAX_BODY = 2048;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status, headers: JSON_HEADERS });
const fail = (status, code, message, headers) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers: { ...JSON_HEADERS, ...headers } });

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const [given, want] = await Promise.all([
    sha256(request.headers.get('Authorization') ?? ''),
    sha256(`Bearer ${env.ADMIN_TOKEN}`),
  ]);
  return crypto.subtle.timingSafeEqual(new TextEncoder().encode(given), new TextEncoder().encode(want));
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
  banned_features: JSON.parse(row.banned_features),
});

// Public configuration read by the extension: same fields it always parsed.
async function config(env) {
  const [policy, users] = await Promise.all([
    readPolicy(env),
    env.DB.prepare('SELECT kind, name FROM users ORDER BY id').all(),
  ]);
  const names = kind => users.results.filter(u => u.kind === kind).map(u => u.name);
  const { banned_features, ...rest } = publicPolicy(policy);
  return {
    ...rest,
    authorizedUsers: names('authorized'),
    bannedUsers: names('banned'),
    bannedFeatures: banned_features,
  };
}

function userRoutes(kind) {
  const list = async env =>
    ok({ items: (await env.DB.prepare('SELECT id, name, reason, created_at FROM users WHERE kind = ? ORDER BY id').bind(kind).all()).results });
  const add = async (request, env) => {
    const body = await readBody(request);
    const entry = { name: v.name(body.name), reason: v.reason(body.reason) };
    const row = await env.DB.prepare('INSERT INTO users (kind, name, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id, name, reason, created_at')
      .bind(kind, entry.name, entry.reason, Date.now()).first();
    if (!row) throw new HttpError(409, 'conflict', `"${entry.name}" is already in ${kind}.`);
    return ok(row, 201);
  };
  const remove = async (_request, env, id) => {
    const result = await env.DB.prepare('DELETE FROM users WHERE kind = ? AND id = ?').bind(kind, Number(id)).run();
    if (result.meta.changes !== 1) throw new HttpError(404, 'not_found', `No ${kind} entry with id ${id}.`);
    return ok({ deleted: Number(id) });
  };
  return { list, add, remove };
}

async function stats(env) {
  const now = Date.now();
  const [policy, rows, totals] = await Promise.all([
    readPolicy(env),
    env.DB.prepare('SELECT version, COUNT(*) AS installs, SUM(last_seen >= ?) AS active FROM installs GROUP BY version').bind(now - ACTIVE_MS).all(),
    env.DB.prepare('SELECT COUNT(*) AS installs, COALESCE(SUM(launches), 0) AS launches FROM installs').first(),
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
  await env.DB.prepare(`INSERT INTO installs (id_hash, first_seen, last_seen, launches, version) VALUES (?1, ?2, ?2, 1, ?3)
    ON CONFLICT (id_hash) DO UPDATE SET
      launches = launches + (excluded.last_seen - last_seen >= ?4),
      last_seen = excluded.last_seen,
      version = excluded.version`)
    .bind(await sha256(id), now, version, MIN_LAUNCH_GAP_MS).run();
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

async function putPolicy(request, env) {
  const p = v.policy(await readBody(request));
  await env.DB.prepare('UPDATE policy SET lens_active = ?, my_api_active = ?, version = ?, latest = ?, banned_features = ?, updated_at = ? WHERE id = 1')
    .bind(+p.lens_active, +p.my_api_active, p.version, p.latest, JSON.stringify(p.banned_features), Date.now()).run();
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

// [method, pattern, admin-only, handler]
const ROUTES = [
  ['GET', '/v1/config', false, (_r, env) => config(env).then(ok)],
  ['POST', '/v1/nonce', false, (_r, env) => issueNonce(env)],
  ['POST', '/v1/installs', false, heartbeat],
  ['DELETE', '/v1/installs', false, forget],
  ['POST', '/v1/updates', false, reportUpdate],
  ['GET', '/v1/policy', true, (_r, env) => readPolicy(env).then(r => ok(publicPolicy(r)))],
  ['PUT', '/v1/policy', true, putPolicy],
  ['GET', '/v1/banned', true, (_r, env) => banned.list(env)],
  ['POST', '/v1/banned', true, banned.add],
  ['DELETE', '/v1/banned/:id', true, banned.remove],
  ['GET', '/v1/authorized', true, (_r, env) => authorized.list(env)],
  ['POST', '/v1/authorized', true, authorized.add],
  ['DELETE', '/v1/authorized/:id', true, authorized.remove],
  ['GET', '/v1/stats', true, (_r, env) => stats(env).then(ok)],
  ['GET', '/v1/versions', true, (_r, env) => stats(env).then(s => ok({ current_version: s.current_version, versions: s.versions }))],
  ['GET', '/v1/updates', true, updateHistory],
];

function match(method, path) {
  const allowed = new Set();
  for (const route of ROUTES) {
    const pattern = new RegExp(`^${route[1].replace(':id', '(\\d{1,12})')}$`);
    const m = pattern.exec(path);
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
      const [, , adminOnly, handler] = hit.route;
      if (adminOnly && !await isAdmin(request, env)) {
        return fail(401, 'unauthorized', 'Admin token required.', { 'WWW-Authenticate': 'Bearer' });
      }
      return await handler(request, env, hit.id);
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
      env.DB.prepare('DELETE FROM installs WHERE last_seen < ?').bind(now - INSTALL_RETENTION_MS),
      env.DB.prepare('DELETE FROM updates WHERE at < ? OR id_hash NOT IN (SELECT id_hash FROM installs)').bind(now - UPDATE_RETENTION_MS),
    ]);
  },
};
