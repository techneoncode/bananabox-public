import { h, svg } from '../dom';
import type { Ctx } from '../ctx';
import type { GraderVM } from '../../shared/types';
import { dateTime } from '../format';
import { reducedMotion } from '../motion';

const H = 64, PAD_Y = 7;
const DRAW_MS = 1600, SLIDE_MS = 700;

/** First time each project's trend showed: its line draws once, continued across re-renders. */
const drawnAt = new Map<number, number>();
/** Where the selection marker was, so a new pick slides from there instead of jumping. */
const marks = new Map<number, { id: number; from: number; to: number; at: number }>();

export function resetTrends(): void {
  drawnAt.clear();
  marks.clear();
}

const band = (score: number) => score >= 100 ? 'pass' : score >= 50 ? 'warn' : 'fail';
const yOf = (score: number) => PAD_Y + (1 - Math.min(100, Math.max(0, score)) / 100) * (H - PAD_Y * 2);

/**
 * Smooth path through the points that never overshoots (monotone cubic, Fritsch–Carlson): a score curve
 * must not bulge above 100% or below the attempts it joins.
 */
export function smoothPath(points: Array<[number, number]>): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0]);
    m.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
  }
  const tan = points.map((_, i) => i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
  }
  const f = (v: number) => Number(v.toFixed(2));
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1], h3 = dx[i] / 3;
    d += ` C${f(x0 + h3)},${f(y0 + tan[i] * h3)} ${f(x1 - h3)},${f(y1 - tan[i + 1] * h3)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

/**
 * The score after every attempt as one smooth curve; each attempt is a point to pick, and picking one shows
 * that run everywhere (ring, tests, tasks). The marker slides to the pick; the curve draws itself the first time.
 */
export function scoreTrend(ctx: Ctx, grader: GraderVM, selected: number, onPick: (id: number) => void): HTMLElement | null {
  const { t, lang } = ctx, id = grader.projectId, now = Date.now();
  const runs = grader.history.filter((r): r is typeof r & { score: number } => r.score !== null);
  if (!runs.length) return null;
  const n = runs.length;
  const xOf = (i: number) => n === 1 ? 50 : 5 + (i / (n - 1)) * 90;
  const pts: Array<[number, number]> = runs.map((r, i) => [xOf(i), yOf(r.score)]);
  const line = smoothPath(pts);
  const area = `${line} L${pts[n - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const pick = Math.max(0, runs.findIndex(r => r.id === selected));
  const sel = runs[pick];

  const root = h('div.trend', { role: 'group', 'aria-label': t('report.trend') });
  const motion = !reducedMotion();
  const first = drawnAt.get(id) ?? (drawnAt.set(id, now), now);
  if (motion && now - first < DRAW_MS) { root.classList.add('trend-draw'); root.style.setProperty?.('--since', `${now - first}ms`); }

  const x = xOf(pick);
  const mark = marks.get(id);
  if (!mark || mark.id !== sel.id) marks.set(id, { id: sel.id, from: mark ? mark.to : x, to: x, at: mark ? now : first });
  const m = marks.get(id)!;
  if (motion && now - m.at < SLIDE_MS && m.from !== m.to) {
    root.classList.add('trend-slide');
    root.style.setProperty?.('--from', `${m.from}%`);
    root.style.setProperty?.('--slide', `${now - m.at}ms`);
  }

  const gid = `trend-${id}`;
  const plot = h('div.trend-plot');
  root.append(h('span.trend-axis', { 'aria-hidden': 'true' }, h('span', '100'), h('span', '50'), h('span', '0')), plot);
  plot.append(
    svg('svg', { class: 'trend-svg', viewBox: `0 0 100 ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      svg('defs', {},
        svg('linearGradient', { id: `${gid}-fill`, x1: 0, y1: 0, x2: 0, y2: 1 },
          svg('stop', { offset: '0%', style: 'stop-color: var(--banana); stop-opacity: 0.42' }),
          svg('stop', { offset: '100%', style: 'stop-color: var(--banana); stop-opacity: 0' })),
        svg('linearGradient', { id: `${gid}-line`, x1: 0, y1: 0, x2: 1, y2: 0 },
          svg('stop', { offset: '0%', style: 'stop-color: color-mix(in srgb, var(--banana) 55%, var(--fg-3))' }),
          svg('stop', { offset: '100%', style: 'stop-color: var(--banana)' }))),
      svg('line', { class: 'trend-grid', x1: 0, x2: 100, y1: yOf(100), y2: yOf(100), 'vector-effect': 'non-scaling-stroke' }),
      svg('line', { class: 'trend-grid', x1: 0, x2: 100, y1: yOf(50), y2: yOf(50), 'vector-effect': 'non-scaling-stroke' }),
      svg('path', { class: 'trend-area', d: area, fill: `url(#${gid}-fill)` }),
      svg('path', { class: 'trend-line', d: line, stroke: `url(#${gid}-line)`, 'vector-effect': 'non-scaling-stroke' })),
    h('i.trend-guide', { style: { left: `${x}%` }, 'aria-hidden': 'true' }),
    h('span.trend-tag', { class: `b-${band(sel.score)}${sel.score < 30 ? ' high' : ''}`, style: { left: `${Math.min(84, Math.max(16, x))}%` }, 'aria-hidden': 'true' },
      h('b', `${sel.score}%`), ` · ${t('report.attemptN', { n: pick + 1 })}`),
    ...runs.map((r, i) => h('button.trend-pt', {
      type: 'button',
      class: `b-${band(r.score)}${i === pick ? ' on' : ''}${i === n - 1 ? ' latest' : ''}`,
      style: { left: `${xOf(i)}%`, top: `${(yOf(r.score) / H) * 100}%`, '--j': String(i) },
      title: t('report.trendPoint', { n: i + 1, score: `${r.score}%`, date: dateTime(r.date, lang) }),
      'aria-label': t('report.trendPoint', { n: i + 1, score: `${r.score}%`, date: dateTime(r.date, lang) }),
      'aria-pressed': String(i === pick),
      onclick: () => { if (r.id !== selected) onPick(r.id); },
    })));
  return root;
}
