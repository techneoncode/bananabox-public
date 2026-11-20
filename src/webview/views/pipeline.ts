import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import type { DeliveryCheck, DeliveryStep } from '../../shared/deliveryTypes';
import { readinessVerdict, gitReadinessDetail } from '../../domain/readiness';
import { milestoneChecks, projectMilestones, type Milestone, type MilestoneEvent } from '../../domain/milestones';
import { h, icon } from '../dom';
import { dateTime, compactDuration } from '../format';
import { renderFunctionRules } from './functionRules';
import { renderGraderCommand } from './graderCommand';
import { chip, gut, notice, type Tone } from '../ui';

const STAGES: DeliveryCheck['id'][] = ['style', 'build', 'tests', 'files', 'functions', 'binary', 'valgrind'];

/** The project's coming events, nearest first (the delivery always last and always there). */
export const milestones = (ctx: Ctx, p: ProjectVM): MilestoneEvent[] => projectMilestones(p, ctx.activities?.get(p.id));

/** The event asked for, else the nearest one. */
export function milestoneEvent(ctx: Ctx, p: ProjectVM, kind?: Milestone): MilestoneEvent {
  const all = milestones(ctx, p);
  return (kind && all.find(e => e.kind === kind)) || all[0];
}

/**
 * Every check an event depends on, local and remote, in the order a submission meets them. Defaults to the nearest
 * event; checks the student turned off are left out unless `withOff`.
 */
export function deliveryChecks(ctx: Ctx, p: ProjectVM, event = milestoneEvent(ctx, p), withOff = false): DeliveryCheck[] {
  const { t } = ctx, vm = ctx.readiness.get(p.id), g = ctx.graders.get(p.id);
  const checks: DeliveryCheck[] = STAGES.map(id => vm?.checks.find(c => c.id === id) ?? { id, status: 'unknown', detail: t('delivery.notChecked') });
  const git = ctx.state.commitStates?.[p.id];
  checks.push({ id: 'git', status: !git ? 'unknown' : git.dirty || git.ahead || !git.hasUpstream ? 'fail' : 'pass',
    detail: git ? gitReadinessDetail({ dirty: git.dirtyCount ?? (git.dirty ? 1 : 0), ahead: git.ahead ?? 0, hasUpstream: git.hasUpstream ?? false }, t) : t('delivery.noGit') });
  const remaining = Date.parse(event.date) - Date.now();
  checks.push({ id: 'deadline', status: Number.isFinite(remaining) ? remaining > 0 ? 'pass' : 'fail' : 'unknown',
    detail: remaining > 0 ? t('milestone.in', { time: compactDuration(remaining) }) : t('timeline.closed', { when: dateTime(event.date, ctx.lang) }) });
  checks.push({ id: 'grader', status: !g?.quota || g.error ? 'unknown' : !g.canRun || g.running || g.quota.remaining <= 0 ? 'fail' : 'pass',
    detail: g?.running ? t('grader.running') : g && !g.canRun ? t(`grader.reason.${g.reason}`) : g?.quota?.remaining === 0 ? t('grader.noTokens') : g?.quota ? t('run.tokens', { left: g.quota.remaining, total: g.quota.total }) : t('grader.noQuota') });
  const disabled = withOff ? [] : ctx.state.disabledChecks?.[event.kind];
  return milestoneChecks(event.kind, checks, vm, { c: vm?.c ?? true, disabled }, t);
}

const toneOf = (status: DeliveryCheck['status']): Tone => status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : status === 'running' ? 'running' : '';

/**
 * The pipeline: one gutter-marked row per stage, the focused stage opens its drawer.
 * `run` is the grader action, placed beside the delivery action at the end of the rail.
 * `kind` picks the event checked; unset follows the nearest one.
 */
