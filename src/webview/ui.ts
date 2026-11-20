import { h, icon } from './dom';

/** Semantic tone shared by chips, gutter marks and values. */
export type Tone = 'pass' | 'fail' | 'warn' | 'accent' | 'fatal' | 'major' | 'minor' | 'info' | 'muted' | 'running' | '';

type Child = Node | string | number | false | null | undefined | Child[];

export function chip(tone: Tone, ...children: Child[]): HTMLElement {
  return h('span.chip', { class: tone ? `t-${tone}` : '' }, ...children);
}

/** The gutter cell: an optional index and a severity mark, shown only for non-neutral state. */
export function gut(index?: string | number | null, tone?: Tone | null, glyph?: HTMLElement | null): HTMLElement {
  return h('span.gut', { 'aria-hidden': 'true' }, index ?? '', glyph ?? null, h('span.mark', { class: tone ? `t-${tone}` : '' }));
}

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  count?: number;
  /** Codicon drawn before the label. */
  icon?: string;
}

/** Underlined tabs with arrow-key navigation (WAI-ARIA tabs pattern, automatic activation). */
export function tabs<T extends string>(items: TabSpec<T>[], active: T, onSelect: (id: T) => void, label: string): HTMLElement {
  const buttons: HTMLButtonElement[] = [];
  const list = h('div.tabs', { role: 'tablist', 'aria-label': label });
  items.forEach((item, index) => {
    const selected = item.id === active;
    const button = h('button.tab', {
      role: 'tab', type: 'button', class: selected ? 'active' : '', 'aria-selected': String(selected), tabIndex: selected ? 0 : -1,
      onclick: () => onSelect(item.id),
      onkeydown: (e: KeyboardEvent) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const edge = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
        if (!step && edge < 0) return;
        e.preventDefault();
        const next = edge >= 0 ? edge : (index + step + items.length) % items.length;
        focusTab = items[next].id;
        onSelect(items[next].id);
      },
    }, item.icon ? [icon(item.icon), h('span.tab-label', item.label)] : item.label, item.count ? h('span.counter', item.count) : null);
    buttons.push(button);
    list.append(button);
    if (focusTab === item.id) {
      focusTab = null;
      queueMicrotask(() => button.focus?.());
    }
  });
  return list;
}
let focusTab: string | null = null;

export interface MenuItem {
  label: string;
  icon: string;
  onSelect: () => void;
  title?: string;
}

/** Overflow menu: one trigger, a role=menu list, Esc and arrow keys, closes when focus leaves. */
let openMenu: string | null = null;
export function menu(id: string, label: string, items: MenuItem[]): HTMLElement | null {
  if (!items.length) return null;
  const wrap = h('div.menu-wrap');
  const list = h('div.menu', { role: 'menu', 'aria-label': label, hidden: openMenu !== id });
  const trigger = h('button.icon-btn', { type: 'button', title: label, 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': String(openMenu === id),
    onclick: () => toggle(openMenu !== id),
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'ArrowDown') { e.preventDefault(); toggle(true); entries[0]?.focus(); } } }, icon('ellipsis'));
  const toggle = (open: boolean) => {
    openMenu = open ? id : null;
    list.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };
  const entries = items.map((item, index) => h('button.menu-item', { type: 'button', role: 'menuitem', tabIndex: -1, title: item.title,
    onclick: () => { toggle(false); item.onSelect(); },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); toggle(false); trigger.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); entries[(index + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length].focus(); }
    } }, icon(item.icon), item.label));
  list.append(...entries);
  wrap.addEventListener('focusout', (e: FocusEvent) => {
    if (!wrap.contains?.(e.relatedTarget as Node)) toggle(false);
  });
  wrap.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' && openMenu === id) { toggle(false); trigger.focus(); } });
  wrap.append(trigger, list);
  return wrap;
}

/** A titled region: heading, optional meta and trailing tools, then content. No box. */
export function section(title: Child, opts: { meta?: Child; tools?: Child; cls?: string; id?: string } = {}, ...children: Child[]): HTMLElement {
  return h('section.section', { class: opts.cls ?? '', dataset: opts.id ? { detailId: opts.id } : undefined },
    h('div.section-head', h('h2', title), opts.meta ? h('span.meta', opts.meta) : null, h('span.spacer'), opts.tools ?? null),
    ...children);
}

/** Native disclosure with a rotating chevron; persistence is handled by main.ts through data-detail-id. */
export function disclosure(id: string | null, summary: Child, open: boolean, ...children: Child[]): HTMLDetailsElement {
  return h('details.disc', { open, dataset: id ? { detailId: id } : undefined }, h('summary', icon('chevron-right', 'chev'), summary), ...children);
}

/** Inline "Loading…" with a slow spinner, for a part of a section waiting for its answer. */
export function waitLine(text: string): HTMLElement {
  return h('span.wait', { role: 'status' }, icon('loading', 'spin'), h('span', text));
}

/** A whole section or page waiting for its answer: the same line, over two soft placeholder lines. */
export function waitBlock(text: string): HTMLElement {
  return h('div.wait-block', waitLine(text), h('div.wait-lines', { 'aria-hidden': 'true' }, h('div.sk.w80'), h('div.sk.w60')));
}

export function notice(tone: 'error' | 'warn' | 'accent' | 'running' | '', glyph: string, ...children: Child[]): HTMLElement {
  return h('div.notice', { class: tone }, icon(glyph, glyph === 'loading' ? 'spin' : ''), h('div', ...children));
}
