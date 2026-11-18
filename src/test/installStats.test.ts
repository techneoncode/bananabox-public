import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { InstallStats } from '../services/installStats';

interface Call { method: string; path: string; body?: Record<string, string> }

function setup(options: { statistics?: boolean; failOn?: string } = {}) {
  const store = new Map<string, unknown>();
  const calls: Call[] = [];
  const notices: string[] = [];
  let nonces = 0;
  Object.assign(vscode.window, { showInformationMessage: async (message: string) => { notices.push(message); return undefined; } });
  (vscode.workspace as any).getConfiguration = () => ({
    get: (key: string) => (key === 'anonymousStatistics' ? options.statistics : undefined),
  });
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ method: init.method!, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path === options.failOn) return Response.json({ ok: false }, { status: 500 });
    return Response.json({ ok: true, data: path === '/v1/nonce' ? { nonce: String(++nonces).padStart(32, '0') } : {} });
  }) as unknown as typeof fetch;
  const context = { globalState: {
    get: (key: string) => store.get(key),
    update: async (key: string, value: unknown) => { value === undefined ? store.delete(key) : store.set(key, value); },
  } } as unknown as vscode.ExtensionContext;
  return { store, calls, notices, stats: (version: string) => new InstallStats(context, version, fetcher) };
}

test('nothing is sent until the notice has been shown once', async () => {
  const { calls, notices, stats } = setup();
  await stats('1.4.0').report();
  assert.equal(calls.length, 0);
  assert.equal(notices.length, 1);
  await stats('1.4.0').report();
  assert.deepEqual(calls.map(c => c.path), ['/v1/nonce', '/v1/installs']);
  assert.equal(notices.length, 1, 'the notice is shown only once');
});

test('only a random install id, the version and a nonce are sent', async () => {
  const { calls, stats } = setup();
  await stats('1.4.0').report();
  await stats('1.4.0').report();
  const body = calls.find(c => c.path === '/v1/installs')!.body!;
  assert.deepEqual(Object.keys(body).sort(), ['installId', 'nonce', 'version']);
  assert.match(body.installId, /^[0-9a-f]{32}$/);
  assert.equal(body.version, '1.4.0');
  await stats('1.4.0').report();
  assert.equal(calls.filter(c => c.path === '/v1/installs').at(-1)!.body!.installId, body.installId, 'the id is stable');
  assert.notEqual(calls.filter(c => c.path === '/v1/nonce').length, 1, 'each write fetches its own nonce');
});

test('an update is reported once, with the previous and the new version', async () => {
  const { calls, stats } = setup();
  await stats('1.3.4').report();
  await stats('1.3.4').report();
  await stats('1.4.0').report();
  const updates = calls.filter(c => c.path === '/v1/updates');
  assert.deepEqual(updates.map(c => [c.body!.from, c.body!.to]), [['1.3.4', '1.4.0']]);
  await stats('1.4.0').report();
  assert.equal(calls.filter(c => c.path === '/v1/updates').length, 1);
});

test('a failed update report is retried at the next launch and errors never escape', async () => {
  const { calls, store, stats } = setup({ failOn: '/v1/updates' });
  await stats('1.3.4').report();
  await stats('1.3.4').report();
  await assert.doesNotReject(stats('1.4.0').report());
  assert.equal(store.get('bananabox.reportedVersion.v1'), '1.3.4');
  await stats('1.4.0').report();
  assert.equal(calls.filter(c => c.path === '/v1/updates').length, 2);
});

test('turning statistics off deletes the server data and the local id, and sends nothing else', async () => {
  const on = setup();
  await on.stats('1.4.0').report();
  await on.stats('1.4.0').report();
  const off = setup({ statistics: false });
  off.store.set('bananabox.installId.v1', 'a'.repeat(32));
  await off.stats('1.4.0').report();
  assert.deepEqual(off.calls.map(c => [c.method, c.path]), [['POST', '/v1/nonce'], ['DELETE', '/v1/installs']]);
  assert.equal(off.store.has('bananabox.installId.v1'), false);
  await off.stats('1.4.0').report();
  assert.equal(off.calls.length, 2, 'no request once there is nothing to delete');
  assert.equal(off.notices.length, 0);
});
