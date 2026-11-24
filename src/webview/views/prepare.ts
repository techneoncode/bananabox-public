import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import type { Milestone } from '../../domain/milestones';
import { readinessVerdict } from '../../domain/readiness';
import { compactDuration, dateOnly, dateTime } from '../format';
import { chip, type Tone } from '../ui';
import { deliveryChecks, milestoneEvent, milestones, renderPipeline } from './pipeline';

const VERDICT_TONE: Record<string, Tone> = { ready: 'pass', blocked: 'fail', unchecked: 'warn', stale: 'warn', running: 'running' };

/** Sidebar and project panel push the Prepare page in place; Home opens the project's panel on it. */
const open = (ctx: Ctx, p: ProjectVM, kind: Milestone) => () => {
  ctx.ui.milestone = kind;
  if (ctx.home) {
    ctx.post({ type: 'openProject', projectId: p.id, tab: `prepare-${kind}` });
    return;
  }
  ctx.ui.tab = 'prepare';
  ctx.rerender();
};

/** The project's coming events as cards, nearest first; `current` marks the one the Prepare page shows. */
export function renderMilestoneStrip(ctx: Ctx, p: ProjectVM, current?: Milestone): HTMLElement | null {
  const { t, lang } = ctx, vm = ctx.readiness.get(p.id), now = Date.now();
  if (!p.registered || p.status === 'upcoming') return null;
  return h('nav.ms-strip.rise', { style: { '--i': '3' }, 'aria-label': t('milestone.label') },
    milestones(ctx, p).map((event, i) => {
      const checks = deliveryChecks(ctx, p, event);
      const verdict = readinessVerdict(vm, checks), passed = checks.filter(c => c.status === 'pass').length;
      const left = Date.parse(event.date) - now;
      return h('button.panel.ms-card', { type: 'button', class: event.kind === current ? 'on' : i === 0 && !current ? 'next' : '',
        'aria-current': event.kind === current ? 'page' : undefined, title: [event.name, dateTime(event.date, lang)].filter(Boolean).join(' · '), onclick: open(ctx, p, event.kind) },
        h('span.sb-tile-label', i === 0 ? t('milestone.next') : t(`milestone.${event.kind}`), icon('chevron-right')),
        h('span.ms-name', t(`milestone.prepare.${event.kind}`)),
        h('span.ms-meter', { 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${checks.length}, minmax(0, 1fr))` } }, checks.map(c => h('i', { class: c.status }))),
        h('span.ms-foot',
          h('span.sb-tile-sub', left > 0 ? t('milestone.in', { time: compactDuration(left, lang) }) : dateOnly(event.date, lang)),
          h('span.spacer'),
          h('span.num.small', `${passed}/${checks.length}`),
          chip(VERDICT_TONE[verdict] ?? '', t(`sb.verdict.${verdict}`))));
    }));
}

/** The Prepare page: the events to switch between, then the checks the chosen one asks for. */
export function renderPrepare(ctx: Ctx, p: ProjectVM): HTMLElement {
  const event = milestoneEvent(ctx, p, ctx.ui.milestone);
  return h('div.prepare', renderMilestoneStrip(ctx, p, event.kind), renderPipeline(ctx, p, null, event.kind));
}
