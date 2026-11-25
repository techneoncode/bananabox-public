import { inflateRawSync } from 'node:zlib';
import * as vscode from 'vscode';
import { compareVersions } from '../domain/remotePolicy';
import type { ReleaseStep } from '../shared/adminTypes';
import { vsixManifest } from './extensionUpdate';

const REPO = 'techneoncode/bananabox-public';
const EXTENSION_ID = 'techneoncode.bananabox';
const WRITE_ROLES = ['admin', 'maintain', 'write'];

export class ReleaseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function github(token: string, method: string, url: string, body?: unknown, raw?: Buffer): Promise<any> {
  const response = await fetch(url.startsWith('https://') ? url : `https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: raw ? new Uint8Array(raw) : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(raw ? 300_000 : 20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ReleaseError('github', `GitHub ${method} ${url.split('?')[0]}: ${response.status} ${detail?.message ?? ''}`.trim());
  }
  return response.status === 204 ? {} : response.json();
}

/** The first entry whose name passes `wanted`, read from the ZIP directory (stored or deflated). */
function zipEntry(zip: Buffer, wanted: (name: string) => boolean): Buffer | undefined {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (wanted(name)) {
      const local = zip.readUInt32LE(offset + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + zip.readUInt32LE(offset + 20));
      const method = zip.readUInt16LE(offset + 10);
      if (method !== 0 && method !== 8) throw new Error(`unsupported compression ${method}`);
      return method === 8 ? inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : data;
    }
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  return undefined;
}

/** The CLion ZIP holds the plugin jar (`<plugin>/lib/*.jar`), whose root carries META-INF/plugin.xml. */
function assertClionZip(zip: Buffer, version: string): void {
  let valid = false;
  try {
    const jar = zipEntry(zip, name => /(^|\/)lib\/[^/]+\.jar$/.test(name));
    valid = !!jar && !!zipEntry(jar, name => name === 'META-INF/plugin.xml');
  } catch {
    valid = false;
  }
  if (!valid) throw new ReleaseError('not_clion', `bananabox-clion-${version}.zip is not a CLion plugin ZIP.`);
}

export interface PublishedRelease {
  version: string;
  url: string;
  latest: string;
}

/**
 * Publishes a VSIX as release `v<version>` with the GitHub account signed in to VS Code, which must be able to push
 * to the repository. `apply` then points the API at it; api.json follows for the versions that still read it.
 */
export async function publishRelease(
  bytes: Buffer,
  notes: string,
  currentVersion: string,
  apply: (version: string, latest: string, clionLatest: string | null) => Promise<unknown>,
  step: (step: ReleaseStep, version?: string) => void,
  clionBytes?: Buffer,
): Promise<PublishedRelease> {
  step('reading');
  const manifest = vsixManifest(bytes);
  const version = manifest.version ?? '';
  if (`${manifest.publisher}.${manifest.name}` !== EXTENSION_ID || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ReleaseError('not_bananabox', 'This VSIX is not a Bananabox release.');
  }
  if (compareVersions(version, currentVersion) <= 0) {
    throw new ReleaseError('not_newer', `Version ${version} is not newer than ${currentVersion}.`);
  }
  if (clionBytes) assertClionZip(clionBytes, version);

  step('account', version);
  const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
  const token = session.accessToken;
  const access = await github(token, 'GET', `/collaborators/${encodeURIComponent(session.account.label)}/permission`).catch(() => null);
  if (!access || !WRITE_ROLES.includes(access.role_name ?? access.permission)) {
    throw new ReleaseError('not_contributor', `${session.account.label} cannot push to ${REPO}.`);
  }
  if (await github(token, 'GET', `/releases/tags/v${version}`)) {
    throw new ReleaseError('release_exists', `Release v${version} already exists.`);
  }

  step('creating', version);
  const release = await github(token, 'POST', '/releases', {
    tag_name: `v${version}`,
    target_commitish: 'main',
    name: `Bananabox ${version}`,
    ...(notes.trim() ? { body: notes.trim() } : { generate_release_notes: true }),
  });

  step('uploading', version);
  const name = `bananabox-${version}.vsix`;
  const clionName = `bananabox-clion-${version}.zip`;
  let asset: any;
  let clionAsset: any;
  try {
    asset = await github(token, 'POST', `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${name}`, undefined, bytes);
    if (clionBytes) {
      clionAsset = await github(token, 'POST', `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${clionName}`, undefined, clionBytes);
    }
  } catch (error) {
    // A release without its VSIX would break every automatic update: take it back.
    await github(token, 'DELETE', `/releases/${release.id}`).catch(() => undefined);
    await github(token, 'DELETE', `/git/refs/tags/v${version}`).catch(() => undefined);
    throw error;
  }
  const latest = asset?.browser_download_url ?? `https://github.com/${REPO}/releases/download/v${version}/${name}`;
  // Without a CLion ZIP in this release the policy must not keep the previous one.
  const clionLatest = clionBytes ? clionAsset?.browser_download_url ?? `https://github.com/${REPO}/releases/download/v${version}/${clionName}` : null;

  step('policy', version);
  await apply(version, latest, clionLatest);

  step('apiJson', version);
  const file = await github(token, 'GET', '/contents/api.json?ref=main');
  if (file?.content) {
    const text = Buffer.from(file.content, 'base64').toString('utf8')
      .replace(/("version":\s*)"[^"]*"/, `$1"${version}"`)
      .replace(/("latest":\s*)"[^"]*"/, `$1"${latest}"`)
      .replace(/("clion_latest":\s*)(?:null|"[^"]*")/, `$1${clionLatest ? `"${clionLatest}"` : 'null'}`);
    await github(token, 'PUT', '/contents/api.json', {
      message: `release: ${version}`,
      content: Buffer.from(text).toString('base64'),
      sha: file.sha,
      branch: 'main',
    });
  }
  return { version, url: release.html_url, latest };
}
