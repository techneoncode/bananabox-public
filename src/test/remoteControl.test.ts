import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { clionLatestUrl, compareVersions, latestUrl, matchesGroup, parseRemoteConfig, remoteStatus, type RemoteConfig, type RemoteFeature } from '../domain/remotePolicy';
import { RemoteControl, REMOTE_CONFIG_URL } from '../services/remoteControl';
import { remoteFeatures } from '../services/remoteFeatures';
import { downloadAndInstall, validateVsix, type ExtensionUpdateProgress } from '../services/extensionUpdate';
import { EpitechClient } from '../api/client';
import { readSettings, setRemoteLensEnabled } from '../codingStyle/config';

const release = (version: string) => `https://github.com/techneoncode/bananabox-public/releases/download/v${version}/bananabox-${version}.vsix`;
const baseline: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.1',
  latest: release('0.5.1'), authorized: [], banned: [] };
const ban = (user: string, features: RemoteFeature[] = ['lens_active', 'my_api_active']) => ({ user, features });
const reset = () => remoteFeatures.set(remoteStatus(undefined, '0.5.1', 'niels'));
const envelope = (data: unknown) => Response.json({ ok: true, data });
const flush = () => new Promise(resolve => setImmediate(resolve));
Object.assign(vscode.window, { showErrorMessage: async () => undefined, showInformationMessage: async () => undefined });

function context(store = new Map<string, unknown>()): vscode.ExtensionContext {
  return { extension: { id: 'techneoncode.bananabox', packageJSON: { version: '0.5.1' } },
    globalState: { get: (key: string) => store.get(key), update: async (key: string, value: unknown) => { store.set(key, value); } },
  } as unknown as vscode.ExtensionContext;
}

test('remote policy: independent switches, OS username substring override, and a mandatory minimum version', () => {
  const disabled = { ...baseline, lens_active: false, my_api_active: false, authorized: ['niels'] };
  assert.equal(remoteStatus(disabled, '0.5.1', 'niels').lensActive, true);
  assert.equal(remoteStatus(disabled, '0.5.1', 'niels').myApiActive, true);
  for (const username of ['nielsLaptop', 'superniels', 'supernielsLaptop']) {
    assert.equal(remoteStatus(disabled, '0.5.1', username).lensActive, true);
    assert.equal(remoteStatus(disabled, '0.5.1', username).myApiActive, true);
  }
  assert.equal(remoteStatus(disabled, '0.5.1', 'Niels').lensActive, false);
  assert.equal(remoteStatus(disabled, '0.5.1', '').myApiActive, false);
  assert.equal(remoteStatus(disabled, '0.6.0', 'niels').versionMismatch, false, 'a newer build keeps working');
  for (const version of ['0.4.0', '0.5.0', '0.5.1-beta']) {
    const status = remoteStatus(disabled, version, 'niels');
    assert.equal(status.versionMismatch, true);
    assert.equal(status.lensActive, false);
    assert.equal(status.myApiActive, false);
  }
  assert.equal(remoteStatus({ ...baseline, lens_active: false }, '0.5.1', 'other').myApiActive, true);
  assert.equal(remoteStatus({ ...baseline, my_api_active: false }, '0.5.1', 'other').lensActive, true);
  assert.equal(remoteStatus(undefined, '0.5.1', 'niels').lensActive, true);
  assert.equal(remoteStatus(disabled, '0.5.1', 'niels', true).lensActive, false);
  assert.equal(remoteStatus(disabled, '0.5.1', 'niels', true).myApiActive, false);
  const refused = { ...disabled, banned: [ban('niels')] };
  assert.equal(remoteStatus(refused, '0.5.1', 'niels').connectionRefused, true);
  assert.equal(remoteStatus(refused, '0.5.1', 'niels').lensActive, false);
  assert.equal(remoteStatus(refused, '0.5.1', 'niels').myApiActive, false);
  for (const username of ['nielsLaptop', 'superniels', 'supernielsLaptop']) {
    assert.equal(remoteStatus(refused, '0.5.1', username).connectionRefused, true);
    assert.equal(remoteStatus(refused, '0.5.1', username).lensActive, false);
    assert.equal(remoteStatus(refused, '0.5.1', username).myApiActive, false);
  }
  assert.equal(remoteStatus({ ...disabled, authorized: [''] }, '0.5.1', 'guest').myApiActive, false);
  assert.equal(remoteStatus({ ...baseline, banned: [ban('')] }, '0.5.1', 'guest').connectionRefused, false);
  assert.equal(remoteStatus(refused, '0.5.1', 'Niels').connectionRefused, false);
  assert.deepEqual(parseRemoteConfig(baseline).banned, []);
  assert.throws(() => parseRemoteConfig({ ...baseline, banned: [1] }));
  assert.throws(() => parseRemoteConfig({ ...baseline, banned: 'niels' }));
  for (const invalid of [null, {}, { ...baseline, lens_active: 'false' }, { ...baseline, version: '../bad' }, { ...baseline, authorized: [1] }]) {
    assert.throws(() => parseRemoteConfig(invalid));
  }
});

