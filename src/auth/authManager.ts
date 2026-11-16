import * as vscode from 'vscode';
import { ApiError, EpitechClient } from '../api/client';
import { cleanToken, inspectToken } from '../domain/jwt';
import type { AuthVM } from '../shared/types';
import {
  MicrosoftAuthError,
  refreshMicrosoftTokens,
  type MicrosoftTokens,
} from './microsoft';

const TOKEN_KEY = 'epibox.accessToken';
const REFRESH_KEY = 'epibox.refreshToken';
const MS_REFRESH_KEY = 'epibox.msRefreshToken';
const BROWSER_KEY = 'epibox.browserSession';
const RENEW_MARGIN_MS = 5 * 60_000;
const RENEW_COOLDOWN_MS = 15_000;

interface SignInOptions {
  msRefresh?: string;
  viaBrowser?: boolean;
  myRefresh?: string;
  keepMsRefresh?: boolean;
}

export class AuthManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AuthVM>();
  readonly onDidChange = this.emitter.event;

  private token: string | undefined;
  private generation = 0;
  private persistence: Promise<void> = Promise.resolve();
  private state: AuthVM = blank('signedOut');
  private renewing: Promise<boolean> | undefined;
  private lastRenewAt = 0;
  private signingIn = false;
  private renewalTimer: NodeJS.Timeout | undefined;
  client!: EpitechClient;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly deps: {
      refresh?: typeof refreshMicrosoftTokens;
      silentLogin?: () => Promise<MicrosoftTokens | null>;
      isEnabled?: () => boolean;
    } = {},
  ) {}

  get snapshot(): AuthVM {
    return this.state;
  }

  get accessToken(): string | undefined {
    return this.token;
  }

  get isSignedIn(): boolean {
    return this.state.status === 'signedIn';
  }

  /**
   * Restores a previous session from the OS keychain without blocking on the
   * network.
   */
  async restore(): Promise<void> {
    if (this.deps.isEnabled?.() === false) return;
    const gen = this.generation;
    const stored = await this.secrets.get(TOKEN_KEY);
    if (gen !== this.generation) return;
    if (!stored) return;

    const info = inspectToken(stored);
    this.token = stored;
    const identity = this.identityFromClaims(info.claims);
    if (info.expiresAt !== null && info.expiresAt <= Date.now()) {
      if (await this.renew()) return;
      if (gen !== this.generation) return;
      this.set({
        ...blank('expired'),
        ...identity,
        status: 'expired',
        expiresAt: info.expiresAt,
      });
      await vscode.commands.executeCommand(
        'setContext',
        'epibox.signedIn',
        false,
      );
      return;
    }

    this.set({
      ...blank('signedIn'),
      ...identity,
      status: 'signedIn',
      expiresAt: info.expiresAt,
    });
    await vscode.commands.executeCommand(
      'setContext',
      'epibox.signedIn',
      true,
    );
    this.scheduleRenewal(info.expiresAt);
    this.client.verify().then(
      (v) => {
        if (gen === this.generation && this.isSignedIn) {
          this.set({ ...this.state, ...this.identityFromClaims(v) });
        }
      },
      () => undefined,
    );
  }

  /**
   * Signs in with a token the user pasted. Accepts either a MyEpitech access
   * token or a Microsoft Entra access token (which is exchanged for a MyEpitech
   * one). A separate flag guards re-entry because `state.busy` is also raised
   * while the controller redeems the Microsoft code.
   */
  async signIn(rawInput: string, opts: SignInOptions = {}): Promise<void> {
    if (this.signingIn) throw new Error('Sign-in is already in progress.');
    this.signingIn = true;
    try {
      await this.doSignIn(rawInput, opts);
    } finally {
      this.signingIn = false;
    }
  }

  private async doSignIn(rawInput: string, opts: SignInOptions): Promise<void> {
    if (this.deps.isEnabled?.() === false) {
      throw new Error('My API has been remote disabled.');
    }

    const gen = ++this.generation;
    const input = cleanToken(rawInput);
    if (!input) throw new Error('The token is empty.');
    this.set({ ...this.state, busy: true, error: null });
    try {
      let accessToken = input;
      let refreshToken = opts.myRefresh;
      const info = inspectToken(input);
      if (info.expiresAt !== null && info.expiresAt <= Date.now()) {
        throw new Error(
          'This token has already expired. Copy a fresh one from my.epitech.eu.',
        );
      }

      if (info.kind === 'microsoft') {
        const exchanged = await this.client.exchangeMicrosoftToken(input);
        accessToken = exchanged.access_token;
        refreshToken = exchanged.refresh_token;
      }

      if (!accessToken) {
        throw new Error('The server did not return an access token.');
      }

      const verified = await this.client.verify(accessToken);
      if (gen !== this.generation) return;
      await this.persist(async () => {
        if (gen !== this.generation) return;
        await this.secrets.store(TOKEN_KEY, accessToken);
        if (refreshToken) {
          await this.secrets.store(REFRESH_KEY, refreshToken);
        } else {
          await this.secrets.delete(REFRESH_KEY);
        }

        if (opts.msRefresh) {
          await this.secrets.store(MS_REFRESH_KEY, opts.msRefresh);
        } else if (!opts.keepMsRefresh) {
          await this.secrets.delete(MS_REFRESH_KEY);
        }

        if (opts.viaBrowser) await this.secrets.store(BROWSER_KEY, '1');
      });
      if (gen !== this.generation) return;
      this.token = accessToken;
      const expiry = inspectToken(accessToken).expiresAt;
      this.set({
        ...blank('signedIn'),
        ...this.identityFromClaims(verified),
        expiresAt: expiry,
      });
      await vscode.commands.executeCommand(
        'setContext',
        'epibox.signedIn',
        true,
      );
      this.scheduleRenewal(expiry);
    } catch (e) {
      if (gen === this.generation) {
        this.set({
          ...this.state,
          busy: false,
          error: (e as Error).message,
        });
      }

      throw e;
    }
  }

  async signOut(): Promise<void> {
    this.generation++;
    clearTimeout(this.renewalTimer);
    this.token = undefined;
    this.set(blank('signedOut'));
    await vscode.commands.executeCommand(
      'setContext',
      'epibox.signedIn',
      false,
    );
    await this.persist(async () => {
      for (const key of [TOKEN_KEY, REFRESH_KEY, MS_REFRESH_KEY, BROWSER_KEY]) {
        await this.secrets.delete(key);
      }
    });
  }

  /**
   * Stop the current session while retaining credentials for a later remote
   * reactivation.
   */
  suspend(): void {
    this.generation++;
    clearTimeout(this.renewalTimer);
    this.token = undefined;
    this.set(blank('signedOut'));
    void vscode.commands.executeCommand('setContext', 'epibox.signedIn', false);
  }

  /**
   * Called by the API client when the server rejects the current token. Tries
   * a silent renewal first.
   */
  markExpired(): void {
    if (
      this.state.status !== 'signedIn'
      || this.renewing
      || Date.now() - this.lastRenewAt < RENEW_COOLDOWN_MS
    ) {
      return;
    }

    void this.renew().then((ok) => {
      if (!ok && this.state.status === 'signedIn') {
        this.set({
          ...this.state,
          status: 'expired',
          busy: false,
          error: null,
        });
        void vscode.commands.executeCommand(
          'setContext',
          'epibox.signedIn',
          false,
        );
      }
    });
  }

  /**
   * Silent renewal through the stored Microsoft refresh token. Resolves `true`
   * once a fresh session is in place.
   */
  renew(): Promise<boolean> {
    this.renewing ??= this.doRenew().finally(() => {
      this.renewing = undefined;
    });
    return this.renewing;
  }

  private async doRenew(): Promise<boolean> {
    if (this.deps.isEnabled?.() === false) return false;
    if (await this.renewWithMyEpitech()) return true;

    const stored = await this.secrets.get(MS_REFRESH_KEY);
    if (stored && this.deps.isEnabled?.() !== false) {
      try {
        const tokens = await (
          this.deps.refresh ?? refreshMicrosoftTokens
        )(stored);
        await this.signIn(tokens.idToken, { msRefresh: tokens.refreshToken });
        this.lastRenewAt = Date.now();
        return this.isSignedIn;
      } catch (e) {
        if (e instanceof MicrosoftAuthError && e.code === 'reauth') {
          await this.persist(async () => {
            await this.secrets.delete(MS_REFRESH_KEY);
          });
        }
      }
    }

    return this.renewInvisibly();
  }

  /**
   * Renewal through MyEpitech's own rotating refresh token
   * (`POST /api/auth/refresh`): no Microsoft involved. A 4xx answer drops the
   * stored token; a network failure keeps it for the next attempt.
   */
  private async renewWithMyEpitech(): Promise<boolean> {
    const stored = await this.secrets.get(REFRESH_KEY);
    if (!stored || !this.client?.refreshSession) return false;
    try {
      const fresh = await this.client.refreshSession(stored);
      await this.signIn(fresh.access_token, {
        myRefresh: fresh.refresh_token,
        keepMsRefresh: true,
      });
      this.lastRenewAt = Date.now();
      return this.isSignedIn;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        await this.persist(async () => {
          await this.secrets.delete(REFRESH_KEY);
        });
      }

      return false;
    }
  }

  /**
   * Renews a few minutes before the access token expires, so the session never
   * visibly lapses.
   */
  private scheduleRenewal(expiresAt: number | null): void {
    clearTimeout(this.renewalTimer);
    if (expiresAt === null) return;
    const delay = Math.min(
      Math.max(expiresAt - Date.now() - RENEW_MARGIN_MS, 30_000),
      2_000_000_000,
    );
    this.renewalTimer = setTimeout(() => {
      void this.renew();
    }, delay);
    this.renewalTimer.unref?.();
  }

  /**
   * Last resort before asking the user to sign in again: an invisible browser
   * run (`prompt=none`) that reuses Microsoft's cookies kept in Bananabox's own
   * browser profile. Only for users who signed in through that window.
   */
  private async renewInvisibly(): Promise<boolean> {
    if (!this.deps.silentLogin || !(await this.secrets.get(BROWSER_KEY))) {
      return false;
    }

    try {
      const tokens = await this.deps.silentLogin();
      if (!tokens) return false;
      await this.signIn(tokens.idToken, {
        msRefresh: tokens.refreshToken,
        viaBrowser: true,
      });
      this.lastRenewAt = Date.now();
      return this.isSignedIn;
    } catch {
      return false;
    }
  }

  /**
   * Publishes (or clears) the pending browser step; `busy` covers the token
   * exchange that follows.
   */
  setPending(pending: AuthVM['pending'], busy = false): void {
    this.set({ ...this.state, pending, busy, error: null });
  }

  reportError(message: string | null, keepPending = false): void {
    this.set({
      ...this.state,
      busy: false,
      pending: keepPending ? this.state.pending : null,
      error: message,
    });
  }

  private persist(operation: () => Promise<void>): Promise<void> {
    const task = this.persistence.then(operation);
    this.persistence = task.catch(() => undefined);
    return task;
  }

  private identityFromClaims(
    c: Record<string, unknown> | null,
  ): Partial<AuthVM> {
    if (!c) return {};
    const city = Array.isArray(c.cities)
      ? (c.cities[0] as { name?: string } | undefined)?.name
      : undefined;
    return {
      login: typeof c.login === 'string' ? c.login : null,
      firstname: typeof c.firstname === 'string' ? c.firstname : null,
      lastname: typeof c.lastname === 'string' ? c.lastname : null,
      promotion: typeof c.promotion === 'number' ? c.promotion : null,
      cursus: typeof c.cursus === 'string' ? c.cursus : null,
      campus: city ?? null,
    };
  }

  private set(next: AuthVM): void {
    this.state = { ...next, busy: next.busy ?? false };
    this.emitter.fire(this.state);
  }

  dispose(): void {
    clearTimeout(this.renewalTimer);
    this.emitter.dispose();
  }
}

function blank(status: AuthVM['status']): AuthVM {
  return {
    status,
    login: null,
    firstname: null,
    lastname: null,
    promotion: null,
    cursus: null,
    campus: null,
    expiresAt: null,
    busy: false,
    error: null,
    pending: null,
  };
}
