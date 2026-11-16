import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { MS_REDIRECT_URI } from './microsoft';

export type BrowserErrorCode = 'unavailable' | 'cancelled' | 'timeout';

export class BrowserAuthError extends Error {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserAuthError';
  }
}

export interface FindDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (path: string) => boolean;
}

/**
 * Candidate executables, in order of preference: Chromium family first
 * (Chrome, Edge, Brave, Chromium), then Firefox.
 */
export function browserCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  if (platform === 'win32') {
    const roots = [
      env['PROGRAMFILES'],
      env['PROGRAMFILES(X86)'],
      env['LOCALAPPDATA'],
    ].filter((x): x is string => Boolean(x));
    const rel = [
      '\\Google\\Chrome\\Application\\chrome.exe',
      '\\Microsoft\\Edge\\Application\\msedge.exe',
      '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '\\Chromium\\Application\\chrome.exe',
      '\\Mozilla Firefox\\firefox.exe',
    ];
    return rel.flatMap((r) => roots.map((root) => root + r));
  }

  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
      'Chromium.app/Contents/MacOS/Chromium',
      'Firefox.app/Contents/MacOS/firefox',
    ];
    return apps.flatMap((a) => [
      `/Applications/${a}`,
      `${home}/Applications/${a}`,
    ]);
  }

  const names = [
    'google-chrome-stable',
    'google-chrome',
    'microsoft-edge-stable',
    'microsoft-edge',
    'brave-browser',
    'chromium',
    'chromium-browser',
    'firefox',
    'firefox-esr',
  ];
  const dirs = (env['PATH'] ?? '')
    .split(':')
    .filter(Boolean)
    .concat([
      '/usr/bin',
      '/usr/local/bin',
      '/opt/google/chrome',
      '/opt/microsoft/msedge',
      '/opt/firefox',
      '/usr/lib/firefox',
      '/snap/bin',
    ]);
  return names.flatMap((n) => dirs.map((d) => `${d}/${n}`));
}

export type BrowserKind = 'chromium' | 'firefox';

/**
 * Firefox speaks WebDriver BiDi; everything else is driven through the
 * Chromium DevTools protocol.
 */
export function browserKind(executable: string): BrowserKind {
  return /firefox/i.test(executable.split(/[\\/]/).pop() ?? '')
    ? 'firefox'
    : 'chromium';
}

/**
 * Returns the browser to drive: the user's `epibox.browserPath` if it exists,
 * else the first installed candidate.
 */
export function findBrowser(
  override: string | undefined,
  deps: FindDeps = {},
): string | undefined {
  const exists = deps.exists ?? existsSync;
  const path = override?.trim();
  if (path) return exists(path) ? path : undefined;
  return browserCandidates(
    deps.platform ?? process.platform,
    deps.env ?? process.env,
    deps.home ?? homedir(),
  ).find((p) => exists(p));
}

/**
 * True for the final `https://my.epitech.eu/#code=...` (or `?code=...`, or an
 * `error=...`) navigation.
 */