export function renderPipeline(ctx: Ctx, p: ProjectVM, run?: HTMLElement | null, kind?: Milestone): HTMLElement {
  const { t } = ctx, vm = ctx.readiness.get(p.id), g = ctx.graders.get(p.id), flow = ctx.guided.get(p.id);
  const busy = vm?.status === 'running' || flow?.status === 'running';
  const event = milestoneEvent(ctx, p, kind);
  const all = deliveryChecks(ctx, p, event, true);
  const off = new Set(ctx.state.disabledChecks?.[event.kind] ?? []);
  const checks = all.filter(c => !off.has(c.id));
  const verdict = readinessVerdict(vm, checks), passed = checks.filter(c => c.status === 'pass').length;
  const focusMap = ctx.ui.pipelineFocus ??= {};
  const focus = p.id in focusMap ? focusMap[p.id] : checks.find(c => c.status === 'fail' && STAGES.includes(c.id))?.id ?? null;

  const root = h('section.section.readiness', { dataset: { detailId: 'readiness' }, 'aria-label': t('delivery.title'), title: t('delivery.scope') },
    h('div.section-head',
      h('h2', t('delivery.title')),
      h('span.meta', t('delivery.progress', { passed, total: checks.length })),
      h('span.chip.t-accent', { title: dateTime(event.date, ctx.lang) }, t(`milestone.${event.kind}`)),
      chip(verdict === 'ready' ? 'pass' : verdict === 'blocked' ? 'fail' : 'warn', t(`delivery.verdict.${verdict}`)),
      h('span.spacer'),
      h('div.pipeline-tools',
        busy
          ? h('button.icon-btn', { title: t('delivery.stop'), 'aria-label': t('delivery.stop'), onclick: () => ctx.post({ type: 'cancelLocal', projectId: p.id }) }, icon('debug-stop'))
          : h('button.icon-btn', { title: t('delivery.check'), 'aria-label': t('delivery.check'), onclick: () => ctx.post({ type: 'checkReadiness', projectId: p.id }) }, icon('refresh')),
        h('button.icon-btn', { disabled: busy, title: t('delivery.adjust'), 'aria-label': t('delivery.adjust'), onclick: () => ctx.post({ type: 'configureChecks', projectId: p.id, advanced: true }) }, icon('settings-gear')))));

  root.append(h('div.pipeline-meter', { 'aria-hidden': 'true' }, checks.map(c => h('i', { class: c.status, title: t(`delivery.check.${c.id}`) }))));

  if (flow) root.append(h('div.guided-progress', { role: 'status' },
    (['save', 'check', 'review', 'commit', 'push', 'grader'] as DeliveryStep[]).filter(step => step !== 'grader' || event.kind === 'delivery').map(step => h('span', { class: flow.completed.includes(step) ? 'done' : flow.step === step ? 'current' : '' },
      icon(flow.completed.includes(step) ? 'check' : flow.step === step && flow.status === 'running' ? 'loading' : 'circle-small', flow.step === step && flow.status === 'running' ? 'spin' : ''), t(`delivery.step.${step}`))),
    flow.message && h('span.ic-danger', flow.message),
    flow.status !== 'running' && chip('', t(`delivery.flow.${flow.status}`))));

  const notes = h('div.pipeline-notes');
  if (vm?.error) notes.append(notice('error', 'error', vm.error));
  if (vm?.stale) notes.append(notice('warn', 'history', t('delivery.changed')));
  if (vm?.detected) notes.append(notice('', 'sparkle', h('strong', t('delivery.automatic')),
    h('span.muted', t('delivery.detectedTasks', { n: vm.taskCount ?? 0 })),
    vm.commands?.length && h('details.inline', h('summary', icon('chevron-right', 'chev'), t('delivery.detectedCommands')), h('div.mono.small', vm.commands.map(c => h('div', c))))));
  if (vm?.unreproducedCommands?.length) notes.append(notice('', 'info', t('command.unreproduced'),
    h('details.inline', h('summary', icon('chevron-right', 'chev'), t('analysis.commands')), vm.unreproducedCommands.map(command => h('div.mono.small', command)))));
  if (notes.childElementCount) root.append(notes);

  const list = h('div.g-list', { role: 'list' });
  all.forEach((c, i) => {
    const enabled = !off.has(c.id), open = enabled && focus === c.id, name = t(`delivery.check.${c.id}`);
    list.append(h('div.check-item', { role: 'listitem', class: enabled ? '' : 'off' },
      h('input.check-toggle', { type: 'checkbox', checked: enabled, disabled: busy, title: t(enabled ? 'milestone.checkOff' : 'milestone.checkOn', { name }), 'aria-label': name,
        onchange: (e: Event) => ctx.post({ type: 'setPrepareCheck', milestone: event.kind, check: c.id, enabled: (e.target as HTMLInputElement).checked }) }),
      h('button.g-row.readiness-check', { class: `${enabled ? c.status : 'skipped'} ${open ? 'is-focus' : ''}`, 'aria-expanded': String(open), disabled: !enabled,
        onclick: () => { focusMap[p.id] = open ? null : c.id; ctx.rerender(); } },
        gut(i + 1, enabled ? toneOf(c.status) : '', enabled && c.status === 'running' ? icon('loading', 'spin') : null),
        h('span.g-main', h('span.name', name), h('span.spacer'), h('span.g-sub.ellipsis.check-detail', enabled ? c.detail : t('milestone.skipped')))),
      open && drawer(ctx, p, c, !!busy)));
  });
  root.append(list);

  const ready = verdict === 'ready';
  const prepare = h('button.btn', { class: ready && run ? '' : 'primary', disabled: busy || !p.registered || !p.repoEnabled || g?.running,
    onclick: () => ctx.post({ type: 'guidedDelivery', projectId: p.id, milestone: event.kind }) }, icon(flow?.status === 'paused' ? 'debug-continue' : 'rocket'), flow?.status === 'paused' ? t('delivery.resume') : t(`milestone.prepare.${event.kind}`));
  if (run && ready) run.classList.add('primary');
  root.append(h('div.run-cta', prepare, run ?? null));
  return root;
}

