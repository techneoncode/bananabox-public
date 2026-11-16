import type * as vscode from 'vscode';
import { REMINDER_HOURS, dueReminder, reminderKey } from '../domain/deadlines';
import type { ProjectVM } from '../shared/types';

const KEY = 'epibox.deadlineShown.v1';
const KEEP_MS = 14 * 86_400_000;

/**
 * Fires the J-1 and H-3 reminders for the project of the open folder, once
 * each, remembered across restarts.
 */
export class DeadlineService {
  private readonly shown: Set<string>;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly notify: (project: ProjectVM, hours: number) => void,
  ) {
    const now = Date.now();
    const kept = memento.get<string[]>(KEY, []).filter((k) => {
      const end = Date.parse(k.split(':').slice(1, -1).join(':'));
      return Number.isFinite(end) && end > now - KEEP_MS;
    });
    this.shown = new Set(kept);
  }

  /** Call regularly with the project of the open folder (or `undefined`). */
  check(
    project: ProjectVM | undefined,
    enabled: boolean,
    now = Date.now(),
  ): void {
    if (!enabled || !project || project.status !== 'ongoing'
      || !project.registered) {
      return;
    }
    const due = dueReminder(project.id, project.endDate, now, this.shown);
    if (!due) return;
    due.keys.forEach((k) => this.shown.add(k));
    void this.memento.update(KEY, [...this.shown]);
    this.notify(project, due.hours);
  }

  /**
   * "Don't remind me": silences every remaining threshold of this project's
   * current deadline.
   */
  mute(project: ProjectVM): void {
    REMINDER_HOURS.forEach((h) => {
      this.shown.add(reminderKey(project.id, project.endDate, h));
    });
    void this.memento.update(KEY, [...this.shown]);
  }
}