test('remote version and latest URL are validated when the policy is parsed', () => {
  for (const version of ['1.0', '1.0.0+build', '01.0.0', '../bad']) {
    assert.throws(() => parseRemoteConfig({ ...baseline, version }), /Invalid version/);
  }
  assert.throws(() => parseRemoteConfig({ ...baseline, latest: 'https://github.com/https://github.com/techneoncode/bananabox-public' }), /direct HTTPS URL/);
  assert.throws(() => parseRemoteConfig({ ...baseline, latest: release('0.5.1') + '?download=1' }), /direct HTTPS URL/);
  assert.throws(() => parseRemoteConfig({ ...baseline, latest: release('0.5.1').replace('techneoncode/', 'someone/') }), /direct HTTPS URL/);
  assert.throws(() => parseRemoteConfig({ ...baseline, latest: release('0.5.2') }), /tag "v0.5.2" does not match version 0.5.1/);
  assert.throws(() => parseRemoteConfig({ ...baseline, latest: release('0.5.1').replace('bananabox-0.5.1.vsix', 'other.vsix') }), /file "other.vsix" does not match/);
  assert.equal(parseRemoteConfig(baseline).latest, release('0.5.1'));
});

test('semver compares numerically and orders prereleases before their release', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.0.2', '1.0.2'), 0);
  assert.ok(compareVersions('1.0.2-beta', '1.0.2') < 0);
  assert.ok(compareVersions('1.0.2', '1.0.2-beta') > 0);
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0-alpha.1') < 0);
  assert.ok(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta') < 0);
  assert.ok(compareVersions('1.0.0-2', '1.0.0-10') < 0);
  assert.ok(compareVersions('1.0.0-10', '1.0.0-alpha') < 0);
  assert.throws(() => compareVersions('1.0', '1.0.0'), /Invalid version "1.0"/);
});

test('refused accounts override authorized, block updates and recover when removed from the list', async () => {
  reset();
  let value: RemoteConfig = { ...baseline, version: '0.5.2', latest: release('0.5.2'), authorized: ['niels'], banned: [ban('niels')] };
  let installs = 0;
  const service = new RemoteControl(context(), { username: 'nielsLaptop',
    fetch: async () => envelope(value), install: async () => { installs++; } });
  try {
    await service.refresh(); await flush();
    assert.equal(remoteFeatures.status.connectionRefused, true);
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, false);
    assert.equal(installs, 0);
    value = { ...baseline, lens_active: false, my_api_active: false, authorized: ['niels'], banned: [] };
    await service.refresh();
    assert.equal(remoteFeatures.status.connectionRefused, false);
    assert.equal(remoteFeatures.status.lensActive, true);
    assert.equal(remoteFeatures.status.myApiActive, true);
  } finally { service.dispose(); reset(); }
});

