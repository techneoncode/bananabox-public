import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Cached answers are copied in and out, so a caller that edits its answer never
 * edits the cache.
 */
const copy = <T>(value: T): T => (
  value === null
  || typeof value !== 'object'
  || Buffer.isBuffer(value)
    ? value
    : structuredClone(value)
);

export type Priority = 'user' | 'background';

interface RequestContext {
  priority: Priority;
  fresh: boolean;
}

const context = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `task` as background work: it waits behind the student's requests and
 * uses a smaller budget.
 */
export function inBackground<T>(task: () => Promise<T>): Promise<T> {
  return context.run(
    { priority: 'background', fresh: context.getStore()?.fresh ?? false },
    task,
  );
}

/**
 * Runs `task` asking for fresh data: cached GETs are refetched unless they are
 * younger than their floor.
 */
export function fresh<T>(task: () => Promise<T>): Promise<T> {
  return context.run(
    { priority: context.getStore()?.priority ?? 'user', fresh: true },
    task,
  );
}

export function currentPriority(): Priority {
  return context.getStore()?.priority ?? 'user';
}

export function wantsFresh(): boolean {
  return context.getStore()?.fresh ?? false;
}

/**
 * How long a GET answer stays useful (`ttl`), and the minimum age before even a
 * fresh request refetches it (`floor`).
 */
export interface CachePolicy {
  ttl: number;
  floor: number;
}

const S = 1000;
const M = 60 * S;

/**
 * Cache policy per route. Unknown routes are not cached but still deduplicated
 * and budgeted.
 */
