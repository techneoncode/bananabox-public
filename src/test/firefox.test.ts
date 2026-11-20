import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import { BrowserAuthError, browserKind } from '../auth/browser';
import { browserProfileDir } from '../auth/capture';
import { captureFirefox, firefoxArgs, firefoxPrefs, freePort } from '../auth/firefox';

interface Fake {
  spawnImpl: typeof spawn;
  child: any;
  args: string[];
  killed: boolean;
}

function fakeFirefox(onKill?: () => void): Fake {
  const child: any = new EventEmitter();
  const fake: Fake = { child, args: [], killed: false, spawnImpl: ((_e: string, args: string[]) => ((fake.args = args), child)) as unknown as typeof spawn };
  child.kill = () => {
    fake.killed = true;
    onKill?.();
    setImmediate(() => child.emit('exit', null));
  };
  return fake;
}

const profile = () => join(mkdtempSync(join(tmpdir(), 'bananabox-ff-')), 'profile');
const base = { executable: '/usr/bin/firefox', url: 'https://login.microsoftonline.com/x/authorize?a=b', timeoutMs: 5_000, connectTimeoutMs: 1_500 };

/** A minimal WebDriver BiDi endpoint. `onNavigate` decides what Firefox "navigates" to. */
async function bidiServer(onNavigate: (ws: WebSocket, url: string) => void, opts: { emptyTree?: boolean } = {}) {
  const port = await freePort();
  const wss = new WebSocketServer({ port, host: '127.0.0.1', path: '/session' });
  const seen: Array<{ method: string; params: any }> = [];
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const { id, method, params } = JSON.parse(raw.toString());
      seen.push({ method, params });
      const ok = (result: object) => ws.send(JSON.stringify({ type: 'success', id, result }));
      switch (method) {
        case 'session.new': return ok({ sessionId: 's1', capabilities: {} });
        case 'session.subscribe':
          // Like a strict server: an unknown event name fails the call.
          return params.events[0] === 'browsingContext.navigationCommitted'
            ? ws.send(JSON.stringify({ type: 'error', id, error: 'invalid argument', message: 'unknown event' }))
            : ok({ subscription: 'x' });
        case 'browsingContext.getTree': return ok({ contexts: opts.emptyTree ? [] : [{ context: 'C1', url: 'about:blank', children: [] }] });
        case 'browsingContext.create': return ok({ context: 'C2' });
        case 'browsingContext.navigate':
          ok({ navigation: 'n1', url: params.url });
          return onNavigate(ws, params.url);
        case 'browser.close': return ok({});
      }
    });
  });
  return { port, seen, close: () => new Promise<void>((r) => wss.close(() => r())) };
}

const navEvent = (url: string, method = 'browsingContext.navigationStarted') => JSON.stringify({ type: 'event', method, params: { context: 'C1', navigation: 'n', url, timestamp: 1 } });

test('browserKind tells Firefox from the Chromium family', () => {
  assert.equal(browserKind('/usr/bin/firefox'), 'firefox');
  assert.equal(browserKind('C:\\Program Files\\Mozilla Firefox\\firefox.exe'), 'firefox');
  assert.equal(browserKind('/Applications/Firefox.app/Contents/MacOS/firefox'), 'firefox');
  assert.equal(browserKind('/usr/bin/google-chrome'), 'chromium');
  assert.equal(browserKind('/snap/bin/chromium'), 'chromium');
});

test('firefox args: separate instance, own profile, BiDi port, starts blank; headless on demand', () => {
  const a = firefoxArgs({ profileDir: '/p', port: 4242 });
  assert.deepEqual(a.slice(0, 4), ['--no-remote', '--new-instance', '--profile', '/p']);
  assert.deepEqual(a.slice(4, 6), ['--remote-debugging-port', '4242']);
  assert.equal(a.at(-1), 'about:blank');
  assert.ok(!a.includes('--headless'));
  assert.ok(firefoxArgs({ profileDir: '/p', port: 1, headless: true }).includes('--headless'));
  assert.match(firefoxPrefs(), /user_pref\("remote.active-protocols", 1\);/);
  assert.match(firefoxPrefs(), /user_pref\("browser.shell.checkDefaultBrowser", false\);/);
});

test('snap-confined browsers get their profile inside ~/snap, others in the extension storage', () => {
  const none = () => false;
  assert.equal(browserProfileDir('/gs', '/usr/bin/firefox', { platform: 'linux', home: '/home/u', exists: (p) => p === '/home/u/snap/firefox/common' }), '/home/u/snap/firefox/common/bananabox-firefox-profile');
  assert.equal(browserProfileDir('/gs', '/snap/bin/firefox', { platform: 'linux', home: '/home/u', exists: none }), '/home/u/snap/firefox/common/bananabox-firefox-profile');
  assert.equal(browserProfileDir('/gs', '/snap/bin/chromium', { platform: 'linux', home: '/home/u', exists: none }), '/home/u/snap/chromium/common/bananabox-chromium-profile');
  assert.equal(browserProfileDir('/gs', '/usr/bin/firefox', { platform: 'linux', home: '/home/u', exists: none }), '/gs/browser-profile-firefox');
  assert.equal(browserProfileDir('/gs', '/usr/bin/google-chrome', { platform: 'linux', home: '/home/u', exists: () => true }), '/gs/browser-profile-chromium');
  assert.equal(browserProfileDir('/gs', '/Applications/Firefox.app/Contents/MacOS/firefox', { platform: 'darwin', home: '/Users/u', exists: () => true }), '/gs/browser-profile-firefox');
});

