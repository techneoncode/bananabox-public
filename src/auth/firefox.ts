import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import WebSocket from 'ws';
import {
  BrowserAuthError,
  isRedirectUrl,
  type CaptureOptions,
} from './browser';

export interface FirefoxCaptureOptions extends CaptureOptions {
  /** Test seam: skip the free-port lookup. */
  port?: number;
  /** How long to wait for Firefox to start listening (default 20 s). */
  connectTimeoutMs?: number;
}

const PROFILE_PREFS: Record<string, string | number | boolean> = {
  'remote.active-protocols': 1,
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.page': 0,
  'browser.startup.homepage_override.mstone': 'ignore',
  'startup.homepage_welcome_url': '',
  'startup.homepage_welcome_url.additional': '',
  'browser.aboutwelcome.enabled': false,
  'browser.tabs.warnOnClose': false,
  'browser.sessionstore.resume_from_crash': false,
  'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'signon.rememberSignons': false,
};

export function firefoxPrefs(): string {
  return Object.entries(PROFILE_PREFS)
    .map(([k, v]) =>
      `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('\n') + '\n';
}

export function firefoxArgs(o: {
  profileDir: string;
  port: number;
  headless?: boolean;
}): string[] {
  return [
    '--no-remote',
    '--new-instance',
    '--profile',
    o.profileDir,
    '--remote-debugging-port',
    String(o.port),
    ...(o.headless ? ['--headless'] : []),
    'about:blank',
  ];
}

/**
 * Asks the OS for a free loopback port (closed again right away; Firefox binds
 * it a moment later).
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const EVENTS = [
  'browsingContext.navigationStarted',
  'browsingContext.navigationCommitted',
  'browsingContext.fragmentNavigated',
  'browsingContext.historyUpdated',
  'browsingContext.domContentLoaded',
  'browsingContext.load',
];
const EXIT_GRACE_MS = 3_000;

/**
 * Firefox flavour of the copy-paste-free sign-in, same contract as
 * `captureChromium`: rejects with `unavailable`, `cancelled` or `timeout`.
 * Starts a separate Firefox (own profile, `--no-remote`) so the user's tabs are
 * never touched, and reads the redirect from the WebDriver BiDi navigation
 * events, fragment included.
 */
export async function captureFirefox(
  o: FirefoxCaptureOptions,
): Promise<string> {
  try {
    mkdirSync(o.profileDir, { recursive: true });
    writeFileSync(join(o.profileDir, 'user.js'), firefoxPrefs());
  } catch (e) {
    throw new BrowserAuthError(
      'unavailable',
      `Could not prepare the Firefox profile: ${(e as Error).message}`,
    );
  }

  const port = o.port ?? (await freePort());

  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = (o.spawnImpl ?? spawn)(
        o.executable,
        firefoxArgs({ profileDir: o.profileDir, port, headless: o.headless }),
        { stdio: 'ignore', windowsHide: Boolean(o.headless) },
      );
    } catch (e) {
      return reject(new BrowserAuthError(
        'unavailable',
        `Could not start Firefox: ${(e as Error).message}`,
      ));
    }

    const startedAt = Date.now();
    let settled = false;
    let exited = false;
    let connected = false;
    let socket: WebSocket | undefined;
    let retry: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    let nextId = 1;
    const calls = new Map<
      number,
      { resolve: (v: any) => void; reject: (e: Error) => void }
    >();

    const call = (
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<any> =>
      new Promise((res, rej) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return rej(new Error('BiDi socket is not open'));
        }

        const id = nextId++;
        calls.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, method, params }), (err) => {
          if (err) {
            calls.delete(id);
            rej(err);
          }
        });
      });

    const finish = (
      outcome: { url: string } | { error: BrowserAuthError },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(retry);
      o.signal?.removeEventListener('abort', onAbort);
      for (const c of calls.values()) c.reject(new Error('closed'));
      calls.clear();
      const done = (): void => (
        'url' in outcome ? resolve(outcome.url) : reject(outcome.error)
      );
      if (connected) void call('browser.close').catch(() => undefined);
      setTimeout(() => socket?.terminate(), 500).unref();
      if (exited) return done();
      const killer = setTimeout(() => child.kill(), EXIT_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(killer);
        done();
      });
      if (!connected) child.kill();
    };

    const onEvent = (msg: any): void => {
      const url = msg?.params?.url;
      if (typeof url === 'string' && isRedirectUrl(url)) finish({ url });
    };

    const onMessage = (raw: WebSocket.RawData): void => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'event') return onEvent(msg);
      const pending = calls.get(msg.id);
      if (!pending) return;
      calls.delete(msg.id);
      if (msg.type === 'error') {
        pending.reject(new Error(`${msg.error}: ${msg.message ?? ''}`));
      } else {
        pending.resolve(msg.result);
      }
    };

    /**
     * Opens the session and subscribes before navigating, so the redirect
     * cannot be missed.
     */
    const begin = async (): Promise<void> => {
      await call('session.new', { capabilities: {} });
      for (const event of EVENTS) {
        await call('session.subscribe', { events: [event] })
          .catch(() => undefined);
      }

      const tree = await call('browsingContext.getTree', {});
      const context: string = tree?.contexts?.[0]?.context
        ?? (await call('browsingContext.create', { type: 'window' })).context;
      await call('browsingContext.navigate', {
        context,
        url: o.url,
        wait: 'none',
      });
    };

    const tryConnect = (): void => {
      if (settled) return;
      if (exited || Date.now() - startedAt > (o.connectTimeoutMs ?? 20_000)) {
        return finish({
          error: new BrowserAuthError(
            'unavailable',
            'Firefox did not open its WebDriver BiDi port.',
          ),
        });
      }

      const ws = new WebSocket(`ws://127.0.0.1:${port}/session`, {
        handshakeTimeout: 2_000,
      });
      ws.on('open', () => {
        socket = ws;
        connected = true;
        begin().catch((e: Error) => finish({
          error: new BrowserAuthError(
            'unavailable',
            `Firefox BiDi session failed: ${e.message}`,
          ),
        }));
      });
      ws.on('message', onMessage);
      ws.on('error', () => undefined);
      ws.on('close', () => {
        if (connected || settled) return;
        retry = setTimeout(tryConnect, 250);
      });
    };

    child.on('error', (e) => finish({
      error: new BrowserAuthError(
        'unavailable',
        `Could not start Firefox: ${e.message}`,
      ),
    }));
    child.on('exit', () => {
      exited = true;
      if (settled) return;
      finish({
        error: connected
          ? new BrowserAuthError(
              'cancelled',
              'The sign-in window was closed.',
            )
          : new BrowserAuthError(
              'unavailable',
              'Firefox exited before it could be driven.',
            ),
      });
    });

    const onAbort = (): void => finish({
      error: new BrowserAuthError('cancelled', 'Sign-in cancelled.'),
    });
    if (o.signal?.aborted) return onAbort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () => finish({
        error: new BrowserAuthError(
          'timeout',
          'Timed out waiting for the Microsoft sign-in.',
        ),
      }),
      o.timeoutMs,
    );
    tryConnect();
  });
}
