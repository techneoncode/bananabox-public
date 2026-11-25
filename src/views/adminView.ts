import * as vscode from 'vscode';
import type { RemoteFeature } from '../domain/remotePolicy';
import { AdminError, type AdminService } from '../services/adminService';
import { publishRelease } from '../services/releasePublisher';
import type { AdminViewState, AdminWebviewMessage, ReleaseStep } from '../shared/adminTypes';
import { config } from '../util/config';
import { buildAdminHtml } from './webviewHtml';

const FEATURES: readonly RemoteFeature[] = ['lens_active', 'my_api_active'];
const STALE_MS = 60_000;
const MAX_VSIX_BASE64 = Math.ceil((100 * 1024 * 1024) / 3) * 4;

const isFeatures = (value: unknown): value is RemoteFeature[] =>
  Array.isArray(value) && value.length > 0 && value.every((f) => FEATURES.includes(f));
const SCOPES = ['uid', 'promotion', 'campus'];
/** A temporary ban ends in the future; null means permanent. The Worker also caps it at 366 days. */
const isExpiry = (value: unknown): value is number | null =>
  value === null || (Number.isInteger(value) && (value as number) > Date.now());
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

/** The admin dashboard of the sidebar; shown by `bananabox.isAdmin`, usable after an admin login. */
export class AdminView implements vscode.WebviewViewProvider {
  static readonly viewType = 'bananabox.admin';

