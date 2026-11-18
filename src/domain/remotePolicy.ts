export type RemoteFeature = 'lens_active' | 'my_api_active';

export interface RemoteConfig {
  lens_active: boolean;
  my_api_active: boolean;
  version: string;
  latest: string;
  authorized: string[];
  banned: BannedEntry[];
  /** OS account names of the admins (exact match); absent from older API versions. */
  admins?: string[];
}

/** An account-name fragment and the features it loses. */
export interface BannedEntry {
  user: string;
  features: RemoteFeature[];
}

export interface RemoteStatus {
  installedVersion: string;
  requiredVersion?: string;
  versionMismatch: boolean;
  offline: boolean;
  connectionRefused: boolean;
  restrictedFeatures: RemoteFeature[];
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

const isFeature = (value: unknown): value is RemoteFeature =>
  value === 'lens_active' || value === 'my_api_active';

const isBannedEntry = (value: unknown): value is BannedEntry => {
  const entry = value as Partial<BannedEntry> | null;
  return typeof entry?.user === 'string'
    && Array.isArray(entry.features)
    && entry.features.length > 0
    && entry.features.every(isFeature);
};

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
    || (config.admins !== undefined
      && (!Array.isArray(config.admins)
        || !config.admins.every(user => typeof user === 'string')))) {
    throw new Error('Invalid Bananabox remote configuration.');
  }
  parseSemver(config.version);
  latestUrl(config.latest, config.version);

  return {
    lens_active: config.lens_active,
    my_api_active: config.my_api_active,
    version: config.version,
    latest: config.latest,
    authorized: [...config.authorized],
    banned: config.banned.map(entry => ({
      user: entry.user,
      features: [...new Set(entry.features)],
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

export function remoteStatus(
  config: RemoteConfig | undefined,
  installedVersion: string,
  username: string,
  offline = false,
): RemoteStatus {
  const versionMismatch = config !== undefined
    && compareVersions(installedVersion, config.version) < 0;
  const authorized = matchesUsername(username, config?.authorized);
  const restrictedFeatures: RemoteFeature[] = [...new Set(
    (config?.banned ?? [])
      .filter(entry => matchesUsername(username, [entry.user]))
      .flatMap(entry => entry.features),
  )];
  const connectionRefused = restrictedFeatures.length > 0;

  return {
    installedVersion,
    requiredVersion: config?.version,
    versionMismatch,
    offline,
    connectionRefused,
    restrictedFeatures,
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