test('promotion and campus bans match the signed-in identity, ignore accents and case, and need a cursus when named', () => {
  const zoe = { promotion: 2027, cursus: 'PGE', campus: 'Sète' };
  assert.equal(matchesGroup({ scope: 'promotion', value: '2027' }, zoe), true);
  assert.equal(matchesGroup({ scope: 'promotion', value: 'pge:2027' }, zoe), true);
  assert.equal(matchesGroup({ scope: 'promotion', value: 'bachelor:2027' }, zoe), false);
  assert.equal(matchesGroup({ scope: 'promotion', value: '2028' }, zoe), false);
  assert.equal(matchesGroup({ scope: 'campus', value: 'sete' }, zoe), true);
  assert.equal(matchesGroup({ scope: 'campus', value: 'Paris' }, zoe), false);
  const unknown = { promotion: null, cursus: null, campus: null };
  for (const scope of ['promotion', 'campus'] as const) assert.equal(matchesGroup({ scope, value: 'x' }, unknown), false, 'nothing matches before a sign-in');

  const value = { ...baseline, banned_groups: [
    { scope: 'promotion', value: '2027', features: ['my_api_active'], reason: 'abuse', by: 'admin.one', since: 5 },
    { scope: 'campus', value: 'Sète', features: ['lens_active'] },
  ] };
  const status = remoteStatus(parseRemoteConfig(value), '0.5.1', 'nobody', false, zoe);
  assert.deepEqual(status.restrictedFeatures.sort(), ['lens_active', 'my_api_active']);
  assert.deepEqual(status.restrictions!.map(r => [r.scope, r.target, r.reason, r.by]), [['promotion', '2027', 'abuse', 'admin.one'], ['campus', 'Sète', null, null]]);
  assert.equal(status.connectionRefused, true);
  assert.deepEqual(remoteStatus(parseRemoteConfig(value), '0.5.1', 'nobody').restrictedFeatures, [], 'unknown identity: no group applies');

  const both = remoteStatus(parseRemoteConfig({ ...value, banned: [{ ...ban('nob', ['lens_active']), reason: 'spam' }] }), '0.5.1', 'nobody', false, zoe);
  assert.deepEqual(both.restrictions!.map(r => r.scope), ['user', 'promotion', 'campus'], 'every applicable ban is explained');
  for (const invalid of [[{ scope: 'galaxy', value: 'x', features: ['lens_active'] }], [{ scope: 'campus', value: 'x', features: [] }], [{ scope: 'campus', features: ['lens_active'] }], 'campus']) {
    assert.throws(() => parseRemoteConfig({ ...baseline, banned_groups: invalid }));
  }
  assert.deepEqual(parseRemoteConfig(baseline).banned_groups, [], 'an older API answers without the field');
});

test('a uid ban applies to that OS account before any sign-in, and to no other', async () => {
  const value = { ...baseline, banned_groups: [{ scope: 'uid', value: 'f'.repeat(32), features: ['lens_active', 'my_api_active'], reason: 'spam', by: 'admin.one' }] };
  const none = { promotion: null, cursus: null, campus: null };
  const banned = remoteStatus(parseRemoteConfig(value), '0.5.1', 'zoe', false, { ...none, userId: 'f'.repeat(32) });
  assert.deepEqual([banned.connectionRefused, banned.restrictions![0].scope], [true, 'uid']);
  assert.equal(remoteStatus(parseRemoteConfig(value), '0.5.1', 'zoe', false, { ...none, userId: '0'.repeat(32) }).connectionRefused, false);
  assert.equal(remoteStatus(parseRemoteConfig(value), '0.5.1', 'zoe', false, none).connectionRefused, false);
  const service = new RemoteControl(context(), { fetch: (async () => envelope(value)) as typeof fetch, username: 'zoe', userId: 'f'.repeat(32) });
  try {
    await service.refresh(); await flush();
    assert.equal(remoteFeatures.status.myApiActive, false);
  } finally { service.dispose(); reset(); }
});

test('RemoteControl applies the identity of the last sign-in, also after a restart', async () => {
  const store = new Map<string, unknown>();
  const fetcher = (async () => envelope({ ...baseline, banned_groups: [{ scope: 'campus', value: 'Paris', features: ['my_api_active'], reason: 'test', by: null }] })) as typeof fetch;
  const first = new RemoteControl(context(store), { fetch: fetcher, username: 'zoe', userId: 'e'.repeat(32) });
  try {
    await first.refresh(); await flush();
    assert.equal(remoteFeatures.status.myApiActive, true);
    first.setIdentity({ promotion: 2027, cursus: 'pge', campus: 'Paris' });
    assert.equal(remoteFeatures.status.myApiActive, false);
    assert.equal(remoteFeatures.status.restrictions![0].scope, 'campus');
    first.setIdentity({ promotion: 2027, cursus: 'pge', campus: 'Lyon' });
    assert.equal(remoteFeatures.status.myApiActive, true);
    first.setIdentity({ promotion: 2027, cursus: 'pge', campus: 'Paris' });
  } finally { first.dispose(); reset(); }
  await flush();
  const second = new RemoteControl(context(store), { fetch: fetcher, username: 'zoe', userId: 'e'.repeat(32) });
  try {
    assert.deepEqual(second.identity, { promotion: 2027, cursus: 'pge', campus: 'Paris', userId: 'e'.repeat(32) });
    assert.equal(remoteFeatures.status.myApiActive, false, 'the cached policy and identity already apply before the first check');
  } finally { second.dispose(); reset(); }
});

