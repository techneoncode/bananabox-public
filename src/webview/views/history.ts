import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM, TestResultSummary } from '../../shared/types';
import { scoreChart } from '../charts';
import { dateTime, shortSha } from '../format';
import { renderComparison } from './comparison';
import { selectResult } from './report';
import { gut, section, waitBlock, type Tone } from '../ui';

const tone = (r: TestResultSummary): Tone => r.score === null ? 'muted' : r.score >= 100 ? 'pass' : r.score >= 50 ? 'warn' : 'fail';

/** History tab: score over time, every attempt, and the comparison between two of them. */
export function renderHistory(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, g = ctx.graders.get(p.id);
  if (!g || (g.loading && g.history.length === 0)) return waitBlock(t('wait.grader'));
  if (!g.history.length) return h('div.empty', icon('history'), h('p', h('strong', t('grader.noRuns'))), h('p.small', t('history.empty')));
  const latest = g.history[g.history.length - 1];
  const selected = g.history.some(r => r.id === ctx.ui.selectedResult[p.id]) ? ctx.ui.selectedResult[p.id]! : latest.id;
  const scroller = document.querySelector<HTMLElement>('.scroll');
  const width = Math.max(220, (scroller?.clientWidth ?? 640) - (ctx.surface === 'panel' ? 64 : 24));
  const open = (id: number) => { selectResult(ctx, p.id, id); ctx.ui.tab = 'grader'; ctx.rerender(); };
  const root = h('div.history');
  const scores = g.history.map(r => r.score).filter((v): v is number => v !== null);
  const best = scores.length ? Math.max(...scores) : null;
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const first = scores[0], last = scores.at(-1);
  const gain = first !== undefined && last !== undefined ? Math.round((last - first) * 10) / 10 : null;
  root.append(section(t('grader.scoreOverTime'), { meta: [t('history.runs', { n: g.history.length }), best !== null && `${t('history.best')} ${best}%`, avg !== null && `${t('history.average')} ${avg}%`, gain !== null && `${t('history.progress')} ${gain > 0 ? '+' : ''}${gain}`].filter(Boolean).join(' · ') },
    h('div.panel.history-chart', scoreChart(g.history, {
      lang: ctx.lang, selectedId: selected, width: width - 28, height: 200,
      onCommit: commit => ctx.post({ type: 'openCommit', projectId: p.id, commit }),
      onSelect: id => selectResult(ctx, p.id, id),
      labels: { score: t('grader.scoreOverTime'), empty: t('grader.chartEmpty'), commit: t('grader.commit') },
    }))));
  const comparison = renderComparison(ctx, g);
  if (comparison) root.append(h('div.section', comparison));
  root.append(section(t('history.attempts'), {},
    h('div.g-list', [...g.history].reverse().map((r, i) => h('button.g-row.run-row', { class: r.id === selected ? 'is-focus' : '', title: t('history.openRun'), onclick: () => open(r.id) },
      gut(g.history.length - i, tone(r)),
      h('span.g-main', h('span.when', dateTime(r.date, ctx.lang)),
        h('span.g-sub', r.total > 0 ? t('grader.testsPassed', { passed: r.passed, total: r.total }) : t('grader.noTests')),
        r.commit && h('span.g-sub.mono', shortSha(r.commit))),
      h('span.g-side', h('span.score', r.score === null ? '—' : `${r.score}%`)))))));
  return root;
}
