export const FEATURES = ['lens_active', 'my_api_active'];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;
const RELEASE_URL = /^https:\/\/github\.com\/techneoncode\/bananabox-public\/releases\/download\/([^/?#]+)\/([^/?#]+)$/;
const NAME = /^[\w.@$\\-]{1,64}$/;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const NONCE = /^[0-9a-f]{32}$/;
const EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@epitech\.eu$/;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = message => new HttpError(400, 'invalid_request', message);

export function semver(value, field) {
  const match = typeof value === 'string' && SEMVER.exec(value);
  if (!match) throw bad(`${field} must be major.minor.patch with an optional -prerelease.`);
  return value;
}

/** Numeric semver precedence; prereleases sort before their release. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map(v => SEMVER.exec(v));
  for (let i = 1; i <= 3; i++) if (x[i] !== y[i]) return Number(x[i]) - Number(y[i]);
  if (!x[4] || !y[4]) return (y[4] ? 1 : 0) - (x[4] ? 1 : 0);
  const [p, q] = [x[4].split('.'), y[4].split('.')];
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined || q[i] === undefined) return p[i] === undefined ? -1 : 1;
    if (p[i] === q[i]) continue;
    const [pn, qn] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    if (pn && qn) return Number(p[i]) - Number(q[i]);
    if (pn !== qn) return pn ? -1 : 1;
    return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

export function name(value) {
  if (typeof value !== 'string' || !NAME.test(value)) {
    throw bad('name must be 1-64 characters among letters, digits, _ . @ $ \\ -.');
  }
  return value;
}

/** An OS account name, matched exactly by the extension: same alphabet as a ban name. */
export function whoami(value) {
  if (typeof value !== 'string' || !NAME.test(value)) {
    throw bad('whoami must be 1-64 characters among letters, digits, _ . @ $ \\ -.');
  }
  return value;
}

export function reason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 200) throw bad('reason must be a string of at most 200 characters.');
  return value;
}

export function installId(value) {
  if (typeof value !== 'string' || !INSTALL_ID.test(value)) throw bad('installId must be 32 lowercase hex characters.');
  return value;
}

/** Optional: a name the ban list could not hold is dropped instead of failing the whole report. */
export function account(value) {
  return typeof value === 'string' && NAME.test(value) ? value : null;
}

export const SCOPES = ['user', 'uid', 'promotion', 'campus'];
const USER_ID = /^[0-9a-f]{32}$/;
const FIRST_NAME = /^[\p{L}][\p{L}' -]{0,39}$/u;
const INITIAL = /^\p{Lu}$/u;
const PROMOTION = /^(?:[a-z][a-z0-9-]{0,31}:)?\d{4}$/;
const CAMPUS = /^[\p{L}][\p{L} '-]{0,63}$/u;
const CURSUS = /^[A-Za-z][\w-]{0,31}$/;

export function scope(value) {
  if (value === undefined) return 'user';
  if (!SCOPES.includes(value)) throw bad(`scope must be one of ${SCOPES.join(', ')}.`);
  return value;
}

/** The target of a ban, checked against the alphabet of its scope. A campus keeps the case it was typed in. */
export function target(kind, value) {
  if (kind === 'user') return name(value);
  if (kind === 'uid') {
    if (typeof value !== 'string' || !USER_ID.test(value)) throw bad('a uid ban needs the 32 lowercase hex characters of the user id.');
    return value;
  }
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (kind === 'promotion' && PROMOTION.test(text.toLowerCase())) return text.toLowerCase();
  if (kind === 'campus' && CAMPUS.test(text)) return text;
  throw bad(kind === 'promotion' ? 'promotion must be a year such as 2027, or cursus:year.' : 'campus must be 1-64 letters, spaces, apostrophes or hyphens.');
}

/** Optional: whatever is unusable is dropped instead of failing the whole report. */
export function identity(body) {
  const campus = typeof body.campus === 'string' ? body.campus.trim() : '';
  const first = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const initial = typeof body.lastInitial === 'string' ? body.lastInitial.trim().toUpperCase() : '';
  return {
    userId: typeof body.userId === 'string' && USER_ID.test(body.userId) ? body.userId : null,
    firstName: FIRST_NAME.test(first) ? first : null,
    lastInitial: INITIAL.test(initial) ? initial : null,
    promotion: Number.isInteger(body.promotion) && body.promotion >= 1990 && body.promotion <= 2100 ? body.promotion : null,
    cursus: typeof body.cursus === 'string' && CURSUS.test(body.cursus) ? body.cursus : null,
    campus: CAMPUS.test(campus) ? campus : null,
  };
}

/** The dashboard's name for a ban: admin-only, so it is free text. */
export function label(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 64) throw bad('label must be a string of at most 64 characters.');
  return value;
}

/** Hides the name of the admin who banned from the banned user. */
export function anonymous(value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw bad('anonymous must be a boolean.');
  return value;
}

export function nonce(value) {
  if (typeof value !== 'string' || !NONCE.test(value)) throw bad('nonce must be 32 lowercase hex characters.');
  return value;
}

export function policy(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object.');
  for (const key of ['lens_active', 'my_api_active']) {
    if (typeof body[key] !== 'boolean') throw bad(`${key} must be a boolean.`);
  }
  const version = semver(body.version, 'version');
  const match = typeof body.latest === 'string' && RELEASE_URL.exec(body.latest);
  if (!match || match[1] !== `v${version}` || match[2] !== `bananabox-${version}.vsix`) {
    throw bad('latest must be https://github.com/techneoncode/bananabox-public/releases/download/v<version>/bananabox-<version>.vsix.');
  }
  return {
    lens_active: body.lens_active,
    my_api_active: body.my_api_active,
    version,
    latest: body.latest,
  };
}

export function email(value) {
  const lower = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL.test(lower)) throw bad('email must be an @epitech.eu address.');
  return lower;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw bad('password must be 12 to 128 characters.');
  }
  return value;
}

/** Features a banned account loses; defaults to every feature. */
export function features(value) {
  if (value === undefined) return [...FEATURES];
  if (!Array.isArray(value) || value.length === 0 || !value.every(f => FEATURES.includes(f))) {
    throw bad(`features must be a non-empty array among ${FEATURES.join(', ')}.`);
  }
  return [...new Set(value)];
}
