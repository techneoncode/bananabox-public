import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import * as vscode from 'vscode';
import {
  parseRemoteConfig,
  remoteStatus,
  type Identity,
  type RemoteConfig,
} from '../domain/remotePolicy';
import { createT } from '../shared/i18n';
import { config } from '../util/config';
import { log } from '../util/log';
import { downloadAndInstall } from './extensionUpdate';
import { remoteFeatures } from './remoteFeatures';
import { tr } from '../util/text';

export const API_BASE_URL = 'https://bananabox-api.niels-christophe.workers.dev';
export const REMOTE_CONFIG_URL = `${API_BASE_URL}/v1/config`;
const CACHE_KEY = 'bananabox.remoteConfig.v1';
const UPDATE_KEY = 'bananabox.installedUpdate.v1';
const IDENTITY_KEY = 'bananabox.identity.v1';
const POLL_MS = 60_000;

export interface RemoteControlDependencies {
  fetch?: typeof fetch;
  install?: typeof downloadAndInstall;
  username?: string;
  userId?: string;
}

/**
 * Identifies the OS account on this machine without revealing it: a hash of the editor's machine id and the
 * account's UID (its name on Windows, which has no UID). The UID alone is not enough: most Linux users are 1000.
 */
export function localUserId(): string {
  let account: string;
  try {
    const info = userInfo();
    account = info.uid >= 0 ? `uid:${info.uid}` : `name:${info.username}`;
  } catch {
    account = 'unknown';
  }
  return createHash('sha256').update(`${vscode.env.machineId}:${account}`).digest('hex').slice(0, 32);
}