test('a ban restricts only its own features, per account, including for an otherwise authorized user', () => {
  const matrix = [
    { features: ['lens_active'] as RemoteFeature[], lens: false, my: true },
    { features: ['my_api_active'] as RemoteFeature[], lens: true, my: false },
    { features: ['lens_active', 'my_api_active'] as RemoteFeature[], lens: false, my: false },
    { features: [] as RemoteFeature[], lens: true, my: true },
  ];
  for (const row of matrix) {
    const value = { ...baseline, authorized: ['niels'], banned: row.features.length ? [ban('niels', row.features)] : [] };
    const status = remoteStatus(parseRemoteConfig(value), '0.5.1', 'nielsLaptop');
    assert.equal(status.lensActive, row.lens);
    assert.equal(status.myApiActive, row.my);
    assert.deepEqual(status.restrictedFeatures, row.features);
    const other = remoteStatus(value, '0.5.1', 'guest');
    assert.equal(other.lensActive, true);
    assert.equal(other.myApiActive, true);
    assert.deepEqual(other.restrictedFeatures, []);
    for (const blocked of [remoteStatus(value, '0.0.1', 'nielsLaptop'), remoteStatus(value, '0.5.1', 'nielsLaptop', true)]) {
      assert.equal(blocked.lensActive, false);
      assert.equal(blocked.myApiActive, false);
    }
  }
  const mixed = { ...baseline, banned: [ban('alice', ['lens_active']), ban('bob', ['my_api_active']), ban('alicia', ['my_api_active'])] };
  assert.deepEqual(remoteStatus(mixed, '0.5.1', 'alice').restrictedFeatures, ['lens_active']);
  assert.deepEqual(remoteStatus(mixed, '0.5.1', 'bob').restrictedFeatures, ['my_api_active']);
  assert.deepEqual(remoteStatus(mixed, '0.5.1', 'alicia').restrictedFeatures, ['my_api_active']);
  assert.deepEqual(remoteStatus({ ...mixed, banned: [ban('al', ['lens_active']), ban('ice', ['my_api_active'])] }, '0.5.1', 'alice').restrictedFeatures, ['lens_active', 'my_api_active'], 'matching entries add up');
  assert.deepEqual(parseRemoteConfig({ ...baseline, banned: [ban('niels', ['lens_active', 'lens_active'])] }).banned, [{ ...ban('niels', ['lens_active']), reason: null, by: null }]);
  for (const invalid of [[ban('niels', ['unknown' as RemoteFeature])], [ban('niels', [])], [{ user: 'niels', features: 'lens_active' }], [{ features: ['lens_active'] }], ['niels']]) {
    assert.throws(() => parseRemoteConfig({ ...baseline, banned: invalid }));
  }
});

test('remote refresh switches a restricted account between Lens-only, My-only and no restriction', async () => {
  reset();
  let features: RemoteFeature[] = ['lens_active'];
  const service = new RemoteControl(context(), { username: 'nielsLaptop',
    fetch: async () => envelope({ ...baseline, banned: features.length ? [ban('niels', features)] : [] }) });
  try {
    await service.refresh();
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, true);
    assert.equal(remoteFeatures.apiSignal.aborted, false);
    const signal = remoteFeatures.apiSignal;
    features = ['my_api_active'];
    await service.refresh();
    assert.equal(remoteFeatures.status.lensActive, true);
    assert.equal(remoteFeatures.status.myApiActive, false);
    assert.equal(signal.aborted, true);
    features = [];
    await service.refresh();
    assert.equal(remoteFeatures.status.connectionRefused, false);
    assert.equal(remoteFeatures.status.lensActive, true);
    assert.equal(remoteFeatures.status.myApiActive, true);
    assert.equal(remoteFeatures.apiSignal.aborted, false);
  } finally { service.dispose(); reset(); }
});

