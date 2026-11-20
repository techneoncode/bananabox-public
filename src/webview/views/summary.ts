import { h, icon } from '../dom';
import type { Ctx, Tab } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import type { DeliveryCheck } from '../../shared/deliveryTypes';
import { meterBar, ring, skillBars, sparkArea, stackBar } from '../charts';
import { dateOnly, relative, shortSha, timeOnly } from '../format';
import { freshSince, liveCountdown, rollNumber } from '../motion';
import { chip, menu, waitLine, type MenuItem, type Tone } from '../ui';
import { avatarStack } from '../avatars';
import { readinessVerdict } from '../../domain/readiness';
import { statusBadge } from './list';
import { deliveryChecks, milestoneEvent } from './pipeline';
import { renderMilestoneStrip } from './prepare';
import { commitButton, selectResult } from './report';
import { projectTrack, renderNextUp } from './focus';
import { columnWidth, graderPending, projectClock, projectSkyline, skylineSkeleton } from './signature';

type Child = Node | string | number | false | null | undefined | Child[];

/**
 * Where a summary piece leads: in the sidebar it pushes the page in place; on Home (the overview) it opens the
 * project's editor tab straight on that page.
 */
const go = (ctx: Ctx, tab: Tab | null, p: ProjectVM) => () => {
  if (ctx.surface === 'sidebar') { ctx.ui.tab = tab; ctx.rerender(); return; }
  ctx.post({ type: 'openProject', projectId: p.id, tab: tab === 'details' || tab === null ? 'overview' : tab === 'prepare' ? `prepare-${ctx.ui.milestone ?? milestoneEvent(ctx, p).kind}` : tab });
};

/** The sidebar app bar: back, the collapsed title, the overflow menu and "open wide". */
export function sidebarNav(ctx: Ctx, p: ProjectVM, page: Tab | null): HTMLElement {
  const { t } = ctx;
  const isCurrent = p.id === ctx.state.currentProjectId;
  const canClone = p.repoEnabled && p.registered && !isCurrent && !(ctx.state.localProjects ?? []).includes(p.id);
  const items: MenuItem[] = [
    ...(canClone ? [{ label: t('action.cloneOpen'), icon: 'repo-clone', onSelect: () => ctx.post({ type: 'openFolder', projectId: p.id }), title: p.repoLink ?? t('action.cloneUnknown') }] : []),
    { label: t('action.intranet'), icon: 'globe', onSelect: () => ctx.post({ type: 'openExternal', url: p.intranetUrl }) },
    ...(p.hermesUrl ? [{ label: t('action.hermes'), icon: 'link-external', onSelect: () => ctx.post({ type: 'openExternal', url: p.hermesUrl! }) }] : []),
    ...(p.repoLink ? [{ label: t('action.copyRepo'), icon: 'copy', onSelect: () => ctx.post({ type: 'copy', text: p.repoLink!, what: t('detail.repoUrl') }) }] : []),
  ];
  const back = page
    ? h('button.sb-back', { type: 'button', title: t('action.back'), onclick: go(ctx, null, p) }, icon('chevron-left'), h('span.ellipsis', { style: { viewTransitionName: `sb-title-${p.id}` } }, p.name))
    : h('button.sb-back', { type: 'button', title: t('action.back'), onclick: () => { ctx.ui.showList = true; ctx.ui.sidebarProject = null; ctx.ui.tab = null; ctx.rerender(); } }, icon('chevron-left'), h('span', t('sb.projects')));
  return h('header.sb-nav', { style: { viewTransitionName: 'sb-nav' } },
    back,
    !page && h('span.sb-mini.ellipsis', { 'aria-hidden': 'true' }, p.name),
    h('span.spacer'),
    menu(`project-${p.id}`, t('action.more'), items),
    ...openButtons(ctx, p));
}

/**
 * "Open" opens the project's folder in this window when Bananabox knows where it lives (like `code .` in it);
 * the overview in the editor has its own button. Already open here: only the overview is offered.
 */
