import { h, svg } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { compactDuration, dateOnly, dateTime } from '../format';

const DAY = 86_400_000;
export type SeasonRange = '4w' | '8w' | 'all';

interface Window { start: number; end: number }

function windowFor(projects: ProjectVM[], range: SeasonRange, now: number): Window {
  if (range === '4w') return { start: now - 7 * DAY, end: now + 21 * DAY };
  if (range === '8w') return { start: now - 14 * DAY, end: now + 42 * DAY };
  const live = projects.filter(p => p.status !== 'past');
  const pool = live.length ? live : projects;
  if (!pool.length) return { start: now - 7 * DAY, end: now + 21 * DAY };
  const start = Math.min(now, ...pool.map(p => Date.parse(p.startDate)).filter(Number.isFinite));
  const end = Math.max(now, ...pool.map(p => Date.parse(p.endDate)).filter(Number.isFinite));
  const pad = Math.max(2 * DAY, (end - start) * 0.04);
  return { start: start - pad, end: end + pad };
}

const pct = (t: number, w: Window) => Math.min(100, Math.max(0, ((t - w.start) / (w.end - w.start)) * 100));

/** Share of a (possibly clipped) bar from `left` to `right` that lies before the now line, in 0..1. */
export function barFill(left: number, right: number, nowPos: number): number {
  if (right - left <= 0) return nowPos >= right ? 1 : 0;
  return Math.min(1, Math.max(0, (nowPos - left) / (right - left)));
}

/** Projects that intersect the window, most pressing first. */
export function seasonProjects(projects: ProjectVM[], w: Window): ProjectVM[] {
  const rank = { ongoing: 0, upcoming: 1, past: 2 } as const;
  return projects
    .filter(p => Date.parse(p.endDate) >= w.start && Date.parse(p.startDate) <= w.end)
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.status === 'upcoming' ? Date.parse(a.startDate) - Date.parse(b.startDate) : Date.parse(a.endDate) - Date.parse(b.endDate)));
}

/**
 * The semester as Gantt lanes: one bar per project with elapsed time filled, a now line,
 * registration-close ticks and, under the lanes, how many projects run at once.
 */
