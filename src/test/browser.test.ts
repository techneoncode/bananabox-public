import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { BrowserAuthError, browserArgs, captureChromium, detectBrowsers, findBrowser, isRedirectUrl } from '../auth/browser';
import { releaseProfile } from '../auth/capture';

// ───────── helpers: a fake Chromium speaking the DevTools pipe protocol (NUL-delimited JSON on fd 3 / fd 4) ─────────

interface FakeBrowser {
  spawnImpl: typeof spawn;
  /** Commands the extension sent. */
  commands: Array<{ id: number; method: string; params?: any; sessionId?: string }>;
  emit(msg: object): void;
  exit(): void;
  killed: boolean;
  args: string[];
}

function fakeBrowser(): FakeBrowser {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const child: any = new EventEmitter();
  child.stdio = [null, null, null, toBrowser, fromBrowser];
  const fake: FakeBrowser = {
    commands: [],
    killed: false,
    args: [],
    emit: (msg) => void fromBrowser.write(JSON.stringify(msg) + '\0'),
    exit: () => child.emit('exit', 0),
    spawnImpl: ((_exe: string, args: string[]) => {
      fake.args = args;
      return child;
    }) as unknown as typeof spawn,
  };
  child.kill = () => {
    fake.killed = true;
    child.emit('exit', null);
  };
  let buf = '';
  toBrowser.on('data', (chunk) => {
    buf += chunk.toString();
    let at: number;
    while ((at = buf.indexOf('\0')) >= 0) {
      const cmd = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      fake.commands.push(cmd);
      // Like Chromium: closing the browser ends the process.
      if (cmd.method === 'Browser.close') setImmediate(() => child.emit('exit', 0));
    }
  });
  return fake;
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const base = { executable: '/usr/bin/fake-chrome', profileDir: '/tmp/profile', url: 'https://login.microsoftonline.com/x/authorize?a=b', timeoutMs: 5_000 };
const page = (url: string, targetId = 'T1') => ({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId, type: 'page', url } } });

// ───────── isRedirectUrl ─────────

test('isRedirectUrl matches only my.epitech.eu with a code or an error', () => {
  assert.equal(isRedirectUrl('https://my.epitech.eu/#code=abc&state=s'), true);
  assert.equal(isRedirectUrl('https://my.epitech.eu/?code=abc&state=s'), true);
  assert.equal(isRedirectUrl('https://my.epitech.eu/#error=login_required&error_description=x'), true);
  assert.equal(isRedirectUrl('https://my.epitech.eu/'), false);
  assert.equal(isRedirectUrl('https://my.epitech.eu/#/projects?x=1'), false);
  assert.equal(isRedirectUrl('https://evil.example/#code=abc'), false);
  assert.equal(isRedirectUrl('https://login.microsoftonline.com/x/authorize?code=abc'), false);
  assert.equal(isRedirectUrl('not a url'), false);
});

// ───────── findBrowser ─────────

