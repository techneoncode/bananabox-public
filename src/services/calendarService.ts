import * as vscode from 'vscode';
import { ApiError, EpitechClient } from '../api/client';
import { fresh, inBackground } from '../api/requestGuard';
import { normalizeSlots } from '../domain/activities';
import {
  canRegister,
  isoDay,
  missingPeople,
  normalizeEvents,
  normalizePeople,
  pickSlot,
  schoolYear,
  validatePrefs,
  weekStart,
} from '../domain/calendar';
import type {
  ActivitySlotVM,
  CalendarEventVM,
  CalendarPrefs,
  CalendarVM,
  Person,
  ProjectVM,
} from '../shared/types';
import { log } from '../util/log';
import { tr } from '../util/text';

const WRITE_GAP = 8_000;
const AUTO_EVERY = 10 * 60_000;
const AUTO_WEEKS = 3;
const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? v as Record<string, any> : {};
const DEBOUNCE = 250;
const CACHED_RANGES = 8;
const DEFAULT_PREFS: CalendarPrefs = { autoRegister: false, preferences: [] };

export interface CalendarIdentity {
  login: string | null;
  promotion: number | null;
  cursus: string | null;
  projects: readonly ProjectVM[];
}

/**
 * The student's calendar: required sessions from their units and projects,
 * registration (simple or by slot), and the automatic registration that runs
 * while VS Code is open.
 */
