import { parseSemver } from '../domain/remotePolicy';

export const CHANGELOG_MAX_BYTES = 256 * 1024;
const RAW_URL = 'https://raw.githubusercontent.com/techneoncode/bananabox-public';
const TIMEOUT_MS = 10_000;

/** Downloads one CHANGELOG.md; undefined when the file is not there (404). */
async function download(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > CHANGELOG_MAX_BYTES) throw new Error('Changelog too large.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > CHANGELOG_MAX_BYTES) throw new Error('Changelog too large.');
  return new TextDecoder().decode(bytes);
}

/**
 * The CHANGELOG.md of the release tagged `v<version>`, or of `main` when that tag has none.
 * Throws when neither can be read; the caller decides what to show.
 */
export async function fetchChangelog(
  version: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  parseSemver(version);
  const text = (await download(`${RAW_URL}/v${version}/CHANGELOG.md`, fetchImpl, signal))
    ?? (await download(`${RAW_URL}/main/CHANGELOG.md`, fetchImpl, signal));
  if (text === undefined) throw new Error('No CHANGELOG.md for this version.');
  return text;
}