export function isRedirectUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }

  if (u.origin !== new URL(MS_REDIRECT_URI).origin) return false;
  const param = /(^|[?#&])(code|error)=/;
  return param.test(u.hash) || param.test(u.search);
}

export interface CaptureOptions {
  executable: string;
  /** Dedicated profile folder (keeps Microsoft's cookies between runs). */
  profileDir: string;
  url: string;
  /** Invisible window, for `prompt=none` renewals. */
  headless?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Test seam. */
  spawnImpl?: typeof spawn;
}

export function browserArgs(
  o: Pick<CaptureOptions, 'profileDir' | 'url' | 'headless'>,
): string[] {
  return [
    '--remote-debugging-pipe',
    `--user-data-dir=${o.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-features=Translate,msEdgeSidebarV2,msEdgeSplitWindow',
    ...(o.headless
      ? ['--headless=new', '--disable-gpu', o.url]
      : ['--window-size=520,760', `--app=${o.url}`]),
  ];
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: any;
  sessionId?: string;
}

const EXIT_GRACE_MS = 3_000;
const QUICK_EXIT_MS = 4_000;

/**
 * Opens the authorization page in a small dedicated Chromium window and
 * resolves with the full redirect address (`https://my.epitech.eu/#code=...`).
 * The window is driven over the DevTools pipe (no network port is opened), so
 * the code is read and the window closed as soon as it lands on the redirect,
 * before the site's own scripts run.
 *
 * Rejects with a {@link BrowserAuthError}: `unavailable` (could not start or
 * drive the browser, fall back to copy-paste), `cancelled` (window closed or
 * aborted) or `timeout`.
 */
export function captureChromium(o: CaptureOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = (o.spawnImpl ?? spawn)(o.executable, browserArgs(o), {
        stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
        windowsHide: Boolean(o.headless),
      });
    } catch (e) {
      return reject(new BrowserAuthError(
        'unavailable',
        `Could not start the browser: ${(e as Error).message}`,
      ));
    }

    const toBrowser = child.stdio[3] as NodeJS.WritableStream | null;
    const fromBrowser = child.stdio[4] as NodeJS.ReadableStream | null;
    if (!toBrowser || !fromBrowser) {
      child.kill();
      return reject(new BrowserAuthError(
        'unavailable',
        'The browser did not expose its DevTools pipe.',
      ));
    }

    const startedAt = Date.now();
    let settled = false;
    let exited = false;
    let sawPage = false;
    let nextId = 1;
    let buffer = '';
    const attached = new Set<string>();
    let timer: NodeJS.Timeout | undefined;

    const send = (
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ): void => {
      if (exited) return;
      try {
        const message = {
          id: nextId++,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        };
        toBrowser.write(JSON.stringify(message) + '\0');
      } catch {}
    };

    const finish = (
      outcome: { url: string } | { error: BrowserAuthError },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      send('Browser.close');
      const done = (): void => (
        'url' in outcome ? resolve(outcome.url) : reject(outcome.error)
      );
      if (exited) return done();
      const killer = setTimeout(() => child.kill(), EXIT_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(killer);
        done();
      });
    };

    const check = (url: string | undefined): void => {
      if (url && isRedirectUrl(url)) finish({ url });
    };

    const onMessage = (msg: CdpMessage): void => {
      const p = msg.params;
      switch (msg.method) {
        case 'Target.targetCreated':
        case 'Target.targetInfoChanged': {
          const info = p?.targetInfo;
          if (info?.type !== 'page') return;
          sawPage = true;
          check(info.url);
          if (!settled && info.targetId && !attached.has(info.targetId)) {
            attached.add(info.targetId);
            send('Target.attachToTarget', {
              targetId: info.targetId,
              flatten: true,
            });
          }

          return;
        }

        case 'Target.attachedToTarget':
          if (p?.sessionId) send('Page.enable', {}, p.sessionId);
          return;
        case 'Page.frameNavigated':
          if (!p?.frame?.parentId) {
            check(`${p.frame.url ?? ''}${p.frame.urlFragment ?? ''}`);
          }

          return;
        case 'Page.navigatedWithinDocument':
          check(p?.url);
          return;
      }
    };

    fromBrowser.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let at: number;
      while ((at = buffer.indexOf('\0')) >= 0) {
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!raw) continue;
        try {
          onMessage(JSON.parse(raw) as CdpMessage);
        } catch {}
      }
    });
    toBrowser.on('error', () => undefined);
    fromBrowser.on('error', () => undefined);

    child.on('error', (e) => finish({
      error: new BrowserAuthError(
        'unavailable',
        `Could not start the browser: ${e.message}`,
      ),
    }));
    child.on('exit', () => {
      exited = true;
      if (settled) return;
      const quick = !sawPage && Date.now() - startedAt < QUICK_EXIT_MS;
      finish({
        error: quick
          ? new BrowserAuthError(
              'unavailable',
              'The browser exited immediately (is the same profile already in use?).',
            )
          : new BrowserAuthError('cancelled', 'The sign-in window was closed.'),
      });
    });

    const onAbort = (): void => finish({
      error: new BrowserAuthError('cancelled', 'Sign-in cancelled.'),
    });
    if (o.signal?.aborted) {
      onAbort();
    } else {
      o.signal?.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(
      () => finish({
        error: new BrowserAuthError(
          'timeout',
          'Timed out waiting for the Microsoft sign-in.',
        ),
      }),
      o.timeoutMs,
    );

    send('Target.setDiscoverTargets', { discover: true });
  });
}
