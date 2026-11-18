import type { ActivityVM, ProjectVM } from '../shared/types';

export interface DefenseEvent {
  key: string;
  projectId: number;
  projectName: string;
  activityName: string;
  startDate: string;
  endDate: string;
  location: string | null;
}

export interface DefenseAlert extends DefenseEvent {
  minutes: 60 | 30 | 15;
  test?: boolean;
}

export const DEFENSE_THRESHOLDS = [60, 30, 15] as const;

/**
 * Only the student's actual slot triggers reminders; the overall session start
 * is never substituted.
 */
export function defenseEvents(
  project: ProjectVM,
  activities: ActivityVM[],
): DefenseEvent[] {
  return activities
    .filter(a => a.kind === 'midterm' || a.kind === 'defense' || a.kind === 'susie')
    .flatMap(a => (a.slots ?? []).filter(s => s.mine).map(s => ({
      key: `${project.id}:${a.eventId}:${s.id}:${s.startDate}`,
      projectId: project.id,
      projectName: project.name,
      activityName: a.name,
      startDate: s.startDate,
      endDate: s.endDate,
      location: a.location ?? null,
    })));
}

export function dueDefenseAlert(
  event: DefenseEvent,
  acknowledged: ReadonlySet<string>,
  now = Date.now(),
): DefenseAlert | null {
  const left = Date.parse(event.startDate) - now;
  if (!Number.isFinite(left) || Date.parse(event.endDate) <= now) return null;
  const minutes = [...DEFENSE_THRESHOLDS]
    .reverse()
    .find(m => left <= m * 60_000);
  return minutes && !acknowledged.has(`${event.key}:${minutes}`)
    ? { ...event, minutes }
    : null;
}

/**
 * A late start shows the most urgent alert once, without a backlog of obsolete
 * popups.
 */
export function acknowledgedDefenseKeys(alert: DefenseAlert): string[] {
  return DEFENSE_THRESHOLDS
    .filter(m => m >= alert.minutes)
    .map(m => `${alert.key}:${m}`);
}
