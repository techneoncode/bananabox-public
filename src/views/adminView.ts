import * as vscode from 'vscode';
import type { RemoteFeature } from '../domain/remotePolicy';
import { AdminError, type AdminService } from '../services/adminService';
import type { AdminViewState, AdminWebviewMessage } from '../shared/adminTypes';
import { config } from '../util/config';
import { buildAdminHtml } from './webviewHtml';

const FEATURES: readonly RemoteFeature[] = ['lens_active', 'my_api_active'];
const STALE_MS = 60_000;

const isFeatures = (value: unknown): value is RemoteFeature[] =>
  Array.isArray(value) && value.length > 0 && value.every((f) => FEATURES.includes(f));
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

/** The admin dashboard of the sidebar; shown by `epibox.isAdmin`, usable after an admin login. */
export class AdminView implements vscode.WebviewViewProvider {
  static readonly viewType = 'epibox.admin';

  private webview?: vscode.Webview;
  private state: AdminViewState = { lang: config.language(), phase: 'loading' };

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
    this.set({ phase: 'login', session: undefined, snapshot: undefined, error: undefined });
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
        return this.set({ phase: 'login', session: undefined, snapshot: undefined, busy: false, error: undefined });
      case 'ban':
        if (!isText(message.name, 64) || !isFeatures(message.features) || (message.reason !== undefined && !isText(message.reason, 200))) return;
        return this.run(() => this.service.ban(message.name, message.features, message.reason));
      case 'updateBan':
        if (!Number.isInteger(message.id)) return;
        if (message.features !== undefined && !isFeatures(message.features)) return;
        if (message.reason !== undefined && !isText(message.reason, 200)) return;
        return this.run(() => this.service.updateBan(message.id, { features: message.features, reason: message.reason }));
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
    }
  }
}
