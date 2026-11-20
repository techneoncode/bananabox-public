import type { DeliveryCheck, ReadinessVM } from '../shared/deliveryTypes';
import type { ActivityVM, ProjectVM } from '../shared/types';

/** What a submission is prepared for: each one asks for its own checks. */
export type Milestone = 'followup' | 'midterm' | 'delivery';

export interface MilestoneEvent {
  kind: Milestone;
  /** When it happens: the student's booked slot, else the session, else the project's own date. */
  date: string;
  /** The session it comes from, when there is one. */
  name?: string;
}

/** Bytes a mid-term may still leak: a work in progress, not a finished program. */
export const MIDTERM_LEAK_BYTES = 1024;

/** Checks that only mean something on a C project. */
const C_ONLY = new Set<DeliveryCheck['id']>(['style', 'functions', 'binary']);

const RULES: Record<Milestone, DeliveryCheck['id'][]> = {
  followup: ['git', 'build', 'style', 'functions', 'binary', 'deadline'],
  midterm: ['git', 'build', 'tests', 'valgrind', 'style', 'functions', 'binary', 'deadline'],
  delivery: ['style', 'build', 'tests', 'files', 'functions', 'valgrind', 'binary', 'git', 'deadline', 'grader'],
};

/** Every check an event can ask for. */
export const milestoneCheckIds = (kind: Milestone): readonly DeliveryCheck['id'][] => RULES[kind];

/** The next session of one kind that has not ended yet, at the student's own slot when booked. */
function nextSession(activities: ActivityVM[], kind: ActivityVM['kind'], now: number): MilestoneEvent | null {
  for (const a of activities.filter(x => x.kind === kind)) {
    const slot = a.slots?.find(s => s.mine);
    if (Date.parse(slot?.endDate ?? a.endDate) > now) {
      return { kind: kind === 'followup' ? 'followup' : 'midterm', date: slot?.startDate ?? a.startDate, name: a.name };
    }
  }
  return null;
}

/**
 * The project's coming events, nearest first: the next follow-up, the mid-term, then the delivery (which also
 * prepares the defense, held on the finished project). The delivery is always there, even once closed.
 */
export function projectMilestones(p: ProjectVM, activities: ActivityVM[] | undefined, now = Date.now()): MilestoneEvent[] {
  const list = activities ?? [];
  const events: MilestoneEvent[] = [];
  const followup = nextSession(list, 'followup', now);
  if (followup) events.push(followup);
  const midterm = nextSession(list, 'midterm', now);
  if (midterm) events.push(midterm);
  else if (!list.some(a => a.kind === 'midterm') && !p.midEstimated && p.midDate && Date.parse(p.midDate) > now) {
    events.push({ kind: 'midterm', date: p.midDate });
  }
  events.push({ kind: 'delivery', date: p.endDate });
  return events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export const MILESTONES: readonly Milestone[] = ['followup', 'midterm', 'delivery'];

/** Checks the student turned off, per event. */
export type DisabledChecks = Partial<Record<Milestone, string[]>>;

export interface MilestoneOptions {
  /** The project is written in C (unknown until checked: assumed). */
  c: boolean;
  /** Checks left out of this event. */
  disabled?: readonly string[];
}

/**
 * The checks an event asks for, in its order, read the way it reads them: a mid-term only needs tests to exist
 * and accepts a few leaked bytes; a delivery needs everything green.
 */
export function milestoneChecks(
  kind: Milestone,
  checks: DeliveryCheck[],
  vm: ReadinessVM | undefined,
  options: MilestoneOptions,
  t: (key: string, params?: Record<string, string | number>) => string,
): DeliveryCheck[] {
  const done = vm?.status === 'done';
  return RULES[kind].flatMap(id => {
    if (!options.c && (C_ONLY.has(id) || (kind === 'followup' && id === 'build'))) return [];
    if (options.disabled?.includes(id)) return [];
    const c = checks.find(x => x.id === id);
    if (!c) return [];
    if (id === 'functions' && done && c.status === 'unknown') return [];
    if (kind === 'midterm' && id === 'tests' && done) {
      return [c.status === 'pass' || c.status === 'fail'
        ? { ...c, status: 'pass' as const, detail: t('milestone.testsPresent') }
        : { ...c, status: 'fail' as const, detail: t('milestone.testsMissing') }];
    }
    if (kind === 'midterm' && id === 'valgrind' && c.status === 'fail' && c.leakBytes !== undefined) {
      return [c.leakBytes <= MIDTERM_LEAK_BYTES
        ? { ...c, status: 'pass' as const, detail: t('milestone.leaksTolerated', { bytes: c.leakBytes, max: MIDTERM_LEAK_BYTES }) }
        : { ...c, detail: t('milestone.leaksOver', { bytes: c.leakBytes, max: MIDTERM_LEAK_BYTES }) }];
    }
    return [c];
  });
}
