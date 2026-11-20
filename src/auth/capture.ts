import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { browserKind, captureChromium, type CaptureOptions } from './browser';
import { captureFirefox } from './firefox';

/**
 * Opens the authorization page in the right kind of browser and resolves with
 * the redirect address.
 */
export function captureRedirect(o: CaptureOptions): Promise<string> {
  return browserKind(o.executable) === 'firefox'
    ? captureFirefox(o)
    : captureChromium(o);
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