function drawer(ctx: Ctx, p: ProjectVM, c: DeliveryCheck, busy: boolean): HTMLElement {
  const { t } = ctx, vm = ctx.readiness.get(p.id);
  const body = h('div.g-drawer');
  body.append(h('p.drawer-text', c.detail));
  if (c.id === 'style') body.append(styleScan(ctx, p.id));
  if (c.id === 'tests' || c.id === 'build') {
    body.append(renderGraderCommand(ctx, p.id, busy));
    if (vm?.commandSource) body.append(h('p.tiny', t(`command.source.${vm.commandSource}`)));
  }
  if (c.id === 'functions') body.append(renderFunctionRules(ctx, p.id, busy));
  if (c.id === 'git') body.append(h('div.actions', h('button.btn.small', { onclick: () => ctx.post({ type: 'reviewChanges', projectId: p.id }) }, icon('diff'), t('delivery.viewChanges'))));
  if (c.output) body.append(h('details.check-output', { open: c.status === 'fail' }, h('summary', icon('chevron-right', 'chev'), t('delivery.output')), h('pre.trace-mini', c.output)));
  if (c.files?.length) body.append(h('div.check-locations', c.files.slice(0, 5).map(f => h('button.btn.ghost.small.mono', {
    onclick: () => ctx.post({ type: 'openFile', projectId: p.id, ...f }) }, icon('go-to-file'), `${f.file}:${f.line}`, h('span.muted', f.message))),
    c.files.length > 5 && h('span.tiny', t('delivery.moreIssues', { n: c.files.length - 5 }))));
  return body;
}

/** Project-wide epiclang scan, shown in the style stage. */
export function styleScan(ctx: Ctx, projectId: number): HTMLElement {
  const { t } = ctx;
  const scan = ctx.styleScans.get(projectId);
  const running = scan?.status === 'running';
  const root = h('div.style-scan', { dataset: { detailId: 'coding-style' } },
    h('div.actions',
      h('button.btn.small', { disabled: running, onclick: () => ctx.post({ type: 'scanStyle', projectId }) }, icon(running ? 'loading' : 'search', running ? 'spin' : ''), t('style.scan')),
      h('span.tiny', t('style.localNote'))));
  if (running) root.append(h('p.small', { role: 'status' }, t('style.running')));
  if (scan?.status === 'error') root.append(notice('error', 'error', scan.error));
  if (scan?.status === 'unavailable') root.append(h('p.muted.small', t(scan.error === 'no_local_copy' ? 'style.noLocalCopy' : 'style.disabled')));
  if (scan?.status === 'done') {
    const blocking = scan.summary.fatal + scan.summary.major;
    root.append(h('p.small', { class: blocking ? 'bad' : 'ok' }, blocking ? t('style.counts', scan.summary) : t('style.clean', { files: scan.files })));
    if (scan.issues.length) root.append(h('ul.style-issues', scan.issues.map(i => h('li',
      h('button.style-issue', { onclick: () => ctx.post({ type: 'openFile', projectId, file: i.file, line: i.line, column: i.column }) },
        chip(i.bucket === 'fatal' || i.bucket === 'major' || i.bucket === 'minor' || i.bucket === 'info' ? i.bucket : '', i.rule ?? i.bucket),
        h('span.mono', `${i.file}:${i.line}:${i.column}`), h('span', i.message))))));
    if (scan.truncated) root.append(h('p.tiny', t('style.truncated')));
  }
  return root;
}
