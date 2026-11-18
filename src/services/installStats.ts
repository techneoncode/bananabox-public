import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { compareVersions } from '../domain/remotePolicy';
import { createT } from '../shared/i18n';
import { config } from '../util/config';
import { log } from '../util/log';
import { API_BASE_URL } from './remoteControl';

const ID_KEY = 'bananabox.installId.v1';
const NOTICE_KEY = 'bananabox.statisticsNotice.v1';
const VERSION_KEY = 'bananabox.reportedVersion.v1';
const TERMS_URL = 'https://github.com/techneoncode/bananabox-public/blob/main/docs/terms.md';

/**
 * Anonymous installation statistics (see docs/terms.md): a random id, the
 * version and a launch count. Nothing is sent before the user has been shown
 * the notice once, and turning the setting off deletes the server-side data.
 */
export class InstallStats {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly version: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** One report per activation; never throws and never blocks the extension. */
  async report(): Promise<void> {
    try {
      const state = this.context.globalState;
      if (!config.statistics()) return await this.forget();
      if (!state.get<boolean>(NOTICE_KEY)) {
        await state.update(NOTICE_KEY, true);
        this.showNotice();
        return;
      }

      let id = state.get<string>(ID_KEY);
      if (!id) {
        id = randomBytes(16).toString('hex');
        await state.update(ID_KEY, id);
      }
      await this.send('POST', '/v1/installs', { installId: id, version: this.version });

      const previous = state.get<string>(VERSION_KEY);
      if (previous && compareVersions(previous, this.version) < 0) {
        await this.send('POST', '/v1/updates', { installId: id, from: previous, to: this.version });
      }
      if (previous !== this.version) await state.update(VERSION_KEY, this.version);
    } catch (error) {
      log().debug('Statistics report skipped.', error);
    }
  }

  private async forget(): Promise<void> {
    const state = this.context.globalState;
    const id = state.get<string>(ID_KEY);
    if (!id) return;
    await this.send('DELETE', '/v1/installs', { installId: id });
    await state.update(ID_KEY, undefined);
    await state.update(VERSION_KEY, undefined);
  }

  private showNotice(): void {
    const t = createT(config.language());
    const learn = t('statistics.learnMore');
    const disable = t('statistics.disable');
    void vscode.window.showInformationMessage(t('statistics.notice'), learn, disable)
      .then((choice) => {
        if (choice === learn) void vscode.env.openExternal(vscode.Uri.parse(TERMS_URL));
        if (choice === disable) void config.disableStatistics();
      });
  }

  /** Every write needs a fresh single-use nonce, so a captured request cannot be replayed. */
  private async send(method: 'POST' | 'DELETE', path: string, body: Record<string, string>): Promise<void> {
    const nonce = (await this.call('POST', '/v1/nonce')).nonce;
    await this.call(method, path, { ...body, nonce });
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const response = await this.fetcher(API_BASE_URL + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
    return ((await response.json()) as { data: unknown }).data;
  }
}
