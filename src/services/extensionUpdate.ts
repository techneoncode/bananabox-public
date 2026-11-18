import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import * as vscode from 'vscode';
import { tr } from '../util/text';

/**
 * Entries of a VSIX (zip) whose name passes `wanted`, read from the ZIP
 * directory, each at most `maxSize` bytes.
 */
function vsixEntries(
  bytes: Buffer,
  wanted: (name: string) => boolean,
  maxSize: number,
): Map<string, Buffer> {
  let end = bytes.length - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < minimum
    || bytes.readUInt16LE(end + 20) !== bytes.length - end - 22) {
    throw new Error(tr('Invalid VSIX archive.'));
  }

  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const found = new Map<string, Buffer>();
  for (let idx = 0; idx < count; idx++) {
    if (offset + 46 > end
      || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(tr('Invalid VSIX directory.'));
    }
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    const local = bytes.readUInt32LE(offset + 42);
    if (wanted(name)) {
      if (local + 30 > bytes.length
        || bytes.readUInt32LE(local) !== 0x04034b50) {
        throw new Error(tr('Invalid VSIX entry {p0}.', { p0: name }));
      }
      const start = local + 30
        + bytes.readUInt16LE(local + 26)
        + bytes.readUInt16LE(local + 28);
      if (start + size > bytes.length
        || (method !== 0 && method !== 8)) {
        throw new Error(tr('Invalid VSIX compression for {p0}.', { p0: name }));
      }
      const compressed = bytes.subarray(start, start + size);
      const content = method === 8
        ? inflateRawSync(compressed, { maxOutputLength: maxSize })
        : compressed;
      if (content.length > maxSize) {
        throw new Error(`VSIX entry ${name} too large.`);
      }
      found.set(name, content);
    }
    offset += 46 + nameLength
      + bytes.readUInt16LE(offset + 30)
      + bytes.readUInt16LE(offset + 32);
  }
  return found;
}

export function validateVsix(
  bytes: Buffer,
  extensionId: string,
  version: string,
): void {
  const content = vsixEntries(
    bytes,
    name => name === 'extension/package.json',
    1024 * 1024,
  ).get('extension/package.json');
  if (!content) {
    throw new Error(tr('The VSIX does not contain extension/package.json.'));
  }
  const manifest = JSON.parse(content.toString('utf8'));
  if (`${manifest.publisher}.${manifest.name}` !== extensionId
    || manifest.version !== version) {
    throw new Error(tr('The VSIX extension identity or version does not match the remote configuration.'));
  }
}

export interface ExtensionUpdateProgress {
  stage: 'downloading' | 'verifying' | 'installing';
  receivedBytes: number;
  totalBytes?: number;
}

/**
 * Downloads the VSIX at `latest` (HTTPS redirects only), checks that it
 * identifies `extensionId` at `version`, then installs it through VS Code.
 */
export async function downloadAndInstall(
  latest: string,
  version: string,
  extensionId: string,
  signal: AbortSignal,
  onProgress?: (progress: ExtensionUpdateProgress) => void,
): Promise<void> {
  let url = new URL(latest);
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetch(url, { redirect: 'manual', signal: timeout });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 5) {
      throw new Error(tr('Invalid VSIX download redirect.'));
    }
    url = new URL(location, url);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error(tr('VSIX redirects must use HTTPS.'));
    }
  }
  if (!response?.ok || !response.body) {
    throw new Error(`VSIX download failed: HTTP ${response?.status}.`);
  }

  const chunks: Buffer[] = [];
  let length = 0;
  const maxSize = 100 * 1024 * 1024;
  const contentLength = Number(response.headers.get('content-length'));
  const totalBytes = Number.isSafeInteger(contentLength)
    && contentLength > 0
    && !response.headers.get('content-encoding')
    ? contentLength
    : undefined;
  const report = (stage: ExtensionUpdateProgress['stage']) => {
    onProgress?.({ stage, receivedBytes: length, totalBytes });
  };

  let lastReport = Date.now();
  report('downloading');
  for await (
    const chunk of response.body as unknown as AsyncIterable<Uint8Array>
  ) {
    length += chunk.byteLength;
    if (length > maxSize) {
      await response.body.cancel().catch(() => undefined);
      throw new Error(tr('VSIX exceeds 100 MiB.'));
    }
    chunks.push(Buffer.from(chunk));
    if (Date.now() - lastReport >= 100) {
      report('downloading');
      lastReport = Date.now();
    }
  }
  report('downloading');

  const bytes = Buffer.concat(chunks);
  timeout.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'bananabox-update-'));
  try {
    const path = join(directory, 'update.vsix');
    await writeFile(path, bytes, { mode: 0o600 });
    report('verifying');
    validateVsix(bytes, extensionId, version);
    timeout.throwIfAborted();
    report('installing');
    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      vscode.Uri.file(path),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