test('captures the redirect reported by BiDi: subscribes first, navigates, then closes Firefox', async () => {
  const server = await bidiServer((ws, url) => {
    assert.equal(url, base.url);
    ws.send(navEvent('https://login.microsoftonline.com/x/login'));
    ws.send(navEvent('https://my.epitech.eu/#code=FF-CODE&state=S1'));
  });
  const fake = fakeFirefox();
  const dir = profile();
  const result = captureFirefox({ ...base, profileDir: dir, port: server.port, spawnImpl: fake.spawnImpl });
  // Firefox "quits" when asked to.
  const closing = setInterval(() => server.seen.some((s) => s.method === 'browser.close') && fake.child.emit('exit', 0), 5);
  assert.equal(await result, 'https://my.epitech.eu/#code=FF-CODE&state=S1');
  clearInterval(closing);
  const methods = server.seen.map((s) => s.method);
  assert.equal(methods[0], 'session.new');
  assert.ok(methods.indexOf('browsingContext.navigate') > methods.lastIndexOf('session.subscribe')); // subscribe before navigate
  assert.ok(methods.includes('browser.close'));
  assert.match(readFileSync(join(dir, 'user.js'), 'utf8'), /remote\.active-protocols/);
  assert.equal(fake.args.at(-1), 'about:blank');
  await server.close();
});

test('a fragment-only navigation and an error redirect are captured too; empty tree creates a window', async () => {
  const server = await bidiServer((ws) => ws.send(navEvent('https://my.epitech.eu/#error=login_required&error_description=x', 'browsingContext.fragmentNavigated')), { emptyTree: true });
  const fake = fakeFirefox();
  const result = captureFirefox({ ...base, profileDir: profile(), port: server.port, spawnImpl: fake.spawnImpl });
  const closing = setInterval(() => server.seen.some((s) => s.method === 'browser.close') && fake.child.emit('exit', 0), 5);
  assert.match(await result, /#error=login_required/);
  clearInterval(closing);
  assert.ok(server.seen.some((s) => s.method === 'browsingContext.create'));
  assert.equal(server.seen.find((s) => s.method === 'browsingContext.navigate')?.params.context, 'C2');
  await server.close();
});

test('closing the Firefox window before signing in is "cancelled"', async () => {
  const fake = fakeFirefox();
  const server = await bidiServer(() => setTimeout(() => fake.child.emit('exit', 0), 10));
  await assert.rejects(captureFirefox({ ...base, profileDir: profile(), port: server.port, spawnImpl: fake.spawnImpl }), (e: BrowserAuthError) => e.code === 'cancelled');
  await server.close();
});

test('Firefox that never opens its BiDi port, or exits at once, is "unavailable" (copy-paste fallback)', async () => {
  const closed = await freePort();
  const stuck = fakeFirefox();
  await assert.rejects(captureFirefox({ ...base, connectTimeoutMs: 400, profileDir: profile(), port: closed, spawnImpl: stuck.spawnImpl }), (e: BrowserAuthError) => e.code === 'unavailable');
  assert.equal(stuck.killed, true);

  const dying = fakeFirefox();
  const result = captureFirefox({ ...base, profileDir: profile(), port: closed, spawnImpl: dying.spawnImpl });
  setTimeout(() => dying.child.emit('exit', 1), 20);
  await assert.rejects(result, (e: BrowserAuthError) => e.code === 'unavailable');

  const boom = (() => { throw new Error('ENOENT'); }) as unknown as typeof spawn;
  await assert.rejects(captureFirefox({ ...base, profileDir: profile(), port: closed, spawnImpl: boom }), (e: BrowserAuthError) => e.code === 'unavailable');
});

test('abort ends the Firefox run and asks Firefox to quit', async () => {
  const server = await bidiServer(() => undefined); // navigates, but never reaches my.epitech.eu
  const fake = fakeFirefox();
  const ctrl = new AbortController();
  const result = captureFirefox({ ...base, profileDir: profile(), port: server.port, signal: ctrl.signal, spawnImpl: fake.spawnImpl });
  const closing = setInterval(() => server.seen.some((s) => s.method === 'browser.close') && fake.child.emit('exit', 0), 5);
  setTimeout(() => ctrl.abort(), 150);
  await assert.rejects(result, (e: BrowserAuthError) => e.code === 'cancelled');
  clearInterval(closing);
  assert.ok(server.seen.some((s) => s.method === 'browser.close'));
  await server.close();
});

test('timeout rejects with "timeout"', async () => {
  const server = await bidiServer(() => undefined);
  const fake = fakeFirefox();
  const closing = setInterval(() => server.seen.some((s) => s.method === 'browser.close') && fake.child.emit('exit', 0), 5);
  await assert.rejects(captureFirefox({ ...base, timeoutMs: 200, profileDir: profile(), port: server.port, spawnImpl: fake.spawnImpl }), (e: BrowserAuthError) => e.code === 'timeout');
  clearInterval(closing);
  await server.close();
});
