import type { Ctx } from '../ctx';
import { h } from '../dom';
import type { ProjectVM } from '../../shared/types';
import { skyline } from '../charts';
import { dateTime, progress } from '../format';
import { freshSince } from '../motion';

const DAY = 86_400_000;

/** Width available inside the sidebar column, minus `inset` pixels of padding; a sane default off-screen. */
export function columnWidth(inset: number): number {
  const scroller = typeof document.querySelector === 'function' ? document.querySelector<HTMLElement>('.scroll') : null;
  const width = scroller?.clientWidth || 300;
  return Math.max(120, width - 24 - inset);
}

/** The project's skyline from its real attempts and tokens; null until its grader is known or when it has none. */
export function projectSkyline(ctx: Ctx, p: ProjectVM, width: number, height: number, maxBar?: number): SVGElement | null {
  const { t, lang } = ctx, g = ctx.graders.get(p.id);
  if (!g) return null;
  if (!g.canRun && g.history.length === 0 && (g.reason === 'not_registered' || g.reason === 'repo_disabled')) return null;
  const left = g.quota?.remaining ?? 0;
  const bars = g.history.map((r, i) => ({ score: r.score, title: `${t('sb.attempt', { n: i + 1, score: r.score === null ? '—' : `${r.score}%` })} · ${dateTime(r.date, lang)}` }));
  return skyline(bars, left, {
    width, height, maxBar, running: g.running, fresh: freshSince(p.id) !== null,
    aria: t('sb.signature', { n: g.history.length, left }), slotTitle: t('sb.tokenSlot'), ghostTitle: t('sb.inFlight'),
  });
}

/** True while a project's attempts are being read for the first time (nothing cached to show yet). */
export function graderPending(ctx: Ctx, p: ProjectVM): boolean {
  const g = ctx.graders.get(p.id);
  if (p.status === 'upcoming' || !p.registered) return false;
  return !g || (g.loading && g.history.length === 0 && !g.quota);
}

/** Placeholder skyline while attempts load: soft shimmering columns, never mistaken for real scores. */
export function skylineSkeleton(ctx: Ctx, width: number, height: number, maxBar = 18): HTMLElement {
  const heights = [0.35, 0.55, 0.45, 0.7, 0.6];
  const bar = Math.min(maxBar, Math.max(6, Math.floor(width / 12)));
  return h('div.sky-skel', { role: 'status', 'aria-label': ctx.t('readout.loading'), style: { height: `${height}px` } },
    heights.map(k => h('i', { style: { width: `${bar}px`, height: `${Math.round(k * (height - 6))}px` } })));
}

/** What the clock says for a project: the moment it counts to, how far along it is, whether it is urgent. */
export function projectClock(p: ProjectVM, now = Date.now()): { target: string; elapsed: number; urgent: boolean; key: 'closesIn' | 'opensIn' | 'closed' } {
  const remaining = Date.parse(p.endDate) - now;
  return {
    target: p.status === 'upcoming' ? p.startDate : p.endDate,
    elapsed: p.status === 'upcoming' ? 0 : progress(p.startDate, p.endDate, now),
    urgent: p.status === 'ongoing' && remaining < DAY,
    key: p.status === 'ongoing' ? 'closesIn' : p.status === 'upcoming' ? 'opensIn' : 'closed',
  };
}
