import type * as vscode from 'vscode';
import type { BanScope, RemoteFeature } from '../domain/remotePolicy';
import type {
  AdminAccount,
  AdminPolicy,
  AdminSession,
  AdminSnapshot,
  AdminStats,
  ListEntry,
  UpdateEntry,
} from '../shared/adminTypes';
import { API_BASE_URL } from './remoteControl';

const SESSION_KEY = 'bananabox.adminSession.v1';
const RECENT_UPDATES = 20;

interface StoredSession extends AdminSession {
  token: string;
}

/** `code` is the Worker error code, or `network`, `session_expired`, `bad_response`. */
export class AdminError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Client of the admin endpoints. The session token lives in the editor's
 * SecretStorage and never reaches the webview; the password is only forwarded
 * to the login endpoint and is not kept.
 */
export class AdminService {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl: string = API_BASE_URL,
  ) {}

  private async stored(): Promise<StoredSession | undefined> {
    const raw = await this.secrets.get(SESSION_KEY);
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as StoredSession;
      if (typeof value.token === 'string' && value.expiresAt > Date.now()) return value;
    } catch {}
    await this.secrets.delete(SESSION_KEY);
    return undefined;
  }

  async session(): Promise<AdminSession | undefined> {
    const value = await this.stored();
    return value && { email: value.email, whoami: value.whoami, expiresAt: value.expiresAt };
  }

  async login(email: string, password: string): Promise<AdminSession> {
    const data = await this.request<{ token: string; expires_at: number; email: string; whoami: string | null }>(
      'POST', '/v1/admin/login', { email, password }, undefined,
    );
    const session: StoredSession = { token: data.token, email: data.email, whoami: data.whoami ?? null, expiresAt: data.expires_at };
    await this.secrets.store(SESSION_KEY, JSON.stringify(session));
    return { email: session.email, whoami: session.whoami, expiresAt: session.expiresAt };
  }

  /** Ends the session on the server when possible; the local token is always dropped. */
  async logout(): Promise<void> {
    const current = await this.stored();
    await this.secrets.delete(SESSION_KEY);
    if (current) await this.request('POST', '/v1/admin/logout', undefined, current.token).catch(() => undefined);
  }

  /** Drops the local session without calling the server (the account lost admin access). */
  clear(): Thenable<void> {
    return this.secrets.delete(SESSION_KEY);
  }

  async snapshot(): Promise<AdminSnapshot> {
    const [stats, banned, authorized, policy, updates] = await Promise.all([
      this.authed<AdminStats>('GET', '/v1/stats'),
      this.authed<{ items: ListEntry[] }>('GET', '/v1/banned'),
      this.authed<{ items: ListEntry[] }>('GET', '/v1/authorized'),
      this.authed<AdminPolicy>('GET', '/v1/policy'),
      this.authed<{ items: UpdateEntry[] }>('GET', `/v1/updates?limit=${RECENT_UPDATES}`),
    ]);
    return { stats, banned: banned.items, authorized: authorized.items, policy, updates: updates.items, fetchedAt: Date.now() };
  }

  ban(ban: { name: string; scope: BanScope; features: RemoteFeature[]; reason?: string; anonymous?: boolean; label?: string }): Promise<ListEntry> {
    const { reason, label, ...rest } = ban;
    return this.authed('POST', '/v1/banned', { ...rest, ...(reason && { reason }), ...(label && { label }) });
  }

  // Root endpoints: the Cloudflare root token is passed by the caller for each request and never stored.

  async admins(root: string): Promise<AdminAccount[]> {
    return (await this.request<{ items: AdminAccount[] }>('GET', '/v1/admins', undefined, root)).items;
  }

  createAdmin(root: string, account: { email: string; whoami: string; password: string }): Promise<AdminAccount> {
    return this.request('POST', '/v1/admins', account, root);
  }

  setAdminWhoami(root: string, id: number, whoami: string): Promise<AdminAccount> {
    return this.request('PUT', `/v1/admins/${id}`, { whoami }, root);
  }

  deleteAdmin(root: string, id: number): Promise<unknown> {
    return this.request('DELETE', `/v1/admins/${id}`, undefined, root);
  }

  updateBan(id: number, change: { features?: RemoteFeature[]; reason?: string; anonymous?: boolean }): Promise<ListEntry> {
    return this.authed('PUT', `/v1/banned/${id}`, change);
  }

  unban(id: number): Promise<unknown> {
    return this.authed('DELETE', `/v1/banned/${id}`);
  }

  authorize(name: string, reason?: string): Promise<ListEntry> {
    return this.authed('POST', '/v1/authorized', { name, ...(reason && { reason }) });
  }

  unauthorize(id: number): Promise<unknown> {
    return this.authed('DELETE', `/v1/authorized/${id}`);
  }

  /** The endpoint replaces the whole policy, so the current one is read first. */
  async setPolicy(change: Partial<AdminPolicy>): Promise<AdminPolicy> {
    const current = await this.authed<AdminPolicy>('GET', '/v1/policy');
    return this.authed('PUT', '/v1/policy', { ...current, ...change });
  }

  private async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    const current = await this.stored();
    if (!current) throw new AdminError(401, 'session_expired', 'The admin session expired.');
    try {
      return await this.request<T>(method, path, body, current.token);
    } catch (error) {
      if (error instanceof AdminError && error.status === 401) {
        await this.secrets.delete(SESSION_KEY);
        throw new AdminError(401, 'session_expired', 'The admin session expired.');
      }
      throw error;
    }
  }

  private async request<T>(method: string, path: string, body: unknown, token: string | undefined): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + path, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (error) {
      throw new AdminError(0, 'network', error instanceof Error ? error.message : String(error));
    }
    let envelope: { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | undefined;
    try {
      envelope = await response.json() as typeof envelope;
    } catch {}
    if (envelope?.ok === true) return envelope.data as T;
    if (envelope?.ok === false && envelope.error) {
      throw new AdminError(response.status, envelope.error.code ?? 'bad_response', envelope.error.message ?? `HTTP ${response.status}`);
    }
    throw new AdminError(response.status, 'bad_response', `Unexpected response (HTTP ${response.status}).`);
  }
}
