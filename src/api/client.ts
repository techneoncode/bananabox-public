import type { ProjectStatus, ProjectVM } from '../shared/types';
import { ApiActivity } from '../domain/apiActivity';
import { cachePolicy, GuardPausedError, RequestGuard } from './requestGuard';
import { tr } from '../util/text';

type Json = Record<string, any>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface GraderRef {
  year: number;
  unitCode: string;
  instanceCode: string;
  projectId: number;
  registrationId: number;
}

export interface ClientOptions {
  baseUrl: () => string;
  token: () => string | undefined;
  /** Called when the API rejects the token. */
  onUnauthorized: () => void;
  userAgent: string;
  isEnabled?: () => boolean;
  signal?: () => AbortSignal;
  onActivityChange?: () => void;
  /** Shared budget and cache, one per extension host. */
  guard?: RequestGuard;
}

type ReqOpts = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  token?: string;
  raw?: boolean;
  anonymous?: boolean;
  noRetry?: boolean;
};

const TIMEOUT_MS = 20_000;

/**
 * Thin wrapper over the MyEpitech REST API.
 *
 * Endpoints were reverse-engineered from browser traffic (HAR); the ones
 * that could not be verified are explicitly marked `best effort` and must
 * be treated as optional by callers.
 */
export class EpitechClient {
  readonly activity = new ApiActivity();
  readonly guard: RequestGuard;

  constructor(private readonly opts: ClientOptions) {
    this.guard = opts.guard ?? new RequestGuard({
      onChange: () => opts.onActivityChange?.(),
    });
  }

