import { h, icon } from '../dom';
import type { Ctx, Filter } from '../ctx';
import type { ProjectStatus, ProjectVM } from '../../shared/types';
import { compactDuration, dateOnly, progress, relative } from '../format';
import { chip, gut, type Tone } from '../ui';
import { renderSeason } from './season';
import { avatar } from '../avatars';
import { openInSidebar, renderCarousel } from './carousel';
import { progressStrip } from './strip';
import { liveCountdown } from '../motion';

const STATUS_ICON: Record<ProjectStatus, [string, Tone]> = {
  ongoing: ['issues', 'pass'],
  upcoming: ['clock', ''],
  past: ['issue-closed', 'info'],
};

function initials(ctx: Ctx): string {
  const a = ctx.state.auth;
  return ((a.firstname?.[0] ?? a.login?.[0] ?? '?') + (a.lastname?.[0] ?? '')).toUpperCase();
}

/** Project state as a chip: icon and label, never colour alone. */
export function statusBadge(ctx: Ctx, status: ProjectStatus): HTMLElement {
  return h('span.chip.state', { class: `${status} ${STATUS_ICON[status][1] ? `t-${STATUS_ICON[status][1]}` : ''}` }, icon(STATUS_ICON[status][0]), ctx.t(`status.${status}`));
}

export function renderList(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const root = h('div.list', { class: ctx.surface === 'sidebar' ? 'sb-home' : '' });
  const a = state.auth;
  root.append(h('div.me',
    a.login ? avatar(ctx, { login: a.login, name: [a.firstname, a.lastname].filter(Boolean).join(' ') }, 28) : h('div.avatar', { 'aria-hidden': 'true' }, initials(ctx)),
    h('div.me-text', h('strong.ellipsis', [a.firstname, a.lastname].filter(Boolean).join(' ') || a.login), h('span.sub.ellipsis', [a.login, a.cursus, a.promotion].filter(Boolean).join(' · '))),
    ctx.surface === 'sidebar' && h('button.icon-btn.colors-btn', { type: 'button', title: t('appearance.open'), 'aria-label': t('appearance.open'), onclick: () => { ctx.ui.page = 'appearance'; ctx.rerender(); } }, icon('symbol-color')),
    ctx.surface === 'sidebar' && h('button.icon-btn.refresh-btn', { type: 'button', title: t('action.refresh'), 'aria-label': t('action.refresh'), disabled: !!state.loading, onclick: () => ctx.post({ type: 'refresh' }) },
      icon(state.loading ? 'loading' : 'refresh', state.loading ? 'spin' : '')),
    h('button.icon-btn.home-btn', { type: 'button', title: t('home.open'), 'aria-label': t('home.open'), onclick: () => ctx.post({ type: 'openHome' }) }, icon('home'))));

  if (ctx.surface === 'sidebar' && state.projects) {
    root.append(greeting(ctx));
    const carousel = renderCarousel(ctx);
    if (carousel) root.append(carousel);
  }
  const current = state.projects?.find(p => p.id === state.currentProjectId);
  if (state.projects?.some(p => p.status !== 'past')) {
    const season = renderSeason(ctx, { selected: current?.id ?? null, compact: true, onSelect: (id) => openInSidebar(ctx, id) });
    season.classList.add('rise');
    season.style?.setProperty?.('--i', '2');
    root.append(season);
  }
  const browser = projectBrowser(ctx);
  browser.forEach((n, i) => { n.classList.add('rise'); n.style?.setProperty?.('--i', String(3 + Math.min(i, 2))); });
  root.append(...browser);
  return root;
}

/** "Good evening, Ada" and the one fact that matters most right now, ticking. */
function greeting(ctx: Ctx): HTMLElement {
  const { t, state } = ctx, now = Date.now();
  const hour = new Date().getHours();
  const name = state.auth.firstname || state.auth.login || '';
  const ongoing = (state.projects ?? []).filter(p => p.status === 'ongoing' && Date.parse(p.endDate) > now)
    .sort((x, y) => Date.parse(x.endDate) - Date.parse(y.endDate));
  const next = ongoing[0];
  const urgent = next && Date.parse(next.endDate) - now < 24 * 3_600_000;
  return h('div.sb-hello.rise', { style: { '--i': '0' } },
    h('h1', t(hour < 12 ? 'home.morning' : hour < 18 ? 'home.afternoon' : 'home.evening', { name })),
    h('p', h('b', t('home.ongoing', { n: ongoing.length })),
      next && [' · ', t('sb.closesNext', { name: next.name }), ' ', h('span.mono.num', { class: urgent ? 'urgent' : '' }, liveCountdown(next.endDate))]));
}

