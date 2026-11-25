import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import * as vscode from 'vscode';
import { publishRelease } from '../services/releasePublisher';

function vsix(manifest: object): Buffer {
  const name = Buffer.from('extension/package.json');
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(manifest)));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(compressed.length, 20); directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, directory, name, end]);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiJson = '{\n  "lens_active": true,\n  "version": "1.4.1",\n  "latest": "https://old",\n  "clion_latest": null,\n  "bannedFeatures": ["lens_active"]\n}\n';

const CLION_URL = 'https://github.com/techneoncode/bananabox-public/releases/download/v1.5.0/bananabox-clion-1.5.0.zip';
/** A ZIP of the given entries, deflated, with a central directory (the shape GitHub and the reader expect). */
function zipOf(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [entry, content] of Object.entries(files)) {
    const name = Buffer.from(entry), data = deflateRawSync(content);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    parts.push(local, name, data); central.push(directory, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
const clionZip = () => zipOf({ 'bananabox/lib/bananabox.jar': zipOf({ 'META-INF/plugin.xml': Buffer.from('<idea-plugin/>'), 'com/x/A.class': Buffer.from('bytes') }) });
async function scenario(role: string, uploadStatus = 201, clion?: Buffer) {
  const calls: string[] = [];
  let written = '';
  const original = globalThis.fetch;
  Object.assign(vscode.authentication, { getSession: async () => ({ accessToken: 'gho_x', account: { label: 'me' } }) });
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push(`${method} ${url.replace('https://api.github.com/repos/techneoncode/bananabox-public', '').replace(/\?.*/, '')}`);
    if (url.includes('/permission')) return json({ role_name: role, permission: role });
    if (url.includes('/releases/tags/')) return json({ message: 'Not Found' }, 404);
    if (url.endsWith('/releases') && method === 'POST') return json({ id: 7, html_url: 'https://github.com/r/v1.5.0' }, 201);
    if (url.includes('uploads.github.com')) {
      const asset = url.includes('name=bananabox-clion-') ? CLION_URL : 'https://github.com/techneoncode/bananabox-public/releases/download/v1.5.0/bananabox-1.5.0.vsix';
      return uploadStatus === 201 ? json({ browser_download_url: asset }, 201) : json({ message: 'boom' }, uploadStatus);
    }
    if (url.includes('/contents/api.json') && method === 'GET') return json({ sha: 'abc', content: Buffer.from(apiJson).toString('base64') });
    if (url.includes('/contents/api.json') && method === 'PUT') { written = Buffer.from(JSON.parse(String(init!.body)).content, 'base64').toString(); return json({}); }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const policy: string[] = [];
  try {
    const result = await publishRelease(vsix({ publisher: 'techneoncode', name: 'bananabox', version: '1.5.0' }), '', '1.4.1',
      async (version, latest, clionLatest) => { policy.push(`${version} ${latest} ${clionLatest}`); }, () => {}, clion).catch((e: Error & { code?: string }) => e);
    return { result, calls, written, policy };
  } finally {
    globalThis.fetch = original;
  }
}

test('a contributor publishes the VSIX, then the API and api.json point to it', async () => {
  const { result, written, policy } = await scenario('write');
  assert.equal((result as { version: string }).version, '1.5.0');
  assert.deepEqual(policy, ['1.5.0 https://github.com/techneoncode/bananabox-public/releases/download/v1.5.0/bananabox-1.5.0.vsix null']);
  assert.match(written, /"version": "1\.5\.0"/);
  assert.match(written, /"clion_latest": null/, 'without a ZIP the policy and api.json drop the previous one');
  assert.match(written, /"bannedFeatures": \["lens_active"\]/, 'the rest of api.json keeps its layout');
});
test('a CLion ZIP is uploaded with the VSIX and pointed to by the policy and api.json', async () => {
  const { result, written, policy } = await scenario('write', 201, clionZip());
  assert.equal((result as { version: string }).version, '1.5.0');
  assert.deepEqual(policy, [`1.5.0 https://github.com/techneoncode/bananabox-public/releases/download/v1.5.0/bananabox-1.5.0.vsix ${CLION_URL}`]);
  assert.match(written, new RegExp(`"clion_latest": "${CLION_URL.replace(/[.]/g, '\\.')}"`));
});
test('a ZIP that is not a CLion plugin is refused before anything reaches GitHub', async () => {
  const { result, calls } = await scenario('write', 201, zipOf({ 'readme.txt': Buffer.from('hi') }));
  assert.equal((result as { code?: string }).code, 'not_clion');
  assert.deepEqual(calls, []);
});

test('only accounts that can push may publish, and a failed upload takes the release back', async () => {
  const reader = await scenario('read');
  assert.equal((reader.result as { code?: string }).code, 'not_contributor');
  assert.equal(reader.calls.some(c => c.startsWith('POST')), false);

  const failed = await scenario('write', 500);
  assert.ok(failed.result instanceof Error);
  assert.ok(failed.calls.includes('DELETE /releases/7'));
  assert.ok(failed.calls.includes('DELETE /git/refs/tags/v1.5.0'));
  assert.deepEqual(failed.policy, []);
});
