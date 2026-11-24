import { h, icon } from '../dom';
import type { AppTab, Ctx, Tab } from '../ctx';

type Child = Node | string | number | false | null | undefined;

// ───────────── navigation: the only way screens of the sidebar app move ─────────────

/** Shows a bottom tab. Tapping the tab already shown pops it back to its root, as phone apps do. */
export function switchTab(ctx: Ctx, tab: AppTab): void {
  const ui = ctx.ui;
  const current = ui.appTab ?? 'projects';
  if (tab === current) { ui.sidebarProject = null; ui.tab = null; ui.page = null; }
  ui.appTab = tab;
  ui.sheetProject = null;
  ctx.rerender();
}

/** Opens a project's quick sheet over the current screen. */
export function openSheet(ctx: Ctx, id: number): void {
  ctx.ui.sheetProject = id;
  ctx.loadProject?.(id);
  ctx.rerender();
}

export function closeSheet(ctx: Ctx): void {
  ctx.ui.sheetProject = null;
  ctx.rerender();
}

/** Pushes a project's full screen, optionally straight onto one of its pages. */
export function openProject(ctx: Ctx, id: number, page: Tab | null = null): void {
  const ui = ctx.ui;
  ui.sheetProject = null;
  ui.appTab = ui.appTab === 'home' ? 'home' : 'projects';
  ui.showList = false;
  ui.sidebarProject = id;
  ui.tab = page;
  ctx.rerender();
}

/** One level up inside the project screen: a page to the project, the project to its tab root. */
export function popProject(ctx: Ctx): void {
  const ui = ctx.ui;
  if (ui.tab) ui.tab = null;
  else ui.sidebarProject = null;
  ctx.rerender();
}

// ───────────── building blocks: one look for every screen ─────────────

export interface AppBarOptions {
  title: Child;
  /** Shown left of the title; the label names where it goes. */
  back?: { label: string; onclick: () => void };
  actions?: Child[];
  /** Large title under the bar, as on a tab root. */
  large?: boolean;
  sub?: Child;
}

/** The top bar of a screen: back, title, up to two icon actions. */
export function appBar(o: AppBarOptions): HTMLElement {
  // A tab root (large, no back): the title shares the top row with the actions, as on every tab.
  if (o.large && !o.back) {
    return h('header.ab.ab-large.ab-root',
      h('div.ab-row', h('h1.ab-big', o.title), o.actions?.length ? h('div.ab-actions', ...o.actions) : null),
      o.sub ? h('p.ab-sub', o.sub) : null);
  }
  return h('header.ab', { class: o.large ? 'ab-large' : '' },
    h('div.ab-row',
      o.back ? h('button.ab-back', { type: 'button', onclick: o.back.onclick, 'aria-label': o.back.label }, icon('chevron-left'), h('span.ellipsis', o.back.label)) : null,
      !o.large ? h('h1.ab-title.ellipsis', o.title) : h('span.spacer'),
      o.actions?.length ? h('div.ab-actions', ...o.actions) : null),
    o.large ? h('h1.ab-big', o.title) : null,
    o.sub ? h('p.ab-sub', o.sub) : null);
}

/** A round icon button for bars and cards: 36px visible, 44px to the pointer. */
export function iconAction(label: string, name: string, onclick: () => void, extra: Record<string, unknown> = {}): HTMLElement {
  return h('button.ia', { type: 'button', title: label, 'aria-label': label, onclick, ...extra }, icon(name));
}

export interface RowOptions {
  icon?: string;
  /** Tone of the leading icon tile: pass, fail, warn, accent, info. */
  tone?: string;
  label: Child;
  detail?: Child;
  /** Right side, before the chevron: a count, a status chip, a time. */
  meta?: Child;
  onclick?: () => void;
  chevron?: boolean;
  disabled?: boolean;
}

/** One row of a grouped list: 48px tall, the whole row is the target. */
export function listRow(o: RowOptions): HTMLElement {
  const inner: Child[] = [
    o.icon ? h('span.lr-ic', { class: o.tone ? `t-${o.tone}` : '' }, icon(o.icon)) : null,
    h('span.lr-text', h('span.lr-label', o.label), o.detail ? h('span.lr-detail', o.detail) : null),
    o.meta != null && o.meta !== false ? h('span.lr-meta', o.meta) : null,
    (o.chevron ?? !!o.onclick) ? icon('chevron-right', 'lr-chev') : null,
  ];
  return o.onclick
    ? h('button.lr', { type: 'button', onclick: o.onclick, disabled: o.disabled }, ...inner)
    : h('div.lr', ...inner);
}

/** A titled group of rows on one rounded surface, like a phone settings list. */
export function listGroup(title: Child, ...rows: Child[]): HTMLElement {
  const items = rows.filter(Boolean);
  return h('section.lg', title ? h('h2.lg-title', title) : null, h('div.lg-body', ...items));
}

/** Large segmented switch (columns, modes). */
export function segmented<T extends string>(label: string, options: Array<{ id: T; label: Child; count?: number }>, value: T, onChange: (id: T) => void): HTMLElement {
  return h('div.segl', { role: 'tablist', 'aria-label': label },
    ...options.map(o => h('button.segl-opt', {
      type: 'button', role: 'tab', 'aria-selected': String(o.id === value), class: o.id === value ? 'on' : '',
      onclick: () => onChange(o.id),
    }, h('span', o.label), o.count != null ? h('span.segl-count', String(o.count)) : null)));
}

/**
 * A bottom sheet over the screen: grabber, title, content. Closes on the backdrop, the close button or Escape
 * (main.ts routes Escape through goBack, which closes the sheet first).
 */
export function sheet(o: { label: string; onClose: () => void; closeLabel: string; enter?: boolean }, ...children: Child[]): HTMLElement {
  const panel = h('section.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.label },
    h('div.sheet-grab', { 'aria-hidden': 'true' }),
    h('button.sheet-close', { type: 'button', 'aria-label': o.closeLabel, title: o.closeLabel, onclick: o.onClose }, icon('close')),
    h('div.sheet-body', ...children));
  // Only a sheet that just opened rises; re-renders while it is open keep it still.
  return h('div.sheet-layer', { class: o.enter ? 'enter' : '' }, h('div.sheet-backdrop', { onclick: o.onClose }), panel);
}

/** A big full-width button for the one primary action of a screen or sheet. */
export function bigButton(label: Child, iconName: string | null, onclick: () => void, kind: 'primary' | 'secondary' = 'primary', extra: Record<string, unknown> = {}): HTMLElement {
  return h('button.bb', { type: 'button', class: kind === 'primary' ? 'bb-primary' : 'bb-secondary', onclick, ...extra }, iconName ? icon(iconName) : null, h('span', label));
}

/** Empty state: icon, one line, optional action. */
export function emptyState(iconName: string, text: Child, action?: Child): HTMLElement {
  return h('div.es', icon(iconName), h('p', text), action ?? null);
}
