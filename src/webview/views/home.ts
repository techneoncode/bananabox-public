import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { dateOnly, dateTime, relative, timeOnly } from '../format';
import { chip } from '../ui';
import { projectBrowser, statusBadge } from './list';
import { renderSeason } from './season';
import { banner, deadlineTile, openButtons, scoreTile, stateGroup, tileLabel } from './summary';
import { renderMilestoneStrip } from './prepare';
import { enterPart } from '../motion';
import { projectMidpoint } from '../../domain/activities';
import { avatarStack } from '../avatars';

const DAY = 86_400_000;

/** The project the detail card follows: the user's pick, else the open repo, else the next to close. */
export function homeSelection(ctx: Ctx): ProjectVM | null {
  const projects = ctx.state.projects ?? [];
  const picked = ctx.ui.homeSelected;
  return projects.find(p => p.id === picked)
    ?? projects.find(p => p.id === ctx.state.currentProjectId)
    ?? [...projects].filter(p => p.status === 'ongoing').sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))[0]
    ?? [...projects].filter(p => p.status === 'upcoming').sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0]
    ?? projects[0] ?? null;
}

/** Wide Home dashboard: timeline first, then the selected project and what is coming up, then every project. */
export function renderHome(ctx: Ctx, load: (id: number) => void): HTMLElement {
  const { t, state } = ctx;
  const root = h('div.home');
  root.append(header(ctx));
  if (!state.projects) {
    root.append(...projectBrowser(ctx));
    return root;
  }
  const selected = homeSelection(ctx);
  if (selected) load(selected.id);
  root.append(renderSeason(ctx, { selected: selected?.id ?? null, onSelect: (id) => { ctx.ui.homeSelected = id; ctx.rerender(); } }));
  root.append(h('div.home-grid', selected ? projectCard(ctx, selected) : h('div'), agenda(ctx)));
  root.append(h('section.home-all', { 'aria-label': t('home.all') }, h('div.section-head', h('h2', t('home.all'))), ...projectBrowser(ctx)));
  return root;
}

function header(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const hour = new Date().getHours();
  const name = state.auth.firstname || state.auth.login || '';
  const projects = state.projects ?? [];
  const ongoing = projects.filter(p => p.status === 'ongoing');
  const urgent = ongoing.filter(p => Date.parse(p.endDate) - Date.now() < DAY);
  const upcoming = projects.filter(p => p.status === 'upcoming');
  return h('header.home-head',
    h('div.home-title',
      h('h1', t(hour < 12 ? 'home.morning' : hour < 18 ? 'home.afternoon' : 'home.evening', { name })),
      h('p.home-summary',
        chip('pass', icon('pulse'), t('home.ongoing', { n: ongoing.length })),
        urgent.length > 0 && chip('fail', icon('flame'), t('home.urgent', { n: urgent.length })),
        upcoming.length > 0 && chip('', icon('calendar'), t('home.openingSoon', { n: upcoming.length })))),
    h('button.btn.home-colors', { type: 'button', title: t('appearance.open'), onclick: () => { ctx.ui.page = 'appearance'; ctx.rerender(); } }, icon('symbol-color'), t('appearance.title')));
}

/**
 * The selected project, in the sidebar summary's language at Home's width: the skyline banner, the live tiles
 * and the state rows. Every piece opens the project's editor tab on the matching page.
 */
function projectCard(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx;
  const isCurrent = p.id === ctx.state.currentProjectId;
  const card = h('section.home-card', { 'aria-label': t('home.selected') },
    h('div.card-head.rise', { style: { '--i': '0' } },
      h('div.card-title',
        h('h2', p.name),
        h('span.card-sub', [p.unitName, p.unitCode, p.instanceCode].filter(Boolean).join(' · '))),
      h('div.card-chips', statusBadge(ctx, p.status), p.registered ? chip('pass', icon('check'), t('badge.registered')) : p.status !== 'past' && chip('warn', t('badge.notRegistered')), isCurrent && chip('accent', icon('repo'), t('badge.current'))),
      h('div.card-actions',
        ...openButtons(ctx, p),
        h('button.icon-btn', { type: 'button', title: t('action.intranet'), 'aria-label': t('action.intranet'), onclick: () => ctx.post({ type: 'openExternal', url: p.intranetUrl }) }, icon('link-external')))),
    banner(ctx, p, cardWidth() - 30, 76, 34),
    h('div.sb-tiles.home-tiles', deadlineTile(ctx, p), scoreTile(ctx, p), groupTile(ctx, p)),
    renderMilestoneStrip(ctx, p),
    stateGroup(ctx, p));
  // Picking another project on the timeline re-plays the card's entrance, not the whole page's.
  return enterPart(card, 'home-card', String(p.id));
}

/** Who the project is with, as a tile like the others; opens the details page. */
function groupTile(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, now = Date.now();
  const regOpen = p.endRegistrationDate && Date.parse(p.endRegistrationDate) > now;
  return h('button.panel.sb-tile.rise', { type: 'button', style: { '--i': '3' }, title: t('readout.open'), onclick: () => ctx.post({ type: 'openProject', projectId: p.id, tab: 'overview' }) },
    tileLabel(t('overview.group')),
    h('span.sb-tile-row',
      h('span.home-group-name.ellipsis', p.groupName ?? (p.registered ? t('home.solo') : t('badge.notRegistered'))),
      h('span.spacer'),
      p.groupMembers?.length > 0 && avatarStack(ctx, p.groupMembers, 4, 22)),
    h('span.sb-tile-sub', p.groupSizeMax > 1 ? `${p.groupMemberCount ?? '?'} / ${p.groupSizeMin}–${p.groupSizeMax}` : t('home.solo'),
      regOpen ? ` · ${t('home.registrationUntil', { date: dateOnly(p.endRegistrationDate!, lang) })}` : ''));
}