export function cachePolicy(path: string): CachePolicy {
  const route = path.split(/[?#]/, 1)[0];
  if (route === '/api/auth/verify' || route.startsWith('/api/auth/')) {
    return { ttl: 0, floor: 0 };
  }

  if (route === '/api/students/profile') return { ttl: 30 * M, floor: 1 * M };
  if (route === '/api/units/instances/projects') {
    return { ttl: 3 * M, floor: 20 * S };
  }

  if (/^\/api\/students\/test-results\/[^/]+$/.test(route)) {
    return { ttl: 24 * 60 * M, floor: 24 * 60 * M };
  }

  if (/\/registrations\/[^/]+\/ta$/.test(route)) {
    return { ttl: 45 * S, floor: 5 * S };
  }

  if (/\/test-results$/.test(route)) return { ttl: 2 * M, floor: 15 * S };
  if (/\/my-activities$/.test(route)) return { ttl: 4 * M, floor: 20 * S };
  if (/^\/api\/units\/[^/]+\/[^/]+\/[^/]+\/registrations$/.test(route)) {
    return { ttl: 30 * M, floor: 1 * M };
  }

  if (/^\/api\/events\/[^/]+\/registrations$/.test(route)) {
    return { ttl: 2 * M, floor: 20 * S };
  }

  if (route === '/api/events') return { ttl: 2 * M, floor: 20 * S };
  if (route === '/api/units/instances') return { ttl: 30 * M, floor: 1 * M };
  if (/^\/api\/events\/[^/]+\/slots$/.test(route)) {
    return { ttl: 45 * S, floor: 10 * S };
  }

  if (/\/related-resources\/files$/.test(route)) {
    return { ttl: 30 * M, floor: 1 * M };
  }

  if (
    /^\/api\/units\/[^/]+\/[^/]+\/[^/]+\/projects\/[^/]+$/.test(route)
    || /^\/api\/units\/instances\/projects\/[^/]+$/.test(route)
  ) {
    return { ttl: 15 * M, floor: 30 * S };
  }

  return { ttl: 0, floor: 0 };
}

export interface GuardSnapshot {
  /** Requests running right now. */
  active: number;
  /** Requests waiting for budget. */
  queued: number;
  /** Requests started in the last minute. */
  lastMinute: number;
  /** While set, nothing is sent: the server rate-limited us. */
  pausedUntil: number | null;
}

export class GuardPausedError extends Error {
  constructor(readonly until: number) {
    super('Requests to MyEpitech are paused to protect your account after a rate-limit response.');
    this.name = 'GuardPausedError';
  }
}

export interface GuardOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxConcurrent?: number;
  minGapMs?: number;
  /** Starts allowed per rolling minute, in total. */
  perMinute?: number;
  /** Share of {@link perMinute} background work may use. */
  backgroundPerMinute?: number;
  pauseMs?: number;
  onChange?: () => void;
}

interface Waiter {
  priority: Priority;
  resolve: () => void;
  reject: (e: Error) => void;
}

/**
 * Every request to MyEpitech goes through this guard. It keeps the extension
 * well-behaved without making the student wait: caching and sharing come
 * first, the budgets only stop runaway loops, and a rate-limit answer is
 * always respected:
 *
 * - GET responses are cached per route for as long as their data is useful,
 *   and identical GETs in flight are shared;
 * - at most `maxConcurrent` requests run at once, starts are spaced by
 *   `minGapMs`, and a rolling one-minute budget caps the total (background
 *   work gets a smaller share than what the student asked for);
 * - the first 429 (or 503) stops every request for at least `pauseMs`, or
 *   longer if the server says so; nothing retries through it.
 *
 * Callers mark work with {@link inBackground} or {@link fresh}; everything
 * else is treated as asked for by the student. The defaults are loose enough
 * that a page never waits on the guard in normal use, yet tight enough that a
 * bug looping on the API is stopped long before it could look like abuse.
 */
export class RequestGuard {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxConcurrent: number;
  private readonly minGapMs: number;
  private readonly perMinute: number;
  private readonly backgroundPerMinute: number;
  private readonly pauseMs: number;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly waiting: Waiter[] = [];
  private starts: number[] = [];
  private active = 0;
  private pausedUntil = 0;
  private lastStart = 0;
  private pumping = false;
  private epoch = 0;

  constructor(private readonly opts: GuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep
      ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxConcurrent = opts.maxConcurrent ?? 6;
    this.minGapMs = opts.minGapMs ?? 40;
    this.perMinute = opts.perMinute ?? 240;
    this.backgroundPerMinute = opts.backgroundPerMinute ?? 120;
    this.pauseMs = opts.pauseMs ?? 15 * M;
  }

  snapshot(): GuardSnapshot {
    this.prune();
    return {
      active: this.active,
      queued: this.waiting.length,
      lastMinute: this.starts.length,
      pausedUntil: this.pausedUntil > this.now() ? this.pausedUntil : null,
    };
  }

  /**
   * GET through the cache: a young enough answer is returned as is, an
   * identical request in flight is shared, otherwise `load` runs under the
   * budget and its answer is kept.
   */
  async get<T>(
    key: string,
    policy: CachePolicy,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    const age = hit ? this.now() - hit.at : Infinity;
    if (hit && age < (wantsFresh() ? policy.floor : policy.ttl)) {
      return copy(hit.value) as T;
    }

    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const epoch = this.epoch;
    const task = this.run(load)
      .then((value) => {
        if (policy.ttl > 0 && epoch === this.epoch) {
          this.cache.set(key, { at: this.now(), value: copy(value) });
        }

        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === task) this.inflight.delete(key);
      });
    this.inflight.set(key, task);
    return task;
  }

  /** Runs one request under the concurrency, spacing and per-minute budget. */
  async run<T>(
    load: () => Promise<T>,
    priority: Priority = currentPriority(),
  ): Promise<T> {
    if (this.pausedUntil > this.now()) {
      throw new GuardPausedError(this.pausedUntil);
    }

    if (
      !this.waiting.length
      && this.active < this.maxConcurrent
      && this.budgetWait(priority) === 0
    ) {
      this.active++;
      this.lastStart = this.now();
      this.starts.push(this.lastStart);
      this.changed();
    } else {
      await new Promise<void>((resolve, reject) => {
        const waiter = { priority, resolve, reject };
        if (priority === 'user') {
          const firstBackground = this.waiting.findIndex(
            (w) => w.priority === 'background',
          );
          this.waiting.splice(
            firstBackground < 0 ? this.waiting.length : firstBackground,
            0,
            waiter,
          );
        } else {
          this.waiting.push(waiter);
        }

        this.changed();
        void this.pump();
      });
    }

    try {
      return await load();
    } finally {
      this.active--;
      this.changed();
      void this.pump();
    }
  }

  /** Answers the server gave: a 429 or 503 stops everything for a while. */
  observe(status: number, retryAfter?: string | null): void {
    if (status !== 429 && status !== 503) return;
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const date = retryAfter && !Number.isFinite(seconds)
      ? Date.parse(retryAfter)
      : NaN;
    const asked = Number.isFinite(seconds)
      ? seconds * 1000
      : Number.isFinite(date)
        ? date - this.now()
        : 0;
    this.pausedUntil = Math.max(
      this.pausedUntil,
      this.now() + Math.max(this.pauseMs, asked),
    );
    const error = new GuardPausedError(this.pausedUntil);
    for (const w of this.waiting.splice(0)) w.reject(error);
    this.changed();
  }

  /**
   * Drops cached answers whose key contains one of `fragments` (after a change
   * made through the API).
   */
  invalidate(...fragments: string[]): void {
    for (const key of [...this.cache.keys()]) {
      if (fragments.some((f) => key.includes(f))) this.cache.delete(key);
    }
  }

  /**
   * Forgets every cached answer (sign-out, account change). The pause, if any,
   * stays.
   */
  clear(): void {
    this.epoch++;
    this.cache.clear();
    this.inflight.clear();
  }

  private prune(): void {
    const since = this.now() - M;
    while (this.starts.length && this.starts[0] <= since) this.starts.shift();
  }

  private budgetWait(priority: Priority): number {
    this.prune();
    const limit = priority === 'user'
      ? this.perMinute
      : this.backgroundPerMinute;
    const minute = this.starts.length >= limit
      ? this.starts[this.starts.length - limit] + M - this.now()
      : 0;
    const gap = this.lastStart + this.minGapMs - this.now();
    return Math.max(0, minute, gap);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiting.length && this.active < this.maxConcurrent) {
        if (this.pausedUntil > this.now()) {
          const error = new GuardPausedError(this.pausedUntil);
          for (const w of this.waiting.splice(0)) w.reject(error);
          break;
        }

        const next = this.waiting[0];
        const wait = this.budgetWait(next.priority);
        if (wait > 0) {
          await this.sleep(Math.min(wait, 1000));
          continue;
        }

        this.waiting.shift();
        this.active++;
        this.lastStart = this.now();
        this.starts.push(this.lastStart);
        this.changed();
        next.resolve();
      }
    } finally {
      this.pumping = false;
    }
  }

  private changed(): void {
    this.opts.onChange?.();
  }
}
