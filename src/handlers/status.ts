import * as vscode from 'vscode';
import { inBackground } from '../api/requestGuard';
import { defenseEvents } from '../domain/defenseReminders';
import { formatCountdown, isUrgent } from '../domain/deadlines';
import { createT } from '../shared/i18n';
import type { ProjectVM } from '../shared/types';
import { config } from '../util/config';
import { remoteFeatures } from '../services/remoteFeatures';
import type { Controller, Surface } from '../controller';
import { tr } from '../util/text';

export function pushActivities(
  c: Controller,
  projectId: number,
  only?: Surface,
): void {
  const activities = c.activities.get(projectId);
  if (activities || c.activities.error(projectId)) {
    c.post(
      {
        type: 'activities',
        projectId,
        activities: activities ?? [],
        error: c.activities.error(projectId),
        pending:
          c.activityMutations.has(projectId) || c.activities.busy(projectId),
        limits: c.activities.limits(projectId),
      },
      only,
    );
  }
}

/**
 * Polls registered projects even when their activity tab (or the whole
 * sidebar) is closed.
 */
export async function refreshActivities(c: Controller): Promise<void> {
  if (
    c.refreshingActivities ||
    !c.auth.isSignedIn ||
    !remoteFeatures.status.myApiActive
  ) {
    return;
  }
  c.refreshingActivities = true;
  const token = c.auth.accessToken;
  try {
    const queue = (c.projects.projects ?? []).filter(
      p => p.registered
        && Date.parse(p.endDate) > Date.now() - 14 * 86_400_000
        && Date.now() - (c.activityRefreshes.get(p.id) ?? 0) >= 10 * 60_000,
    );
    await Promise.all([0, 1].map(async () => {
      for (let p; (p = queue.shift());) {
        if (
          token !== c.auth.accessToken ||
          !c.auth.isSignedIn ||
          !remoteFeatures.status.myApiActive
        ) {
          return;
        }
        c.activityRefreshes.set(p.id, Date.now());
        await inBackground(() => c.activities.load(p.id));
      }
    }));
  } finally {
    c.refreshingActivities = false;
  }
}

export function updateDefenseReminders(c: Controller): void {
  const enabled = c.auth.isSignedIn && remoteFeatures.status.myApiActive;
  c.defenseReminders.update(
    enabled ? c.auth.snapshot.login : null,
    enabled && config.defenseReminders()
      ? (c.projects.projects ?? []).flatMap(p =>
        defenseEvents(p, c.activities.get(p.id) ?? []),
      )
      : [],
  );
}

export function checkDeadlines(c: Controller): void {
  if (!c.auth.isSignedIn) return;
  c.deadlines.check(c.projects.current, config.deadlineNotifications());
}

export function notifyDeadline(
  c: Controller,
  project: ProjectVM,
  hours: number,
): void {
  const language = config.language();
  const t = createT(language);
  const when = new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(project.endDate));
  const open = t('deadline.open');
  const run = t('deadline.run');
  const mute = t('deadline.mute');
  const actions = [open, ...(project.repoEnabled ? [run] : []), mute];
  void vscode.window
    .showWarningMessage(
      t(hours >= 24 ? 'deadline.day' : 'deadline.hours', {
        name: project.name,
        when,
      }),
      ...actions,
    )
    .then((choice) => {
      if (choice === open) c.openProject(project.id);
      else if (choice === run) void c.runGrader(project.id);
      else if (choice === mute) c.deadlines.mute(project);
    });
}

export function updateStatusBar(c: Controller): void {
  const current = c.projects.current;
  if (!current || !config.showStatusBar() || !c.auth.isSignedIn) {
    c.statusItem.hide();
    return;
  }

  const g = c.grader.get(current.id);
  const last = g?.history[g.history.length - 1];
  const tokens = g?.quota ? `${g.quota.remaining}/${g.quota.total}` : '–';
  const score = last?.score !== null && last?.score !== undefined
    ? `${last.score}%`
    : '–';
  const remaining = current.status === 'ongoing'
    ? Date.parse(current.endDate) - Date.now()
    : Number.NaN;
  const countdown = Number.isFinite(remaining)
    && remaining > 0
    && config.deadlineNotifications()
    ? formatCountdown(remaining)
    : '';
  c.statusItem.text = g?.running
    ? tr('$(sync~spin) Bananabox: grading…')
    : `$(beaker) ${tokens} · ${score}${countdown ? ` · $(clock) ${countdown}` : ''}`;
  c.statusItem.backgroundColor = countdown && isUrgent(remaining)
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
  c.statusItem.tooltip = new vscode.MarkdownString(
    `**${current.name}**\n\n${tr('Grader tokens left: {n}', { n: tokens })}\n\n${tr('Latest score: {score}', { score })}${countdown ? `\n\n${tr('Closes in {time}', { time: countdown })}` : ''}\n\n_${tr('Click to open the project page')}_`,
  );
  c.statusItem.show();
}
