/** Reminders sent before a project closes: one day and three hours. */
export const REMINDER_HOURS = [24, 3] as const;

const HOUR = 3_600_000;

export interface DueReminder {
  /** The tightest threshold crossed, in hours. */
  hours: number;
  /**
   * Every threshold key crossed so far; all are marked as shown so none fires
   * late.
   */
  keys: string[];
}

export const reminderKey = (
  projectId: number,
  endDate: string,
  hours: number,
): string =>
  `${projectId}:${endDate}:${hours}`;

/**
 * Returns the reminder to show now, or `null`. When several thresholds were
 * crossed while the editor was closed (say 2 h left, J-1 and H-3 both passed),
 * only the tightest one fires.
 */
export function dueReminder(
  projectId: number,
  endDate: string,
  now: number,
  shown: ReadonlySet<string>,
  thresholds: readonly number[] = REMINDER_HOURS,
): DueReminder | null {
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) return null;
  const remaining = end - now;
  if (remaining <= 0) return null;
  const crossed = thresholds
    .filter((h) => remaining <= h * HOUR)
    .sort((a, b) => a - b);
  if (crossed.length === 0) return null;
  const tightest = crossed[0];
  if (shown.has(reminderKey(projectId, endDate, tightest))) return null;
  return {
    hours: tightest,
    keys: crossed.map((h) => reminderKey(projectId, endDate, h)),
  };
}

/** "2d 4h", "3h 12m", "42m": compact countdown for the status bar. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${Math.max(1, m)}m`;
}

export const isUrgent = (remainingMs: number): boolean =>
  remainingMs > 0 && remainingMs <= 3 * HOUR;