export function openButtons(ctx: Ctx, p: ProjectVM): HTMLElement[] {
  const { t } = ctx;
  const local = p.id !== ctx.state.currentProjectId && (ctx.state.localProjects ?? []).includes(p.id);
  const overview = () => ctx.post({ type: 'openProject', projectId: p.id });
  if (!local) return [h('button.btn.small', { type: 'button', title: t('action.overviewHint'), onclick: overview }, icon('window'), t('action.overview'))];
  return [
    h('button.icon-btn.sb-overview', { type: 'button', title: t('action.overviewHint'), 'aria-label': t('action.overview'), onclick: overview }, icon('window')),
    h('button.btn.small.primary', { type: 'button', title: t('action.openFolderHint'), onclick: () => ctx.post({ type: 'openFolder', projectId: p.id }) }, icon('folder-opened'), t('action.open')),
  ];
}

/** The compact head of a pushed page: its title over the project it belongs to. */
export function pageHead(ctx: Ctx, p: ProjectVM, tab: Tab): HTMLElement {
  return h('div.sb-page-head.rise', { style: { '--i': '0' } }, h('h1', ctx.t(`tab.${tab}`)), h('span.sub.ellipsis', [p.unitCode, p.name].filter(Boolean).join(' · ')));
}

/** The project summary: everything that answers "where do I stand", each piece one tap from its page. */
export function renderSummary(ctx: Ctx, p: ProjectVM): HTMLElement[] {
  return [title(ctx, p), banner(ctx, p), h('div.sb-tiles', deadlineTile(ctx, p), scoreTile(ctx, p)), renderMilestoneStrip(ctx, p), stateGroup(ctx, p), nextUp(ctx, p), links(ctx, p)].filter((n): n is HTMLElement => !!n);
}

function title(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, members = p.groupMembers ?? [];
  return h('div.sb-title.rise', { style: { '--i': '0' } },
    h('h1', { title: p.name, style: { viewTransitionName: `sb-title-${p.id}` } }, p.name),
    h('div.sb-meta',
      (p.unitCode || p.unitName) && h('span.chip', { title: p.unitName }, p.unitCode || p.unitName),
      statusBadge(ctx, p.status),
      !p.registered && p.status !== 'past' && chip('warn', t('badge.notRegistered')),
      p.id === ctx.state.currentProjectId && chip('accent', icon('folder-opened'), t('badge.current')),
      members.length > 0 && h('span.sb-people', { title: p.groupName ?? '' }, avatarStack(ctx, members, 4, 20),
        p.groupSizeMax > 1 && h('span.num', `${members.length}/${p.groupSizeMax}`))));
}

/** The signature: the project's attempts as a skyline over its timeline. */
export function banner(ctx: Ctx, p: ProjectVM, width = columnWidth(24), height = 54, maxBar?: number): HTMLElement {
  const { t } = ctx, g = ctx.graders.get(p.id), history = g?.history ?? [];
  const scores = history.map(r => r.score).filter((v): v is number => v !== null);
  const sky = projectSkyline(ctx, p, width, height, maxBar);
  const clock = projectClock(p);
  const pending = graderPending(ctx, p);
  const head = pending ? waitLine(t('wait.grader'))
    : !sky ? h('span', t('sb.noGrader'))
    : history.length ? h('span', h('b', t('sb.attempts', { n: history.length })), scores.length ? ` · ${t('sb.best', { score: Math.max(...scores) })}` : '')
    : h('span', h('b', t('sb.noAttempts')));
  return h('section.panel.sb-banner.rise', { class: `${clock.urgent ? 'urgent' : ''}${freshSince(p.id) !== null ? ' fresh' : ''}`, style: { '--i': '1', '--fresh': `${freshSince(p.id) ?? 0}ms`, viewTransitionName: `sb-card-${p.id}` }, 'aria-label': t('focus.label') },
    h('div.sb-banner-head', head, g?.quota && sky ? h('span', t('sb.tokensLeft', { n: g.quota.remaining })) : null),
    pending ? skylineSkeleton(ctx, width, height, maxBar) : sky,
    projectTrack(ctx, p));
}

export function tileLabel(text: string): HTMLElement {
  return h('span.sb-tile-label', text, icon('chevron-right'));
}