  private webview?: vscode.Webview;
  private state: AdminViewState = { lang: config.language(), phase: 'loading' };
  /** The Cloudflare root token, kept in memory only until locked, logged out or the editor closes. */
  private rootToken?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: AdminService,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const { webview } = view;
    this.webview = webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'images'),
      ],
    };
    webview.html = buildAdminHtml(webview, this.extensionUri);
    const subscriptions = [
      webview.onDidReceiveMessage((message: AdminWebviewMessage) => void this.handle(message)),
      view.onDidChangeVisibility(() => {
        const age = Date.now() - (this.state.snapshot?.fetchedAt ?? 0);
        if (view.visible && this.state.phase === 'dashboard' && age > STALE_MS) void this.load();
      }),
    ];
    view.onDidDispose(() => {
      subscriptions.forEach((s) => s.dispose());
      this.webview = undefined;
    });
  }

  /** The signed-in admin lost the right to see the dashboard (removed from the admin list). */
  async revoke(): Promise<void> {
    await this.service.clear();
    this.rootToken = undefined;
    this.set({ phase: 'login', session: undefined, snapshot: undefined, error: undefined, root: undefined });
  }

  /** Runs a root change, then reloads the admin list; a rejected token is forgotten. */
  private async runRoot(action: (token: string) => Promise<unknown>): Promise<void> {
    const token = this.rootToken;
    if (!token) return;
    this.set({ busy: true, error: undefined });
    try {
      await action(token);
      this.set({ root: { admins: await this.service.admins(token) }, busy: false });
    } catch (error) {
      const info = error instanceof AdminError ? { code: error.code, message: error.message } : { code: 'bad_response', message: String(error) };
      if (error instanceof AdminError && (error.status === 401 || error.status === 403)) {
        this.rootToken = undefined;
        return this.set({ root: undefined, busy: false, error: { code: 'root_rejected', message: info.message } });
      }
      this.set({ busy: false, error: info });
    }
  }

  private set(change: Partial<AdminViewState>): void {
    this.state = { ...this.state, lang: config.language(), ...change };
    void this.webview?.postMessage({ type: 'state', state: this.state });
  }

  /** Reads the session, then the data; shows the login page when there is no valid session. */
  private async load(): Promise<void> {
    const session = await this.service.session();
    if (!session) return this.set({ phase: 'login', session: undefined, snapshot: undefined, busy: false });
    await this.run(async () => undefined, session);
  }

  /** Runs a change, then reloads everything so the view always matches the server. */
  private async run(action: () => Promise<unknown>, session = this.state.session): Promise<void> {
    this.set({ busy: true, error: undefined, ...(session && { session }) });
    try {
      await action();
      const snapshot = await this.service.snapshot();
      this.set({ phase: 'dashboard', session: (await this.service.session()) ?? session, snapshot, busy: false });
    } catch (error) {
      const info = error instanceof AdminError
        ? { code: error.code, message: error.message }
        : { code: 'bad_response', message: String(error) };
      if (info.code === 'session_expired') {
        return this.set({ phase: 'login', session: undefined, snapshot: undefined, busy: false, error: info });
      }
      // A failed refresh keeps what is on screen; a failed first load has nothing to show.
      this.set({ phase: this.state.snapshot ? 'dashboard' : 'login', busy: false, error: info });
    }
  }

  private async publish(file: string, bytes: Buffer, notes: string, clionBytes?: Buffer): Promise<void> {
    if (this.state.release && !['done', 'error'].includes(this.state.release.step)) return;
    const current = this.state.snapshot?.policy.version;
    if (!current) return;
    const release = (step: ReleaseStep, version?: string) => this.set({ release: { file, step, version } });
    try {
      const published = await publishRelease(bytes, notes, current, (version, latest, clion_latest) => this.service.setPolicy({ version, latest, clion_latest }), release, clionBytes);
      this.set({ release: { file, step: 'done', version: published.version, url: published.url } });
      await this.run(async () => undefined);
    } catch (error) {
      const last = this.state.release!;
      this.set({ release: { ...last, step: 'error', failed: last.step, error: error instanceof Error ? error.message : String(error) } });
    }
  }

  private async handle(message: AdminWebviewMessage): Promise<void> {
    switch (message?.type) {
      case 'ready':
      case 'refresh':
        return this.load();
      case 'login':
        if (!isText(message.email, 128) || !isText(message.password, 128)) return;
        this.set({ busy: true, error: undefined });
        try {
          const session = await this.service.login(message.email.trim(), message.password);
          return this.run(async () => undefined, session);
        } catch (error) {
          const info = error instanceof AdminError
            ? { code: error.code, message: error.message }
            : { code: 'bad_response', message: String(error) };
          return this.set({ phase: 'login', busy: false, error: info });
        }
      case 'logout':
        await this.service.logout();
        this.rootToken = undefined;
        return this.set({ phase: 'login', session: undefined, snapshot: undefined, busy: false, error: undefined, root: undefined });
      case 'rootUnlock':
        if (!isText(message.token, 512) || !message.token.trim()) return;
        this.rootToken = message.token.trim();
        return this.runRoot(async () => undefined);
      case 'rootLock':
        this.rootToken = undefined;
        return this.set({ root: undefined, error: undefined });
      case 'createAdmin':
        if (!isText(message.email, 128) || !isText(message.whoami, 64) || !isText(message.password, 128)) return;
        return this.runRoot((token) => this.service.createAdmin(token, { email: message.email.trim(), whoami: message.whoami.trim(), password: message.password }));
      case 'setAdminWhoami':
        if (!Number.isInteger(message.id) || !isText(message.whoami, 64)) return;
        return this.runRoot((token) => this.service.setAdminWhoami(token, message.id, message.whoami.trim()));
      case 'deleteAdmin':
        if (!Number.isInteger(message.id)) return;
        return this.runRoot((token) => this.service.deleteAdmin(token, message.id));
      case 'ban':
        if (!isText(message.name, 64) || !SCOPES.includes(message.scope) || !isFeatures(message.features) || (message.reason !== undefined && !isText(message.reason, 200))) return;
        if (message.anonymous !== undefined && typeof message.anonymous !== 'boolean') return;
        if (message.label !== undefined && !isText(message.label, 64)) return;
        if (message.expiresAt !== undefined && !isExpiry(message.expiresAt)) return;
        return this.run(() => this.service.ban({ name: message.name, scope: message.scope, features: message.features, reason: message.reason, anonymous: message.anonymous, label: message.label, expiresAt: message.expiresAt }));
      case 'updateBan':
        if (!Number.isInteger(message.id)) return;
        if (message.features !== undefined && !isFeatures(message.features)) return;
        if (message.reason !== undefined && !isText(message.reason, 200)) return;
        if (message.anonymous !== undefined && typeof message.anonymous !== 'boolean') return;
        if (message.expiresAt !== undefined && !isExpiry(message.expiresAt)) return;
        return this.run(() => this.service.updateBan(message.id, { features: message.features, reason: message.reason, anonymous: message.anonymous, expiresAt: message.expiresAt }));
      case 'unban':
        if (!Number.isInteger(message.id)) return;
        return this.run(() => this.service.unban(message.id));
      case 'authorize':
        if (!isText(message.name, 64) || (message.reason !== undefined && !isText(message.reason, 200))) return;
        return this.run(() => this.service.authorize(message.name, message.reason));
      case 'unauthorize':
        if (!Number.isInteger(message.id)) return;
        return this.run(() => this.service.unauthorize(message.id));
      case 'setPolicy': {
        const change: { lens_active?: boolean; my_api_active?: boolean } = {};
        for (const key of ['lens_active', 'my_api_active'] as const) {
          if (message[key] !== undefined) {
            if (typeof message[key] !== 'boolean') return;
            change[key] = message[key];
          }
        }
        return this.run(() => this.service.setPolicy(change));
      }
      case 'publishRelease':
        if (!isText(message.file, 200) || typeof message.data !== 'string' || message.data.length > MAX_VSIX_BASE64) return;
        if (message.notes !== undefined && !isText(message.notes, 20_000)) return;
        if (message.clionData !== undefined && (typeof message.clionData !== 'string' || message.clionData.length > MAX_VSIX_BASE64)) return;
        return this.publish(message.file, Buffer.from(message.data, 'base64'), message.notes ?? '', message.clionData ? Buffer.from(message.clionData, 'base64') : undefined);
    }
  }
}
