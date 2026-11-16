import { h, icon } from '../dom';
import type { Ctx, Tab } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { projectMidpoint } from '../../domain/activities';
import { dateTime, progress } from '../format';
import { agendaItems, agendaRow } from './home';

interface Mark { at: number; kind: 'reg' | 'mid' | 'slot'; title: string; tab?: Tab }

/** One project as a lane: open → close with elapsed fill, now line, registration, midpoint and my booked slots. */
export function projectTrack(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, now = Date.now();
  const start = Date.parse(p.startDate), end = Date.parse(p.endDate);
  const marks: Mark[] = [];
  const mid = projectMidpoint(p, ctx.activities.get(p.id));
  if (mid.date && mid.source !== 'slot') marks.push({ at: Date.parse(mid.date), kind: 'mid', title: `${t('timeline.mid')} · ${dateTime(mid.date, lang)}`, tab: 'details' });
  if (p.endRegistrationDate) marks.push({ at: Date.parse(p.endRegistrationDate), kind: 'reg', title: t('season.registration', { date: dateTime(p.endRegistrationDate, lang) }), tab: 'details' });
  for (const a of ctx.activities.get(p.id) ?? []) for (const s of a.slots ?? []) if (s.mine) marks.push({ at: Date.parse(s.startDate), kind: 'slot', title: `${a.name} · ${dateTime(s.startDate, lang)}`, tab: 'activities' });
  const valid = marks.filter(m => Number.isFinite(m.at));
  // Defenses often fall after the close: the lane stretches to the last booked slot.
  const last = Math.max(end, ...valid.map(m => m.at));
  const span = Math.max(1, last - start);
  const at = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));
  const closeAt = at(end), nowAt = at(now);
  const live = p.status === 'ongoing';
  const short = (iso: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(iso));
  const go = (tab?: Tab) => () => { if (tab) { ctx.ui.tab = tab; ctx.rerender(); } };

  return h('div.ptrack', { role: 'group', 'aria-label': t('focus.track') },
    h('div.ptrack-lane',
      h('span.ptrack-bar', { style: { width: `${closeAt}%` } }, h('span.ptrack-done', { style: { width: `${progress(p.startDate, p.endDate, now) * 100}%` } })),
      last > end && h('span.ptrack-after', { style: { left: `${closeAt}%`, width: `${100 - closeAt}%` } }),
      h('span.ptrack-close', { style: { left: `${closeAt}%` }, title: `${t('timeline.close')} · ${dateTime(p.endDate, lang)}` }),
      valid.map(m => h('button.ptrack-mark', { type: 'button', class: `m-${m.kind}${m.at < now ? ' past' : ''}${m.at > end ? ' after' : ''}`, style: { left: `${at(m.at)}%` }, title: m.title, 'aria-label': m.title, onclick: go(m.tab) })),
      live && h('span.ptrack-now', { style: { left: `${nowAt}%` } })),
    h('div.ptrack-axis',
      h('span', short(p.startDate)),
      // Past ~70% the close label would collide with the last event's; the focus card already states the close.
      (last <= end || closeAt < 70) && h('span.ptrack-end', { class: last > end ? 'inner' : '', style: last > end ? { left: `${closeAt}%` } : {} }, short(p.endDate)),
      last > end && h('span.ptrack-last', short(new Date(last).toISOString()))));
}

/** Up to three dated events of this project, Home's agenda grammar. */
export function renderNextUp(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  // The focus card owns the close; the rows go to slots, defenses, the midpoint and registration.
  const items = agendaItems(ctx, [p], { midpoint: true, ownProject: true }).filter(i => i.kind !== 'close').slice(0, 3);
  if (!items.length) return null;
  const tabFor = (kind: string): Tab => kind === 'slot' ? 'activities' : 'details';
  return h('section.next-up', { 'aria-label': ctx.t('nextUp.title') },
    h('div.section-head', h('h2', ctx.t('nextUp.title'))),
    h('ol.agenda-list', items.map(i => agendaRow(ctx, i, () => { ctx.ui.tab = tabFor(i.kind); ctx.rerender(); }))));
}