test('findBrowser honours the override, then searches the platform candidates in order', () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);
  assert.equal(findBrowser('/opt/mine', { exists: exists(['/opt/mine']) }), '/opt/mine');
  assert.equal(findBrowser('/opt/missing', { exists: exists(['/usr/bin/google-chrome']) }), undefined); // a wrong override never silently picks another browser
  const win = { platform: 'win32' as const, env: { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' } };
  assert.equal(findBrowser(undefined, { ...win, exists: exists(['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) }), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(
    findBrowser(undefined, { ...win, exists: exists(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) }),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Chrome before Edge
  );
  assert.equal(findBrowser(undefined, { platform: 'darwin', home: '/Users/a', exists: exists(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']) }), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  assert.equal(findBrowser(undefined, { platform: 'linux', env: { PATH: '/home/a/bin:/usr/bin' }, exists: exists(['/usr/bin/chromium']) }), '/usr/bin/chromium');
  assert.equal(findBrowser(undefined, { platform: 'linux', env: { PATH: '' }, exists: () => false }), undefined);
});

test('browserArgs: visible window is an app window; headless is invisible; both use the pipe and the dedicated profile', () => {
  const visible = browserArgs({ profileDir: '/p', url: 'https://x/y' });
  assert.ok(visible.includes('--remote-debugging-pipe') && visible.includes('--user-data-dir=/p') && visible.includes('--app=https://x/y'));
  assert.ok(!visible.some((a) => a.startsWith('--headless')));
  const hidden = browserArgs({ profileDir: '/p', url: 'https://x/y', headless: true });
  assert.ok(hidden.includes('--headless=new') && hidden.includes('https://x/y') && !hidden.some((a) => a.startsWith('--app')));
});

// ───────── captureChromium ─────────

test('captures the redirect from a target URL change and closes the browser gracefully', async () => {
  const b = fakeBrowser();
  const result = captureChromium({ ...base, spawnImpl: b.spawnImpl });
  await tick();
  assert.equal(b.commands[0].method, 'Target.setDiscoverTargets');
  b.emit({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'T1', type: 'page', url: base.url } } });
  b.emit(page('https://login.microsoftonline.com/x/login'));
  await tick();
  b.emit(page('https://my.epitech.eu/#code=THE-CODE&state=S1&session_state=z'));
  assert.equal(await result, 'https://my.epitech.eu/#code=THE-CODE&state=S1&session_state=z');
  assert.ok(b.commands.some((c) => c.method === 'Browser.close'));
  assert.equal(b.killed, false); // closed on its own: no forced kill
});

test('also captures through the page session (frameNavigated carries the fragment separately)', async () => {
  const b = fakeBrowser();
  const result = captureChromium({ ...base, spawnImpl: b.spawnImpl });
  await tick();
  b.emit({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'T1', type: 'page', url: 'about:blank' } } });
  await tick();
  assert.ok(b.commands.some((c) => c.method === 'Target.attachToTarget' && c.params.targetId === 'T1' && c.params.flatten === true));
  b.emit({ method: 'Target.attachedToTarget', params: { sessionId: 'SESS', targetInfo: { targetId: 'T1', type: 'page' } } });
  await tick();
  assert.ok(b.commands.some((c) => c.method === 'Page.enable' && c.sessionId === 'SESS'));
  b.emit({ method: 'Page.frameNavigated', sessionId: 'SESS', params: { frame: { url: 'https://my.epitech.eu/', urlFragment: '#code=C2&state=S2' } } });
  assert.equal(await result, 'https://my.epitech.eu/#code=C2&state=S2');
});

test('ignores sub-frames, other targets and cleared URLs; reports Microsoft errors as redirects', async () => {
  const b = fakeBrowser();
  const result = captureChromium({ ...base, spawnImpl: b.spawnImpl });
  await tick();
  b.emit({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId: 'W', type: 'service_worker', url: 'https://my.epitech.eu/#code=NO' } } });
  b.emit({ method: 'Page.frameNavigated', sessionId: 'S', params: { frame: { parentId: 'P', url: 'https://my.epitech.eu/', urlFragment: '#code=NO' } } });
  b.emit({ method: 'Page.navigatedWithinDocument', sessionId: 'S', params: { url: 'https://my.epitech.eu/' } });
  b.emit(page('https://my.epitech.eu/#error=login_required&error_description=interaction'));
  assert.match(await result, /#error=login_required/);
});

test('closing the window before signing in rejects with "cancelled"', async () => {
  const b = fakeBrowser();
  const result = captureChromium({ ...base, spawnImpl: b.spawnImpl });
  await tick();
  b.emit(page(base.url));
  await tick();
  b.exit();
  await assert.rejects(result, (e: BrowserAuthError) => e.code === 'cancelled');
});

test('a browser that exits at once without a page (hand-off to a running instance) is "unavailable"', async () => {
  const b = fakeBrowser();
  const result = captureChromium({ ...base, spawnImpl: b.spawnImpl });
  await tick();
  b.exit();
  await assert.rejects(result, (e: BrowserAuthError) => e.code === 'unavailable');
});

test('a spawn failure is "unavailable"', async () => {
  const boom = (() => { throw new Error('ENOENT'); }) as unknown as typeof spawn;
  await assert.rejects(captureChromium({ ...base, spawnImpl: boom }), (e: BrowserAuthError) => e.code === 'unavailable' && /ENOENT/.test(e.message));
  const noPipe = (() => Object.assign(new EventEmitter(), { stdio: [null, null, null, null, null], kill() {} })) as unknown as typeof spawn;
  await assert.rejects(captureChromium({ ...base, spawnImpl: noPipe }), (e: BrowserAuthError) => e.code === 'unavailable');
});

test('timeout and abort both close the browser; a stuck browser is killed after the grace period', async () => {
  const slow = fakeBrowser();
  await assert.rejects(captureChromium({ ...base, timeoutMs: 20, spawnImpl: slow.spawnImpl }), (e: BrowserAuthError) => e.code === 'timeout');
  assert.ok(slow.commands.some((c) => c.method === 'Browser.close'));

  const aborted = fakeBrowser();
  const ctrl = new AbortController();
  const result = captureChromium({ ...base, signal: ctrl.signal, spawnImpl: aborted.spawnImpl });
  await tick();
  ctrl.abort();
  await assert.rejects(result, (e: BrowserAuthError) => e.code === 'cancelled');

  const already = new AbortController();
  already.abort();
  await assert.rejects(captureChromium({ ...base, signal: already.signal, spawnImpl: fakeBrowser().spawnImpl }), (e: BrowserAuthError) => e.code === 'cancelled');
});

test('tolerates frames split across chunks and garbage between messages', async () => {
  const b = fakeBrowser();
  const result = captureChromium({ ...base, spawnImpl: b.spawnImpl });
  await tick();
  const raw = JSON.stringify(page('https://my.epitech.eu/#code=SPLIT&state=s')) + '\0';
  b.emit({ nonsense: true });
  const child = (b.spawnImpl as any)();
  // Write the real frame in two halves through the same pipe.
  (child.stdio[4] as PassThrough).write('not json\0');
  (child.stdio[4] as PassThrough).write(raw.slice(0, 20));
  await tick();
  (child.stdio[4] as PassThrough).write(raw.slice(20));
  assert.equal(await result, 'https://my.epitech.eu/#code=SPLIT&state=s');
});

// ───────── detectBrowsers / releaseProfile ─────────

test('detectBrowsers lists one entry per installed browser, plus a custom path', () => {
  const linux = { platform: 'linux' as const, env: { PATH: '/usr/bin' }, home: '/home/a' };
  const found = detectBrowsers('/opt/vivaldi/vivaldi', {
    ...linux,
    exists: (p) => ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/firefox', '/usr/bin/brave-browser', '/opt/vivaldi/vivaldi'].includes(p),
  });
  assert.deepEqual(found.map((b) => [b.id, b.name, b.path]), [
    ['chrome', 'Chrome', '/usr/bin/google-chrome-stable'],
    ['brave', 'Brave', '/usr/bin/brave-browser'],
    ['firefox', 'Firefox', '/snap/bin/firefox'],
    ['other', 'vivaldi', '/opt/vivaldi/vivaldi'],
  ]);
  const win = detectBrowsers(undefined, { platform: 'win32', env: { PROGRAMFILES: 'C:\\PF' }, exists: (p) => p === 'C:\\PF\\Chromium\\Application\\chrome.exe' });
  assert.deepEqual(win.map((b) => b.id), ['chromium']);
});

test('releaseProfile stops only browsers on the profile, then clears stale locks', () => {
  const dir = '/home/a/snap/firefox/common/bananabox-firefox-profile';
  const ps = [
    `  713304 /snap/firefox/8107/usr/lib/firefox/firefox --no-remote --profile ${dir} --headless about:blank`,
    '  9 /usr/lib/firefox/firefox',
    `  10 grep ${dir}`,
    '  11 /opt/google/chrome/chrome --user-data-dir=/x/browser-profile-chromium',
  ].join('\n');
  const killed: [number, string][] = [];
  const removed: string[] = [];
  const deps = { platform: 'linux' as const, processes: () => ps, kill: (pid: number, s: string) => { killed.push([pid, s]); }, remove: (p: string) => { removed.push(p); } };
  releaseProfile(dir, 'SIGKILL', deps);
  assert.deepEqual(killed, [[713304, 'SIGKILL']]);
  assert.ok(removed.includes(`${dir}/lock`) && removed.includes(`${dir}/.parentlock`));

  // After a sign-in: a browser still closing removes its own locks.
  killed.length = 0; removed.length = 0;
  releaseProfile(dir, 'SIGTERM', deps);
  assert.deepEqual(killed, [[713304, 'SIGTERM']]);
  assert.deepEqual(removed, []);

  releaseProfile('/x/browser-profile-chromium', 'SIGKILL', { ...deps, platform: 'win32' });
  assert.equal(killed.length, 1);
});
