import { h, icon } from '../dom';
import type { Ctx, Tab } from '../ctx';
import type { ProjectVM, TestResultSummary } from '../../shared/types';
import { projectMidpoint } from '../../domain/activities';
import { sparkArea, tokenBlocks } from '../charts';
import { compactDuration, dateOnly, dateTime, progress, relative, timeOnly } from '../format';
import { commitButton, commitStatus, remoteCommit } from './report';

/** Four gauges that answer "where do I stand": time, score, tokens, commit. */
export function renderReadout(ctx: Ctx, p: ProjectVM): HTMLElement {
  return h('section.readout', { 'aria-label': ctx.t('readout.label') }, deadline(ctx, p), score(ctx, p), tokens(ctx, p), commit(ctx, p));
}

function gauge(ctx: Ctx, label: string, tab: Tab | null, ...children: Array<Node | string | false | null | undefined>): HTMLElement {
  const head = tab
    ? h('button.gauge-label', { type: 'button', title: ctx.t('readout.open'), onclick: () => { ctx.ui.tab = tab; ctx.rerender(); } }, label, icon('arrow-right'))
    : h('span.gauge-label', label);
  return h('div.gauge', head, ...children);
}

function deadline(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, now = Date.now();
  const left = Date.parse(p.endDate) - now;
  const urgent = p.status === 'ongoing' && left < 24 * 3_600_000;
  const pos = progress(p.startDate, p.endDate, now);
  const mid = projectMidpoint(p, ctx.activities?.get(p.id));
  const midPos = mid.date ? progress(p.startDate, p.endDate, Date.parse(mid.date)) : null;
  const label = p.status === 'ongoing' ? t('gauge.closesIn') : p.status === 'upcoming' ? t('gauge.opensIn') : t('gauge.closed');
  const value = p.status === 'ongoing' ? compactDuration(left) : p.status === 'upcoming' ? compactDuration(Date.parse(p.startDate) - now) : relative(p.endDate, lang);
  return gauge(ctx, label, 'details',
    h('div.gauge-value', { class: urgent ? 'urgent' : p.status === 'past' ? 'sha none' : '' }, value),
    h('div.deadline-rail', { class: urgent ? 'urgent' : '', role: 'progressbar', 'aria-label': t('milestone.elapsed', { pct: Math.round(pos * 100) }), 'aria-valuenow': String(Math.round(pos * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('span.fill', { style: { width: `${pos * 100}%` } }),
      midPos !== null && h('span.tick', { class: midPos <= pos ? 'done' : '', style: { left: `${midPos * 100}%` }, title: `${t('timeline.mid')} · ${dateTime(mid.date, lang)}` })),
    h('div.gauge-sub', h('span', `${dateOnly(p.status === 'upcoming' ? p.startDate : p.endDate, lang)} · ${timeOnly(p.status === 'upcoming' ? p.startDate : p.endDate, lang)}`),
      mid.date && h('span', t('gauge.mid', { date: dateOnly(mid.date, lang) }))));
}

function delta(ctx: Ctx, cur: TestResultSummary, prev: TestResultSummary | undefined): HTMLElement | null {
  if (!prev || cur.score === null || prev.score === null) return null;
  const d = Math.round((cur.score - prev.score) * 10) / 10;
  if (d === 0) return h('span', icon('dash'), ' ', ctx.t('grader.unchanged'));
  return h('span', { class: d > 0 ? 'up' : 'down' }, icon(d > 0 ? 'arrow-up' : 'arrow-down'), `${d > 0 ? '+' : ''}${d}`);
}

function score(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, g = ctx.graders.get(p.id);
  const latest = g?.history.at(-1), previous = g?.history.at(-2);
  if (!g || !latest) return gauge(ctx, t('gauge.score'), 'grader', h('div.gauge-value.none', g ? '—' : '…'), h('div.gauge-sub', g ? t('grader.noRuns') : t('readout.loading')));
  const trend = g.history.map(r => r.score).filter((v): v is number => v !== null).slice(-12);
  return gauge(ctx, t('gauge.score'), 'grader',
    h('div.gauge-row',
      h('div.gauge-value', { class: latest.score === null ? 'none' : latest.score >= 100 ? 'ok' : '' }, latest.score === null ? '—' : String(latest.score), latest.score !== null && h('small', '%')),
      trend.length > 1 && sparkArea(trend, { width: 96, height: 34, aria: t('home.scoreTrend') })),
    h('div.gauge-sub', delta(ctx, latest, previous), h('span', latest.total > 0 ? t('grader.testsPassed', { passed: latest.passed, total: latest.total }) : t('grader.noTests'))));
}

function tokens(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, q = ctx.graders.get(p.id)?.quota ?? null;
  if (!q) return gauge(ctx, t('grader.tokens'), null, h('div.gauge-value.none', ctx.graders.has(p.id) ? '—' : '…'), h('div.gauge-sub', t('grader.noQuota')));
  const tone = q.remaining <= 0 ? 'bad' : q.remaining / Math.max(1, q.total) <= 0.34 ? 'warn' : '';
  return gauge(ctx, t('grader.tokens'), null,
    h('div.gauge-value', { class: tone }, String(q.remaining), h('small', `/ ${q.total}`)),
    tokenBlocks(q.remaining, q.total),
    h('div.gauge-sub', h('span', t('grader.tokensUsed', { used: q.consumed, total: q.total })),
      typeof q.override === 'number' && Number.isFinite(q.override) && h('span', t('grader.override', { n: q.override }))));
}

function commit(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, g = ctx.graders.get(p.id), latest = g?.history.at(-1);
  return gauge(ctx, t('gauge.commit'), 'history',
    h('div.gauge-value.sha', latest?.commit ? commitButton(ctx, p.id, latest.commit) : h('span.none', '—')),
    h('div.gauge-sub.commit-line', latest?.commit ? commitStatus(ctx, p.id, latest.commit) : h('span', t('grader.noRuns')), latest && h('span', relative(latest.date, ctx.lang))),
    g && remoteCommit(ctx, p.id, g));
}