test('partially restricted users still receive version updates for their remaining features', async () => {
  for (const features of [['lens_active'], ['my_api_active']] as RemoteFeature[][]) {
    reset();
    let installs = 0;
    const service = new RemoteControl(context(), { username: 'nielsLaptop',
      fetch: async () => envelope({ ...baseline, version: '0.5.2', latest: release('0.5.2'), banned: [ban('niels', features)] }),
      install: async () => { installs++; } });
    try {
      await service.refresh(); await flush();
      assert.equal(installs, 1);
      assert.equal(remoteFeatures.status.update, 'installed');
      assert.equal(remoteFeatures.status.lensActive, false);
      assert.equal(remoteFeatures.status.myApiActive, false);
    } finally { service.dispose(); reset(); }
  }
});

test('remote refresh applies flags, blocks offline even with cached permissions and recovers online', async () => {
  reset();
  const store = new Map<string, unknown>();
  let value = { ...baseline, lens_active: false, my_api_active: false };
  let fail = false;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), REMOTE_CONFIG_URL);
    assert.equal(init?.cache, 'no-store');
    if (fail) throw new Error('offline');
    return envelope(value);
  };
  const service = new RemoteControl(context(store), { fetch: fetcher, username: 'guest' });
  try {
    await service.refresh();
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, false);
    assert.equal(remoteFeatures.status.offline, false);
    fail = true;
    await service.refresh();
    assert.equal(remoteFeatures.status.myApiActive, false);
    assert.equal(remoteFeatures.status.offline, true);
    reset();
    const restored = new RemoteControl(context(store), { fetch: fetcher, username: 'guest' });
    assert.equal(remoteFeatures.status.lensActive, false);
    restored.dispose();
    fail = false;
    value = { ...baseline, lens_active: false, my_api_active: false, authorized: ['guest'] };
    await service.refresh();
    assert.equal(remoteFeatures.status.lensActive, true);
    assert.equal(remoteFeatures.status.myApiActive, true);
    assert.equal(remoteFeatures.status.offline, false);
    fail = true;
    await service.refresh();
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, false);
    assert.equal(remoteFeatures.status.offline, true);
  } finally { service.dispose(); reset(); }
});

test('version mismatch disables both features while installing, avoids duplicate installs and waits for reload', async () => {
  reset();
  const store = new Map<string, unknown>();
  let complete!: () => void;
  let report!: (progress: ExtensionUpdateProgress) => void;
  let installs = 0;
  const value = { ...baseline, version: '0.5.2', latest: release('0.5.2'), authorized: ['niels'] };
  const deps = { username: 'niels', fetch: (async () => envelope(value)) as typeof fetch,
    install: async (_url: string, version: string, id: string, _signal: AbortSignal, onProgress?: (progress: ExtensionUpdateProgress) => void) => {
      assert.equal(version, '0.5.2'); assert.equal(id, 'techneoncode.bananabox');
      installs++;
      report = onProgress!;
      await new Promise<void>(resolve => { complete = resolve; });
    } };
  const service = new RemoteControl(context(store), deps);
  try {
    await service.refresh();
    assert.equal(remoteFeatures.status.update, 'downloading');
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, false);
    await service.refresh();
    assert.equal(installs, 1);
    report({ stage: 'downloading', receivedBytes: 50, totalBytes: 100 });
    assert.deepEqual(remoteFeatures.status.updateProgress, { receivedBytes: 50, totalBytes: 100 });
    report({ stage: 'verifying', receivedBytes: 100, totalBytes: 100 });
    assert.equal(remoteFeatures.status.update, 'verifying');
    report({ stage: 'installing', receivedBytes: 100, totalBytes: 100 });
    assert.equal(remoteFeatures.status.update, 'installing');
    complete(); await flush();
    assert.equal(remoteFeatures.status.update, 'installed');
    assert.equal(remoteFeatures.status.versionMismatch, true);
    await service.refresh(); assert.equal(installs, 1);
    const restarted = new RemoteControl(context(store), deps);
    await restarted.refresh();
    assert.equal(installs, 1);
    assert.equal(remoteFeatures.status.update, 'installed');
    restarted.dispose();
  } finally { service.dispose(); reset(); }
});

test('an invalid latest URL invalidates the policy, so nothing is downloaded', async () => {
  reset();
  let attempts = 0;
  const service = new RemoteControl(context(), { username: 'niels',
    fetch: async () => envelope({ ...baseline, version: '0.5.2', latest: 'https://github.com/https://github.com/techneoncode/bananabox-public' }),
    install: async () => { attempts++; } });
  try {
    await service.refresh(); await flush();
    assert.equal(attempts, 0);
    assert.equal(remoteFeatures.status.offline, true);
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, false);
  } finally { service.dispose(); reset(); }
});

