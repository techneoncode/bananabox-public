import { h, icon } from '../dom';
import type { Ctx, UiState } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { compactDuration, dateOnly } from '../format';
import { reducedMotion } from '../motion';
import { chip } from '../ui';
import { avatarStack } from '../avatars';
import { projectClock } from '../views/signature';
import { ring } from '../charts';
import { bigButton, emptyState, iconAction, openSheet, segmented } from './kit';

type Column = NonNullable<UiState['boardColumn']>;
const COLUMNS: Column[] = ['ongoing', 'upcoming', 'past'];

// Search reveal is screen state only; the query itself lives in ui.search (shared with the list view).
let searchOpen = false;
let focusSearch = false;
let settleTimer = 0;
// The column the strip was last placed on or settled on; a change from outside (host, tab switch) re-places it.
let shownColumn: Column | null = null;

/** Projects tab: the board of project cards, one column per status, swiped sideways. */
export function renderProjectsTab(ctx: Ctx): HTMLElement {
  const { t, ui } = ctx;
  const all = ctx.state.projects ?? [];
  const loading = ctx.state.loading && !ctx.state.projects;
  const failed = !!ctx.state.error && !ctx.state.projects;
  const q = ui.search.trim().toLowerCase();
  const matches = (p: ProjectVM) => !q || `${p.name} ${p.unitName} ${p.unitCode}`.toLowerCase().includes(q);
  // The project open in this window is pinned above the columns, whatever its status; the columns list the others.
  const current = all.find(p => p.id === ctx.state.currentProjectId);
  const others = all.filter(p => p !== current);
  const shown = others.filter(matches);
  const byColumn = (list: ProjectVM[]): Record<Column, ProjectVM[]> => {
    const out: Record<Column, ProjectVM[]> = { ongoing: [], upcoming: [], past: [] };
    list.forEach(p => out[p.status as Column]?.push(p));
    return out;
  };
  const columns = byColumn(shown);
  const everything = byColumn(others);
  const active: Column = ui.boardColumn ?? COLUMNS.find(c => everything[c].length > 0) ?? 'ongoing';
  if (!loading && !failed) all.forEach(p => ctx.loadProject?.(p.id, true));

  const strip = h('div.bd-strip', { dataset: { keepScroll: 'board' }, onscroll: () => { fitStrip(); clearTimeout(settleTimer); settleTimer = window.setTimeout(settle, 120); } },
    COLUMNS.map(c => h('section.bd-col', { role: 'group', 'aria-label': columnLabel(ctx, c) },
      loading ? [0, 1].map(() => skeleton())
        : columns[c].length ? columns[c].map(p => card(ctx, p))
        : emptyState('project', q ? t('list.noMatch') : t('app.board.empty')))));
  const markSeg = (id: Column) => {
    seg.querySelectorAll<HTMLElement>('.segl-opt').forEach((el, i) => {
      const on = COLUMNS[i] === id;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
    });
  };
  const goTo = (id: Column, smooth: boolean) => {
    strip.scrollTo({ left: COLUMNS.indexOf(id) * strip.clientWidth, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  };
  // Scroll ended on a column: that column becomes the switch's value. No re-render, so the strip keeps its motion.
  function settle(): void {
    const index = Math.min(COLUMNS.length - 1, Math.max(0, Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth))));
    const id = COLUMNS[index];
    if (ui.boardColumn === id) return;
    ui.boardColumn = id;
    shownColumn = id;
    markSeg(id);
  }
  const seg = segmented(t('app.board.columns'), COLUMNS.map(c => ({ id: c, label: columnLabel(ctx, c), count: loading ? undefined : columns[c].length })), active, id => {
    ui.boardColumn = id;
    shownColumn = id;
    markSeg(id);
    goTo(id, true);
  });
  // Across re-renders the strip keeps its position (main.ts restores it). Place it when it is new or the active column
  // changed elsewhere. The view may be swapped in a frame or more later (navigation transitions), so wait for layout.
  if (!document.querySelector('.bd-strip') || active !== shownColumn) placeOn(COLUMNS.indexOf(active), 60);
  shownColumn = active;
  // Cards change height as data arrives: size the strip to its column once this render is in the page.
  requestAnimationFrame(() => fitStrip());

  const search = searchOpen || ui.search ? h('label.bd-search', icon('search'),
    h('input.bd-input', { type: 'search', value: ui.search, placeholder: t('list.search'), 'aria-label': t('list.search'), dataset: { keep: 'board-search' },
      oninput: (e: Event) => { ui.search = (e.target as HTMLInputElement).value; ctx.rerender(); } })) : null;
  if (focusSearch) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[data-keep="board-search"]')?.focus());
  focusSearch = false;

  const body = failed ? emptyState('warning', t('app.board.loadError'), bigButton(t('action.retry'), 'refresh', () => ctx.post({ type: 'refresh' }), 'secondary'))
    : !loading && !all.length ? emptyState('project', t('app.board.empty'))
    : [
      current && matches(current) ? h('section.bd-pinned', { 'aria-label': t('app.board.openHere') }, h('h2.lg-title', t('app.board.openHere')), card(ctx, current)) : null,
      seg, ctx.state.error ? h('p.bd-note', icon('warning'), ctx.state.error) : null, strip];
  // One row: large title left, search and refresh right (kit.appBar's large variant stacks them).
  return h('div.board',
    h('header.ab', h('div.ab-row',
      h('h1.bd-title', t('app.tab.projects')),
      h('span.spacer'),
      h('div.ab-actions',
        iconAction(t('list.search'), 'search', () => {
          searchOpen = !searchOpen;
          focusSearch = searchOpen;
          if (!searchOpen) ui.search = '';
          ctx.rerender();
        }, { 'aria-pressed': String(searchOpen || !!ui.search) }),
        iconAction(t('action.refresh'), 'refresh', () => ctx.post({ type: 'refresh' }))))),
    search,
    body);
}

