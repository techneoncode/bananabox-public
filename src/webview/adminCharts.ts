import { h, svg } from './dom';
import type { TimelineDay, VersionCount } from '../shared/adminTypes';

const W = 300;
const H = 112;
const PAD = { top: 8, bottom: 4, left: 4, right: 4 };

export interface TimelineLabels {
  aria: string;
  /** `{day}: {new} new, {seen} last seen` */
  tip: (day: string, created: number, seen: number) => string;
}

/**
 * 30-day chart: one bar per day for new installations and a line for the installations whose last
 * launch was that day. Both share one scale so the heights compare. Entrance motion is CSS only.
 */
export function timelineChart(days: TimelineDay[], labels: TimelineLabels): SVGElement {
  const max = Math.max(1, ...days.flatMap((d) => [d.new, d.last_seen]));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, days.length);
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (value: number) => PAD.top + plotH * (1 - value / max);

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'adm-timeline', role: 'img', 'aria-label': labels.aria, preserveAspectRatio: 'none' });
  for (const fraction of [0, 0.5, 1]) {
    chart.append(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: y(max * fraction), y2: y(max * fraction), class: 'adm-grid' }));
  }
  days.forEach((d, i) => {
    const bar = svg('rect', {
      x: x(i) - slot * 0.31, y: y(d.new), width: slot * 0.62, height: Math.max(0, PAD.top + plotH - y(d.new)), rx: 1.5, class: 'adm-bar',
    });
    bar.style.setProperty('--i', String(i));
    bar.append(svg('title', {}, labels.tip(d.day, d.new, d.last_seen)));
    chart.append(bar);
  });
  const points = days.map((d, i) => `${x(i).toFixed(1)},${y(d.last_seen).toFixed(1)}`);
  if (points.length > 1) {
    chart.append(
      svg('path', { d: `M${points.join(' L')} L${x(days.length - 1).toFixed(1)},${PAD.top + plotH} L${x(0).toFixed(1)},${PAD.top + plotH} Z`, class: 'adm-area' }),
      svg('path', { d: `M${points.join(' L')}`, class: 'adm-line', pathLength: 100 }),
    );
  }
  return chart;
}

/** Horizontal bars per version: the track is the installations, the fill the active ones. */
export function versionBars(versions: VersionCount[], aria: string, labels: { active: string; installs: string }, current?: string): HTMLElement {
  const max = Math.max(1, ...versions.map((v) => v.installs));
  const wrap = h('div.adm-versions', { role: 'img', 'aria-label': aria });
  versions.forEach((v, i) => {
    const track = h('div.adm-track', { title: `${labels.installs}: ${v.installs} · ${labels.active}: ${v.active}` },
      h('div.adm-total', { style: { width: `${(v.installs / max) * 100}%`, '--i': i } },
        h('div.adm-fill', { style: { width: `${v.installs ? (v.active / v.installs) * 100 : 0}%` } })));
    const tone = v.version === current ? 'current' : v.obsolete ? 'obsolete' : '';
    wrap.append(h('div.adm-version', { class: tone }, h('span.mono.adm-version-name', v.version), track, h('span.adm-version-count', v.installs)));
  });
  return wrap;
}
