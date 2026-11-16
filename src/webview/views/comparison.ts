import type { Ctx } from '../ctx';
import type { GraderVM, TestResultDetail, TestTask } from '../../shared/types';
import { compareResults } from '../../domain/graderComparison';
import { dateTime, shortSha } from '../format';
import { h, icon } from '../dom';
import { collapsible } from '../sections';
import { gut } from '../ui';
import { compareInsights, reportInsights, taskInsights } from '../../domain/graderInsights';
import { renderInsights } from './insights';
import { triangulate } from '../../domain/triangulation';
import { resultTrace, taskEvidence } from '../../domain/graderEvidence';
import { renderTaskAnalysis, renderTriangulation } from './graderAnalysis';

export function renderComparison(ctx: Ctx, g: GraderVM): HTMLElement | null {
  if (g.history.length < 2) return null;
  const { t } = ctx, id = g.projectId;
  const preference = ctx.ui.comparisons[id];
  const automatic = preference?.automatic !== false || !g.history.some(r => r.id === preference.before) || !g.history.some(r => r.id === preference.after);
  const selected = { before: automatic ? g.history.at(-2)!.id : preference!.before,
    after: automatic ? g.history.at(-1)!.id : preference!.after, filter: preference?.filter ?? 'changed', automatic };
  const root = h('div.box.comparison', h('div.box-header', h('h3', icon('git-compare'), t('compare.title'))));
  const finish = () => collapsible(root, 'grader-comparison', true);
  const selector = (key: 'before' | 'after') => h('label.compare-select', h('span.muted.tiny', t(`compare.${key}`)),
    h('select', { value: String(selected[key]), 'aria-label': t(`compare.${key}`), onchange: (e: Event) => {
      ctx.ui.comparisons[id] = { ...selected, automatic: false, [key]: Number((e.target as HTMLSelectElement).value) }; ctx.rerender();
    } }, [...g.history].reverse().map(r => h('option', { value: String(r.id), selected: r.id === selected[key] },
      `${dateTime(r.date, ctx.lang)} · ${r.score ?? '—'}%${r.commit ? ` · ${shortSha(r.commit)}` : ''}`))));
  const body = h('div.box-body', h('div.compare-mode', icon(automatic ? 'sparkle' : 'git-compare'), h('span.muted.small', t(automatic ? 'compare.automatic' : 'compare.manual')),
    !automatic && h('button.btn.ghost.small', { onclick: () => { ctx.ui.comparisons[id] = { ...selected, automatic: true }; ctx.rerender(); } }, t('compare.useAutomatic'))),
    h('div.compare-controls', selector('before'), icon('arrow-right'), selector('after')));
  root.append(body);
  if (selected.before === selected.after) { body.append(h('p.muted.small', t('compare.same'))); return finish(); }
  for (const resultId of [selected.before, selected.after]) {
    if (!g.history.some(r => r.id === resultId)) continue;
    if (!ctx.results.has(resultId)) {
      ctx.results.set(resultId, { loading: true, detail: null, error: null });
      ctx.post({ type: 'loadResult', projectId: id, resultId });
    }
  }
  const a = ctx.results.get(selected.before), b = ctx.results.get(selected.after);
  if (a?.error || b?.error) {
    body.append(h('div.notice.error', a?.error ?? b?.error), h('button.btn', { onclick: () => {
      ctx.results.delete(selected.before); ctx.results.delete(selected.after); ctx.rerender();
    } }, t('action.retry')));
    return finish();
  }
  if (!a?.detail || !b?.detail || a.loading || b.loading) { body.append(h('div.muted', icon('loading', 'spin'), t('compare.loading'))); return finish(); }
  const beforeSummary = g.history.find(r => r.id === selected.before), afterSummary = g.history.find(r => r.id === selected.after);
  const beforeScore = a.detail.score ?? beforeSummary?.score, afterScore = b.detail.score ?? afterSummary?.score;
  if (beforeScore != null && afterScore != null) {
    const delta = Math.round((afterScore - beforeScore) * 10) / 10;
    body.append(h('p.compare-score', h('strong', `${beforeScore}% → ${afterScore}%`),
      h('span.label', { class: delta > 0 ? 'success' : delta < 0 ? 'danger' : '' }, t('compare.scoreDelta', { n: `${delta > 0 ? '+' : ''}${delta}` }))));
  }
  const compared = compareResults(a.detail, b.detail, beforeSummary, afterSummary);
  ctx.comparisonFiles ??= new Map();
  const filesKey = `${id}:${selected.before}:${selected.after}`;
  if (!ctx.comparisonFiles.has(filesKey)) {
    ctx.comparisonFiles.set(filesKey, { loading: true, files: null });
    ctx.post({ type: 'loadComparisonFiles', projectId: id, before: selected.before, after: selected.after });
  }
  const context = ctx.comparisonFiles.get(filesKey)!;
  const scan = ctx.styleScans.get(id);
  // Current local findings corroborate the later run only when it is the clean current commit.
  const state = ctx.state.commitStates?.[id];
  const readiness = ctx.readiness.get(id);
  const localStyle = scan?.status === 'done' && state && !state.dirty && state.head === b.detail.commit && readiness?.status === 'done' && !readiness.stale && readiness.commit === b.detail.commit ? scan.issues.map(i => ({ file: i.file, line: i.line, rule: i.rule ?? undefined })) : undefined;
  const analysis = triangulate(resultTrace(a.detail), resultTrace(b.detail), { changedFiles: context.files, localStyle });
  body.append(renderTriangulation(ctx, analysis, context.loading));
  const counts = { fixed: 0, regressed: 0, stillFailing: 0 };
  compared.forEach(c => { if (c.kind in counts) counts[c.kind as keyof typeof counts]++; });
  const comparable = compared.some(c => c.before && c.after && c.before.status !== 'unknown' && c.after.status !== 'unknown');
  root.firstElementChild!.append(h('span.label', { class: counts.regressed ? 'danger' : counts.fixed ? 'success' : '' }, comparable ? t('compare.headerCounts', counts) : t('compare.noComparable')));
  body.append(h('div.compare-stats', ...Object.entries(counts).map(([kind, n]) => h('div', { class: kind }, h('strong', comparable ? n : '—'), h('span.muted.small', t(`compare.kind.${kind}`))))));
  if (!comparable) body.append(h('p.muted.small', t('compare.noComparable')));
  const logDelta = compareInsights(reportInsights(a.detail), reportInsights(b.detail));
  if (logDelta.after.diagnostics.length) root.firstElementChild!.append(h('span.label.attention', t('insights.findingsCount', { n: logDelta.after.diagnostics.length })));
  body.append(h('details', { dataset: { detailId: 'comparison-log-findings' } }, h('summary', t('insights.title')), renderInsights(ctx, id, logDelta, 'comparison-report')));
  body.append(h('div.actions',
    h('select', { 'aria-label': t('compare.filter'), onchange: (e: Event) => {
      ctx.ui.comparisons[id] = { ...selected, filter: (e.target as HTMLSelectElement).value }; ctx.rerender();
    } }, ['changed', 'regressed', 'fixed', 'stillFailing', 'all'].map(kind => h('option', { value: kind, selected: selected.filter === kind }, t(`compare.filter.${kind}`)))),
    h('button.btn', { disabled: !a.detail.commit || !b.detail.commit, onclick: () => ctx.post({ type: 'compareCommits', projectId: id, before: selected.before, after: selected.after }) }, icon('diff'), t('compare.diff'))));
  const filtered = compared.filter(c => selected.filter === 'all' || selected.filter === 'changed' && c.kind !== 'unchanged' || c.kind === selected.filter);
  if (!filtered.length) body.append(h('p.muted.small', t('compare.empty')));
  for (const [i, c] of filtered.entries()) {
    const evidence = c.after ? taskEvidence(b.detail, c.after) : undefined;
    const triangulation = analysis.tasks.find(t => t.task === evidence?.name);
    const delta = compareInsights(taskInsights(c.before), taskInsights(c.after));
    const row = h('details.comparison-task', { dataset: { detailId: `comparison-task:${c.name}` } }, h('summary', gut(i + 1, c.kind === 'regressed' ? 'fail' : c.kind === 'fixed' ? 'pass' : c.kind === 'stillFailing' ? 'warn' : ''), icon('chevron-right', 'chev'), h('strong', c.name),
      h('span.label', { class: c.kind === 'regressed' ? 'danger' : c.kind === 'fixed' ? 'success' : '' }, t(`compare.kind.${c.kind}`)),
      h('span.muted.small', `${taskScore(c.before)} → ${taskScore(c.after)}`)));
    if (triangulation?.transition === 'progress') row.firstElementChild!.append(h('span.label.success', t('analysis.progress')));
    row.append(h('div.task-body', renderTaskAnalysis(ctx, id, evidence, triangulation), renderInsights(ctx, id, delta, `comparison-task:${c.name}`, true, c.name), history(ctx, g, c.name),
      h('div.compare-traces', trace(ctx, a.detail, c.before), trace(ctx, b.detail, c.after)),
      c.after?.status === 'failed' && h('button.btn', { onclick: () => ctx.post({ type: 'reproduce', projectId: id, resultId: b.detail!.id, task: c.name }) }, icon('debug-alt'), t('reproduce.run'))));
    body.append(row);
  }
  body.append(h('p.muted.tiny', t('compare.scope')));
  return finish();
}
const taskScore = (task: TestTask | null) => !task ? '—' : task.count ? `${task.passed}/${task.count}` : task.status === 'passed' ? '✓' : task.status === 'failed' ? '✕' : '?';
function trace(ctx: Ctx, result: TestResultDetail, task: TestTask | null): HTMLElement {
  return h('div', h('span.muted.tiny', dateTime(result.date, ctx.lang)), h('pre.trace-mini', task?.trace || ctx.t('result.noOutput')));
}
export function history(ctx: Ctx, g: GraderVM, taskName: string): HTMLElement {
  return h('div.test-history', h('span.muted.tiny', ctx.t('compare.history')),
    g.history.slice(-8).map(r => {
      const detail = ctx.results.get(r.id)?.detail?.tasks.find(t => t.name === taskName);
      const skill = r.skills.find(s => s.name === taskName);
      const status = detail?.status ?? (skill?.count ? skill.passed === skill.count ? 'passed' : 'failed' : 'unknown');
      return h('button.history-dot', { class: status, title: `${dateTime(r.date, ctx.lang)} · ${detail ? taskScore(detail) : skill ? `${skill.passed}/${skill.count}` : '?'}`,
        'aria-label': `${dateTime(r.date, ctx.lang)} · ${ctx.t(`compare.status.${status}`)}`,
        onclick: () => {
          ctx.ui.selectedResult[g.projectId] = r.id;
          ctx.ui.traceQuery = taskName;
          if (!ctx.results.has(r.id)) { ctx.results.set(r.id, { loading: true, detail: null, error: null }); ctx.post({ type: 'loadResult', projectId: g.projectId, resultId: r.id }); }
          ctx.rerender();
        } }, icon(status === 'passed' ? 'pass-filled' : status === 'failed' ? 'error' : 'circle-large-outline'));
    }));
}