/**
 * The strip is as tall as the column on screen, not the tallest one: In progress must not scroll past its last card
 * because Done is longer. Mid-swipe it takes the taller of the two columns in view, so nothing is cut while moving.
 */
function fitStrip(): void {
  const strip = document.querySelector<HTMLElement>('.bd-strip');
  if (!strip || strip.clientWidth === 0) return;
  const cols = strip.querySelectorAll<HTMLElement>(':scope > .bd-col');
  const at = strip.scrollLeft / strip.clientWidth;
  const a = cols[Math.floor(at)], b = cols[Math.ceil(at)];
  const height = Math.max(a?.offsetHeight ?? 0, b?.offsetHeight ?? 0);
  if (height) strip.style.height = `${height}px`;
}

/** Sets the live strip to a column once it is in the page and has a width; gives up after `frames` frames. */
function placeOn(index: number, frames: number): void {
  const strip = document.querySelector<HTMLElement>('.bd-strip');
  if (strip && strip.clientWidth > 0) { strip.scrollLeft = index * strip.clientWidth; fitStrip(); return; }
  if (frames > 0) requestAnimationFrame(() => placeOn(index, frames - 1));
}

function columnLabel(ctx: Ctx, c: Column): string {
  return c === 'ongoing' ? ctx.t('status.ongoing') : c === 'upcoming' ? ctx.t('status.upcoming') : ctx.t('app.board.done');
}

function skeleton(): HTMLElement {
  return h('div.bd-card.bd-skel', { 'aria-hidden': 'true' },
    h('span.bd-sk.w60'), h('span.bd-sk.w40'), h('span.bd-sk.w80'));
}

/** One project card: the whole card opens its quick sheet. */
function card(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx;
  const now = Date.now();
  const g = ctx.graders.get(p.id);
  const clock = projectClock(p, now);
  const remaining = Date.parse(clock.target) - now;
  const isCurrent = p.id === ctx.state.currentProjectId;
  const scores = (g?.history ?? []).map(r => r.score).filter((s): s is number => s != null);
  const last = g?.history.at(-1)?.score ?? null;
  const best = scores.length ? Math.max(...scores) : null;
  const q = g?.quota ?? null;
  const members = p.groupMembers ?? [];
  return h('button.bd-card', {
    type: 'button',
    class: [isCurrent ? 'current' : '', clock.urgent ? 'urgent' : ''].join(' ').trim(),
    'aria-label': [p.name, [p.unitCode, p.unitName].filter(Boolean).join(' · ')].filter(Boolean).join(', '),
    onclick: () => openSheet(ctx, p.id),
  },
    h('span.bd-head',
      h('span.bd-titles',
        h('span.bd-name', p.name),
        h('span.bd-unit', [p.unitCode, p.unitName].filter(Boolean).join(' · '))),
      // The current project carries its last score as a ring: the first-viewport anchor of the board.
      isCurrent ? ring(last != null ? last / 100 : 0, { size: 48, stroke: 5, label: last != null ? `${last}%` : '—', aria: `${t('gauge.score')} ${last != null ? `${last}%` : '—'}` }) : null),
    !p.registered ? h('span.bd-chips',
      !p.registered ? chip('', t('badge.notRegistered')) : null) : null,
    h('span.bd-deadline', { class: clock.urgent ? 'urgent' : '', title: clock.urgent ? t('app.board.urgent') : undefined },
      h('span.bd-rail', h('i', { style: { width: `${Math.round(clock.elapsed * 100)}%` } })),
      h('span.bd-time.bd-num', clock.key === 'closed' ? t('gauge.closed') : `${t(`gauge.${clock.key}`)} ${compactDuration(remaining, lang)}`)),
    last != null ? scoreBar(ctx, last) : null,
    h('span.bd-foot',
      best != null ? h('span.bd-stat', h('b.bd-num', `${best}%`), h('small', t('history.best'))) : null,
      q ? h('span.bd-stat', h('b.bd-num', `${q.remaining}/${q.total}`), h('small', t('grader.tokensLeft'))) : null,
      h('span.spacer'),
      members.length > 1 ? avatarStack(ctx, members, 3, 18) : null));
}

/**
 * Last grader score as a bar whose colour follows the score: the theme's fail at 0, warn at 50, pass at 100,
 * mixed in between so 72% reads as "almost there".
 */
function scoreBar(ctx: Ctx, score: number): HTMLElement {
  const s = Math.max(0, Math.min(100, score));
  const tone = s < 50 ? `color-mix(in oklab, var(--warn) ${s * 2}%, var(--fail))` : `color-mix(in oklab, var(--pass) ${(s - 50) * 2}%, var(--warn))`;
  return h('span.bd-score', { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(s), 'aria-label': ctx.t('gauge.score') },
    h('span.bd-score-rail', h('i', { style: { width: `${s}%`, background: tone } })),
    h('span.bd-score-l', h('b.bd-num', { style: { color: tone } }, `${s}%`), h('small', ctx.t('gauge.score'))));
}

/** Count-aware string: `app.board.<base>.one` for 1 (0 in French), `.other` otherwise. */
export function plural(ctx: Ctx, base: string, n: number): string {
  const one = ctx.lang === 'fr' ? n <= 1 : n === 1;
  return ctx.t(`${base}.${one ? 'one' : 'other'}`, { n });
}
