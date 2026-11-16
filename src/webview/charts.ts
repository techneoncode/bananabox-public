import type { TestResultSummary } from '../shared/types';
import { svg } from './dom';
import { Lang, dateTime } from './format';

export interface ChartOptions {
  lang: Lang;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCommit?: (commit: string) => void;
  labels: { score: string; empty: string; commit: string };
  height?: number;
  /** Pixel width to draw at, so text stays crisp (defaults to 640). */
  width?: number;
  /** Small inline chart: keep points and tooltips, omit axis labels. */
  compact?: boolean;
}


/**
 * Score-over-time line chart rendered as plain SVG (no dependency).
 * Points are evenly spaced per run so closely-timed runs stay readable; hovering shows the details.
 */
export function scoreChart(history: TestResultSummary[], o: ChartOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = o.compact ? 'chart chart-compact' : 'chart';
  const W = Math.max(o.compact ? 96 : 220, Math.round(o.width ?? 640));
  const H = o.height ?? 190;
  const pad = o.compact ? { l: 4, r: 4, t: 5, b: 5 } : { l: 34, r: 14, t: 14, b: 26 };
  const pts = history.filter((r) => r.score !== null);
  if (pts.length === 0) {
    wrap.classList.add('chart-empty');
    wrap.textContent = o.labels.empty;
    return wrap;
  }
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => pad.t + (1 - v / 100) * ih;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': o.labels.score, preserveAspectRatio: o.compact ? 'none' : 'xMidYMid meet' });
  root.setAttribute('width', String(W));
  root.setAttribute('height', String(H));

  for (const tick of o.compact ? [0, 50, 100] : [0, 25, 50, 75, 100]) {
    root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(tick), y2: y(tick), class: 'grid' }));
    if (o.compact) continue;
    const label = svg('text', { x: pad.l - 6, y: y(tick) + 3, class: 'axis', 'text-anchor': 'end' });
    label.textContent = `${tick}`;
    root.append(label);
  }

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score!).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  root.append(svg('path', { d: area, class: 'area' }), svg('path', { d: line, class: 'line' }));

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.append(tip);

  const show = (i: number) => {
    const p = pts[i];
    tip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `${p.score}%`;
    const meta = document.createElement('span');
    meta.textContent = `${p.passed}/${p.total} · ${dateTime(p.date, o.lang)}`;
    tip.append(title, meta);
    if (p.commit) {
      const c = document.createElement('button');
      c.className = 'label btn-tag mono';
      c.disabled = !/^[a-f0-9]{40}$/i.test(p.commit) || /^0+$/.test(p.commit);
      c.onclick = () => o.onCommit?.(p.commit!);
      c.textContent = `${o.labels.commit} ${p.commit.slice(0, 7)}`;
      tip.append(c);
    }
    tip.hidden = false;
    const left = (x(i) / W) * 100;
    tip.style.left = `${Math.min(86, Math.max(14, left))}%`;
    tip.style.top = `${(y(p.score!) / H) * 100}%`;
  };

  pts.forEach((p, i) => {
    const g = svg('g', { class: `pt${p.id === o.selectedId ? ' selected' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${p.score}% · ${dateTime(p.date, o.lang)}` });
    g.append(svg('circle', { cx: x(i), cy: y(p.score!), r: 12, class: 'hit' }), svg('circle', { cx: x(i), cy: y(p.score!), r: o.compact ? (p.id === o.selectedId ? 3.5 : 2.5) : p.id === o.selectedId ? 5.5 : 4, class: 'dot' }));
    g.addEventListener('mouseenter', () => show(i));
    g.addEventListener('focus', () => show(i));


    g.addEventListener('click', () => o.onSelect(p.id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        o.onSelect(p.id);
      }
    });
    root.append(g);
  });

  if (!o.compact) {
    // Runs are evenly spaced, so the axis names runs, not dates; dates live in the tooltip.
    const every = Math.max(1, Math.ceil(pts.length / 12));
    pts.forEach((_, i) => {
      if (i % every && i !== pts.length - 1) return;
      const label = svg('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' });
      label.textContent = `#${history.indexOf(pts[i]) + 1}`;
      root.append(label);
    });
  }
  wrap.addEventListener('mouseleave', () => { if (!tip.contains(document.activeElement)) tip.hidden = true; });
  wrap.addEventListener('focusout', (event) => { if (!wrap.contains(event.relatedTarget as Node)) tip.hidden = true; });
  wrap.prepend(root);
  return wrap;
}

