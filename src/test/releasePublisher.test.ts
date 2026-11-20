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
const apiJson = '{\n  "lens_active": true,\n  "version": "1.4.1",\n  "latest": "https://old",\n  "bannedFeatures": ["lens_active"]\n}\n';

async function scenario(role: string, uploadStatus = 201) {
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
    if (url.includes('uploads.github.com')) return uploadStatus === 201 ? json({ browser_download_url: 'https://github.com/techneoncode/bananabox-public/releases/download/v1.5.0/bananabox-1.5.0.vsix' }, 201) : json({ message: 'boom' }, uploadStatus);
    if (url.includes('/contents/api.json') && method === 'GET') return json({ sha: 'abc', content: Buffer.from(apiJson).toString('base64') });
    if (url.includes('/contents/api.json') && method === 'PUT') { written = Buffer.from(JSON.parse(String(init!.body)).content, 'base64').toString(); return json({}); }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const policy: string[] = [];
  try {
    const result = await publishRelease(vsix({ publisher: 'techneoncode', name: 'bananabox', version: '1.5.0' }), '', '1.4.1',
      async (version, latest) => { policy.push(`${version} ${latest}`); }, () => {}).catch((e: Error & { code?: string }) => e);
    return { result, calls, written, policy };
  } finally {
    globalThis.fetch = original;
  }
}

test('a contributor publishes the VSIX, then the API and api.json point to it', async () => {
  const { result, written, policy } = await scenario('write');
  assert.equal((result as { version: string }).version, '1.5.0');
  assert.deepEqual(policy, ['1.5.0 https://github.com/techneoncode/bananabox-public/releases/download/v1.5.0/bananabox-1.5.0.vsix']);
  assert.match(written, /"version": "1\.5\.0"/);
  assert.match(written, /"bannedFeatures": \["lens_active"\]/, 'the rest of api.json keeps its layout');
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
