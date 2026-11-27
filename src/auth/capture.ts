import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { browserKind, captureChromium, type CaptureOptions } from './browser';
import { captureFirefox } from './firefox';

/**
 * Opens the authorization page in the right kind of browser and resolves with
 * the redirect address.
 */
export function captureRedirect(o: CaptureOptions): Promise<string> {
  // A newer sign-in on the same profile owns it: an older one must not stop that window when it ends.
  const run = (runs.get(o.profileDir) ?? 0) + 1;
  runs.set(o.profileDir, run);
  releaseProfile(o.profileDir, 'SIGKILL');
  const capture = browserKind(o.executable) === 'firefox'
    ? captureFirefox(o)
    : captureChromium(o);
  return capture.finally(() => {
    if (runs.get(o.profileDir) === run) releaseProfile(o.profileDir, 'SIGTERM');
  });
}

const runs = new Map<string, number>();

const PROFILE_LOCKS = ['lock', '.parentlock', 'parent.lock', 'SingletonLock', 'SingletonSocket', 'SingletonCookie'];

export interface ReleaseDeps {
  platform?: NodeJS.Platform;
  /** `ps` output: one `<pid> <command line>` per line. */
  processes?: () => string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  remove?: (path: string) => void;
}

/**
 * Frees the dedicated profile before and after a sign-in. A browser left on it
 * (the snap launcher exits but the real Firefox stays, a crash, a hung headless
 * renewal) makes the next start fail with "Firefox is already running, but is
 * not responding". Only processes started on this exact profile are stopped:
 * the user's own browser windows use another one.
 */
export function releaseProfile(
  profileDir: string,
  signal: NodeJS.Signals,
  deps: ReleaseDeps = {},
): void {
  // Windows locks die with their process; there is no launcher left behind there.
  if ((deps.platform ?? process.platform) === 'win32') return;
  let list = '';
  try {
    list = (deps.processes ?? (() => execFileSync('ps', ['axww', '-o', 'pid=,args='], { encoding: 'utf8', timeout: 3_000 })))();
  } catch {
    return;
  }
  const kill = deps.kill ?? ((pid: number, s: NodeJS.Signals) => process.kill(pid, s));
  let stopped = false;
  for (const line of list.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const args = m[2];
    if (!args.includes(`--profile ${profileDir}`) && !args.includes(`--user-data-dir=${profileDir}`)) continue;
    try {
      kill(Number(m[1]), signal);
      stopped = true;
    } catch {
      // Already gone.
    }
  }
  // A lock is stale once its owner is gone; removing a live one would let two browsers share the profile.
  if (signal !== 'SIGKILL' && stopped) return;
  const remove = deps.remove ?? ((p: string) => rmSync(p, { force: true }));
  for (const f of PROFILE_LOCKS) {
    try {
      remove(join(profileDir, f));
    } catch {
      // Not there, or not ours to remove.
    }
  }
}

export interface ProfileDeps {
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
}

/**
 * Folder of the dedicated browser profile. It normally lives in the extension's
 * global storage, but on Ubuntu Firefox/Chromium are *snaps*, which cannot read
 * hidden folders such as `~/.config`: their profile has to sit inside the
 * snap's own writable area (`~/snap/<name>/common`).
 */
export function browserProfileDir(
  globalStoragePath: string,
  executable: string,
  deps: ProfileDeps = {},
): string {
  const platform = deps.platform ?? process.platform;
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? existsSync;
  if (platform === 'linux') {
    const name = browserKind(executable) === 'firefox'
      ? 'firefox'
      : /chromium/i.test(basename(executable))
        ? 'chromium'
        : undefined;
    if (name) {
      const common = join(home, 'snap', name, 'common');
      if (executable.startsWith('/snap/') || exists(common)) {
        return join(common, `bananabox-${name}-profile`);
      }
    }
  }

  return join(globalStoragePath, `browser-profile-${browserKind(executable)}`);
}
