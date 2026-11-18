import { HttpError } from './validate.js';

// shortcut: 100k is Workers' PBKDF2 maximum; raise via the stored iteration count if that limit moves.
const ITERATIONS = 100_000;
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
export const SESSION_MS = 12 * 3_600_000;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g) ?? [], h => parseInt(h, 16));
export const randomHex = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${hex(await derive(password, salt, ITERATIONS))}`;
}

const DUMMY = `pbkdf2$${ITERATIONS}$${'00'.repeat(16)}$${'00'.repeat(32)}`;

/** Always derives a hash, even for an unknown account, so timing does not reveal which emails exist. */
export async function verifyPassword(password, stored) {
  const [, iterations, salt, expected] = (stored ?? DUMMY).split('$');
  const actual = await derive(password, unhex(salt), Number(iterations));
  const same = crypto.subtle.timingSafeEqual(actual, unhex(expected));
  return stored !== null && stored !== undefined && same;
}

export function audit(env, actor, action, target = null, detail = null, onlyIfChanged = false) {
  return env.DB.prepare(
    `INSERT INTO audit_log (at, actor_type, actor_id, actor_email, action, target, detail)
     SELECT ?, ?, ?, ?, ?, ?, ? ${onlyIfChanged ? 'WHERE changes() > 0' : ''}`,
  ).bind(Date.now(), actor.type, actor.id ?? null, actor.email ?? null, action, target, detail === null ? null : JSON.stringify(detail));
}

export const ANONYMOUS = { type: 'anonymous' };

export { HttpError };
