import { h, icon } from '../dom';
import { graderGroupRestriction } from '../../domain/projects';
import type { Ctx } from '../ctx';
import type { GraderRun, GraderVM, ProjectVM } from '../../shared/types';
import { relative } from '../format';
import { renderPipeline } from './pipeline';
import { renderReproduction } from './reproduction';
import { renderReport } from './report';
import { notice, waitBlock } from '../ui';

export interface RunState { noTokens: boolean; groupReason: string | null; leaderWarning: boolean; disabled: boolean; hint: string; active: GraderRun | undefined }

/** Whether the grader can run now, and why not: shared by the Grader page and the sidebar dock. */
export function runState(ctx: Ctx, p: ProjectVM, g: GraderVM): RunState {
  const { t } = ctx, q = g.quota;
  const noTokens = q !== null && q.remaining <= 0;
  const groupReason = graderGroupRestriction(p);
  const leaderWarning = groupReason === 'leader_only' || g.reason === 'leader_only';
  const disabled = !!groupReason || !g.canRun || g.loading || g.running || noTokens || ctx.styleScans.get(p.id)?.status === 'running' || ctx.readiness.get(p.id)?.status === 'running' || ctx.guided.get(p.id)?.status === 'running';
  const hint = groupReason ? t(`grader.reason.${groupReason}`) : !g.canRun ? t(`grader.reason.${g.reason}`) : noTokens ? t('grader.noTokens') : g.running ? t('grader.running') : t('grader.runHint');
  const active = g.runs.find(r => r.state === 'submitted' || r.state === 'started');
  return { noTokens, groupReason, leaderWarning, disabled, hint, active };
}

/** Grader tab: the pipeline on the left, the selected run on the right. One loop, one screen. */
export function renderGrader(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx;
  const g = ctx.graders.get(p.id);
  if (!g || (g.loading && g.history.length === 0 && !g.quota)) {
    return waitBlock(t('wait.grader'));
  }
  const root = h('div.grader');
  if (g.error) root.append(notice('error', 'error', g.error));
  if (!g.canRun && g.history.length === 0 && (g.reason === 'not_registered' || g.reason === 'repo_disabled')) {
    root.append(h('div.empty', icon('beaker'), h('p', t(`grader.reason.${g.reason ?? 'not_registered'}`))));
    return root;
  }

  const { noTokens, groupReason, leaderWarning, disabled: runDisabled, hint: runHint, active } = runState(ctx, p, g);
  const run = h('button.btn', { disabled: runDisabled, title: runHint, onclick: () => ctx.post({ type: 'runGrader', projectId: p.id }) },
    g.running ? icon('loading', 'spin') : icon('play'), g.running ? t('grader.running') : t('grader.run'));

  const left = h('div.pipeline-col.grader-control',
    renderPipeline(ctx, p, run),
    leaderWarning && h('div.grader-reason.grader-run-warning', icon('warning'), h('span', t('grader.reason.leader_only'))),
    !leaderWarning && (groupReason || !g.canRun || noTokens) && h('p.run-hint', icon('info'), ' ', runHint),
    active && runBanner(ctx, active));

  const latest = g.history[g.history.length - 1];
  const selected = g.history.some(r => r.id === ctx.ui.selectedResult[p.id]) ? ctx.ui.selectedResult[p.id]! : latest?.id ?? null;
  const right = h('div.report-col',
    renderReproduction(ctx, p.id),
    selected !== null ? renderReport(ctx, g, selected) : h('div.empty', icon('beaker'), h('p', h('strong', t('grader.noRuns'))), h('p.small', t('grader.firstRun'))));
  root.append(h('div.loop', left, right));
  return root;
}

function runBanner(ctx: Ctx, run: GraderRun): HTMLElement {
  const queued = run.state === 'submitted';
  return notice('running', 'loading', h('strong', queued ? ctx.t('grader.queued') : ctx.t('grader.executing')), h('span.muted', ctx.t('grader.requestedAt', { when: relative(run.requestedAt, ctx.lang) })));
}