export function deadlineTile(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, c = projectClock(p);
  const pct = Math.round(c.elapsed * 100);
  return h('button.panel.sb-tile.rise', { type: 'button', style: { '--i': '2' }, title: t('readout.open'), onclick: go(ctx, 'details', p) },
    tileLabel(t(`gauge.${c.key}`)),
    h('span.sb-tile-row',
      h('span.sb-val', { class: c.urgent ? 'urgent' : '' }, p.status === 'past' ? relative(p.endDate, lang) : liveCountdown(c.target)),
      h('span.spacer'),
      ring(c.elapsed, { size: 34, stroke: 4, tone: c.urgent ? 'urgent' : p.status === 'past' ? 'done' : 'live', label: `${pct}`, aria: t('milestone.elapsed', { pct }) })),
    h('span.sb-tile-sub', `${dateOnly(c.target, lang)} · ${timeOnly(c.target, lang)}`));
}

export function scoreTile(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, g = ctx.graders.get(p.id), history = g?.history ?? [];
  const latest = history.at(-1), previous = history.at(-2);
  const scores = history.map(r => r.score).filter((v): v is number => v !== null).slice(-12);
  const diff = latest?.score != null && previous?.score != null ? Math.round((latest.score - previous.score) * 10) / 10 : null;
  return h('button.panel.sb-tile.rise', { type: 'button', style: { '--i': '3' }, title: t('readout.open'), onclick: go(ctx, 'history', p) },
    tileLabel(t('gauge.score')),
    h('span.sb-tile-row',
      latest?.score != null ? h('span.sb-val', rollNumber(`score:${p.id}`, latest.score), h('small', '%')) : h('span.sb-val.none', '—'),
      diff !== null && diff !== 0 && h('span.delta-pill', { class: diff > 0 ? 'up' : 'down' }, icon(diff > 0 ? 'arrow-up' : 'arrow-down'), String(Math.abs(diff)))),
    scores.length > 1
      ? sparkArea(scores, { width: Math.max(80, (columnWidth(8) / 2) - 20), height: 26, aria: t('home.scoreTrend') })
      : graderPending(ctx, p) ? waitLine(t('readout.loading'))
      : h('span.sb-tile-sub', latest ? (latest.total > 0 ? t('grader.testsPassed', { passed: latest.passed, total: latest.total }) : t('grader.noTests')) : t('grader.noRuns')));
}

/** One row of the state group: the title is the row's link; inner controls stay clickable above it. */
function stateRow(glyph: string, label: string, open: () => void, meta: Child, ...body: Child[]): HTMLElement {
  return h('div.sb-row',
    icon(glyph, 'sb-row-icon'),
    h('div.sb-row-body',
      h('div.sb-row-head', h('button.sb-row-link', { type: 'button', onclick: open }, label), h('span.sb-row-meta', meta)),
      ...body),
    icon('chevron-right', 'sb-row-chev'));
}

const VERDICT_TONE: Record<string, Tone> = { ready: 'pass', blocked: 'fail', unchecked: 'warn', stale: 'warn', running: 'running' };

export function stateGroup(ctx: Ctx, p: ProjectVM): HTMLElement {
  return h('section.panel.sb-group.rise', { style: { '--i': '4' }, 'aria-label': ctx.t('delivery.title') },
    deliveryRow(ctx, p), syncRow(ctx, p), styleRow(ctx, p), lastRunRow(ctx, p));
}

function noLocal(ctx: Ctx, p: ProjectVM): HTMLElement {
  const canClone = p.repoEnabled && p.registered;
  return h('span.sb-note', icon('folder'), ctx.t('sb.noLocal'),
    canClone && h('button.btn.small', { type: 'button', onclick: () => ctx.post({ type: 'openFolder', projectId: p.id }) }, icon('repo-clone'), ctx.t('action.cloneOpen')));
}