/** One square per grader token (GitHub contribution-graph style); falls back to a count above 24 tokens. */
export function tokenBlocks(remaining: number, total: number): HTMLElement {
  const wrap = document.createElement('div');
  const ratio = total > 0 ? remaining / total : 0;
  wrap.className = `tokens ${remaining <= 0 ? 'empty' : ratio <= 0.34 ? 'low' : 'ok'}`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${remaining}/${total}`);
  if (total > 24) {
    wrap.style.display = 'none';
    return wrap;
  }
  for (let i = 0; i < total; i++) {
    const b = document.createElement('span');
    b.className = `tok ${i < remaining ? 'on' : 'off'}`;
    b.style.setProperty?.('--j', String(i));
    wrap.append(b);
  }
  return wrap;
}

/** Progress ring (0‥1) with an optional centred label; the arc carries the tone class. */
export function ring(ratio: number, opts: { size?: number; stroke?: number; tone?: string; label?: string; sub?: string; aria: string }): SVGElement {
  const size = opts.size ?? 64, sw = opts.stroke ?? 6, r = size / 2 - sw / 2 - 1, c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: `ring ${opts.tone ?? ''}`, role: 'img', 'aria-label': opts.aria });
  s.append(
    svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-track', 'stroke-width': sw }),
    svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-value', 'stroke-width': sw, 'stroke-dasharray': `${(c * v).toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }),
  );
  if (opts.label) {
    const t = svg('text', { x: size / 2, y: size / 2 + (opts.sub ? -2 : 1), class: 'ring-text', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = opts.label;
    s.append(t);
  }
  if (opts.sub) {
    const t = svg('text', { x: size / 2, y: size / 2 + 11, class: 'ring-sub', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = opts.sub;
    s.append(t);
  }
  return s;
}

/** Tiny area chart of 0‥100 values; the last point is marked. */
export function sparkArea(values: number[], opts: { width?: number; height?: number; aria: string }): SVGElement {
  const W = opts.width ?? 120, H = opts.height ?? 36, pad = 3;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark', role: 'img', 'aria-label': opts.aria, preserveAspectRatio: 'none' });
  if (!values.length) return s;
  const x = (i: number) => values.length === 1 ? W / 2 : pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  s.append(
    svg('line', { x1: 0, x2: W, y1: y(100), y2: y(100), class: 'spark-max' }),
    svg('path', { d: `${line} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`, class: 'spark-area' }),
    svg('path', { d: line, class: 'spark-line', pathLength: 100 }),
    svg('circle', { cx: x(values.length - 1), cy: y(values.at(-1)!), r: 2.6, class: 'spark-dot' }),
  );
  return s;
}

/** Horizontal stacked bar; segments with a zero value are skipped. */
export function stackBar(segments: Array<{ value: number; tone: string; label: string }>, aria: string): HTMLElement {
  const total = segments.reduce((n, s) => n + Math.max(0, s.value), 0);
  const wrap = document.createElement('div');
  wrap.className = `stack-bar${total ? '' : ' empty'}`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', aria);
  for (const s of segments) {
    if (s.value <= 0) continue;
    const seg = document.createElement('span');
    seg.className = `seg-${s.tone}`;
    seg.style.flexGrow = String(s.value);
    seg.style.setProperty?.('--j', String(wrap.childElementCount));
    seg.title = `${s.label}: ${s.value}`;
    wrap.append(seg);
  }
  return wrap;
}

/** One column per attempt, height = score, tone by threshold; the latest score is labelled. */
export function heatStrip(values: Array<{ score: number | null; title: string; selected?: boolean }>, aria: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'heat-strip';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', aria);
  const cols = document.createElement('div');
  cols.className = 'heat-cols';
  for (const v of values) {
    const cell = document.createElement('span');
    const band = v.score === null ? 'none' : v.score >= 100 ? 'full' : v.score >= 50 ? 'mid' : 'low';
    cell.className = `heat ${band}${v.selected ? ' selected' : ''}`;
    cell.style.height = `${Math.max(8, v.score ?? 0)}%`;
    cell.title = v.title;
    cols.append(cell);
  }
  wrap.append(cols);
  const last = values.at(-1);
  if (last) {
    const label = document.createElement('span');
    label.className = 'heat-last';
    label.textContent = last.score === null ? '—' : `${last.score}%`;
    wrap.append(label);
  }
  return wrap;
}

/** `band` overrides the tone read from the score (a valgrind check is good at zero, not at 100). */
export interface SkylineBar { score: number | null; title: string; band?: 'pass' | 'warn' | 'fail' | 'none' }

/**
 * The project's signature: one bar per attempt (height = score, tone by band, the latest lit),
 * a breathing ghost while an attempt is in flight, then one dashed slot per token still to spend.
 * Older attempts drop off the left when they no longer fit; tokens left are never invented.
 */
export function skyline(bars: SkylineBar[], tokensLeft: number, o: { width: number; height: number; aria: string; running?: boolean; fresh?: boolean; slotTitle: string; ghostTitle: string; maxBar?: number }): SVGElement {
  const W = Math.max(60, Math.round(o.width)), H = o.height, gap = 3, minBar = 4;
  const fit = Math.max(1, Math.floor((W + gap) / (minBar + gap)));
  const ghost = o.running ? 1 : 0;
  let slots = Math.max(0, Math.min(tokensLeft, 24));
  // Tokens may take at most a third of the room once attempts need it.
  if (bars.length + ghost + slots > fit) slots = Math.min(slots, Math.max(bars.length ? Math.floor(fit / 3) : fit - ghost, 0));
  const shown = bars.slice(-Math.max(0, fit - slots - ghost));
  const n = Math.max(1, shown.length + ghost + slots);
  const bw = Math.min(o.maxBar ?? 14, (W - gap * (n - 1)) / n);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'skyline', role: 'img', 'aria-label': o.aria });
  s.append(svg('line', { x1: 0, x2: W, y1: 0.5, y2: 0.5, class: 'sky-guide' }));
  let k = 0;
  shown.forEach((b, i) => {
    const v = b.score ?? 0, bh = Math.max(2, (v / 100) * (H - 2));
    const band = b.band ?? (b.score === null ? 'none' : v >= 100 ? 'pass' : v >= 50 ? 'warn' : 'fail');
    const last = i === shown.length - 1;
    const rect = svg('rect', { x: (k * (bw + gap)).toFixed(2), y: (H - bh).toFixed(2), width: bw.toFixed(2), height: bh.toFixed(2), rx: Math.min(2, bw / 3), class: `sky-bar b-${band}${last ? ' latest' : ''}${last && o.fresh ? ' fresh' : ''}`, style: `--i:${i}` });
    rect.append(svg('title', {}, b.title));
    s.append(rect);
    k++;
  });
  if (ghost) {
    const rect = svg('rect', { x: (k * (bw + gap)).toFixed(2), y: (H * 0.3).toFixed(2), width: bw.toFixed(2), height: (H * 0.7).toFixed(2), rx: Math.min(2, bw / 3), class: 'sky-ghost' });
    rect.append(svg('title', {}, o.ghostTitle));
    s.append(rect);
    k++;
  }
  for (let j = 0; j < slots; j++, k++) {
    const rect = svg('rect', { x: (k * (bw + gap) + 0.5).toFixed(2), y: (H * 0.55).toFixed(2), width: Math.max(1, bw - 1).toFixed(2), height: (H * 0.45 - 0.5).toFixed(2), rx: Math.min(2, bw / 3), class: 'sky-slot', style: `--i:${shown.length + j}` });
    rect.append(svg('title', {}, o.slotTitle));
    s.append(rect);
  }
  return s;
}

export interface SkillRow { name: string; count: number; passed: number; crashed: number }

/** One row per skill: segmented when small (one segment per test), proportional beyond twelve. */
export function skillBars(skills: SkillRow[], aria: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'skill-bars';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', aria);
  skills.forEach((sk, j) => {
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.title = `${sk.name} · ${sk.passed}/${sk.count}${sk.crashed ? ` · ${sk.crashed} crash` : ''}`;
    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = sk.name;
    const bar = document.createElement('span');
    bar.className = `skill-bar${sk.count > 12 ? ' prop' : ''}`;
    const failed = Math.max(0, sk.count - sk.passed - sk.crashed);
    const parts: Array<[string, number]> = [['p', sk.passed], ['c', sk.crashed], ['f', failed]];
    if (sk.count > 12) {
      for (const [cls, v] of parts) {
        if (v <= 0) continue;
        const seg = document.createElement('i');
        seg.className = cls;
        seg.style.flexGrow = String(v);
        seg.style.setProperty?.('--j', String(j));
        bar.append(seg);
      }
    } else {
      let k = 0;
      for (const [cls, v] of parts) for (let i = 0; i < v; i++, k++) {
        const seg = document.createElement('i');
        seg.className = cls;
        seg.style.setProperty?.('--j', String(j * 2 + k * 0.3));
        bar.append(seg);
      }
    }
    const ratio = document.createElement('span');
    ratio.className = 'skill-ratio';
    ratio.textContent = `${sk.passed}/${sk.count}`;
    row.append(name, bar, ratio);
    wrap.append(row);
  });
  return wrap;
}

/** A thin labelled meter (0‥1), e.g. line or branch coverage. */
export function meterBar(ratio: number, label: string, value: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'meter-bar';
  const head = document.createElement('span');
  head.className = 'meter-head';
  const b = document.createElement('b');
  b.textContent = value;
  head.append(label, ' ', b);
  const track = document.createElement('span');
  track.className = 'meter-track';
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `${label} ${value}`);
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  track.append(fill);
  wrap.append(head, track);
  return wrap;
}