test('update failure remains visible and is retried on the next check', async () => {
  reset();
  let attempts = 0;
  const service = new RemoteControl(context(), { username: 'niels',
    fetch: async () => envelope({ ...baseline, version: '0.5.2', latest: release('0.5.2') }),
    install: async () => { attempts++; throw new Error('network down'); } });
  try {
    await service.refresh(); await flush();
    assert.equal(remoteFeatures.status.update, 'error');
    assert.equal(remoteFeatures.status.updateError, 'network down');
    assert.equal(remoteFeatures.status.lensActive, false);
    assert.equal(remoteFeatures.status.myApiActive, false);
    await service.refresh(); await flush();
    assert.equal(attempts, 2);
  } finally { service.dispose(); reset(); }
});

test('API requests are rejected or aborted by remote policy, and the Lens gate survives local settings reads', async () => {
  reset();
  const original = globalThis.fetch;
  let calls = 0;
  const client = new EpitechClient({ baseUrl: () => 'https://my.epitech.eu', token: () => 'secret', onUnauthorized() {},
    userAgent: 'test', isEnabled: () => remoteFeatures.status.myApiActive, signal: () => remoteFeatures.apiSignal });
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const pending = client.verify();
    remoteFeatures.set(remoteStatus({ ...baseline, my_api_active: false }, '0.5.1', 'guest'));
    await assert.rejects(pending, /remote disabled/);
    await assert.rejects(client.refreshSession('refresh-token'), /remote disabled/);
    assert.equal(calls, 1);
    reset();
    globalThis.fetch = async () => Response.json({ login: 'test' });
    assert.deepEqual(await client.verify(), { login: 'test' });
    setRemoteLensEnabled(false);
    assert.equal(readSettings().enabled, false);
    setRemoteLensEnabled(true);
    assert.equal(readSettings().enabled, true);
  } finally { globalThis.fetch = original; setRemoteLensEnabled(true); reset(); }
});

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

test('updater follows HTTPS asset redirects, validates identity/version, installs a local VSIX and cleans up', async () => {
  const original = globalThis.fetch;
  const execute = vscode.commands.executeCommand;
  const bytes = vsix({ publisher: 'techneoncode', name: 'bananabox', version: '0.5.2' });
  const url = release('0.5.2');
  let installedPath = '', installs = 0;
  const progress: ExtensionUpdateProgress[] = [];
  Object.assign(vscode.commands, { executeCommand: async (command: string, uri: vscode.Uri) => {
    assert.equal(command, 'workbench.extensions.installExtension');
    assert.deepEqual(await readFile(uri.fsPath), bytes);
    installedPath = uri.fsPath; installs++;
  } });
  try {
    globalThis.fetch = async input => String(input).includes('github.com/')
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } })
      : new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.length) } });
    await downloadAndInstall(url, '0.5.2', 'techneoncode.bananabox', new AbortController().signal, value => progress.push(value));
    assert.equal(installs, 1);
    assert.deepEqual(progress.map(value => value.stage), ['downloading', 'downloading', 'verifying', 'installing']);
    assert.equal(progress[0].receivedBytes, 0);
    assert.equal(progress.at(-1)!.receivedBytes, bytes.length);
    assert.equal(progress.at(-1)!.totalBytes, bytes.length);
    await assert.rejects(readFile(installedPath), { code: 'ENOENT' });
    assert.throws(() => validateVsix(bytes, 'another.extension', '0.5.2'), /identity or version/);
    assert.throws(() => validateVsix(bytes, 'techneoncode.bananabox', '0.5.3'), /identity or version/);
    assert.throws(() => validateVsix(Buffer.from('<html>not a vsix</html>'), 'techneoncode.bananabox', '0.5.2'));
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://insecure.test/update' } });
    await assert.rejects(downloadAndInstall(url, '0.5.2', 'techneoncode.bananabox', new AbortController().signal), /HTTPS/);
    for (const bad of ['http://host/update.vsix', 'https://host/page', 'https://user:password@host/update.vsix']) assert.throws(() => latestUrl(bad, '0.5.2'), /direct HTTPS/);
    assert.equal(installs, 1);
  } finally { globalThis.fetch = original; Object.assign(vscode.commands, { executeCommand: execute }); }
});