/** The card's width, to draw its skyline at its real size: the wide grid's first column, or the whole page. */
function cardWidth(): number {
  const scroller = typeof document.querySelector === 'function' ? document.querySelector<HTMLElement>('.scroll') : null;
  const page = Math.min(1240, (scroller?.clientWidth || 900)) - 24;
  return Math.max(260, page > 900 ? ((page - 18) * 1.75) / 2.75 : page);
}

export interface AgendaItem { at: number; title: string; sub: string; tone: '' | 'fail' | 'accent' | 'pass'; icon: string; projectId: number; kind: 'close' | 'open' | 'registration' | 'slot' | 'mid' }

/** Dated events still ahead: closes, openings, registration deadlines and my booked slots, soonest first. */
export function agendaItems(ctx: Ctx, projects: ProjectVM[], opts: { midpoint?: boolean; ownProject?: boolean } = {}): AgendaItem[] {
  const { t } = ctx, now = Date.now();
  const items: AgendaItem[] = [];
  for (const p of projects) {
    const end = Date.parse(p.endDate), start = Date.parse(p.startDate);
    const name = (key: string) => opts.ownProject ? t(`${key}.self`) : t(key, { name: p.name });
    if (p.status === 'ongoing' && end > now) items.push({ at: end, title: name('agenda.closes'), sub: opts.ownProject ? dateTime(p.endDate, ctx.lang) : p.unitName, tone: end - now < DAY ? 'fail' : p.id === ctx.state.currentProjectId && !opts.ownProject ? 'accent' : '', icon: 'milestone', projectId: p.id, kind: 'close' });
    if (p.status === 'upcoming' && start > now) items.push({ at: start, title: name('agenda.opens'), sub: p.unitName, tone: '', icon: 'rocket', projectId: p.id, kind: 'open' });
    const reg = p.endRegistrationDate ? Date.parse(p.endRegistrationDate) : NaN;
    if (!p.registered && reg > now) items.push({ at: reg, title: name('agenda.registration'), sub: p.unitName, tone: '', icon: 'person-add', projectId: p.id, kind: 'registration' });
    if (opts.midpoint) {
      const mid = projectMidpoint(p, ctx.activities.get(p.id));
      const at = mid.date ? Date.parse(mid.date) : NaN;
      // A midpoint taken from my booked slot is already listed as that slot.
      if (at > now && mid.source !== 'slot') items.push({ at, title: t('timeline.mid'), sub: t(`activities.mid.${mid.source}`), tone: '', icon: 'debug-step-over', projectId: p.id, kind: 'mid' });
    }
    // A session split into windows (a defense in the morning and the afternoon) is one event: one row, every time listed.
    const byName = new Map<string, Array<{ start: string; room: string | null }>>();
    for (const a of ctx.activities.get(p.id) ?? []) for (const s of a.slots ?? []) {
      if (s.mine && Date.parse(s.startDate) > now) byName.set(a.name, [...byName.get(a.name) ?? [], { start: s.startDate, room: s.room ?? a.location ?? null }]);
    }
    for (const [title, slots] of byName) {
      slots.sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
      const times = opts.ownProject ? slots.map(x => timeOnly(x.start, ctx.lang)).join(', ') : p.name;
      const rooms = [...new Set(slots.map(x => x.room).filter(Boolean))].join(', ');
      items.push({ at: Date.parse(slots[0].start), title, sub: [times, rooms].filter(Boolean).join(' · '), tone: 'pass', icon: 'calendar', projectId: p.id, kind: 'slot' });
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

/** One agenda row: date block, title with icon, context, relative time. */
export function agendaRow(ctx: Ctx, i: AgendaItem, onclick: () => void): HTMLElement {
  const d = new Date(i.at);
  return h('li', h('button.agenda-item', { type: 'button', class: i.tone ? `t-${i.tone}` : '', onclick, title: dateTime(d.toISOString(), ctx.lang) },
    h('span.agenda-date', h('b', String(d.getDate())), h('span', new Intl.DateTimeFormat(ctx.lang, { weekday: 'short' }).format(d))),
    h('span.agenda-main', h('span.agenda-title', icon(i.icon), h('span.ellipsis', i.title)), h('span.agenda-sub', i.sub)),
    h('span.agenda-when', relative(d.toISOString(), ctx.lang))));
}

function agenda(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const list = agendaItems(ctx, ctx.state.projects ?? []).slice(0, 7);
  return h('section.panel.agenda', { 'aria-label': t('agenda.title') },
    h('div.section-head', h('h2', t('agenda.title'))),
    list.length === 0
      ? h('p.muted.small', t('agenda.empty'))
      : h('ol.agenda-list', list.map(i => agendaRow(ctx, i, () => ctx.post({ type: 'openProject', projectId: i.projectId })))));
}
