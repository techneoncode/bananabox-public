import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import * as vscode from 'vscode';
import { compareVersions } from '../domain/remotePolicy';
import { createT } from '../shared/i18n';
import { config } from '../util/config';
import { log } from '../util/log';
import { API_BASE_URL } from './remoteControl';
import { termsUrl } from '../shared/terms';
import { acceptTerms, termsAccepted } from './termsConsent';

const ID_KEY = 'bananabox.installId.v1';
const VERSION_KEY = 'bananabox.reportedVersion.v1';

function osUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

/**
 * Installation statistics (see docs/terms.md): a random id, the version, the
 * OS account name (so maintainers can ban it) and a launch count. Nothing is
 * sent before the user has accepted the terms, and turning the setting off
 * deletes the server-side data.
 */
export class InstallStats {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly version: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly account: string = osUsername(),
  ) {}

  /** One report per activation; never throws and never blocks the extension. */
  async report(): Promise<void> {
    try {
      const state = this.context.globalState;
      if (!config.statistics()) return await this.forget();
      if (!termsAccepted(state)) {
        // New users accept the terms on the sign-in page; only installations
        // that already reported are asked here.
        if (state.get<string>(ID_KEY)) this.showNotice();
        return;
      }

      let id = state.get<string>(ID_KEY);
      if (!id) {
        id = randomBytes(16).toString('hex');
        await state.update(ID_KEY, id);
      }
      await this.send('POST', '/v1/installs', { installId: id, version: this.version, ...(this.account && { account: this.account }) });

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
    const accept = t('statistics.accept');
    void vscode.window.showInformationMessage(t('statistics.notice'), learn, accept)
      .then(async (choice) => {
        if (choice === learn) void vscode.env.openExternal(vscode.Uri.parse(termsUrl(config.language())));
        if (choice === accept) {
          await acceptTerms(this.context.globalState);
          await this.report();
        }
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
