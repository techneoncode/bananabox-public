import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { tokenBlocks } from '../charts';
import { relative } from '../format';
import { liveElapsed } from '../motion';
import { runState } from './grader';
import { selectResult } from './report';

/**
 * The loop dock: pinned to the bottom of every sidebar project screen, Check and Run always one tap away,
 * and the run's state live above them (queued, executing, then the result that just landed).
 */
export function renderDock(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  const { t, lang } = ctx, g = ctx.graders.get(p.id);
  if (!g) return null;
  if (!g.canRun && g.history.length === 0 && (g.reason === 'not_registered' || g.reason === 'repo_disabled')) return null;
  const rs = runState(ctx, p, g);
  const vm = ctx.readiness.get(p.id), flow = ctx.guided.get(p.id);
  const checking = vm?.status === 'running' || flow?.status === 'running';
  const latest = g.history.at(-1), q = g.quota;
  const local = ctx.state.commitStates?.[p.id] !== null;
  const busy = !!rs.active || g.running;

  let status: HTMLElement;
  if (busy) {
    const since = rs.active?.startedAt ?? rs.active?.requestedAt ?? null;
    status = h('div.sb-dock-status', { role: 'status' },
      icon('loading', 'spin ic-accent'),
      h('b', t(rs.active?.state === 'submitted' ? 'sb.inQueue' : 'sb.executing')),
      h('span.spacer'),
      since && h('span.mono', liveElapsed(since)));
  } else if (g.loading && !g.history.length && !q) {
    status = h('div.sb-dock-status', { role: 'status' }, icon('loading', 'spin'), h('span', t('wait.grader')));
  } else if (checking) {
    status = h('div.sb-dock-status', { role: 'status' }, icon('loading', 'spin ic-accent'), h('b', t('sb.checking')));
  } else if (latest) {
    const band = latest.score === null ? '' : latest.score >= 100 ? 'pass' : latest.score >= 50 ? 'warn' : 'fail';
    status = h('div.sb-dock-status',
      h('button.sb-dock-last', { type: 'button', title: t('sb.openReport'), onclick: () => { selectResult(ctx, p.id, latest.id); ctx.ui.tab = 'grader'; ctx.rerender(); } },
        icon(band === 'pass' ? 'pass-filled' : band === 'fail' ? 'error' : 'circle-large-filled', `t-${band || 'muted'}`),
        h('span', t('sb.lastRunLine', { score: latest.score === null ? '—' : `${latest.score}%`, when: relative(latest.date, lang) }))),
      h('span.spacer'),
      q && tokenBlocks(q.remaining, q.total));
  } else {
    status = h('div.sb-dock-status', h('span', q ? t('sb.firstRun', { left: q.remaining, total: q.total }) : t('grader.noRuns')), h('span.spacer'), q && tokenBlocks(q.remaining, q.total));
  }

  const check = checking
    ? h('button.btn', { type: 'button', title: t('delivery.stop'), onclick: () => ctx.post({ type: 'cancelLocal', projectId: p.id }) }, icon('debug-stop'), t('sb.stop'))
    : h('button.btn', { type: 'button', disabled: !local || busy, title: local ? t('delivery.scope') : t('sb.noLocal'), onclick: () => ctx.post({ type: 'checkReadiness', projectId: p.id }) }, icon('checklist'), t('sb.check'));
  const run = h('button.btn.primary', { type: 'button', disabled: rs.disabled, title: rs.hint, onclick: () => ctx.post({ type: 'runGrader', projectId: p.id }) },
    icon(busy ? 'loading' : 'play', busy ? 'spin' : ''), h('span.ellipsis', t('sb.run')), q && h('span.sb-dock-tokens.num', `${q.remaining}/${q.total}`));

  return h('div.sb-dock', { class: busy || checking ? 'busy' : '', role: 'region', 'aria-label': t('sb.dock'), style: { viewTransitionName: 'sb-dock' } },
    (busy || checking) && h('span.sb-sweep', { 'aria-hidden': 'true' }),
    status,
    h('div.sb-dock-actions', check, run));
}
