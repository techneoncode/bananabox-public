import type {
  ActivitySlotVM,
  CalendarEventVM,
  CalendarPrefs,
  Person,
  SlotPreference,
} from '../shared/types';
import { activityKind } from './activities';

const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? v as Record<string, any> : {};
const validDate = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v));
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** "Midterm Defense - my_ls" → "Midterm Defense": the kind of session a slot preference applies to. */
export const eventType = (name: string) =>
  name.split(/\s+-\s+/)[0].trim() || name.trim();

/** `YYYY-MM-DD` of a local date. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday 00:00 (local) of the week holding `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/** The school year a date belongs to (it starts in late August). */
export const schoolYear = (d: Date) =>
  d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;

const EXTRACURRICULAR = /^(?:S-|B-INN-)/i;
const REQUIRED_NAME = /kick[\s-]?off|mid[\s-]?term|defen[cs]e|soutenance|follow[\s-]?up|suivi|review|evaluation|évaluation|exam|mcq|qcm|unit presentation|réunion administrative/i;
const OPTIONAL_NAME = /boot[\s-]?strap|rattrapage|retake|resit|assistance|révision libre|revision|permanence/i;
const MANDATORY_TEXT = /\b(?:mandatory|obligatoires?|compulsory)\b/i;

/** Whether a session of a unit (and project) the student is registered to must be attended. */
export function isRequiredSession(name: string, description: string): boolean {
  if (MANDATORY_TEXT.test(description)) return true;
  return REQUIRED_NAME.test(name) && !OPTIONAL_NAME.test(name);
}

/**
 * Normalises `/api/events` to the sessions of the student's units: those of a pedagogical unit they are registered to
 * and, when tied to a project, of a project they are registered to. Among them `required` marks what must be attended
 * (see `isRequiredSession`). An activity offered as several sessions needs only one: once the student holds one, the
 * others are `alternative`. Events the student is registered to are always kept.
 */
