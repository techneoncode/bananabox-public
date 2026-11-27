import { h, svg } from './dom';
import type { AdminUser } from '../shared/adminTypes';

/**
 * Charts of the "Advanced" admin theme. Categorical colours come from the validated 8-slot palette
 * (--s1…--s8, stepped per light/dark theme in styles.css), assigned in a fixed order; magnitudes use
 * one hue. Every chart carries a legend or labels with the values, so identity is never colour-only,
 * and a native tooltip on each mark.
 */

export interface Slice {
  label: string;
  value: number;
}

const TAU = Math.PI * 2;
const SLOTS = 8;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Keeps the 7 largest entries and folds the rest into one grey "Other". */
export function topWithOther(slices: Slice[], other: string, keep = SLOTS - 1): Array<Slice & { slot: number | null }> {
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.length > SLOTS ? sorted.slice(0, keep) : sorted;
  const rest = sorted.slice(head.length).reduce((n, s) => n + s.value, 0);
  // The colour follows the entity: slots go by name, not by size, so a re-sort does not repaint.
  const byName = [...head].sort((a, b) => a.label.localeCompare(b.label));
  const out: Array<Slice & { slot: number | null }> = head.map((s) => ({ ...s, slot: byName.indexOf(s) + 1 }));
  if (rest) out.push({ label: other, value: rest, slot: null });
  return out;
}

const point = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];

