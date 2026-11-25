import type { ChangelogEntry } from './changelog';

export type RemoteFeature = 'lens_active' | 'my_api_active';

export interface RemoteConfig {
  lens_active: boolean;
  my_api_active: boolean;
  version: string;
  latest: string;
  /** The CLion plugin ZIP of the same release; absent from older API versions. */
  clion_latest?: string;
  authorized: string[];
  banned: BannedEntry[];
  /** Whole promotions and campuses; absent from older API versions. */
  banned_groups?: BannedGroup[];
  /** OS account names of the admins (exact match); absent from older API versions. */
  admins?: string[];
}

/** What the banned user is told about a ban. */
export interface BanDetail {
  features: RemoteFeature[];
  reason?: string | null;
  /** The admin who decided; null when anonymous. */
  by?: string | null;
  /** When the ban started, in epoch milliseconds. */
  since?: number;
  /** When a temporary ban ends, in epoch milliseconds; null or absent for a permanent ban. */
  until?: number | null;
}

/** An account-name fragment and the features it loses. */
export interface BannedEntry extends BanDetail {
  user: string;
}

/** `user` is the former OS account-name fragment; `uid` is one person, by the id of their OS account. */
export type BanScope = 'user' | 'uid' | 'promotion' | 'campus';

/** One person (`uid`), a whole promotion (`2027` or `cursus:2027`) or campus, and the features it loses. */
export interface BannedGroup extends BanDetail {
  scope: 'uid' | 'promotion' | 'campus';
  value: string;
}

/** Who the signed-in account is, as far as bans are concerned. */
export interface Identity {
  /** Hashed id of the OS account on this machine; known before any sign-in. */
  userId?: string | null;
  promotion: number | null;
  cursus: string | null;
  campus: string | null;
}

/** A ban that applies to this user, and why it does. */
export interface Restriction extends BanDetail {
  scope: BanScope;
  /** The account name, promotion or campus the ban targets. */
  target: string;
}

export interface RemoteStatus {
  installedVersion: string;
  requiredVersion?: string;
  versionMismatch: boolean;
  offline: boolean;
  connectionRefused: boolean;
  restrictedFeatures: RemoteFeature[];
  /** Every ban that applies to this user, for the screens that explain it. */
  restrictions?: Restriction[];
  /** Shows the admin dashboard; the API still requires an admin login. */
  admin?: boolean;
  lensActive: boolean;
  myApiActive: boolean;
  update:
    | 'idle'
    | 'downloading'
    | 'verifying'
    | 'installing'
    | 'installed'
    | 'error';
  updateProgress?: { receivedBytes: number; totalBytes?: number };
  updateError?: string;
  /** What changed between the installed and the required version; only while an update is required. */
  changelog?: { state: 'loading' | 'ready' | 'failed'; entries: ChangelogEntry[] };
  uninstall?: 'uninstalling' | 'uninstalled' | 'error';
  uninstallError?: string;
}

const SEMVER = new RegExp(
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)'
  + '(?:-([\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*))?$',
);
const RELEASE_URL = new RegExp(
  '^https://github\\.com/techneoncode/bananabox-public'
  + '/releases/download/([^/?#]+)/([^/?#]+)$',
);

/**
 * Parses `major.minor.patch` with an optional `-prerelease`. Anything else,
 * including build metadata, throws naming the malformed value.
 */
export function parseSemver(value: string): {
  core: [number, number, number];
  prerelease: string[];
} {
  const match = SEMVER.exec(value);
  if (!match) {
    throw new Error(
      `Invalid version "${value}": expected major.minor.patch, `
      + 'optionally followed by -prerelease.',
    );
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  };
}

/**
 * Orders two versions by semver precedence: negative when `a` is older than
 * `b`, zero when they are equal, positive when `a` is newer. Numbers compare
 * as numbers (`1.10.0` is newer than `1.9.0`).
 */
