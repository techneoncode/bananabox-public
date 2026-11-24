import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { compactDuration, dateOnly } from '../format';
import { chip } from '../ui';
import { projectClock } from '../views/signature';
import { runState } from '../views/grader';
import { ring } from '../charts';
import { bigButton, listGroup, listRow, openProject } from './kit';
import { plural } from './board';

/** Quick sheet of a project: its numbers, one primary action, one-tap sections. The shell wraps it in kit.sheet. */
export function renderProjectSheet(ctx: Ctx, p: ProjectVM): HTMLElement[] {
  const { t, lang } = ctx;
  const now = Date.now();
  const g = ctx.graders.get(p.id);
  const rs = g ? runState(ctx, p, g) : null;
  const clock = projectClock(p, now);
  const remaining = Date.parse(clock.target) - now;
  const isCurrent = p.id === ctx.state.currentProjectId;
  // Same guards as views/detail.ts header and views/dock.ts.
  const local = !isCurrent && (ctx.state.localProjects ?? []).includes(p.id);
  const canClone = p.repoEnabled && p.registered && !isCurrent;
  const hasCopy = ctx.state.commitStates?.[p.id] !== null;
  const busy = !!rs?.active || !!g?.running;
  const checking = ctx.readiness.get(p.id)?.status === 'running';
  const last = g?.history.at(-1)?.score ?? null;
  const scores = (g?.history ?? []).map(r => r.score).filter((s): s is number => s != null);
  const best = scores.length ? Math.max(...scores) : null;
  const q = g?.quota ?? null;
  const next = (ctx.activities.get(p.id) ?? [])
    .filter(a => Date.parse(a.startDate) > now)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0];

  const openFolder = () => ctx.post({ type: 'openFolder', projectId: p.id });
  let primary: HTMLElement | null;
  if (!g) primary = bigButton(t('readout.loading'), 'loading', () => {}, 'primary', { disabled: true });
  else if (busy) primary = bigButton(t('grader.running'), 'loading', () => {}, 'primary', { disabled: true });
  else if (rs && !rs.disabled) primary = bigButton(t('grader.run'), 'play', () => ctx.post({ type: 'runGrader', projectId: p.id }), 'primary', { title: rs.hint });
  else primary = null;

  // Two doors out of the sheet: the folder in VS Code (or its clone), and the project's screen in the app.
  const folder = isCurrent ? bigButton(t('badge.current'), 'folder-opened', () => {}, 'secondary', { disabled: true, title: t('app.project.openHere') })
    : local ? bigButton(t('action.openFolder'), 'folder-opened', openFolder, 'secondary', { title: t('action.openFolderHint') })
    : canClone ? bigButton(t('action.cloneOpen'), 'repo-clone', openFolder, 'secondary', { title: p.repoLink ?? t('action.cloneUnknown') })
    : null;
  const view = folder
    ? h('button.bd-view', { type: 'button', title: t('app.board.openProject'), 'aria-label': t('app.board.openProject'), onclick: () => openProject(ctx, p.id) }, icon('arrow-right'))
    : bigButton(t('app.board.openProject'), 'arrow-right', () => openProject(ctx, p.id), 'secondary');

  const round = (name: string, label: string, onclick: () => void, disabled = false, title = label) =>
    h('button.bd-round', { type: 'button', 'aria-label': label, title, disabled, onclick }, h('span.bd-round-ic', icon(name)), h('span.bd-round-l', label));

  return [
    h('div.bd-sheet-head',
      h('h2.bd-name-lg', p.name),
      h('p.bd-unit', [p.unitCode, p.unitName].filter(Boolean).join(' · ')),
      h('p.bd-status',
        icon('calendar'), `${t('app.board.deadline')} `, h('b.bd-num', dateOnly(p.endDate, lang)),
        isCurrent ? chip('accent', icon('folder-opened'), t('badge.current')) : null,
        !p.registered ? chip('', t('badge.notRegistered')) : null)),

    h('div.bd-keys', { role: 'group', 'aria-label': t('app.board.keyNumbers') },
      keyTile(best != null ? `${best}%` : '—', t('app.board.bestScore')),
      keyTile(q ? `${q.remaining}/${q.total}` : '—', t('grader.tokensLeft')),
      h('div.bd-key',
        ring(clock.elapsed, { size: 36, stroke: 4, tone: clock.urgent ? 'urgent' : 'live', aria: `${t(`gauge.${clock.key}`)} ${compactDuration(remaining, lang)}` }),
        h('span.bd-key-l.bd-num', clock.key === 'closed' ? t('gauge.closed') : compactDuration(remaining, lang)))),

    h('div.bd-actions',
      primary,
      rs?.disabled && !busy ? h('p.bd-hint', rs.hint) : null,
      h('div.bd-round-row', { role: 'group', 'aria-label': t('app.board.quickActions') },
        round('checklist', t('sb.check'), () => ctx.post({ type: 'checkReadiness', projectId: p.id }),
          !hasCopy || busy || checking, hasCopy ? t('delivery.scope') : t('sb.noLocal')),
        round('book', t('tab.subject'), () => openProject(ctx, p.id, 'subject')),
        p.repoLink
          ? round('repo', t('badge.repo'), () => ctx.post({ type: 'openExternal', url: p.repoLink! }))
          : round('globe', t('action.intranet'), () => ctx.post({ type: 'openExternal', url: p.intranetUrl })))),

    listGroup(t('app.board.sections'),
      listRow({ icon: 'beaker', label: t('tab.grader'), meta: last != null ? `${last}%` : '—', onclick: () => openProject(ctx, p.id, 'grader') }),
      listRow({ icon: 'calendar', label: t('tab.activities'), meta: next ? dateOnly(next.startDate, lang) : '—', onclick: () => openProject(ctx, p.id, 'activities') }),
      listRow({ icon: 'history', label: t('tab.history'), meta: g ? plural(ctx, 'app.board.runs', g.history.length) : '—', onclick: () => openProject(ctx, p.id, 'history') }),
      listRow({ icon: 'info', label: t('tab.details'), meta: p.instanceCode || '—', onclick: () => openProject(ctx, p.id, 'details') })),

    h('div.bd-open', folder, view),
  ];
}

function keyTile(value: string, label: string): HTMLElement {
  return h('div.bd-key', h('span.bd-key-v.bd-num', value), h('span.bd-key-l', label));
}