export function renderSeason(ctx: Ctx, opts: { selected: number | null; onSelect: (id: number) => void; compact?: boolean }): HTMLElement {
  const { t, lang, ui } = ctx, now = Date.now();
  const all = ctx.state.projects ?? [];
  const range: SeasonRange = ui.homeRange ?? (opts.compact ? '4w' : '8w');
  const w = windowFor(all, range, now);
  const lanes = seasonProjects(opts.compact ? all.filter(p => p.status !== 'past') : all, w).slice(0, opts.compact ? 5 : 12);
  const nowPos = pct(now, w);

  const root = h('section.season', { class: opts.compact ? 'compact' : '', 'aria-label': t('season.label') });
  if (!opts.compact) {
    root.append(h('div.season-head',
      h('h2', t('season.title')),
      h('span.legend',
        h('span.lg.lg-elapsed', t('season.elapsed')),
        h('span.lg.lg-left', t('season.left')),
        h('span.lg.lg-urgent', t('season.urgent')),
        h('span.lg.lg-reg', t('season.regLegend'))),
      h('span.spacer'),
      h('div.seg.small', { role: 'tablist', 'aria-label': t('season.range') }, (['4w', '8w', 'all'] as SeasonRange[]).map(r =>
        h('button.filter', { role: 'tab', class: range === r ? 'active' : '', 'aria-selected': String(range === r), onclick: () => { ui.homeRange = r; ctx.rerender(); } }, t(`season.range.${r}`))))));
  }

  // Week axis: a tick every Monday (or every 2 weeks on long windows).
  const axis = h('div.season-axis', { 'aria-hidden': 'true' });
  const first = new Date(w.start);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() + ((8 - first.getDay()) % 7));
  const step = (w.end - w.start) / DAY > 70 ? 14 : 7;
  for (let d = first.getTime(); d < w.end; d += step * DAY) {
    const at = pct(d, w);
    if (Math.abs(at - nowPos) < 4 || at > 93) continue;
    axis.append(h('span.tick', { style: { left: `${pct(d, w)}%` } }, new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(d))));
  }
  axis.append(h('span.now-label', { style: { left: `${nowPos}%` } }, t('season.now')));

  const body = h('div.season-lanes', { role: 'list' });
  if (!lanes.length) body.append(h('p.season-empty', t('season.empty')));
  for (const p of lanes) {
    const s = Date.parse(p.startDate), e = Date.parse(p.endDate);
    const left = pct(s, w), right = pct(e, w);
    // The bar is clipped to the window, so its fill is measured on the visible span: it always ends on the now line.
    const elapsed = barFill(left, right, nowPos);
    const remaining = e - now;
    const urgent = p.status === 'ongoing' && remaining < DAY;
    const isCurrent = p.id === ctx.state.currentProjectId;
    const selected = p.id === opts.selected;
    const when = p.status === 'ongoing' ? t('card.left', { time: compactDuration(remaining, ctx.lang) }) : p.status === 'upcoming' ? t('card.opensOn', { date: dateOnly(p.startDate, lang) }) : t('timeline.closed', { when: dateOnly(p.endDate, lang) });
    const reg = p.endRegistrationDate && Date.parse(p.endRegistrationDate) > now && Date.parse(p.endRegistrationDate) < w.end ? pct(Date.parse(p.endRegistrationDate), w) : null;
    const label = `${p.name} · ${dateTime(p.startDate, lang)} → ${dateTime(p.endDate, lang)} · ${when}`;
    body.append(h('div.lane', { role: 'listitem', class: `${p.status} ${selected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${urgent ? 'urgent' : ''}` },
      h('button.lane-label', { type: 'button', onclick: () => opts.onSelect(p.id), 'aria-pressed': String(selected), title: p.unitName },
        h('span.lane-name', p.name), !opts.compact && h('span.lane-unit', p.unitName || p.unitCode)),
      h('div.lane-track',
        h('span.lane-now', { style: { left: `${nowPos}%` } }),
        h('button.bar', { type: 'button', style: { left: `${left}%`, width: `${Math.max(1.2, right - left)}%` }, title: label, 'aria-label': label, 'aria-pressed': String(selected),
          onclick: () => opts.onSelect(p.id), ondblclick: () => ctx.post({ type: 'openProject', projectId: p.id }) },
          h('span.bar-done', { style: { width: `${elapsed * 100}%` } }),
          right - left >= 11 && h('span.bar-text', when)),
        right - left < 11 && !opts.compact && h('span.bar-out', { style: right > 80 ? { right: `${100 - left + 0.6}%` } : { left: `${right + 0.6}%` } }, when),
        reg !== null && h('span.reg-tick', { style: { left: `${reg}%` }, title: t('season.registration', { date: dateTime(p.endRegistrationDate, lang) }) }))));
  }

  root.append(h('div.season-grid', axis, body, !opts.compact && lanes.length > 0 && loadChart(ctx, all, w, nowPos)));
  return root;
}

/** Step area of how many registered or ongoing projects overlap each day of the window. */
function loadChart(ctx: Ctx, projects: ProjectVM[], w: Window, nowPos: number): HTMLElement {
  const days = Math.max(1, Math.round((w.end - w.start) / DAY));
  const counts: number[] = [];
  for (let i = 0; i < days; i++) {
    const t0 = w.start + i * DAY, t1 = t0 + DAY;
    counts.push(projects.filter(p => Date.parse(p.startDate) < t1 && Date.parse(p.endDate) > t0).length);
  }
  const max = Math.max(1, ...counts), W = 1000, H = 40;
  let d = `M0,${H}`;
  counts.forEach((c, i) => {
    const x0 = (i / days) * W, x1 = ((i + 1) / days) * W, y = H - (c / max) * (H - 4);
    d += ` L${x0.toFixed(1)},${y.toFixed(1)} L${x1.toFixed(1)},${y.toFixed(1)}`;
  });
  d += ` L${W},${H} Z`;
  const peak = Math.max(...counts);
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'load-svg', role: 'img', 'aria-label': ctx.t('season.loadAria', { n: peak }) },
    svg('path', { d, class: 'load-area' }),
    svg('line', { x1: (nowPos / 100) * W, x2: (nowPos / 100) * W, y1: 0, y2: H, class: 'load-now' }));
  // The number reads as "right now", like the other project counters; the chart keeps showing the peak.
  const current = projects.filter(p => p.status === 'ongoing').length;
  return h('div.season-load', h('span.load-label', ctx.t('season.load'), h('b', String(current))), h('div.load-track', chart));
}