export function normalizeEvents(
  raw: unknown,
  mine: unknown,
  units: ReadonlySet<string>,
  projects: ReadonlySet<number>,
): CalendarEventVM[] {
  const registered = new Map<number, Record<string, any>>();
  for (const e of Array.isArray(mine) ? mine : []) {
    const r = record(e);
    if (Number.isSafeInteger(r.id)) registered.set(r.id, r);
  }

  const all = new Map<number, Record<string, any>>();
  for (const e of [
    ...(Array.isArray(raw) ? raw : []),
    ...registered.values(),
  ]) {
    const r = record(e);
    if (Number.isSafeInteger(r.id)) {
      all.set(r.id, { ...r, ...registered.get(r.id) });
    }
  }

  const out: CalendarEventVM[] = [];
  for (const e of all.values()) {
    if (!validDate(e.startDate) || !validDate(e.endDate)) continue;
    const projectId = Number.isSafeInteger(e.projectInstanceId)
      ? e.projectInstanceId as number
      : null;
    const isMine = registered.has(e.id);
    const mineUnit = typeof e.unitCode === 'string'
      && units.has(e.unitCode)
      && !EXTRACURRICULAR.test(e.unitCode)
      && (projectId === null || projects.has(projectId));
    if (!isMine && !mineUnit) continue;

    const title = String(
      e.fullTitle || e.activityName || e.title || 'Session',
    ).trim();
    const activityId = num(e.activityInstanceId);
    const slots = e.activitySlotsEnabled === true;
    const count = slots
      ? num(e.slotRegistrationsCount)
      : num(e.simpleRegistrationsCount);
    const capacity = slots
      ? num(e.slotsCount) || null
      : num(e.maxCapacity) || null;
    const deadlineHours = num(e.registrationDeadlineHours);
    out.push({
      id: e.id,
      activityId,
      title,
      type: eventType(title),
      kind: activityKind(title),
      start: e.startDate,
      end: e.endDate,
      room: Array.isArray(e.rooms) && e.rooms.length
        ? e.rooms
          .map((r: any) => record(r).name)
          .filter((n: unknown) => typeof n === 'string')
          .join(', ') || null
        : null,
      unitCode: typeof e.unitCode === 'string' ? e.unitCode : '',
      unitInstance: typeof e.unitInstanceCode === 'string'
        ? e.unitInstanceCode
        : '',
      schoolYear: Number.isSafeInteger(e.schoolYear) ? e.schoolYear : 0,
      unitName: typeof e.unitName === 'string' ? e.unitName : '',
      projectId,
      slots,
      registered: isMine,
      required: mineUnit
        && isRequiredSession(title, String(e.activityDescription ?? '')),
      alternative: !isMine && !!activityId
        && [...registered.values()]
          .some(r => r.activityInstanceId === activityId),
      sessions: activityId
        ? [...all.values()]
          .filter(o => o.activityInstanceId === activityId)
          .length
        : 1,
      mySlot: validDate(e.mySlotStartDate) && validDate(e.mySlotEndDate)
        ? { start: e.mySlotStartDate, end: e.mySlotEndDate }
        : null,
      count,
      capacity,
      full: capacity !== null && count >= capacity,
      deadline: deadlineHours
        ? new Date(Date.parse(e.startDate) - deadlineHours * 3_600_000)
          .toISOString()
        : null,
      exam: e.isExam === true,
    });
  }

  return out.sort((a, b) =>
    Date.parse(a.start) - Date.parse(b.start) || a.id - b.id);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Whether a slot starts at a preferred local time (and weekday, when the preference names one). */
export function slotMatches(
  slot: { startDate: string },
  pref: SlotPreference,
): boolean {
  const d = new Date(slot.startDate);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}` === pref.time
    && (pref.day === null || d.getDay() === pref.day);
}

/** The first free slot in the student's order of preference for this event type; null when none is free. */
export function pickSlot(
  type: string,
  slots: readonly ActivitySlotVM[],
  prefs: CalendarPrefs,
): ActivitySlotVM | null {
  const wanted = prefs.preferences
    .find(p => p.type.toLowerCase() === type.toLowerCase());
  for (const pref of wanted?.slots ?? []) {
    const slot = slots.find(s => s.available && slotMatches(s, pref));
    if (slot) return slot;
  }
  return null;
}

/** Whether registration is still open: before the deadline and before the session starts. */
export const canRegister = (e: CalendarEventVM, now = Date.now()) =>
  !e.registered && !e.alternative && Date.parse(e.start) > now
    && (!e.deadline || Date.parse(e.deadline) > now);

export function validatePrefs(raw: unknown): CalendarPrefs | null {
  const r = record(raw);
  if (typeof r.autoRegister !== 'boolean'
    || !Array.isArray(r.preferences)
    || r.preferences.length > 20) {
    return null;
  }
  const preferences: CalendarPrefs['preferences'] = [];
  for (const p of r.preferences) {
    const q = record(p);
    if (typeof q.type !== 'string'
      || !q.type.trim()
      || q.type.length > 80
      || !Array.isArray(q.slots)
      || q.slots.length > 20) {
      return null;
    }
    const slots: SlotPreference[] = [];
    for (const s of q.slots) {
      const t = record(s);
      if (typeof t.time !== 'string'
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t.time)
        || !(t.day === null
          || (Number.isInteger(t.day) && t.day >= 0 && t.day <= 6))) {
        return null;
      }
      slots.push({ day: t.day, time: t.time });
    }
    preferences.push({ type: q.type.trim(), slots });
  }

  return { autoRegister: r.autoRegister, preferences };
}

/**
 * People registered to a session without slots: `[{ student: { login, firstname, lastname } }]` (verified against
 * single_slot_registration_and_unregistration.har); `{ data }`, `user`, group members and bare people are read too.
 */
export function normalizePeople(raw: unknown): Person[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record(raw).data)
      ? record(raw).data
      : [];
  const people = new Map<string, Person>();
  const add = (p: unknown) => {
    const r = record(p);
    if (typeof r.login !== 'string'
      || !r.login.includes('@')
      || people.has(r.login.toLowerCase())) {
      return;
    }
    people.set(r.login.toLowerCase(), {
      login: r.login,
      name: [r.firstname, r.lastname]
        .filter(v => typeof v === 'string')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || r.login,
    });
  };
  const accepted = (members: unknown) => Array.isArray(members)
    ? members.filter((m: any) => !m.status || m.status === 'accepted')
    : [];
  for (const entry of list) {
    const r = record(entry);
    const group = record(r.projectRegistration);
    if (r.outOfScope === true) continue;
    for (const p of [
      r.student,
      r.user,
      ...(Array.isArray(r.registeredStudents) ? r.registeredStudents : []),
      ...accepted(group.members),
      group.leader,
      ...accepted(r.members),
      r.leader,
      r,
    ]) add(p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Who should attend but holds none of the activity's sessions: `expected` minus everyone in `registered`. */
export function missingPeople(
  expected: readonly Person[],
  ...registered: ReadonlyArray<readonly Person[]>
): Person[] {
  const seen = new Set(registered.flat().map(p => p.login.toLowerCase()));
  return expected.filter(p => !seen.has(p.login.toLowerCase()));
}

/** What the automation will do with an open required session: register it, book a preferred slot, or leave it to the student. */
export type AutoAction = 'register' | 'book' | 'manual' | 'off';
export interface AutoPlanItem {
  event: CalendarEventVM;
  action: AutoAction;
  prefs: SlotPreference[];
}

export function autoPlan(
  events: readonly CalendarEventVM[],
  prefs: CalendarPrefs,
  now = Date.now(),
): AutoPlanItem[] {
  return events
    .filter(e => e.required && !e.full && canRegister(e, now))
    .map(event => {
      if (!event.slots) {
        return {
          event,
          prefs: [],
          action: event.sessions > 1
            ? 'manual'
            : prefs.autoRegister
              ? 'register'
              : 'off',
        };
      }
      const wanted = prefs.preferences
        .find(p => p.type.toLowerCase() === event.type.toLowerCase())
        ?.slots ?? [];
      return { event, prefs: wanted, action: wanted.length ? 'book' : 'manual' };
    });
}
