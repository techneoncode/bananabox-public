import * as vscode from 'vscode';
import { ApiError, EpitechClient } from '../api/client';
import { normalizeActivities, normalizeSlots } from '../domain/activities';
import type {
  ActivityLimitsVM,
  ActivitySlotVM,
  ActivityVM,
} from '../shared/types';
import { createT } from '../shared/i18n';
import { log } from '../util/log';
import { tr } from '../util/text';

const REFRESH_COOLDOWN = 30_000;
const CHANGE_COOLDOWN = 15_000;

/**
 * Shared cache and request guards for activity views, bookings and defense
 * reminders. `windows` lists the events (windows) of an activity and their
 * rooms; `my-activities` names only the first one.
 */
export class ActivityService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;
  private readonly cache = new Map<number, ActivityVM[]>();
  private readonly errors = new Map<number, string>();
  private readonly loads = new Map<number, Promise<void>>();
  private readonly refreshAfter = new Map<number, number>();
  private readonly mutations = new Set<number>();
  private changeAfter = 0;
  private rateLimited = false;
  private generation = 0;

  constructor(
    private readonly client: EpitechClient,
    private readonly identity: (projectId: number) => {
      login: string | null;
      registrationId: number | null;
    } = () => ({ login: null, registrationId: null }),
    private readonly t: (
      key: string,
      params?: Record<string, string | number>,
    ) => string = createT('en'),
    private readonly windows: (
      activity: ActivityVM,
    ) => Promise<Array<{ eventId: number; room: string | null }>> = async a =>
      a.eventId ? [{ eventId: a.eventId, room: null }] : [],
  ) {}

  get(projectId: number): ActivityVM[] | undefined {
    return this.cache.get(projectId);
  }

  error(projectId: number): string | undefined {
    return this.rateLimited
      ? this.t('activities.rateLimited')
      : this.errors.get(projectId);
  }

  limits(projectId: number): ActivityLimitsVM {
    return {
      refreshAfter: this.refreshAfter.get(projectId) ?? 0,
      changeAfter: this.changeAfter,
      rateLimited: this.rateLimited,
    };
  }

  busy(projectId: number): boolean {
    return this.loads.has(projectId) || this.mutations.has(projectId);
  }

  clear(): void {
    this.generation++;
    this.cache.clear();
    this.errors.clear();
    this.loads.clear();
    this.mutations.clear();
    this.refreshAfter.clear();
    this.changeAfter = 0;
  }

  load(projectId: number): Promise<void> {
    const pending = this.loads.get(projectId);
    if (pending) return pending;
    if (this.rateLimited
      || this.mutations.size
      || Date.now() < (this.refreshAfter.get(projectId) ?? 0)) {
      this.emitter.fire(projectId);
      return Promise.resolve();
    }

    const gen = this.generation;
    this.refreshAfter.set(projectId, Date.now() + REFRESH_COOLDOWN);
    const request = this.fetch(projectId, gen).finally(() => {
      if (this.loads.get(projectId) === request) this.loads.delete(projectId);
      if (gen === this.generation) this.emitter.fire(projectId);
    });
    this.loads.set(projectId, request);
    this.emitter.fire(projectId);
    return request;
  }

  private pauseOnRateLimit(e: unknown): void {
    if (e instanceof ApiError && e.status === 429) this.rateLimited = true;
  }

  /**
   * Slots of every window of the activity, each tagged with its event and room.
   */
  private async readSlots(
    projectId: number,
    activity: ActivityVM,
  ): Promise<ActivitySlotVM[]> {
    if (this.rateLimited) throw new Error(this.t('activities.rateLimited'));
    const { login, registrationId } = this.identity(projectId);
    const eventIds = new Set(activity.eventIds ?? [activity.eventId!]);
    const out: ActivitySlotVM[] = [];
    try {
      for (const eventId of eventIds) {
        const raw = await this.client.eventSlots(eventId);
        if (!Array.isArray(raw)) {
          throw new Error(tr('Invalid event slots response'));
        }
        out.push(...normalizeSlots(raw, login, registrationId).map(s => ({
          ...s,
          eventId,
          room: activity.windowRooms?.[eventId] ?? null,
        })));
      }
    } catch (e) {
      this.pauseOnRateLimit(e);
      throw e;
    }
    return out.sort((a, b) =>
      Date.parse(a.startDate) - Date.parse(b.startDate) || a.id - b.id);
  }

  private async fetch(projectId: number, gen: number): Promise<void> {
    try {
      const activities = normalizeActivities(
        await this.client.myActivities(projectId),
      );
      for (const a of activities) {
        if (gen !== this.generation) return;
        if (!a.eventId) continue;
        if (Date.parse(a.endDate) < Date.now() - 86_400_000) {
          a.slots = this.cache.get(projectId)
            ?.find(old => old.id === a.id && old.eventId === a.eventId)
            ?.slots;
          continue;
        }

        try {
          const windows = await this.windows(a).catch(() => []);
          if (windows.length) {
            a.eventIds = [
              ...new Set([a.eventId, ...windows.map(w => w.eventId)]),
            ];
            a.windowRooms = Object.fromEntries(
              windows.map(w => [w.eventId, w.room]),
            );
            a.location ??= [
              ...new Set(windows.map(w => w.room).filter(Boolean)),
            ].join(', ') || null;
          }
          a.slots = await this.readSlots(projectId, a);
        } catch (e) {
          if (this.rateLimited) {
            a.slotsError = this.t('activities.rateLimited');
          } else {
            a.slotsError = e instanceof Error ? e.message : String(e);
          }
          a.slots = this.cache.get(projectId)
            ?.find(old => old.id === a.id && old.eventId === a.eventId)
            ?.slots;
        }
      }
      if (gen !== this.generation) return;
      this.cache.set(projectId, activities);
      this.errors.delete(projectId);
    } catch (e) {
      if (gen !== this.generation) return;
      this.pauseOnRateLimit(e);
      log().debug(`activities unavailable for project ${projectId}`, e);
      this.errors.set(projectId, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * One guarded transaction: read once, DELETE the old booking if switching,
   * then POST the new one.
   */
  async changeSlot(
    projectId: number,
    activityId: number,
    slotId: number,
    cancel: boolean,
    fromSlotId?: number,
  ): Promise<void> {
    if (this.rateLimited) throw new Error(this.t('activities.rateLimited'));
    if (this.mutations.size) throw new Error(this.t('activities.changeBusy'));
    if (Date.now() < this.changeAfter) {
      throw new Error(this.t('activities.changeCooldown'));
    }
    const activity = this.cache.get(projectId)?.find(a => a.id === activityId);
    if (!activity?.eventId
      || !Number.isSafeInteger(slotId)
      || (fromSlotId !== undefined
        && (!Number.isSafeInteger(fromSlotId)
          || fromSlotId === slotId
          || cancel))) {
      throw new Error(this.t('activities.invalidSlot'));
    }

    const gen = this.generation;
    let wrote = false;
    let released = false;
    this.mutations.add(projectId);
    this.changeAfter = Date.now() + CHANGE_COOLDOWN;
    this.emitter.fire(projectId);
    try {
      await this.loads.get(projectId);
      if (gen !== this.generation) return;
      const slots = await this.readSlots(projectId, activity);
      if (gen !== this.generation) return;
      this.setSlots(projectId, activityId, slots);
      const target = slots.find(s => s.id === slotId);
      if (!target || Date.parse(target.startDate) <= Date.now()) {
        throw new Error(this.t('activities.slotUnavailable'));
      }

      if (cancel) {
        if (!target.mine) throw new Error(this.t('activities.notYourSlot'));
        wrote = true;
        await this.client.unregisterSlot(
          target.eventId ?? activity.eventId,
          slotId,
        );
        if (gen === this.generation) {
          this.releaseCachedSlot(projectId, activityId, slotId);
        }
      } else {
        const mine = slots.filter(s => s.mine);
        if (!target.available) {
          throw new Error(this.t('activities.slotOccupied'));
        }
        if (fromSlotId !== undefined) {
          const old = mine.find(s => s.id === fromSlotId);
          if (!old
            || mine.length !== 1
            || Date.parse(old.startDate) <= Date.now()) {
            throw new Error(this.t('activities.bookingChanged'));
          }
          wrote = true;
          await this.client.unregisterSlot(
            old.eventId ?? activity.eventId,
            fromSlotId,
          );
          released = true;
          if (gen !== this.generation) return;
          this.releaseCachedSlot(projectId, activityId, fromSlotId);
        } else if (mine.length) {
          throw new Error(this.t('activities.alreadyBooked'));
        }

        if (gen !== this.generation || this.rateLimited) return;
        wrote = true;
        await this.client.registerSlot(
          target.eventId ?? activity.eventId,
          slotId,
        );
        if (gen === this.generation) {
          this.setSlots(
            projectId,
            activityId,
            this.cache.get(projectId)!
              .find(a => a.id === activityId)!
              .slots!.map(s => {
                if (s.id !== slotId) return s;
                return {
                  ...s,
                  mine: true,
                  available: false,
                  groupName: mine[0]?.groupName ?? null,
                  members: mine[0]?.members ?? [],
                };
              }),
          );
        }
      }
    } catch (e) {
      this.pauseOnRateLimit(e);
      if (released) {
        throw new Error(this.t('activities.switchFailed', {
          message: e instanceof Error ? e.message : String(e),
        }));
      }
      throw e;
    } finally {
      if (gen === this.generation) {
        if (wrote && !this.rateLimited) {
          try {
            const slots = await this.readSlots(projectId, activity);
            if (gen === this.generation) {
              this.setSlots(projectId, activityId, slots);
            }
          } catch (e) {
            const a = this.cache.get(projectId)
              ?.find(a => a.id === activityId);
            if (gen === this.generation && a) {
              a.slotsError = e instanceof Error ? e.message : String(e);
            }
          }
        }
        if (gen === this.generation) {
          this.refreshAfter.set(projectId, Date.now() + REFRESH_COOLDOWN);
          this.changeAfter = Date.now() + CHANGE_COOLDOWN;
          this.mutations.delete(projectId);
          this.emitter.fire(projectId);
        }
      }
    }
  }

  private setSlots(
    projectId: number,
    activityId: number,
    slots: ActivitySlotVM[],
  ): void {
    const a = this.cache.get(projectId)?.find(a => a.id === activityId);
    if (a) {
      a.slots = slots;
      if (slots.length) {
        a.status = slots.some(s => s.mine) ? 'registered' : 'not_registered';
      }
      delete a.slotsError;
    }
  }

  private releaseCachedSlot(
    projectId: number,
    activityId: number,
    slotId: number,
  ): void {
    const slots = this.cache.get(projectId)
      ?.find(a => a.id === activityId)
      ?.slots;
    if (!slots) return;
    this.setSlots(projectId, activityId, slots.map(s => {
      if (s.id !== slotId) return s;
      return {
        ...s,
        mine: false,
        available: true,
        groupName: null,
        members: [],
      };
    }));
  }

  dispose(): void {
    this.clear();
    this.emitter.dispose();
  }
}
