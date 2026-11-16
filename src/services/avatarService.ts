import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Same lifetime the API announces (`cache-control: private, max-age=86400`).
 */
export const AVATAR_TTL = 86_400_000;
const PRUNE_AFTER = 14 * AVATAR_TTL;
const MAX_ENTRIES = 1000;
const CONCURRENCY = 3;
const LOGIN = /^[a-z0-9._+-]+@[a-z0-9.-]+$/i;

interface Entry {
  fetchedAt: number;
  usedAt: number;
  mime: string | null;
}
type Fetcher = (login: string) => Promise<Buffer | null>;

export const validAvatarLogin = (login: unknown): login is string =>
  typeof login === 'string'
  && login.length <= 254
  && LOGIN.test(login);

/**
 * People's profile pictures as data URIs, cached in memory and on disk for a
 * day so each picture is requested at most once per day, whatever the number
 * of views showing it.
 */
export class AvatarService {
  private readonly memory = new Map<string, string | null>();
  private index: Record<string, Entry> = {};
  private loaded: Promise<void> | undefined;
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly queue: Array<() => void> = [];
  private running = 0;
  private generation = 0;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dir: string,
    private readonly fetcher: Fetcher,
    private readonly now: () => number = Date.now,
  ) {}

  private key(login: string): string {
    return createHash('sha1').update(login.toLowerCase()).digest('hex');
  }

  private file(key: string): string {
    return path.join(this.dir, `${key}.jpg`);
  }

  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        this.index = JSON.parse(
          await fs.readFile(path.join(this.dir, 'index.json'), 'utf8'),
        ) ?? {};
      } catch {
        this.index = {};
      }

      const now = this.now();
      const stale = Object.entries(this.index)
        .filter(([, e]) => now - e.usedAt > PRUNE_AFTER)
        .map(([k]) => k);
      const excess = Object.entries(this.index)
        .sort((a, b) => b[1].usedAt - a[1].usedAt)
        .slice(MAX_ENTRIES)
        .map(([k]) => k);

      for (const k of new Set([...stale, ...excess])) {
        delete this.index[k];
        void fs.rm(this.file(k), { force: true });
      }
    })();
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    const gen = this.generation;
    this.saveTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      void fs.mkdir(this.dir, { recursive: true })
        .then(() => fs.writeFile(
          path.join(this.dir, 'index.json'),
          JSON.stringify(this.index),
        ))
        .catch(() => undefined);
    }, 500);
  }

  /**
   * Cached pictures available right now (memory or disk), without any network
   * call.
   */
  async cached(logins: string[]): Promise<Record<string, string | null>> {
    await this.load();
    const out: Record<string, string | null> = {};
    for (const login of logins.filter(validAvatarLogin)) {
      const value = await this.fromDisk(login);
      if (value !== undefined) out[login] = value;
    }
    return out;
  }

  private async fromDisk(login: string): Promise<string | null | undefined> {
    if (this.memory.has(login)) return this.memory.get(login);
    const key = this.key(login);
    const entry = this.index[key];
    if (!entry) return undefined;
    if (entry.mime === null) {
      this.memory.set(login, null);
      return null;
    }
    try {
      const value = `data:${entry.mime};base64,${(await fs.readFile(this.file(key))).toString('base64')}`;
      this.memory.set(login, value);
      return value;
    } catch {
      delete this.index[key];
      return undefined;
    }
  }

  /** Logins whose picture is missing or older than a day. */
  async due(logins: string[]): Promise<string[]> {
    await this.load();
    const now = this.now();
    return [...new Set(logins.filter(validAvatarLogin))].filter(l => {
      const e = this.index[this.key(l)];
      return !e || now - e.fetchedAt > AVATAR_TTL;
    });
  }

  /**
   * Fetches one picture (deduplicated, at most three at a time). A failed
   * refresh keeps the stale copy.
   */
  get(login: string): Promise<string | null> {
    if (!validAvatarLogin(login)) return Promise.resolve(null);
    const running = this.inflight.get(login);
    if (running) return running;

    const gen = this.generation;
    const task = this.slot(async () => {
      await this.load();
      const key = this.key(login);
      const now = this.now();
      const entry = this.index[key];
      if (entry && now - entry.fetchedAt <= AVATAR_TTL) {
        const cached = await this.fromDisk(login);
        if (cached !== undefined) return cached;
      }

      try {
        const bytes = await this.fetcher(login);
        if (gen !== this.generation) return null;
        const mime = bytes ? sniff(bytes) : null;
        if (bytes && mime) {
          await fs.mkdir(this.dir, { recursive: true });
          await fs.writeFile(this.file(key), bytes);
        }
        this.index[key] = {
          fetchedAt: now,
          usedAt: now,
          mime: bytes && mime ? mime : null,
        };
        const value = bytes && mime
          ? `data:${mime};base64,${bytes.toString('base64')}`
          : null;
        this.memory.set(login, value);
        this.save();
        return value;
      } catch {
        const stale = await this.fromDisk(login);
        return stale ?? null;
      }
    }).finally(() => this.inflight.delete(login));
    this.inflight.set(login, task);
    return task;
  }

  private slot<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            this.queue.shift()?.();
          });
      };
      if (this.running < CONCURRENCY) run();
      else this.queue.push(run);
    });
  }

  /** Drops every cached picture, in memory and on disk (sign-out). */
  async clear(): Promise<void> {
    this.generation++;
    clearTimeout(this.saveTimer);
    this.memory.clear();
    this.index = {};
    this.loaded = Promise.resolve();
    await fs.rm(this.dir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

function sniff(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'GIF8') return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF'
    && bytes.subarray(8, 12).toString() === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