/** Ring segment from angle a0 to a1 (radians, clockwise from 12 o'clock). */
function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const end = Math.min(a1, a0 + TAU - 1e-4);
  const large = end - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = point(cx, cy, r1, a0);
  const [x1, y1] = point(cx, cy, r1, end);
  const [x2, y2] = point(cx, cy, r0, end);
  const [x3, y3] = point(cx, cy, r0, a0);
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)},${f(y0)} A${r1},${r1} 0 ${large} 1 ${f(x1)},${f(y1)} L${f(x2)},${f(y2)} A${r0},${r0} 0 ${large} 0 ${f(x3)},${f(y3)} Z`;
}

const fillOf = (slot: number | null) => (slot === null ? 'viz-other' : `viz-s${slot}`);

function legend(items: Array<{ label: string; value: number; slot: number | null }>, total: number): HTMLElement {
  return h('ul.viz-legend', items.map((s) => h('li',
    h('i', { class: fillOf(s.slot), 'aria-hidden': 'true' }),
    h('span.viz-legend-label', s.label),
    h('b', String(s.value)),
    h('span.viz-legend-pct', `${pct(s.value, total)}%`))));
}

/** Donut with its total in the middle and a legend giving every value and share. */
export function donut(slices: Array<Slice & { slot: number | null }>, o: { aria: string; center: string; sub: string; tip: (s: Slice, share: number) => string }): HTMLElement {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const size = 140, c = size / 2;
  const chart = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'viz-donut', role: 'img', 'aria-label': o.aria });
  let a = 0;
  slices.forEach((s, i) => {
    const sweep = total ? (s.value / total) * TAU : 0;
    const path = svg('path', { d: arc(c, c, 42, 66, a, a + sweep), class: `viz-mark ${fillOf(s.slot)}` });
    path.style.setProperty('--i', String(i));
    path.append(svg('title', {}, o.tip(s, pct(s.value, total))));
    chart.append(path);
    a += sweep;
  });
  const value = svg('text', { x: c, y: c - 3, class: 'viz-center', 'text-anchor': 'middle' });
  value.textContent = o.center;
  const sub = svg('text', { x: c, y: c + 13, class: 'viz-center-sub', 'text-anchor': 'middle' });
  sub.textContent = o.sub;
  chart.append(value, sub);
  return h('div.viz-pie', chart, legend(slices, total));
}

export interface Branch extends Slice {
  children: Slice[];
}

/** Two rings: the inner one by group, the outer one splits each group, in the group's hue. */
export function sunburst(branches: Branch[], o: { aria: string; center: string; sub: string; tip: (path: string, value: number, share: number) => string }): HTMLElement {
  const total = branches.reduce((n, b) => n + b.value, 0);
  const size = 160, c = size / 2;
  const slotted = topWithOther(branches, '');
  const chart = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'viz-donut viz-sunburst', role: 'img', 'aria-label': o.aria });
  let a = 0;
  branches.forEach((b, i) => {
    const slot = slotted.find((s) => s.label === b.label)?.slot ?? null;
    const sweep = total ? (b.value / total) * TAU : 0;
    const inner = svg('path', { d: arc(c, c, 30, 52, a, a + sweep), class: `viz-mark ${fillOf(slot)}` });
    inner.style.setProperty('--i', String(i));
    inner.append(svg('title', {}, o.tip(b.label, b.value, pct(b.value, total))));
    chart.append(inner);
    let start = a;
    b.children.forEach((child, j) => {
      const part = b.value ? (child.value / b.value) * sweep : 0;
      const outer = svg('path', { d: arc(c, c, 55, 78, start, start + part), class: `viz-mark ${fillOf(slot)} ${j % 2 ? 'viz-dim' : 'viz-half'}` });
      outer.style.setProperty('--i', String(i + j + 1));
      outer.append(svg('title', {}, o.tip(`${b.label} › ${child.label}`, child.value, pct(child.value, total))));
      chart.append(outer);
      start += part;
    });
    a += sweep;
  });
  const value = svg('text', { x: c, y: c - 2, class: 'viz-center', 'text-anchor': 'middle' });
  value.textContent = o.center;
  const sub = svg('text', { x: c, y: c + 13, class: 'viz-center-sub', 'text-anchor': 'middle' });
  sub.textContent = o.sub;
  chart.append(value, sub);
  return h('div.viz-pie', chart, legend(branches.map((b) => ({ ...b, slot: slotted.find((s) => s.label === b.label)?.slot ?? null })), total));
}

export interface Box { x: number; y: number; w: number; h: number }

/** Splits the items into two halves of nearly equal weight along the longer side, recursively. */
export function layout<T extends { value: number }>(items: T[], box: Box, out: Array<T & Box>): void {
  if (!items.length) return;
  if (items.length === 1) { out.push({ ...items[0], ...box }); return; }
  const total = items.reduce((n, i) => n + i.value, 0);
  let acc = 0, cut = 0;
  while (cut < items.length - 1 && acc + items[cut].value <= total / 2) acc += items[cut++].value;
  if (cut === 0) acc = items[cut++].value;
  const share = total ? acc / total : 0.5;
  if (box.w >= box.h) {
    layout(items.slice(0, cut), { ...box, w: box.w * share }, out);
    layout(items.slice(cut), { ...box, x: box.x + box.w * share, w: box.w * (1 - share) }, out);
  } else {
    layout(items.slice(0, cut), { ...box, h: box.h * share }, out);
    layout(items.slice(cut), { ...box, y: box.y + box.h * share, h: box.h * (1 - share) }, out);
  }
}

/** Area = size, strength of the single hue = the share that is active. */
export function treemap(items: Array<{ label: string; value: number; ratio: number }>, o: { aria: string; tip: (label: string, value: number, ratio: number) => string }): SVGElement {
  const W = 300, H = 170;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-treemap', role: 'img', 'aria-label': o.aria });
  const boxes: Array<{ label: string; value: number; ratio: number } & Box> = [];
  layout([...items].sort((a, b) => b.value - a.value), { x: 0, y: 0, w: W, h: H }, boxes);
  boxes.forEach((b, i) => {
    const g = svg('g', { class: 'viz-tile' });
    g.style.setProperty('--i', String(i));
    const rect = svg('rect', { x: b.x + 1, y: b.y + 1, width: Math.max(0, b.w - 2), height: Math.max(0, b.h - 2), rx: 4, class: 'viz-mark viz-seq' });
    rect.style.setProperty('--a', (0.3 + 0.7 * b.ratio).toFixed(3));
    g.append(rect, svg('title', {}, o.tip(b.label, b.value, b.ratio)));
    if (b.w > 46 && b.h > 26) {
      const name = svg('text', { x: b.x + 7, y: b.y + 15, class: 'viz-tile-label' });
      name.textContent = b.label;
      const count = svg('text', { x: b.x + 7, y: b.y + 28, class: 'viz-tile-value' });
      count.textContent = String(b.value);
      g.append(name, count);
    }
    chart.append(g);
  });
  return chart;
}

/** Concentric bars, one per row, length on one scale; the label sits at the start of each bar. */
export function radialBars(rows: Slice[], o: { aria: string; tip: (s: Slice) => string; format?: (n: number) => string }): SVGElement {
  const size = 200, c = size / 2, sweep = TAU * 0.75;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const step = Math.min(14, (c - 22) / Math.max(1, rows.length));
  const chart = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'viz-radial', role: 'img', 'aria-label': o.aria });
  rows.forEach((r, i) => {
    const r1 = c - 4 - i * step, r0 = r1 - step + 3;
    chart.append(svg('path', { d: arc(c, c, r0, r1, 0, sweep), class: 'viz-track' }));
    const bar = svg('path', { d: arc(c, c, r0, r1, 0, Math.max(0.02, (r.value / max) * sweep)), class: 'viz-mark viz-s1' });
    bar.style.setProperty('--i', String(i));
    bar.append(svg('title', {}, o.tip(r)));
    const label = svg('text', { x: c - 4, y: c - (r0 + r1) / 2 + 3, class: 'viz-radial-label', 'text-anchor': 'end' });
    label.textContent = `${r.label}  ${(o.format ?? String)(r.value)}`;
    chart.append(bar, label);
  });
  return chart;
}

/** One dot per person: days since the last launch against launches (log scale); the active window is shaded. */
export function scatter(points: Array<{ x: number; y: number; active: boolean; tip: string }>, o: { aria: string; window: number; xLabel: (days: number) => string }): SVGElement {
  const W = 300, H = 160, L = 26, B = 18, T = 6, R = 8;
  const maxX = Math.max(o.window * 2, ...points.map((p) => p.x));
  const maxY = Math.max(10, ...points.map((p) => p.y));
  const x = (d: number) => L + (d / maxX) * (W - L - R);
  const y = (n: number) => T + (1 - Math.log10(Math.max(1, n)) / Math.log10(maxY)) * (H - T - B);
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-scatter', role: 'img', 'aria-label': o.aria });
  chart.append(svg('rect', { x: L, y: T, width: x(o.window) - L, height: H - T - B, class: 'viz-window' }));
  for (let tick = 1; tick <= maxY; tick *= 10) {
    chart.append(svg('line', { x1: L, x2: W - R, y1: y(tick), y2: y(tick), class: 'adm-grid' }));
    const label = svg('text', { x: L - 4, y: y(tick) + 3, class: 'viz-axis', 'text-anchor': 'end' });
    label.textContent = String(tick);
    chart.append(label);
  }
  for (const d of [0, o.window, Math.round(maxX)]) {
    const label = svg('text', { x: x(d), y: H - 4, class: 'viz-axis', 'text-anchor': d === 0 ? 'start' : 'middle' });
    label.textContent = o.xLabel(d);
    chart.append(label);
  }
  points.forEach((p, i) => {
    const dot = svg('circle', { cx: x(p.x), cy: y(p.y), r: 4, class: `viz-dot ${p.active ? 'viz-s1' : 'viz-other'}` });
    dot.style.setProperty('--i', String(i % 24));
    dot.append(svg('title', {}, p.tip));
    chart.append(dot);
  });
  return chart;
}

/** Area of a running total, with the first and last values written at the ends. */
export function cumulative(values: number[], o: { aria: string; tip: (i: number, v: number) => string }): SVGElement {
  const W = 300, H = 110, P = 6;
  const min = Math.min(...values), max = Math.max(min + 1, ...values);
  const x = (i: number) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + 12 + (1 - (v - min) / (max - min)) * (H - 2 * P - 12);
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-cumul', role: 'img', 'aria-label': o.aria, preserveAspectRatio: 'none' });
  if (values.length < 2) return chart;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  chart.append(
    svg('path', { d: `${line} L${x(values.length - 1)},${H} L${x(0)},${H} Z`, class: 'viz-area' }),
    svg('path', { d: line, class: 'viz-line', pathLength: 100 }),
  );
  values.forEach((v, i) => {
    const hit = svg('rect', { x: x(i) - (W / values.length) / 2, y: 0, width: W / values.length, height: H, class: 'viz-hit' });
    hit.append(svg('title', {}, o.tip(i, v)));
    chart.append(hit);
  });
  chart.append(svg('circle', { cx: x(values.length - 1), cy: y(values.at(-1)!), r: 4, class: 'viz-dot viz-s1' }));
  return chart;
}

/** Vertical bars with their count above each one. */
export function histogram(bins: Slice[], o: { aria: string; tip: (s: Slice) => string }): SVGElement {
  const W = 300, H = 120, B = 16, T = 14;
  const max = Math.max(1, ...bins.map((b) => b.value));
  const slot = W / Math.max(1, bins.length);
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-hist', role: 'img', 'aria-label': o.aria });
  bins.forEach((b, i) => {
    const hgt = (b.value / max) * (H - B - T);
    const bar = svg('rect', { x: i * slot + slot * 0.14, y: H - B - hgt, width: slot * 0.72, height: Math.max(0, hgt), rx: 4, class: 'viz-mark viz-s1 viz-bar' });
    bar.style.setProperty('--i', String(i));
    bar.append(svg('title', {}, o.tip(b)));
    const count = svg('text', { x: i * slot + slot / 2, y: H - B - hgt - 4, class: 'viz-axis viz-strong', 'text-anchor': 'middle' });
    count.textContent = b.value ? String(b.value) : '';
    const label = svg('text', { x: i * slot + slot / 2, y: H - 4, class: 'viz-axis', 'text-anchor': 'middle' });
    label.textContent = b.label;
    chart.append(bar, count, label);
  });
  return chart;
}

/** Half-ring gauge: 0 % on the left, 100 % on the right, the value in the middle. */
export function gauge(ratio: number, o: { label: string; tone: 'pass' | 'warn' | 'fail' | 'accent'; aria: string }): HTMLElement {
  const v = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const W = 120, c = 60, r1 = 54, r0 = 42;
  const chart = svg('svg', { viewBox: `0 0 ${W} 66`, class: `viz-gauge t-${o.tone}`, role: 'img', 'aria-label': o.aria });
  const start = -Math.PI / 2;
  chart.append(
    svg('path', { d: arc(c, 60, r0, r1, start, start + Math.PI), class: 'viz-track' }),
    svg('path', { d: arc(c, 60, r0, r1, start, start + Math.max(0.01, v * Math.PI)), class: 'viz-gauge-value' }),
  );
  const text = svg('text', { x: c, y: 56, class: 'viz-center', 'text-anchor': 'middle' });
  text.textContent = `${Math.round(v * 100)}%`;
  chart.append(text);
  return h('div.viz-gauge-wrap', chart, h('span', o.label));
}

/**
 * One person per signed-in identity: the server reports one row per OS account, so a student on two computers
 * comes twice. shortcut: two students with the same first name, initial, promotion, cursus and campus merge;
 * report a hashed login with the heartbeat if that ever matters.
 */
export const personKey = (u: AdminUser) => u.first_name ? ['p', u.first_name, u.last_initial, u.promotion, u.cursus, u.campus].join('\u0000') : u.user_id;

/** Users grouped by person, each group's most recently seen computer first, in the server's order. */
export function byPerson(users: AdminUser[]): AdminUser[][] {
  const groups = new Map<string, AdminUser[]>();
  for (const u of users) {
    const key = personKey(u);
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => b.last_seen - a.last_seen));
}