export class RemoteControl implements vscode.Disposable {
  private readonly lifetime = new AbortController();
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private updating?: string;
  private updateAbort?: AbortController;
  private announced?: string;
  private readonly username: string;
  private readonly userId: string;
  private readonly version: string;
  private remote?: RemoteConfig;
  private offline = true;
  private known: Identity = { promotion: null, cursus: null, campus: null };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: RemoteControlDependencies = {},
  ) {
    this.version = context.extension.packageJSON.version;
    try {
      this.username = deps.username ?? userInfo().username;
    } catch {
      this.username = '';
    }
    this.userId = deps.userId ?? localUserId();
    try {
      this.remote = parseRemoteConfig(context.globalState.get(CACHE_KEY));
    } catch {}
    // Remembered from the last sign-in, so a promotion or campus ban already applies before the next one.
    const stored = context.globalState.get<Partial<Identity>>(IDENTITY_KEY);
    this.known = {
      promotion: typeof stored?.promotion === 'number' ? stored.promotion : null,
      cursus: typeof stored?.cursus === 'string' ? stored.cursus : null,
      campus: typeof stored?.campus === 'string' ? stored.campus : null,
    };
    this.apply();
  }

  /** This OS account's id, with the promotion and campus of the last signed-in account. */
  get identity(): Identity {
    return { ...this.known, userId: this.userId };
  }

  /** Called at every sign-in; a different promotion or campus is evaluated against the bans at once. */
  setIdentity(change: Identity): void {
    const identity = { promotion: change.promotion, cursus: change.cursus, campus: change.campus };
    if (JSON.stringify(identity) === JSON.stringify(this.known)) return;
    this.known = identity;
    void this.context.globalState.update(IDENTITY_KEY, identity)
      .then(undefined, (error) => log().warn('Cannot cache identity.', error));
    this.apply();
  }

  async start(): Promise<void> {
    await this.refresh();
    if (this.lifetime.signal.aborted) return;
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.timer.unref?.();
  }

  refresh(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.resolve();
    this.checking ??= this.check().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private apply(resetUpdate = false): void {
    const state = remoteStatus(
      this.remote,
      this.version,
      this.username,
      this.offline,
      this.identity,
    );
    const previous = remoteFeatures.status;
    state.uninstall = previous.uninstall;
    state.uninstallError = previous.uninstallError;
    if (!resetUpdate && state.requiredVersion === previous.requiredVersion) {
      state.update = previous.update;
      state.updateError = previous.updateError;
      state.updateProgress = previous.updateProgress;
    }

    const installed = this.context.globalState.get<{
      from: string;
      version: string;
      latest: string;
    }>(UPDATE_KEY);
    if (
      state.versionMismatch
      && this.remote
      && installed?.from === this.version
      && installed.version === this.remote.version
      && installed.latest === this.remote.latest
    ) {
      state.update = 'installed';
      state.updateError = undefined;
    }
    remoteFeatures.set(state);
  }

  private async check(): Promise<void> {
    try {
      const response = await (this.deps.fetch ?? fetch)(REMOTE_CONFIG_URL, {
        signal: AbortSignal.any([
          this.lifetime.signal,
          AbortSignal.timeout(10_000),
        ]),
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const envelope = (await response.json()) as { ok?: boolean; data?: unknown };
      if (envelope?.ok !== true) throw new Error('Unexpected API response');
      const remote = parseRemoteConfig(envelope.data);
      if (this.lifetime.signal.aborted) return;

      const targetChanged = remote.latest !== this.remote?.latest;
      if (
        targetChanged
        || remoteStatus(remote, this.version, this.username, false, this.identity)
          .restrictedFeatures.length === 2
      ) {
        this.updateAbort?.abort();
        this.updating = undefined;
      }
      this.remote = remote;
      this.offline = false;
      this.apply(targetChanged);
      await this.context.globalState
        .update(CACHE_KEY, remote)
        .then(undefined, (error) =>
          log().warn('Cannot cache remote policy.', error),
        );
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      this.offline = true;
      this.updateAbort?.abort();
      this.updating = undefined;
      this.apply();
      log().warn(
        tr('Remote configuration unavailable; all features are disabled until the next successful check.'),
        error,
      );
    }

    if (
      this.lifetime.signal.aborted
      || this.offline
      || remoteFeatures.status.restrictedFeatures.length === 2
      || !this.remote
    ) {
      return;
    }
    if (!remoteFeatures.status.versionMismatch) return;
    if (this.announced !== this.remote.version) {
      this.announced = this.remote.version;
      void vscode.window.showErrorMessage(
        createT(config.language())('availability.version', {
          installed: this.version,
          required: this.remote.version,
        }),
      );
    }
    if (
      remoteFeatures.status.update !== 'installed'
      && this.updating === undefined
    ) {
      void this.update(this.remote);
    }
  }

  private async update(remote: RemoteConfig): Promise<void> {
    const latest = remote.latest;
    const key = `${remote.version}|${latest}`;
    this.updating = key;
    const abort = new AbortController();
    this.updateAbort = abort;
    const signal = AbortSignal.any([this.lifetime.signal, abort.signal]);
    remoteFeatures.set({
      ...remoteFeatures.status,
      update: 'downloading',
      updateProgress: { receivedBytes: 0 },
      updateError: undefined,
    });
    try {
      await (this.deps.install ?? downloadAndInstall)(
        latest,
        remote.version,
        this.context.extension.id,
        signal,
        (progress) => {
          if (signal.aborted) return;
          remoteFeatures.set({
            ...remoteFeatures.status,
            update: progress.stage,
            updateProgress: {
              receivedBytes: progress.receivedBytes,
              totalBytes: progress.totalBytes,
            },
            updateError: undefined,
          });
        },
      );
      if (signal.aborted) return;

      await this.context.globalState.update(UPDATE_KEY, {
        from: this.version,
        version: remote.version,
        latest,
      });
      if (signal.aborted) return;
      remoteFeatures.set({
        ...remoteFeatures.status,
        update: 'installed',
        updateError: undefined,
      });

      const t = createT(config.language());
      const reload = t('availability.reload');
      void vscode.window
        .showInformationMessage(t('availability.installed'), reload)
        .then((choice) => {
          if (choice === reload) {
            void vscode.commands.executeCommand(
              'workbench.action.reloadWindow',
            );
          }
        });
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      remoteFeatures.set({
        ...remoteFeatures.status,
        update: 'error',
        updateError: message,
      });
      log().error('Automatic extension update failed.', error);
    } finally {
      if (this.updating === key) this.updating = undefined;
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.lifetime.abort();
    this.updateAbort?.abort();
  }
}