function deliveryRow(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx, vm = ctx.readiness.get(p.id);
  const checks: DeliveryCheck[] = deliveryChecks(ctx, p);
  const verdict = readinessVerdict(vm, checks), passed = checks.filter(c => c.status === 'pass').length;
  const failing = checks.filter(c => c.status === 'fail');
  const local = ctx.state.commitStates?.[p.id] !== null;
  const pending = graderPending(ctx, p);
  return stateRow('checklist', t('sb.delivery'), go(ctx, 'prepare', p),
    pending ? waitLine(t('readout.loading')) : [h('span.num', `${passed}/${checks.length}`), chip(VERDICT_TONE[verdict] ?? '', h('span', { title: t(`delivery.verdict.${verdict}`) }, t(`sb.verdict.${verdict}`)))],
    h('div.sb-meter', { role: 'img', 'aria-label': checks.map(c => `${t(`delivery.check.${c.id}`)}: ${c.status}`).join(', ') },
      checks.map((c, j) => h('i', { class: c.status, title: `${t(`delivery.check.${c.id}`)} · ${c.detail}`, style: { '--j': String(j) } }))),
    !local ? noLocal(ctx, p)
      : pending ? null
      : failing.length ? h('span.sb-line.bad', failing.map(c => t(`delivery.check.${c.id}`)).join(' · '))
      : verdict === 'ready' ? h('span.sb-line', t('home.checksClear')) : null);
}

function syncRow(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx;
  const state = ctx.state.commitStates?.[p.id];
  const latest = ctx.graders.get(p.id)?.history.at(-1);
  const graded = latest?.commit ?? null;
  const same = !!state && !!graded && state.head.toLowerCase() === graded.toLowerCase();
  const key = !graded ? 'notGraded' : !state ? 'unknown' : same ? 'same' : 'different';
  const tone: Tone = key === 'same' ? (state?.dirty ? 'warn' : 'pass') : key === 'different' ? 'warn' : '';
  const facts = [
    state?.dirty && h('span', icon('diff-modified'), t('sb.modified', { n: state.dirtyCount ?? 1 })),
    state?.ahead ? h('span', icon('arrow-up'), t('sb.toPush', { n: state.ahead })) : null,
    state && state.hasUpstream === false && h('span', icon('cloud'), t('sb.noUpstream')),
    latest && h('span', t('sb.gradedAgo', { when: relative(latest.date, lang) })),
  ].filter(Boolean);
  if (graderPending(ctx, p)) {
    return stateRow('git-commit', t('sb.graded'), go(ctx, 'history', p), waitLine(t('readout.loading')),
      state && h('div.sb-sync', h('span.sb-sha', { title: `${t('sb.head')} · ${state.head}` }, shortSha(state.head)), h('span.sb-link', icon('dash')), h('span.sb-sha.none', '…')));
  }
  return stateRow('git-commit', t('sb.graded'), go(ctx, 'history', p),
    chip(tone, t(`sb.sync.${key}`)),
    state === null && !graded ? noLocal(ctx, p) : h('div.sb-sync',
      h('span.sb-sha', { title: state ? `${t('sb.head')} · ${state.head}` : t('sb.head') }, state ? shortSha(state.head) : '—'),
      h('span.sb-link', { class: key === 'same' ? 'same' : key === 'different' ? 'diff' : '' }, icon(key === 'same' ? 'check' : key === 'different' ? 'git-compare' : 'dash')),
      graded ? commitButton(ctx, p.id, graded) : h('span.sb-sha.none', t('sb.sync.notGraded'))),
    facts.length > 0 && h('div.sb-facts', facts));
}

function styleRow(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, scan = ctx.styleScans.get(p.id);
  const local = ctx.state.commitStates?.[p.id] !== null;
  const open = () => { (ctx.ui.pipelineFocus ??= {})[p.id] = 'style'; go(ctx, 'prepare', p)(); };
  const buckets = ['fatal', 'major', 'minor', 'info'] as const;
  if (!scan || scan.status === 'unavailable' || scan.status === 'error') {
    return stateRow('eye', t('sb.style'), open, null,
      !local ? h('span.sb-line', t('style.noLocalCopy'))
        : scan?.status === 'unavailable' ? h('span.sb-line', scan.error ?? t('style.disabled'))
        : scan?.status === 'error' ? h('span.sb-line.bad', scan.error ?? t('style.unchecked'))
        : h('span.sb-note', t('sb.styleNone'), h('button.btn.small', { type: 'button', onclick: () => ctx.post({ type: 'scanStyle', projectId: p.id }) }, icon('search'), t('style.scan'))));
  }
  if (scan.status === 'running') {
    return stateRow('eye', t('sb.style'), open, h('span.codicon.codicon-loading.spin', { 'aria-hidden': 'true' }),
      h('div.sb-scan', { 'aria-hidden': 'true' }), h('span.sb-line', t('style.running')));
  }
  const total = buckets.reduce((n, b) => n + scan.summary[b], 0);
  return stateRow('eye', t('sb.style'), open, h('span.num', String(total)),
    stackBar(buckets.map(b => ({ value: scan.summary[b], tone: b, label: t(`style.bucket.${b}`) })), t('style.counts', scan.summary)),
    total ? h('div.sb-legend', buckets.map(b => h('span', h('i', { class: `dot-${b}` }), h('b', String(scan.summary[b])), ` ${t(`style.bucket.${b}`)}`)))
      : h('span.sb-line', t('sb.styleClean', { files: scan.files })),
    total > 0 && scan.scannedAt && h('span.sb-line', t('sb.styleFiles', { files: scan.files, when: relative(new Date(scan.scannedAt).toISOString(), lang) })));
}