export function compareVersions(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = left.core[i] - right.core[i];
    if (diff !== 0) return diff;
  }

  if (!left.prerelease.length || !right.prerelease.length) {
    return right.prerelease.length - left.prerelease.length;
  }
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < count; i++) {
    const x = left.prerelease[i];
    const y = right.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;

    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return x.length - y.length || (x < y ? -1 : 1);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Checks that `latest` is the direct HTTPS VSIX asset of the public release
 * tagged `v<version>` and named `bananabox-<version>.vsix`, and returns it.
 */
export function latestUrl(latest: string, version: string): string {
  const match = RELEASE_URL.exec(latest);
  if (!match) {
    throw new Error(
      'Remote latest must be a direct HTTPS URL on github.com under '
      + '/techneoncode/bananabox-public/releases/download/.',
    );
  }
  if (match[1] !== `v${version}`) {
    throw new Error(
      `Remote latest tag "${match[1]}" does not match version ${version} `
      + `(expected v${version}).`,
    );
  }
  if (match[2] !== `bananabox-${version}.vsix`) {
    throw new Error(
      `Remote latest file "${match[2]}" does not match version ${version} `
      + `(expected bananabox-${version}.vsix).`,
    );
  }
  return latest;
}

/**
 * Checks that `value` is the CLion plugin ZIP of the public release tagged
 * `v<version>`, named `bananabox-clion-<version>.zip`. Anything else is dropped:
 * the field is optional and must never disable the VS Code side.
 */
export function clionLatestUrl(value: unknown, version: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = RELEASE_URL.exec(value);
  return match && match[1] === `v${version}` && match[2] === `bananabox-clion-${version}.zip`
    ? value
    : undefined;
}

const isFeature = (value: unknown): value is RemoteFeature =>
  value === 'lens_active' || value === 'my_api_active';

const isBanDetail = (value: Partial<BanDetail> | null): boolean =>
  Array.isArray(value?.features)
  && value.features.length > 0
  && value.features.every(isFeature)
  && (value.reason == null || typeof value.reason === 'string')
  && (value.by == null || typeof value.by === 'string')
  && (value.since === undefined || typeof value.since === 'number')
  && (value.until == null || typeof value.until === 'number');

const isBannedEntry = (value: unknown): value is BannedEntry => {
  const entry = value as Partial<BannedEntry> | null;
  return typeof entry?.user === 'string' && isBanDetail(entry);
};

const isBannedGroup = (value: unknown): value is BannedGroup => {
  const entry = value as Partial<BannedGroup> | null;
  return (entry?.scope === 'uid' || entry?.scope === 'promotion' || entry?.scope === 'campus')
    && typeof entry.value === 'string'
    && isBanDetail(entry);
};

const detail = (entry: BanDetail): BanDetail => ({
  features: [...new Set(entry.features)],
  reason: entry.reason ?? null,
  by: entry.by ?? null,
  ...(entry.since !== undefined && { since: entry.since }),
  ...(entry.until != null && { until: entry.until }),
});

export function parseRemoteConfig(value: unknown): RemoteConfig {
  const config = value as Partial<RemoteConfig> | null;
  if (!config
    || typeof config.lens_active !== 'boolean'
    || typeof config.my_api_active !== 'boolean'
    || typeof config.version !== 'string'
    || typeof config.latest !== 'string'
    || !Array.isArray(config.authorized)
    || !config.authorized.every(user => typeof user === 'string')
    || !Array.isArray(config.banned)
    || !config.banned.every(isBannedEntry)
    || (config.banned_groups !== undefined
      && (!Array.isArray(config.banned_groups)
        || !config.banned_groups.every(isBannedGroup)))
    || (config.admins !== undefined
      && (!Array.isArray(config.admins)
        || !config.admins.every(user => typeof user === 'string')))) {
    throw new Error('Invalid Bananabox remote configuration.');
  }
  parseSemver(config.version);
  latestUrl(config.latest, config.version);
  const clionLatest = clionLatestUrl(config.clion_latest, config.version);

  return {
    lens_active: config.lens_active,
    my_api_active: config.my_api_active,
    version: config.version,
    latest: config.latest,
    ...(clionLatest !== undefined && { clion_latest: clionLatest }),
    authorized: [...config.authorized],
    banned: config.banned.map(entry => ({ user: entry.user, ...detail(entry) })),
    banned_groups: (config.banned_groups ?? []).map(entry => ({
      scope: entry.scope,
      value: entry.value,
      ...detail(entry),
    })),
    admins: [...(config.admins ?? [])],
  };
}

export function matchesUsername(
  username: string,
  fragments: readonly string[] = [],
): boolean {
  return username !== ''
    && fragments.some(fragment =>
      fragment !== '' && username.includes(fragment));
}

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * A promotion ban is `2027` (every cursus) or `cursus:2027`; a campus ban
 * ignores case and accents. Nothing matches before the user has signed in once.
 */
export function matchesGroup(
  group: Pick<BannedGroup, 'scope' | 'value'>,
  identity: Identity,
): boolean {
  if (group.scope === 'uid') return !!identity.userId && identity.userId === group.value;
  if (group.scope === 'campus') {
    return identity.campus !== null && fold(identity.campus) === fold(group.value);
  }
  const [cursus, year] = group.value.includes(':')
    ? group.value.split(':')
    : [null, group.value];
  return identity.promotion !== null
    && String(identity.promotion) === year
    && (cursus === null || fold(identity.cursus ?? '') === fold(cursus));
}

const NO_IDENTITY: Identity = { promotion: null, cursus: null, campus: null };

export function remoteStatus(
  config: RemoteConfig | undefined,
  installedVersion: string,
  username: string,
  offline = false,
  identity: Identity = NO_IDENTITY,
  now = Date.now(),
): RemoteStatus {
  // A temporary ban stops at its end even when the policy comes from the cache.
  const live = (ban: BanDetail) => ban.until == null || ban.until > now;
  const versionMismatch = config !== undefined
    && compareVersions(installedVersion, config.version) < 0;
  const authorized = matchesUsername(username, config?.authorized);
  const restrictions: Restriction[] = [
    ...(config?.banned ?? [])
      .filter(entry => live(entry) && matchesUsername(username, [entry.user]))
      .map(({ user, ...rest }): Restriction => ({ scope: 'user', target: user, ...rest })),
    ...(config?.banned_groups ?? [])
      .filter(group => live(group) && matchesGroup(group, identity))
      .map(({ scope, value, ...rest }): Restriction => ({ scope, target: value, ...rest })),
  ];
  const restrictedFeatures: RemoteFeature[] = [
    ...new Set(restrictions.flatMap(entry => entry.features)),
  ];
  const connectionRefused = restrictedFeatures.length > 0;

  return {
    installedVersion,
    requiredVersion: config?.version,
    versionMismatch,
    offline,
    connectionRefused,
    restrictedFeatures,
    restrictions,
    admin: username !== '' && (config?.admins ?? []).includes(username),
    lensActive: !restrictedFeatures.includes('lens_active')
      && !offline
      && !versionMismatch
      && (authorized || (config?.lens_active ?? true)),
    myApiActive: !restrictedFeatures.includes('my_api_active')
      && !offline
      && !versionMismatch
      && (authorized || (config?.my_api_active ?? true)),
    update: 'idle',
  };
}