  private request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: ReqOpts = {},
  ): Promise<T> {
    const url = new URL(path, this.opts.baseUrl().replace(/\/+$/, '') + '/');
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const key = `${init.raw ? 'raw ' : ''}${url.pathname}${url.search}`;
    const load = () => this.send<T>(method, url, init);
    const cacheable = method === 'GET' && !init.token && !init.anonymous;
    const pending = cacheable
      ? this.guard.get(key, cachePolicy(url.pathname), load)
      : this.guard.run(load);
    return pending.catch((e) => {
      throw asApiError(e, url.pathname);
    });
  }

  /**
   * One retry for idempotent GETs on transient failures, never after the
   * server asked us to slow down.
   */
  private async send<T>(
    method: 'GET' | 'POST' | 'DELETE',
    url: URL,
    init: ReqOpts,
  ): Promise<T> {
    const token = init.anonymous
      ? undefined
      : (init.token ?? this.opts.token());
    const attempt = async (): Promise<T> => {
      if (this.opts.isEnabled?.() === false) {
        throw new ApiError(
          tr('My API has been remote disabled.'),
          403,
          url.pathname,
        );
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const signal = this.opts.signal
          ? AbortSignal.any([ctrl.signal, this.opts.signal()])
          : ctrl.signal;
        signal.throwIfAborted();
        const complete = this.activity.begin(method, url.pathname);
        this.opts.onActivityChange?.();
        const res = await fetch(url, {
          method,
          redirect: 'error',
          signal,
          headers: {
            Accept: init.raw ? '*/*' : 'application/json, text/plain, */*',
            'User-Agent': this.opts.userAgent,
            ...(init.body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        complete(res.status);
        this.guard.observe(res.status, res.headers.get('retry-after'));
        this.opts.onActivityChange?.();
        if (this.opts.isEnabled?.() === false) {
          throw new ApiError(
            tr('My API has been remote disabled.'),
            403,
            url.pathname,
          );
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new ApiError(
            extractMessage(text) || `${res.status} ${res.statusText}`,
            res.status,
            url.pathname,
          );
          if (
            err.isUnauthorized
            && !init.anonymous
            && !init.token
            && token === this.opts.token()
          ) {
            this.opts.onUnauthorized();
          }
          throw err;
        }

        if (init.raw) {
          return Buffer.from(await res.arrayBuffer()) as unknown as T;
        }
        const text = await res.text();
        return (text ? JSON.parse(text) : null) as T;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if ((e as Error).name === 'AbortError') {
          throw new ApiError(tr('The request timed out.'), 0, url.pathname);
        }
        throw new ApiError(
          tr('Network error: {p0}', { p0: (e as Error).message }),
          0,
          url.pathname,
        );
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await attempt();
    } catch (e) {
      if (
        method === 'GET'
        && !init.noRetry
        && e instanceof ApiError
        && [0, 500, 502, 504].includes(e.status)
        && !this.guard.snapshot().pausedUntil
      ) {
        await new Promise((r) => setTimeout(r, 1500));
        return attempt();
      }
      throw e;
    }
  }

  /**
   * Exchanges a Microsoft Entra access token for MyEpitech tokens
   * (`POST /api/auth/token`).
   */
  exchangeMicrosoftToken(microsoftToken: string): Promise<{
    access_token: string;
    refresh_token?: string;
  }> {
    return this.request('POST', '/api/auth/token', {
      body: {},
      token: microsoftToken,
    });
  }

  /**
   * Renews the session (`POST /api/auth/refresh`, unauthenticated). The refresh
   * token is rotated on every call, so the new one must replace the old one.
   */
  async refreshSession(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const res = await this.request<
      { access_token?: unknown; refresh_token?: unknown } | null
    >(
      'POST',
      '/api/auth/refresh',
      { body: { refresh_token: refreshToken }, anonymous: true },
    );
    if (
      typeof res?.access_token !== 'string'
      || typeof res.refresh_token !== 'string'
      || !res.access_token
      || !res.refresh_token
    ) {
      throw new ApiError(
        tr('The refresh response did not contain new tokens.'),
        0,
        '/api/auth/refresh',
      );
    }
    return { access_token: res.access_token, refresh_token: res.refresh_token };
  }

  verify(token?: string): Promise<Json> {
    return this.request('GET', '/api/auth/verify', { token });
  }

  profile(): Promise<Json> {
    return this.request('GET', '/api/students/profile');
  }

  /** Lists every page of projects for a status filter. */
  async listProjects(
    status: ProjectStatus | 'all',
    registeredOnly: boolean,
  ): Promise<Json[]> {
    const all: Json[] = [];
    for (let page = 1; ; page++) {
      const res = await this.request<{
        data?: Json[];
        meta?: { hasNext?: boolean };
      }>('GET', '/api/units/instances/projects', {
        query: {
          page,
          limit: 50,
          status: status === 'all' ? undefined : status,
          registeredOnly,
        },
      });
      all.push(...(res?.data ?? []));
      if (!res?.meta?.hasNext) break;
    }
    return all;
  }

  /**
   * Full project route used by MyEpitech, including registrations, members
   * and leaders.
   */
  projectDetail(
    projectId: number,
    ref?: Pick<ProjectVM, 'schoolYear' | 'unitCode' | 'instanceCode'>,
  ): Promise<Json> {
    return this.request(
      'GET',
      ref
        ? `/api/units/${ref.schoolYear}/${encodeURIComponent(ref.unitCode)}/${encodeURIComponent(ref.instanceCode)}/projects/${projectId}`
        : `/api/units/instances/projects/${projectId}`,
    );
  }

  private taPath(ref: GraderRef): string {
    return `/api/units/${ref.year}/${encodeURIComponent(ref.unitCode)}/${encodeURIComponent(ref.instanceCode)}/projects/${ref.projectId}/registrations/${ref.registrationId}/ta`;
  }

  graderRuns(ref: GraderRef): Promise<{
    runs?: Json[];
    quota?: Json;
    lastDelivery?: Json | null;
  }> {
    return this.request('GET', this.taPath(ref));
  }

  async startGrader(ref: GraderRef): Promise<Json> {
    try {
      return await this.request<Json>('POST', this.taPath(ref), { body: {} });
    } finally {
      this.guard.invalidate(
        this.taPath(ref),
        `/projects/${ref.projectId}/test-results`,
      );
    }
  }

  /**
   * Kick-off, bootstrap and other sessions the student is registered to for a
   * project.
   */
  async myActivities(projectId: number): Promise<unknown> {
    return this.request<unknown>(
      'GET',
      `/api/units/instances/projects/${projectId}/my-activities`,
      { noRetry: true },
    );
  }

  /** Event slot routes verified against registration_and_timeslots.har. */
  eventSlots(eventId: number): Promise<unknown> {
    return this.request('GET', `/api/events/${eventId}/slots`, {
      noRetry: true,
    });
  }

  async registerSlot(eventId: number, slotId: number): Promise<unknown> {
    try {
      return await this.request(
        'POST',
        `/api/events/${eventId}/slots/${slotId}/registrations`,
        { body: {} },
      );
    } finally {
      this.guard.invalidate('/api/events', '/my-activities');
    }
  }

  async unregisterSlot(eventId: number, slotId: number): Promise<unknown> {
    try {
      return await this.request(
        'DELETE',
        `/api/events/${eventId}/slots/${slotId}/registrations`,
        { body: {} },
      );
    } finally {
      this.guard.invalidate('/api/events', '/my-activities');
    }
  }

  /**
   * Calendar events between two dates (`YYYY-MM-DD`), verified against
   * activities_from_calendar.har. `registered: 'me'` lists only mine.
   */
  events(query: {
    startDate: string;
    endDate: string;
    promotions?: string;
    registered?: 'me';
  }): Promise<unknown> {
    return this.request('GET', '/api/events', { query, noRetry: true });
  }

  /**
   * Units of a school year with `isRegistered`, verified against
   * activities_from_unit.har.
   */
  async unitInstances(schoolYear: number): Promise<Json[]> {
    const res = await this.request<{ data?: Json[] }>(
      'GET',
      '/api/units/instances',
      { query: { schoolYear, expanded: 'false' } },
    );
    return Array.isArray(res?.data) ? res.data : [];
  }

  /**
   * Every student registered to a unit (`[{ student, outOfScope }]`), verified
   * against registration_and_timeslots.har.
   */
  unitRegistrations(ref: {
    schoolYear: number;
    unitCode: string;
    instanceCode: string;
  }): Promise<unknown> {
    return this.request(
      'GET',
      `/api/units/${ref.schoolYear}/${encodeURIComponent(ref.unitCode)}/${encodeURIComponent(ref.instanceCode)}/registrations`,
      { noRetry: true },
    );
  }

  /**
   * Who is registered to an event without slots (`[{ student }]`), verified
   * against single_slot_registration_and_unregistration.har.
   */
  eventRegistrations(eventId: number): Promise<unknown> {
    return this.request('GET', `/api/events/${eventId}/registrations`, {
      noRetry: true,
    });
  }

  /**
   * Registers to / unregisters from an event without slots, verified against
   * single_slot_registration_and_unregistration.har.
   */
  async registerEvent(eventId: number): Promise<unknown> {
    try {
      return await this.request(
        'POST',
        `/api/events/${eventId}/registrations`,
        { body: {} },
      );
    } finally {
      this.guard.invalidate('/api/events', '/my-activities');
    }
  }

  async unregisterEvent(eventId: number): Promise<unknown> {
    try {
      return await this.request(
        'DELETE',
        `/api/events/${eventId}/registrations`,
        { body: {} },
      );
    } finally {
      this.guard.invalidate('/api/events', '/my-activities');
    }
  }

  async testResults(projectId: number): Promise<Json[]> {
    const res = await this.request<{ results?: Json[] }>(
      'GET',
      `/api/units/instances/projects/${projectId}/test-results`,
    );
    return res?.results ?? [];
  }

  testResult(resultId: number | string): Promise<Json> {
    return this.request('GET', `/api/students/test-results/${resultId}`);
  }

  /**
   * Folder tree of the files attached to a project (subject, bootstrap...).
   * Verified against captured traffic.
   */
  async projectResources(projectId: number): Promise<unknown[]> {
    const res = await this.request<unknown[] | null>(
      'GET',
      `/api/units/instances/projects/${projectId}/related-resources/files`,
    );
    return Array.isArray(res) ? res : [];
  }

  /**
   * Asks for the signed download URL of one attached file; the body is the URL
   * itself.
   */
  async resourceLink(route: string): Promise<string> {
    return (await this.request<Buffer>('GET', route, { raw: true }))
      .toString('utf8');
  }

  /**
   * Profile picture (`GET /api/users/{login}/avatar?size=96x96`, JPEG); `null`
   * when the person has none (404).
   */
  async avatar(login: string): Promise<Buffer | null> {
    try {
      return await this.request<Buffer>(
        'GET',
        `/api/users/${encodeURIComponent(login)}/avatar`,
        { query: { size: '96x96' }, raw: true, noRetry: true },
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Downloads a binary resource; absolute URLs are only fetched when they stay
   * on the API host.
   */
  async download(urlOrPath: string): Promise<Buffer> {
    const base = new URL(this.opts.baseUrl());
    const target = new URL(urlOrPath, base);
    if (target.origin !== base.origin) {
      throw new ApiError(
        tr('Refusing to send credentials to a foreign host.'),
        0,
        target.pathname,
      );
    }

    return this.request<Buffer>(
      'GET',
      target.pathname + target.search,
      { raw: true },
    );
  }
}

/**
 * A paused guard reads as a transient failure (status 0): callers keep tokens
 * and simply try later.
 */
function asApiError(e: unknown, path: string): unknown {
  if (e instanceof GuardPausedError) return new ApiError(e.message, 0, path);
  return e;
}

function extractMessage(text: string): string {
  try {
    const j = JSON.parse(text);
    const m = j?.message ?? j?.error;
    return Array.isArray(m)
      ? m.join(', ')
      : typeof m === 'string'
        ? m
        : '';
  } catch {
    return text.slice(0, 200);
  }
}