function lastRunRow(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  const { t } = ctx, latest = ctx.graders.get(p.id)?.history.at(-1);
  if (!latest) return graderPending(ctx, p) ? stateRow('beaker', t('sb.lastRun'), go(ctx, 'grader', p), null, waitLine(t('wait.lastRun'))) : null;
  const open = () => { selectResult(ctx, p.id, latest.id); go(ctx, 'grader', p)(); };
  const skills = [...latest.skills]
    .sort((a, b) => (b.count - b.passed) - (a.count - a.passed) || a.name.localeCompare(b.name))
    .slice(0, 5);
  const cov = ctx.results.get(latest.id)?.detail?.coverage;
  const pct = (pair: [number, number]) => pair[1] > 0 ? pair[0] / pair[1] : 0;
  return stateRow('beaker', t('sb.lastRun'), open,
    h('span.num', latest.total > 0 ? t('grader.testsPassed', { passed: latest.passed, total: latest.total }) : t('grader.noTests')),
    skills.length ? skillBars(skills, t('sb.skills'))
      : latest.total > 0 ? meterBar(latest.passed / latest.total, t('result.tests'), `${latest.passed}/${latest.total}`) : null,
    (cov?.lines || cov?.branches) && h('div.sb-cov',
      cov.lines && meterBar(pct(cov.lines), t('result.lines'), `${Math.round(pct(cov.lines) * 100)}%`),
      cov.branches && meterBar(pct(cov.branches), t('result.branches'), `${Math.round(pct(cov.branches) * 100)}%`)));
}

function nextUp(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  const next = renderNextUp(ctx, p);
  if (!next) {
    // Sessions and defenses come with the activities: say they are on their way rather than show nothing.
    const waiting = p.registered && p.status !== 'upcoming' && !ctx.activities.has(p.id) && !ctx.activityErrors.has(p.id);
    return waiting ? h('section.next-up.rise', { style: { '--i': '5' }, 'aria-label': ctx.t('nextUp.title') },
      h('div.section-head', h('h2', ctx.t('nextUp.title'))), waitLine(ctx.t('activities.loading'))) : null;
  }
  next.classList.add('rise');
  next.style?.setProperty?.('--i', '5');
  return next;
}

function links(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx;
  const runs = ctx.graders.get(p.id)?.history.length ?? 0;
  const sessions = ctx.activities.get(p.id)?.length ?? 0;
  const leaks = ctx.valgrind?.get(p.id)?.run?.leaks.length ?? 0;
  const rows: Array<[Tab, string, number]> = [['grader', 'beaker', 0], ['valgrind', 'debug-alt', leaks], ['subject', 'file-pdf', 0], ['history', 'history', runs], ['activities', 'calendar', sessions], ['details', 'info', 0]];
  return h('nav.panel.sb-links.rise', { style: { '--i': '6' }, 'aria-label': t('sb.pages') },
    rows.map(([tab, glyph, count]) => h('button.sb-link-row', { type: 'button', onclick: go(ctx, tab, p) },
      icon(glyph), h('span', t(`tab.${tab}`)), count > 0 ? h('span.sb-count.num', String(count)) : h('span'), icon('chevron-right', 'sb-row-chev'))));
}
