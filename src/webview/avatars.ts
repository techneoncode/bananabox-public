import { h } from './dom';
import type { Ctx } from './ctx';

interface Who { name: string; login: string }

const asked = new WeakMap<Ctx, Set<string>>();
const pending = new WeakMap<Ctx, Set<string>>();

/** Asks the host for pictures not seen yet, once per login, in a single message after the render. */
function want(ctx: Ctx, login: string): void {
  if (!login || ctx.avatars?.has(login)) return;
  const done = asked.get(ctx) ?? new Set<string>();
  asked.set(ctx, done);
  if (done.has(login)) return;
  done.add(login);
  let batch = pending.get(ctx);
  if (!batch) {
    batch = new Set();
    pending.set(ctx, batch);
    queueMicrotask(() => {
      const logins = [...(pending.get(ctx) ?? [])];
      pending.delete(ctx);
      for (let i = 0; i < logins.length; i += 50) ctx.post({ type: 'loadAvatars', logins: logins.slice(i, i + 50) });
    });
  }
  batch.add(login);
}

export function initialsOf(name: string, login = ''): string {
  const parts = (name || login.split('@')[0].replace(/[._-]+/g, ' ')).trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A person's picture, or their initials while it loads or when they have none. */
export function avatar(ctx: Ctx, who: Who, size = 24): HTMLElement {
  want(ctx, who.login);
  const src = ctx.avatars?.get(who.login);
  const hue = [...who.login].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return h('span.avatar', { class: src ? 'has-img' : '', title: who.name || who.login, style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(9, Math.round(size * 0.42))}px`, ...(src ? {} : { backgroundColor: `hsl(${hue} 50% 50% / 0.34)` }) }, 'aria-hidden': 'true' },
    src ? h('img', { src, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' }) : initialsOf(who.name, who.login));
}

/** Overlapping pictures with a +N chip; the full list of names is the accessible label. */
export function avatarStack(ctx: Ctx, people: Who[], max = 4, size = 24): HTMLElement {
  const shown = people.slice(0, people.length > max ? max - 1 : max);
  const rest = people.length - shown.length;
  return h('span.avatar-stack', { role: 'img', 'aria-label': people.map(p => p.name || p.login).join(', ') },
    shown.map(p => avatar(ctx, p, size)),
    rest > 0 && h('span.avatar.more', { style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }, title: people.slice(shown.length).map(p => p.name).join(', ') }, `+${rest}`));
}

/** A person as picture + name, for lists of people. */
export function personTag(ctx: Ctx, who: Who, size = 20): HTMLElement {
  return h('span.person', { title: who.login }, avatar(ctx, who, size), h('span.person-name', who.name || who.login));
}

/** Forgets pictures and requests (sign-out or account switch). */
export function resetAvatars(ctx: Ctx): void {
  ctx.avatars?.clear();
  asked.delete(ctx);
  pending.delete(ctx);
}