/** Search, status filter and grouped project rows: shared by the sidebar and Home. */
export function projectBrowser(ctx: Ctx): HTMLElement[] {
  const { t, state, ui } = ctx;
  if (!state.projects) return [state.error ? errorState(ctx, state.error) : skeleton()];
  const out: HTMLElement[] = [];
  const all = state.projects;
  const counts: Record<Filter, number> = { all: all.length, ongoing: 0, upcoming: 0, past: 0 };
  all.forEach(p => counts[p.status]++);

  out.push(h('div.list-tools',
    h('div.searchbar', icon('search'), h('input.search', { type: 'search', placeholder: t('list.search'), value: ui.search, 'aria-label': t('list.search'), dataset: { keep: 'search' },
      oninput: (e: Event) => { ui.search = (e.target as HTMLInputElement).value; ctx.rerender(); } })),
    h('div.seg', { role: 'tablist', 'aria-label': t('list.filter') }, (['all', 'ongoing', 'upcoming', 'past'] as Filter[]).map(f =>
      h('button.filter', { role: 'tab', class: ui.filter === f ? 'active' : '', 'aria-selected': String(ui.filter === f), onclick: () => ((ui.filter = f), ctx.rerender()) },
        t(f === 'all' ? 'filter.all' : `status.${f}`), h('span.counter', counts[f]))))));

  if (state.error) out.push(h('div.notice.error', icon('error'), h('div', state.error, h('button.btn.small', { onclick: () => ctx.post({ type: 'refresh' }) }, t('action.retry')))));
  if (state.partialErrors.length) out.push(h('div.notice.warn', icon('warning'), h('div', t('list.partial'))));

  const q = ui.search.trim().toLowerCase();
  const visible = all.filter(p => (ui.filter === 'all' || p.status === ui.filter) && (!q || `${p.name} ${p.unitName} ${p.unitCode}`.toLowerCase().includes(q)));
  if (visible.length === 0) {
    out.push(h('div.empty', icon('search'), h('p', q ? t('list.noMatch') : t('list.empty'))));
    return out;
  }
  const list = h('div.g-list');
  for (const status of ['ongoing', 'upcoming', 'past'] as ProjectStatus[]) {
    const group = visible.filter(p => p.status === status);
    if (!group.length) continue;
    if (ui.filter === 'all') list.append(h('div.group-head', t(`section.${status}`), h('span.counter', group.length)));
    group.forEach((p, i) => list.append(row(ctx, p, i)));
  }
  out.push(list);
  return out;
}

function row(ctx: Ctx, p: ProjectVM, index = 0): HTMLElement {
  const { t, lang } = ctx;
  const now = Date.now();
  const isCurrent = p.id === ctx.state.currentProjectId;
  const left = Date.parse(p.endDate) - now;
  const urgent = p.status === 'ongoing' && left < 24 * 3_600_000;
  const tone: Tone = urgent ? 'fail' : isCurrent ? 'accent' : '';
  return h('button.g-row.repo-row', {
    class: `${isCurrent ? 'is-current' : ''} ${p.status === 'past' ? 'dim' : ''}`, 'aria-label': p.name,
    onclick: () => { if (ctx.surface === 'sidebar') openInSidebar(ctx, p.id); else ctx.post({ type: 'openProject', projectId: p.id }); },
  },
    gut(null, tone),
    h('span.row-main',
      h('span.row-title', h('span.row-name', p.name), isCurrent && chip('accent', icon('repo'), t('badge.current')), !p.registered && p.status !== 'past' && chip('', t('badge.notRegistered'))),
      h('span.row-meta',
        h('span.ellipsis', p.unitName || p.unitCode),
        h('span', p.status === 'upcoming' ? t('card.opensOn', { date: dateOnly(p.startDate, lang) }) : `${dateOnly(p.startDate, lang)} → ${dateOnly(p.endDate, lang)}`),
        p.repoEnabled && h('span', { title: t('badge.repo') }, icon('repo')),
        p.groupSizeMax > 1 && h('span', { title: t('overview.groupSize') }, icon('organization'), `${p.groupSizeMin}–${p.groupSizeMax}`)),
      p.status === 'ongoing' && h('span.rail-thin', { class: urgent ? 'urgent' : '' }, h('span', { style: { width: `${Math.round(progress(p.startDate, p.endDate, now) * 100)}%` } }))),
    h('span.row-side', p.status === 'ongoing' && h('span', { class: urgent ? 'urgent' : '' }, t('card.left', { time: compactDuration(left) })), p.status === 'upcoming' && h('span', relative(p.startDate, lang))),
    (ctx.surface === 'sidebar' || ctx.home) && progressStrip(ctx, p, index));
}

export function skeleton(): HTMLElement {
  return h('div.skeletons', [0, 1, 2, 3].map(() => h('div.skeleton', h('div.sk.w60'), h('div.sk.w40'))));
}

function errorState(ctx: Ctx, message: string): HTMLElement {
  return h('div.empty', icon('error'), h('p', h('strong', ctx.t('list.loadError'))), h('p.small', message),
    h('button.btn', { onclick: () => ctx.post({ type: 'refresh' }) }, icon('refresh'), ctx.t('action.retry')));
}
