import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { ring, tokenBlocks } from '../charts';
import { compactDuration } from '../format';
import { freshSince, reducedMotion, rollNumber } from '../motion';
import { chip, waitLine } from '../ui';
import { avatarStack } from '../avatars';
import { columnWidth, graderPending, projectClock, projectSkyline, skylineSkeleton } from './signature';

const DAY = 86_400_000;

/** Push a project's summary inside the sidebar. */
export function openInSidebar(ctx: Ctx, id: number): void {
  ctx.ui.sidebarProject = id;
  ctx.ui.showList = false;
  ctx.ui.tab = null;
  ctx.rerender();
}

/** Projects worth a card: the open repository first, then what closes soonest, then what opens within a week. */
export function carouselProjects(ctx: Ctx, now = Date.now()): ProjectVM[] {
  const all = ctx.state.projects ?? [];
  const current = ctx.state.currentProjectId;
  const ongoing = all.filter(p => p.status === 'ongoing')
    .sort((a, b) => Number(b.id === current) - Number(a.id === current) || Date.parse(a.endDate) - Date.parse(b.endDate));
  const soon = all.filter(p => p.status === 'upcoming' && Date.parse(p.startDate) - now < 7 * DAY)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  return [...ongoing, ...soon].slice(0, 8);
}

/**
 * Cards of the projects in progress. On a desktop nothing about a hidden scrollbar says "swipe", so the strip moves
 * every way a hand expects: arrows and dots under it, mouse drag, the wheel (handing back to the page at either end),
 * and the arrow keys.
 */
export function renderCarousel(ctx: Ctx): HTMLElement | null {
  const { t } = ctx, projects = carouselProjects(ctx);
  if (!projects.length) return null;
  projects.forEach(p => ctx.loadProject?.(p.id, true));
  const cardWidth = Math.min(264, Math.round(columnWidth(0) * 0.88));
  const step = cardWidth + 10;
  let track!: HTMLElement;
  const go = (index: number) => {
    const target = Math.max(0, Math.min(projects.length - 1, index));
    track.scrollTo({ left: target * step, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const current = () => Math.round(track.scrollLeft / step);
  const prev = h('button.icon-btn.sb-car-arrow', { type: 'button', 'aria-label': t('sb.previous'), title: t('sb.previous'), disabled: true, onclick: () => go(current() - 1) }, icon('chevron-left'));
  const next = h('button.icon-btn.sb-car-arrow', { type: 'button', 'aria-label': t('sb.next'), title: t('sb.next'), disabled: projects.length < 2, onclick: () => go(current() + 1) }, icon('chevron-right'));
  const dots = h('div.sb-dots', projects.map((p, i) => h('button', { type: 'button', class: i === 0 ? 'on' : '', 'aria-label': `${p.name} · ${t('sb.slide', { n: i + 1, total: projects.length })}`, onclick: () => go(i) })));
  const sync = () => {
    const index = current(), max = track.scrollWidth - track.clientWidth;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === index));
    (prev as HTMLButtonElement).disabled = track.scrollLeft <= 2;
    (next as HTMLButtonElement).disabled = track.scrollLeft >= max - 2;
  };

  // Mouse drag: the strip follows the pointer, then settles on the nearest card; a drag never counts as a click.
  let drag: { x: number; left: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: track.scrollLeft, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) { drag.moved = true; track.classList.add('dragging'); track.setPointerCapture?.(e.pointerId); }
    track.scrollLeft = drag.left - dx;
  };
  const onUp = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    track.classList.remove('dragging');
    go(current());
    // Swallow the click that ends the drag.
    track.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
  };

  track = h('div.sb-carousel', {
    role: 'list', 'aria-label': t('sb.carousel'), tabindex: '0', dataset: { keepScroll: 'carousel' }, style: { '--card': `${cardWidth}px` },
    onscroll: sync,
    onpointerdown: onDown, onpointermove: onMove, onpointerup: onUp, onpointercancel: onUp, onlostpointercapture: onUp,
    onwheel: (e: WheelEvent) => {
      // A vertical wheel moves the strip while it can still move that way, then the page scrolls as usual.
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = track.scrollWidth - track.clientWidth;
      if ((e.deltaY > 0 && track.scrollLeft >= max - 2) || (e.deltaY < 0 && track.scrollLeft <= 2)) return;
      e.preventDefault();
      track.scrollBy({ left: e.deltaY, behavior: 'auto' });
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(current() + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(current() - 1); }
    },
  }, projects.map((p, i) => h('div', { role: 'listitem' }, card(ctx, p, i, projects.length, cardWidth - 24))));
  // The kept scroll position is restored after mount; bring the arrows and dots in line with it then.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (track.isConnected) sync(); });
  return h('section.sb-carousel-wrap.rise', { style: { '--i': '1' } }, track,
    projects.length > 1 ? h('div.sb-car-nav', prev, dots, next) : null);
}

function card(ctx: Ctx, p: ProjectVM, index: number, total: number, inner: number): HTMLElement {
  const { t } = ctx, now = Date.now();
  const g = ctx.graders.get(p.id), latest = g?.history.at(-1), previous = g?.history.at(-2);
  const clock = projectClock(p, now);
  const left = Date.parse(clock.target) - now;
  const isCurrent = p.id === ctx.state.currentProjectId;
  const diff = latest?.score != null && previous?.score != null ? Math.round((latest.score - previous.score) * 10) / 10 : null;
  const sky = projectSkyline(ctx, p, inner, 36, 12);
  return h('button.panel.sb-pcard', {
    type: 'button', class: `${isCurrent ? 'current' : ''}${clock.urgent ? ' urgent' : ''}`,
    'aria-label': `${p.name} · ${t('sb.slide', { n: index + 1, total })}`,
    style: { viewTransitionName: `sb-card-${p.id}`, '--i': String(index), '--fresh': `${freshSince(p.id) ?? 0}ms` },
    onclick: () => openInSidebar(ctx, p.id),
  },
    h('span.sb-pcard-sky', graderPending(ctx, p) ? skylineSkeleton(ctx, inner, 36, 12) : sky ?? h('span.sb-pcard-rail', h('i', { style: { width: `${Math.round(clock.elapsed * 100)}%` } }))),
    h('span.sb-pcard-top',
      h('span.sb-pcard-name',
        h('span.name.ellipsis', { style: { viewTransitionName: `sb-title-${p.id}` } }, p.name),
        h('span.unit.ellipsis', [p.unitCode, p.unitName].filter(Boolean).join(' · '))),
      ring(clock.elapsed, { size: 36, stroke: 4, tone: clock.urgent ? 'urgent' : 'live', label: compactDuration(left).split(' ')[0], aria: `${t(`gauge.${clock.key}`)} ${compactDuration(left)}` })),
    h('span.sb-pcard-foot',
      latest?.score != null ? h('span.sb-pcard-score', rollNumber(`score:${p.id}`, latest.score), h('small', '%'))
        : graderPending(ctx, p) ? waitLine(t('readout.loading')) : h('span.sb-pcard-score.none', '—'),
      diff !== null && diff !== 0 && h('span.delta-pill', { class: diff > 0 ? 'up' : 'down' }, icon(diff > 0 ? 'arrow-up' : 'arrow-down'), String(Math.abs(diff))),
      g?.quota && tokenBlocks(g.quota.remaining, g.quota.total),
      h('span.spacer'),
      isCurrent ? chip('accent', icon('folder-opened'), t('badge.current'))
        : p.groupMembers?.length ? avatarStack(ctx, p.groupMembers, 3, 18)
        : p.status === 'upcoming' ? chip('', icon('clock'), t('status.upcoming')) : null));
}
