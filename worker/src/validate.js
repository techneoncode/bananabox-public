export const FEATURES = ['lens_active', 'my_api_active'];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;
const RELEASE_URL = /^https:\/\/github\.com\/techneoncode\/bananabox-public\/releases\/download\/([^/?#]+)\/([^/?#]+)$/;
const NAME = /^[\w.@$\\-]{1,64}$/;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const NONCE = /^[0-9a-f]{32}$/;

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

export function reason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 200) throw bad('reason must be a string of at most 200 characters.');
  return value;
}

export function installId(value) {
  if (typeof value !== 'string' || !INSTALL_ID.test(value)) throw bad('installId must be 32 lowercase hex characters.');
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
  const features = body.banned_features ?? FEATURES;
  if (!Array.isArray(features) || !features.every(f => FEATURES.includes(f))) {
    throw bad(`banned_features must be an array among ${FEATURES.join(', ')}.`);
  }
  return {
    lens_active: body.lens_active,
    my_api_active: body.my_api_active,
    version,
    latest: body.latest,
    banned_features: [...new Set(features)],
  };
}
