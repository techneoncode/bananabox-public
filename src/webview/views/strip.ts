import { h, svg } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { dateTime } from '../format';
import { reducedMotion } from '../motion';
import { graderPending } from './signature';

/** When each project's strip first drew real attempts: its draw-in plays once, continued across re-renders. */
const drawnAt = new Map<number, number>();
const DRAW_MS = 1400;

let observer: IntersectionObserver | null = null;
const watching = new WeakMap<Element, number>();
/** The one element observed per project (rows are rebuilt on every render), and projects already asked for. */
const observed = new Map<number, Element>();
const asked = new Set<number>();
let onVisible: (id: number) => void = () => undefined;

/** Asks for a project's attempts only once its row scrolls into view; rows never seen cost nothing. */
function whenVisible(el: HTMLElement, id: number, load: (id: number) => void): void {
  if (asked.has(id) || typeof IntersectionObserver !== 'function') return;
  onVisible = load;
  observer ??= new IntersectionObserver(entries => {
    for (const e of entries) {
      const pid = watching.get(e.target);
      if (!e.isIntersecting || pid === undefined) continue;
      observer!.unobserve(e.target);
      observed.delete(pid);
      if (!asked.has(pid)) { asked.add(pid); onVisible(pid); }
    }
  }, { rootMargin: '120px 0px' });
  const old = observed.get(id);
  if (old) observer.unobserve(old);
  observed.set(id, el);
  watching.set(el, id);
  observer.observe(el);
}

/** Sign-out: the next account starts from nothing. */
export function resetStrips(): void {
  observer?.disconnect();
  observed.clear();
  asked.clear();
  drawnAt.clear();
}

const band = (score: number | null) => score === null ? 'none' : score >= 100 ? 'pass' : score >= 50 ? 'warn' : 'fail';

/**
 * A project's progress as one line under its name: the time track from open to close, and over its elapsed part
 * the score reached at each attempt, held until the next one (a step chart) and up to now.
 */
export function progressStrip(ctx: Ctx, p: ProjectVM, index: number): HTMLElement {
  const { t, lang } = ctx, now = Date.now();
  const start = Date.parse(p.startDate), end = Date.parse(p.endDate), span = Math.max(1, end - start);
  const at = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));
  const nowX = p.status === 'upcoming' ? 0 : at(now);
  const g = ctx.graders.get(p.id);
  const pending = graderPending(ctx, p);
  const attempts = (g?.history ?? []).filter(r => r.score !== null && Number.isFinite(Date.parse(r.date)));
  const root = h('div.pstrip', { class: `${p.status}${pending ? ' pstrip-wait' : ''}`, style: { '--i': String(Math.min(index, 8)) } });
  if (p.status !== 'upcoming' && p.registered) whenVisible(root, p.id, id => ctx.loadProject?.(id, true));

  const H = 26, base = 24, top = 3;
  const y = (score: number) => base - (score / 100) * (base - top);
  const chart = svg('svg', { viewBox: `0 0 100 ${H}`, preserveAspectRatio: 'none', class: 'pstrip-svg', 'aria-hidden': 'true' },
    svg('rect', { x: 0, y: base, width: 100, height: 2, rx: 1, class: 'pstrip-track' }),
    ...(p.status !== 'upcoming' ? [svg('rect', { x: 0, y: base, width: nowX, height: 2, rx: 1, class: 'pstrip-elapsed' })] : []));

  let label: string | null = null;
  if (attempts.length) {
    const first = drawnAt.get(p.id) ?? (drawnAt.set(p.id, now), now);
    const since = now - first;
    if (since < DRAW_MS && !reducedMotion()) { root.classList.add('draw'); root.style.setProperty?.('--since', `${since}ms`); }
    // Attempts are spaced evenly over the elapsed track (their dates are in each dot's tooltip): bunched-up
    // attempts would otherwise be a smudge at the end, and the staircase reads as progress up to "now".
    const holdTo = p.status === 'past' ? 100 : Math.max(nowX, 8);
    const xs = attempts.map((_, i) => (holdTo * (i + 1)) / (attempts.length + 1));
    let line = `M${xs[0].toFixed(2)},${y(attempts[0].score!).toFixed(2)}`;
    attempts.forEach((r, i) => {
      if (i > 0) line += ` H${xs[i].toFixed(2)} V${y(r.score!).toFixed(2)}`;
    });
    line += ` H${holdTo.toFixed(2)}`;
    const area = `${line} V${base} H${xs[0].toFixed(2)} Z`;
    const last = attempts.at(-1)!;
    chart.append(
      svg('path', { d: area, class: `pstrip-area b-${band(last.score)}` }),
      svg('path', { d: line, class: `pstrip-line b-${band(last.score)}`, 'vector-effect': 'non-scaling-stroke' }));
    label = `${last.score}%`;
    // Dots are HTML so they stay round however wide the row is.
    root.append(h('div.pstrip-dots', attempts.map((r, i) => h('i', {
      class: `b-${band(r.score)}${i === attempts.length - 1 ? ' latest' : ''}`,
      style: { left: `${xs[i]}%`, top: `${(y(r.score!) / H) * 100}%`, '--j': String(i) },
      title: `${t('sb.attempt', { n: i + 1, score: `${r.score}%` })} · ${dateTime(r.date, lang)}`,
    }))));
  }
  if (p.status === 'ongoing') root.append(h('i.pstrip-now', { style: { left: `${nowX}%` } }));
  root.prepend(chart);
  const aria = attempts.length
    ? t('list.stripAria', { n: attempts.length, score: label ?? '—', best: Math.max(...attempts.map(r => r.score!)) })
    : pending ? t('readout.loading') : p.status === 'upcoming' ? t('status.upcoming') : t('grader.noRuns');
  return h('div.pstrip-row', { role: 'img', 'aria-label': aria },
    root,
    h('span.pstrip-score', { class: attempts.length ? `ps-${band(attempts.at(-1)!.score)}` : '' }, pending ? h('span.codicon.codicon-loading.spin.pstrip-spin', { title: t('readout.loading') }) : label ?? ''));
}