export class CalendarService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private from = isoDay(weekStart(new Date()));
  private to = isoDay(
    new Date(weekStart(new Date()).getTime() + 6 * 86_400_000),
  );
  private events: CalendarEventVM[] | null = null;
  private loading = false;
  private error: string | null = null;
  private pending: number | null = null;
  private history: CalendarVM['log'] = [];
  private units: { year: number; codes: Set<string> } | null = null;
  private lastWrite = 0;
  private writing: Promise<unknown> = Promise.resolve();
  private rateLimited = false;
  private readonly skipped = new Set<number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstRun: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private loadTimer: ReturnType<typeof setTimeout> | undefined;
  private loadWaiters: Array<() => void> = [];
  private forceNext = false;
  private autoRunning = false;

  constructor(
    private readonly client: EpitechClient,
    private readonly storage: Pick<vscode.Memento, 'get' | 'update'>,
    private readonly scope: () => string,
    private readonly identity: () => CalendarIdentity,
  ) {}

  private key() {
    return `bananabox.calendarPrefs.v1:${encodeURIComponent(this.scope())}`;
  }

  prefs(): CalendarPrefs {
    return validatePrefs(this.storage.get(this.key())) ?? DEFAULT_PREFS;
  }

  async setPrefs(raw: unknown): Promise<void> {
    const prefs = validatePrefs(raw);
    if (!prefs) throw new Error(tr('Invalid calendar preferences'));
    await this.storage.update(this.key(), prefs);
    this.emitter.fire();
    if (prefs.autoRegister || prefs.preferences.length) void this.autoRun();
  }

  snapshot(): CalendarVM {
    return {
      from: this.from,
      to: this.to,
      events: this.events,
      loading: this.loading,
      error: this.error,
      prefs: this.prefs(),
      pending: this.pending,
      log: this.history,
    };
  }

  /**
   * Starts the automatic runs; they only act when the student enabled
   * something.
   */
  start(): void {
    this.timer ??= setInterval(() => void this.autoRun(), AUTO_EVERY);
    this.firstRun ??= setTimeout(() => void this.autoRun(), 30_000);
  }

  clear(): void {
    this.generation++;
    this.events = null;
    this.error = null;
    this.units = null;
    this.pending = null;
    this.history = [];
    this.skipped.clear();
    this.emitter.fire();
  }

  dispose(): void {
    clearInterval(this.timer);
    clearTimeout(this.firstRun);
    clearTimeout(this.loadTimer);
    this.loadWaiters.splice(0).forEach(resolve => resolve());
    this.emitter.dispose();
  }

  private async unitCodes(): Promise<Set<string>> {
    const year = schoolYear(new Date());
    if (this.units?.year === year) return this.units.codes;
    const codes = new Set((await this.client.unitInstances(year))
      .filter(u => u.isRegistered === true && typeof u.unitCode === 'string')
      .map(u => u.unitCode as string));
    this.units = { year, codes };
    return codes;
  }

  private async fetchRange(
    from: string,
    to: string,
  ): Promise<CalendarEventVM[]> {
    const { promotion, cursus, projects } = this.identity();
    const promotions = promotion && cursus
      ? `${cursus}:${promotion}`
      : undefined;
    const [all, mine, units] = await Promise.all([
      this.client.events({ promotions, startDate: from, endDate: to }),
      this.client.events({ startDate: from, endDate: to, registered: 'me' }),
      this.unitCodes(),
    ]);
    return normalizeEvents(
      all,
      mine,
      units,
      new Set(projects.filter(p => p.registered).map(p => p.id)),
    );
  }

  /**
   * The events (windows) of an activity between its dates, with their rooms.
   * One `/api/events` read for the span, shared with the calendar's own reads
   * through the request cache.
   */
  async activityWindows(
    activityId: number,
    start: string,
    end: string,
  ): Promise<Array<{ eventId: number; room: string | null }>> {
    const { promotion, cursus } = this.identity();
    const raw = await this.client.events({
      promotions: promotion && cursus ? `${cursus}:${promotion}` : undefined,
      startDate: isoDay(new Date(start)),
      endDate: isoDay(new Date(end)),
    });
    return (Array.isArray(raw) ? raw : [])
      .filter(e => record(e).activityInstanceId === activityId
        && Number.isSafeInteger(record(e).id))
      .map(e => ({
        eventId: e.id as number,
        room: Array.isArray(e.rooms)
          ? e.rooms
            .map((r: any) => record(r).name)
            .filter((n: unknown) => typeof n === 'string')
            .join(', ') || null
          : null,
      }));
  }

  /**
   * Shows the range `from` to `to` (`YYYY-MM-DD`, inclusive). A range seen
   * before shows at once from the cache while it is read again; calls within
   * `DEBOUNCE` collapse into one read of the last range (clicking › › › reads
   * one week). `force` (the refresh button) asks for fresh data, which the
   * request guard still refuses within the route's floor.
   */
  load(from = this.from, to = this.to, force = false): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)
      || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || Date.parse(to) - Date.parse(from) > 45 * 86_400_000
      || to < from) {
      return Promise.resolve();
    }
    if (from !== this.from || to !== this.to) {
      this.events = this.cached()[`${from}|${to}`]?.events ?? null;
    }
    this.from = from;
    this.to = to;
    this.loading = true;
    this.error = null;
    this.forceNext ||= force;
    this.emitter.fire();
    clearTimeout(this.loadTimer);
    return new Promise(resolve => {
      this.loadWaiters.push(resolve);
      this.loadTimer = setTimeout(() => void this.readShown(), DEBOUNCE);
    });
  }

  private async readShown(): Promise<void> {
    const waiters = this.loadWaiters.splice(0);
    const force = this.forceNext;
    const { from, to } = this;
    const gen = this.generation;
    this.forceNext = false;
    try {
      const events = await (force
        ? fresh(() => this.fetchRange(from, to))
        : this.fetchRange(from, to));
      if (gen === this.generation && this.from === from && this.to === to) {
        this.events = events;
        await this.remember(from, to, events);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) this.rateLimited = true;
      if (gen === this.generation && this.from === from && this.to === to) {
        this.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (gen === this.generation && this.from === from && this.to === to) {
        this.loading = false;
      }
      this.emitter.fire();
      waiters.forEach(resolve => resolve());
    }
  }

  /**
   * Weeks already read, kept in VS Code storage per account so the calendar
   * opens with data (newest `CACHED_RANGES`).
   */
  private cacheKey() {
    return `bananabox.calendarCache.v1:${encodeURIComponent(this.scope())}`;
  }

  private cached(): Record<string, { at: number; events: CalendarEventVM[] }> {
    const raw = this.storage.get<
      Record<string, { at: number; events: CalendarEventVM[] }>
    >(this.cacheKey());
    return raw && typeof raw === 'object'
      ? Object.fromEntries(
        Object.entries(raw).filter(([, v]) =>
          typeof v?.at === 'number' && Array.isArray(v.events)),
      )
      : {};
  }

  private async remember(
    from: string,
    to: string,
    events: CalendarEventVM[],
  ): Promise<void> {
    const all = {
      ...this.cached(),
      [`${from}|${to}`]: { at: Date.now(), events },
    };
    const kept = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, CACHED_RANGES);
    await Promise.resolve(
      this.storage.update(this.cacheKey(), Object.fromEntries(kept)),
    ).catch(() => undefined);
  }

  async slots(event: CalendarEventVM): Promise<ActivitySlotVM[]> {
    const project = this.identity().projects
      .find(p => p.id === event.projectId);
    return normalizeSlots(
      await this.client.eventSlots(event.id),
      this.identity().login,
      project?.registrationId ?? null,
    );
  }

  /**
   * Who is registered to a session without slots, and who should be but holds
   * none of the activity's sessions: the project's groups when it belongs to a
   * project, else the unit's students. `missing` is null when it cannot be
   * known.
   */
  async people(event: CalendarEventVM): Promise<{
    people: Person[];
    missing: Person[] | null;
  }> {
    const people = normalizePeople(
      await this.client.eventRegistrations(event.id),
    );
    try {
      if (!event.unitCode || !event.unitInstance || !event.schoolYear) {
        return { people, missing: null };
      }
      const ref = {
        schoolYear: event.schoolYear,
        unitCode: event.unitCode,
        instanceCode: event.unitInstance,
      };
      const expected = normalizePeople(event.projectId !== null
        ? record(
          await this.client.projectDetail(event.projectId, ref),
        ).registrations
        : await this.client.unitRegistrations(ref));
      const others: Person[][] = [];
      for (const o of this.events ?? []) {
        if (o.id !== event.id
          && o.activityId
          && o.activityId === event.activityId
          && !o.slots) {
          others.push(normalizePeople(
            await this.client.eventRegistrations(o.id),
          ));
        }
      }
      return {
        people,
        missing: expected.length
          ? missingPeople(expected, people, ...others)
          : null,
      };
    } catch (e) {
      log().debug(`expected attendees unavailable for event ${event.id}`, e);
      return { people, missing: null };
    }
  }

  /** One registration at a time, spaced by `WRITE_GAP`. */
  private write<T>(eventId: number, run: () => Promise<T>): Promise<T> {
    const next = this.writing.then(async () => {
      if (this.rateLimited) {
        throw new Error(tr('MyEpitech asked to slow down; registrations are paused for this session.'));
      }
      const wait = this.lastWrite + WRITE_GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.pending = eventId;
      this.emitter.fire();
      try {
        return await run();
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) this.rateLimited = true;
        throw e;
      } finally {
        this.lastWrite = Date.now();
        this.pending = null;
      }
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /**
   * Registers to an event shown in the calendar: to `slotId` when it has slots.
   */
  async register(eventId: number, slotId?: number): Promise<void> {
    const event = this.events?.find(e => e.id === eventId);
    if (!event || !canRegister(event)) {
      throw new Error(tr('Registration is closed for this session.'));
    }
    if (event.slots !== (slotId !== undefined)
      || (slotId !== undefined && !Number.isSafeInteger(slotId))) {
      throw new Error(tr('Pick a time slot for this session.'));
    }

    try {
      await this.write(eventId, () => slotId !== undefined
        ? this.bookAt(event, slotId)
        : this.client.registerEvent(eventId));
    } finally {
      await this.load();
    }
  }

  /**
   * Leaves a session: the student's slot when it has slots, the simple
   * registration otherwise.
   */
  async unregister(eventId: number): Promise<void> {
    const event = this.events?.find(e => e.id === eventId);
    if (!event?.registered || Date.parse(event.start) <= Date.now()) {
      throw new Error(tr('This session can no longer be left.'));
    }
    try {
      await this.write(eventId, async () => {
        if (!event.slots) return this.client.unregisterEvent(eventId);
        const mine = (await this.slots(event)).find(s => s.mine);
        if (!mine) {
          throw new Error(tr('Your slot was not found; refresh and try again.'));
        }
        return this.client.unregisterSlot(eventId, mine.id);
      });
    } finally {
      await this.load();
    }
  }

  /**
   * Books a place at the time of `slotId`: several groups share one time (a
   * Defense takes three), so the first place still free at that time is taken,
   * then the next one if the API refuses it (taken meanwhile).
   */
  private async bookAt(event: CalendarEventVM, slotId: number): Promise<void> {
    const slots = await this.slots(event);
    const at = slots.find(s => s.id === slotId)?.startDate;
    const places = slots.filter(s => s.available
      && s.startDate === at
      && Date.parse(s.startDate) > Date.now());
    if (!at || !places.length) throw new Error(tr('This time is no longer free.'));
    for (const [i, place] of places.entries()) {
      try {
        await this.client.registerSlot(event.id, place.id);
        return;
      } catch (e) {
        if (i === places.length - 1
          || !(e instanceof ApiError)
          || ![400, 403, 409, 422].includes(e.status)) {
          throw e;
        }
      }
    }
  }

  private note(text: string, ok: boolean): void {
    this.history = [{ at: Date.now(), text, ok }, ...this.history].slice(0, 20);
  }

  /**
   * Registers to every open required session without slots, and books
   * preferred slots as soon as one is free.
   */
  autoRun(): Promise<void> {
    return inBackground(() => this.runAuto());
  }

  private async runAuto(): Promise<void> {
    const prefs = this.prefs();
    if (this.autoRunning
      || this.rateLimited
      || (!prefs.autoRegister && !prefs.preferences.length)
      || !this.identity().login) {
      return;
    }

    this.autoRunning = true;
    const gen = this.generation;
    let changed = false;
    try {
      const start = weekStart(new Date());
      const events = await this.fetchRange(
        isoDay(start),
        isoDay(new Date(start.getTime() + (AUTO_WEEKS * 7 - 1) * 86_400_000)),
      );
      for (const event of events) {
        if (gen !== this.generation || this.rateLimited) return;
        if (!event.required
          || !canRegister(event)
          || event.full
          || this.skipped.has(event.id)) {
          continue;
        }
        try {
          if (!event.slots) {
            if (!prefs.autoRegister || event.sessions > 1) continue;
            await this.write(
              event.id,
              () => this.client.registerEvent(event.id),
            );
            this.note(tr('Registered to {p0}', { p0: event.title }), true);
            changed = true;
          } else if (prefs.preferences.some(p =>
            p.type.toLowerCase() === event.type.toLowerCase())) {
            const slot = pickSlot(event.type, await this.slots(event), prefs);
            if (!slot) continue;
            await this.write(event.id, () => this.bookAt(event, slot.id));
            this.note(tr('Booked {p0} at {p1}', { p0: event.title, p1: new Date(slot.startDate).toLocaleString() }), true);
            changed = true;
          }
        } catch (e) {
          this.skipped.add(event.id);
          this.note(tr('Could not register to {p0}: {p1}', { p0: event.title, p1: e instanceof Error ? e.message : String(e) }), false);
          log().warn(`automatic registration failed for event ${event.id}`, e);
          changed = true;
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) this.rateLimited = true;
      log().debug('automatic calendar run failed', e);
    } finally {
      this.autoRunning = false;
      if (changed && gen === this.generation) await this.load();
    }
  }
}