test('an installed build at or ahead of the required version is never asked to downgrade or reinstall', async () => {
  reset();
  let installs = 0;
  const service = new RemoteControl(context(), { username: 'niels',
    fetch: async () => envelope(baseline),
    install: async () => { installs++; } });
  try {
    await service.refresh(); await flush();
    assert.equal(installs, 0);
    assert.equal(remoteStatus(baseline, '0.5.1', 'niels').versionMismatch, false);
    assert.equal(remoteStatus(baseline, '0.5.2', 'niels').versionMismatch, false);
    assert.equal(remoteStatus(baseline, '0.5.1-beta', 'niels').versionMismatch, true);
  } finally { service.dispose(); reset(); }
});

test('a temporary ban applies until its end, also from a cached policy, then lifts on its own', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const value = { ...baseline,
    banned: [{ ...ban('zoe', ['lens_active']), until: now + 60_000 }],
    banned_groups: [{ scope: 'campus', value: 'Paris', features: ['my_api_active'], until: now - 1 }, { scope: 'campus', value: 'Paris', features: ['lens_active'], until: null }],
  };
  const parsed = parseRemoteConfig(value);
  assert.equal(parsed.banned[0].until, now + 60_000);
  assert.equal('until' in parsed.banned_groups![1], false, 'a permanent ban has no end');
  const identity = { promotion: null, cursus: null, campus: 'Paris' };
  const during = remoteStatus(parsed, '0.5.1', 'zoe', false, identity, now);
  assert.deepEqual(during.restrictedFeatures, ['lens_active'], 'the expired campus ban is ignored');
  assert.deepEqual(during.restrictions!.map(r => [r.scope, r.until ?? null]), [['user', now + 60_000], ['campus', null]]);
  const after = remoteStatus(parsed, '0.5.1', 'zoe', false, { ...identity, campus: null }, now + 60_000);
  assert.deepEqual(after.restrictedFeatures, [], 'the end itself is no longer banned');
  for (const until of ['tomorrow', {}]) {
    assert.throws(() => parseRemoteConfig({ ...baseline, banned: [{ ...ban('zoe'), until }] }));
  }
});

test('remote config: clion_latest is optional and kept only when it is the CLion ZIP of the same release', () => {
  const release = 'https://github.com/techneoncode/bananabox-public/releases/download/v2.0.2';
  const base = { lens_active: true, my_api_active: true, version: '2.0.2', latest: `${release}/bananabox-2.0.2.vsix`, authorized: [], banned: [] };
  const zip = `${release}/bananabox-clion-2.0.2.zip`;
  assert.equal(parseRemoteConfig({ ...base, clion_latest: zip }).clion_latest, zip);
  assert.equal(parseRemoteConfig(base).clion_latest, undefined);
  assert.equal(parseRemoteConfig({ ...base, clion_latest: base.latest }).clion_latest, undefined);
  assert.equal(parseRemoteConfig({ ...base, clion_latest: 'https://example.com/bananabox-clion-2.0.2.zip' }).clion_latest, undefined);
  assert.equal(clionLatestUrl(42, '2.0.2'), undefined);
});

test('an update required brings the changelog of the target version to the status, fetched once', async () => {
  reset();
  const changelog = '## [0.5.2] - 2026-11-25\n- Fixed the thing.\n\n## [0.5.1] - 2026-11-20\n- Installed already.\n';
  const value = { ...baseline, version: '0.5.2', latest: release('0.5.2') };
  const requested: string[] = [];
  const fetchMock = (async (url: string | URL | Request) => {
    requested.push(String(url));
    return String(url).endsWith('/CHANGELOG.md') ? new Response(changelog) : envelope(value);
  }) as typeof fetch;
  const install = async (_url: string, _version: string, _id: string, signal: AbortSignal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))));
  };
  const service = new RemoteControl(context(), { username: 'niels', fetch: fetchMock, install });
  const changelogRequests = () => requested.filter((url) => url.endsWith('/CHANGELOG.md')).length;
  try {
    await service.refresh();
    for (let i = 0; i < 100 && remoteFeatures.status.changelog?.state !== 'ready'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(remoteFeatures.status.changelog?.state, 'ready');
    assert.deepEqual(remoteFeatures.status.changelog.entries.map((entry) => entry.version), ['0.5.2']);
    assert.equal(changelogRequests(), 1);
    await service.refresh();
    await flush();
    assert.equal(changelogRequests(), 1, 'the changelog of a target version is fetched once');
    assert.equal(remoteFeatures.status.changelog?.state, 'ready');
  } finally { service.dispose(); reset(); }
});
