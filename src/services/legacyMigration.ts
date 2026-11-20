import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

/** Older versions used the `epibox` prefix for their settings, stored state and secrets. */
const OLD = 'epibox';
const NEW = 'bananabox';
const SECRETS = ['accessToken', 'refreshToken', 'msRefreshToken', 'browserSession'];
const DONE = `${NEW}.legacyMigration.v1`;

const renamed = (key: string) => `${NEW}${key.slice(OLD.length)}`;

async function moveState(state: vscode.Memento) {
  for (const key of state.keys()) {
    if (!key.startsWith(`${OLD}.`) && !key.startsWith(`${OLD}:`)) continue;
    if (state.get(renamed(key)) === undefined) {
      await state.update(renamed(key), state.get(key));
    }
    await state.update(key, undefined);
  }
}

async function moveSecrets(secrets: vscode.SecretStorage) {
  for (const name of SECRETS) {
    const value = await secrets.get(`${OLD}.${name}`);
    if (value === undefined) continue;
    if ((await secrets.get(`${NEW}.${name}`)) === undefined) {
      await secrets.store(`${NEW}.${name}`, value);
    }
    await secrets.delete(`${OLD}.${name}`);
  }
}

function settingNames(manifest: any): string[] {
  const sections = manifest?.contributes?.configuration;
  return (Array.isArray(sections) ? sections : [sections])
    .flatMap(s => Object.keys(s?.properties ?? {}))
    .filter(key => key.startsWith(`${NEW}.`))
    .map(key => key.slice(NEW.length + 1));
}

/**
 * Copies the old settings of one scope over to the new names. The old entries are left in settings.json:
 * VS Code refuses to write a setting no extension declares anymore.
 */
async function moveSettings(names: string[], workspace: boolean) {
  const old = vscode.workspace.getConfiguration(OLD);
  const current = vscode.workspace.getConfiguration(NEW);
  for (const name of names) {
    const from = old.inspect(name), to = current.inspect(name);
    if (workspace) {
      if (from?.workspaceValue !== undefined && to?.workspaceValue === undefined) {
        await current.update(name, from.workspaceValue, vscode.ConfigurationTarget.Workspace);
      }
    } else if (from?.globalValue !== undefined && to?.globalValue === undefined) {
      await current.update(name, from.globalValue, vscode.ConfigurationTarget.Global);
    }
  }
}

async function moveBrowserProfiles(home: string) {
  for (const browser of ['firefox', 'chromium']) {
    const common = join(home, 'snap', browser, 'common');
    const from = join(common, `${OLD}-${browser}-profile`), to = join(common, `${NEW}-${browser}-profile`);
    if (existsSync(from) && !existsSync(to)) await rename(from, to);
  }
}

/** Moves everything stored under the old prefix once, so nobody is signed out or loses their settings. */
export async function migrateLegacyPrefix(context: vscode.ExtensionContext, home = homedir()): Promise<void> {
  const names = settingNames(context.extension?.packageJSON);
  const steps: Array<() => Promise<unknown>> = [];
  if (!context.globalState.get(DONE)) {
    steps.push(
      () => moveState(context.globalState),
      () => moveSecrets(context.secrets),
      () => moveSettings(names, false),
      () => process.platform === 'linux' ? moveBrowserProfiles(home) : Promise.resolve(),
    );
  }
  if (vscode.workspace.workspaceFolders?.length && !context.workspaceState.get(DONE)) {
    steps.push(() => moveState(context.workspaceState), () => moveSettings(names, true));
  }
  if (!steps.length) return;

  let failed = false;
  for (const step of steps) {
    try {
      await step();
    } catch {
      failed = true;
    }
  }
  if (failed) return;
  await context.globalState.update(DONE, true);
  if (vscode.workspace.workspaceFolders?.length) await context.workspaceState.update(DONE, true);
}
