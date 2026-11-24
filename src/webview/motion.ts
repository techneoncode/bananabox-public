/**
 * Motion for the sidebar app: navigation transitions, living numbers and time-anchored entrances.
 *
 * `render()` replaces the whole DOM on every update, so nothing here may rely on an element surviving.
 * Entrances are anchored to the moment their route was entered (`--since` shifts every animation delay),
 * so a re-render half way through continues the animation instead of replaying or cutting it.
 * Living numbers remember what they last showed and roll only when the value changes.
 */
import { compactDuration } from './format';

/** Language of the live clocks beyond a day ("2d 4h" / "2 j 4 h"); main.ts sets it with the state. */
let clockLang: 'en' | 'fr' = 'en';
export function setClockLang(lang: 'en' | 'fr'): void { clockLang = lang; }

const DAY = 86_400_000;
/** How long after entering a route its entrance choreography may still be running. */
export const ENTRY_WINDOW = 1400;

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────────────────────── entrances ─────────────────────────

let routeEnteredAt = 0;

export function enterRoute(now = Date.now()): void {
  routeEnteredAt = now;
}

/** Milliseconds since the current route was entered, or null once its entrance is over. */
export function entrySince(now = Date.now()): number | null {
  const since = now - routeEnteredAt;
  return routeEnteredAt && since < ENTRY_WINDOW ? since : null;
}

/** Parts of a page that change in place (Home's selected project, a panel tab): when each last showed something new. */
const parts = new Map<string, { key: string; at: number }>();

/**
 * Gives a part that just changed what it shows its own entrance, continued across re-renders like a route's:
 * the element gets `.motion-in` and its own `--since` while the entrance runs.
 */
export function enterPart<E extends HTMLElement>(el: E, slot: string, key: string, now = Date.now()): E {
  const last = parts.get(slot);
  if (!last || last.key !== key) parts.set(slot, { key, at: last ? now : routeEnteredAt || now });
  const since = now - parts.get(slot)!.at;
  if (since < ENTRY_WINDOW && !reducedMotion()) {
    el.classList.add('motion-in');
    el.style.setProperty?.('--since', `${since}ms`);
  }
  return el;
}

// ───────────────────────── fresh results ─────────────────────────

const fresh = new Map<number, number>();

/** A grader result just arrived for this project (not on first load): its bar rises and its score rolls. */
export function markFresh(projectId: number, now = Date.now()): void {
  fresh.set(projectId, now);
}

/** Milliseconds since the project's latest result arrived, while its arrival effect still plays. */
export function freshSince(projectId: number, now = Date.now()): number | null {
  const at = fresh.get(projectId);
  if (at === undefined) return null;
  const since = now - at;
  if (since > 2600) { fresh.delete(projectId); return null; }
  return since;
}

// ───────────────────────── living numbers ─────────────────────────

interface Roll { from: number; to: number; t0: number }
const rolls = new Map<string, Roll>();
const ROLL_MS = 900;
const ease = (x: number) => 1 - Math.pow(1 - x, 4);

function valueAt(r: Roll, now: number): number {
  const k = Math.min(1, Math.max(0, (now - r.t0) / ROLL_MS));
  return r.from + (r.to - r.from) * ease(k);
}

let frame = 0;
function tick(): void {
  frame = 0;
  const now = Date.now();
  let busy = false;
  document.querySelectorAll<HTMLElement>('[data-roll]').forEach(el => {
    const r = rolls.get(el.dataset.roll!);
    if (!r) return;
    el.textContent = String(Math.round(valueAt(r, now)));
    if (now - r.t0 < ROLL_MS) busy = true;
  });
  if (busy) frame = requestAnimationFrame(tick);
}

/**
 * A number that rolls from what it last showed to `value`: from 0 the first time it appears,
 * from the previous value when it changes, and not at all on a plain re-render.
 */
export function rollNumber(key: string, value: number, now = Date.now()): HTMLElement {
  const el = document.createElement('span');
  el.className = 'roll';
  const known = rolls.get(key);
  if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
    rolls.set(key, { from: value, to: value, t0: 0 });
  } else if (!known) {
    rolls.set(key, { from: 0, to: value, t0: now });
  } else if (known.to !== value) {
    rolls.set(key, { from: valueAt(known, now), to: value, t0: now });
  }
  const r = rolls.get(key)!;
  el.dataset.roll = key;
  el.textContent = String(Math.round(valueAt(r, now)));
  if (now - r.t0 < ROLL_MS && !frame && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick);
  return el;
}

/** Forget every remembered value (sign-out). */
export function resetMotion(): void {
  rolls.clear();
  fresh.clear();
  parts.clear();
  routeEnteredAt = 0;
}

// ───────────────────────── live clocks ─────────────────────────

/** Under a day the countdown beats to the second; beyond, it reads in days and hours. */
export function countdownText(ms: number): string {
  if (ms >= DAY) return compactDuration(ms, clockLang);
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Elapsed time as m:ss (or h:mm:ss). */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A countdown to `iso` that the 1 s ticker keeps current without a re-render. */
export function liveCountdown(iso: string, now = Date.now()): HTMLElement {
  const el = document.createElement('span');
  el.className = 'live-clock';
  el.dataset.countdown = iso;
  el.textContent = countdownText(Date.parse(iso) - now);
  return el;
}

/** Time since `iso`, kept current by the ticker. */
export function liveElapsed(iso: string, now = Date.now()): HTMLElement {
  const el = document.createElement('span');
  el.className = 'live-clock';
  el.dataset.elapsed = iso;
  el.textContent = elapsedText(now - Date.parse(iso));
  return el;
}

/** Updates every live clock in place; called once a second while the view is visible. */
export function tickClocks(root: ParentNode = document, now = Date.now()): void {
  root.querySelectorAll<HTMLElement>('[data-countdown]').forEach(el => {
    const text = countdownText(Date.parse(el.dataset.countdown!) - now);
    if (el.textContent !== text) el.textContent = text;
  });
  root.querySelectorAll<HTMLElement>('[data-elapsed]').forEach(el => {
    const text = elapsedText(now - Date.parse(el.dataset.elapsed!));
    if (el.textContent !== text) el.textContent = text;
  });
}
