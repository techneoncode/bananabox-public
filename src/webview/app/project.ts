import { h, icon } from '../dom';
import type { Ctx, Tab } from '../ctx';
import type { GraderVM, ProjectVM, TestResultSummary } from '../../shared/types';
import { sparkArea, tokenBlocks } from '../charts';
import { compactDuration, dateOnly, relative, timeOnly } from '../format';
import { personTag } from '../avatars';
import { projectMidpoint } from '../../domain/activities';
import { renderMarkdown } from '../views/markdown';
import { chip, menu, type MenuItem, type Tone } from '../ui';
import { readinessVerdict } from '../../domain/readiness';
import { tabBody } from '../views/detail';
import { renderNextUp } from '../views/focus';
import { runState } from '../views/grader';
import { statusBadge } from '../views/list';
import { deliveryChecks } from '../views/pipeline';
import { projectClock } from '../views/signature';
import { appBar, bigButton, iconAction, listGroup, listRow, popProject } from './kit';

/** Picks the .one or .other string by n (French reads 0 as singular). */
const count = (ctx: Ctx, key: string, n: number, params: Record<string, string | number> = {}) =>
  ctx.t(`${key}.${n === 1 || (ctx.lang === 'fr' && n === 0) ? 'one' : 'other'}`, { n, ...params });

const VERDICT_TONE: Record<string, Tone> = { ready: 'pass', blocked: 'fail', unchecked: 'warn', stale: 'warn', running: 'accent' };

/** A project's full screen (the root) or one of its pushed pages (ui.tab set). */
export function renderProjectScreen(ctx: Ctx, p: ProjectVM): HTMLElement {
  if (ctx.ui.tab) return projectPage(ctx, p, ctx.ui.tab);
  const { t } = ctx;
  const back = ctx.ui.appTab === 'home' ? 'app.tab.home' : 'app.tab.projects';
  return h('div.ps', { dataset: { project: String(p.id) } },
    appBar({ title: p.unitCode || p.name, back: { label: t(back), onclick: () => popProject(ctx) }, actions: [overflow(ctx, p)] }),
    hero(ctx, p),
    h('div.ps-groups', work(ctx, p), school(ctx, p)),
    renderNextUp(ctx, p),
    actionBar(ctx, p));
}

/** A pushed page: back to the project, the page title, then the page body. The grader page keeps its own Run. */
function projectPage(ctx: Ctx, p: ProjectVM, tab: Tab): HTMLElement {
  const { t } = ctx, g = ctx.graders.get(p.id);
  const fresh = tab === 'grader' && g && !g.loading && g.history.length === 0 && !g.running && !g.runs.some(r => r.state === 'submitted' || r.state === 'started');
  return h('div.ps.ps-page', { dataset: { project: String(p.id) } },
    appBar({ title: t(`tab.${tab}`), back: { label: p.name, onclick: () => popProject(ctx) } }),
    h('div.tab-body.ps-body', { role: 'region', 'aria-label': t(`tab.${tab}`) }, fresh ? firstRun(ctx, p, g) : tab === 'details' ? details(ctx, p) : tabBody(ctx, p, tab)),
    tab === 'grader' ? null : actionBar(ctx, p));
}

const go = (ctx: Ctx, tab: Tab) => () => { ctx.ui.tab = tab; ctx.rerender(); };

function overflow(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  const { t } = ctx;
  const isCurrent = p.id === ctx.state.currentProjectId;
  const canClone = p.repoEnabled && p.registered && !isCurrent && !(ctx.state.localProjects ?? []).includes(p.id);
  const items: MenuItem[] = [
    ...(canClone ? [{ label: t('action.cloneOpen'), icon: 'repo-clone', onSelect: () => ctx.post({ type: 'openFolder', projectId: p.id }), title: p.repoLink ?? t('action.cloneUnknown') }] : []),
    ...(canClone ? [{ label: t('action.locateRepo'), icon: 'search', onSelect: () => ctx.post({ type: 'locateRepo', projectId: p.id }) }] : []),
    { label: t('action.intranet'), icon: 'globe', onSelect: () => ctx.post({ type: 'openExternal', url: p.intranetUrl }) },
    ...(p.hermesUrl ? [{ label: t('action.hermes'), icon: 'link-external', onSelect: () => ctx.post({ type: 'openExternal', url: p.hermesUrl! }) }] : []),
    ...(p.repoLink ? [{ label: t('action.copyRepo'), icon: 'copy', onSelect: () => ctx.post({ type: 'copy', text: p.repoLink!, what: t('detail.repoUrl') }) }] : []),
  ];
  return menu(`project-${p.id}`, t('action.more'), items);
}

/** Name, unit, status, the deadline rail, best score with its attempts, tokens left. */
function hero(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, c = projectClock(p);
  const g = ctx.graders.get(p.id), history = g?.history ?? [], latest = history.at(-1), q = g?.quota;
  const scores = history.map(r => r.score).filter((v): v is number => v !== null);
  const best = scores.length ? Math.max(...scores) : null;
  const left = Date.parse(c.target) - Date.now(), pct = Math.round(c.elapsed * 100);
  const timeText = p.status === 'past' ? relative(p.endDate, lang) : left > 0 ? compactDuration(left, lang) : relative(c.target, lang);
  return h('section.ps-hero', { 'aria-label': p.name },
    h('div.ps-id', h('h1.ps-name', { title: p.name }, p.name),
      (p.unitCode || p.unitName) && h('p.ps-unit', [p.unitCode, p.unitName].filter(Boolean).join(' · '))),
    h('div.ps-chips', statusBadge(ctx, p.status),
      !p.registered && p.status !== 'past' && chip('warn', t('badge.notRegistered')),
      p.id === ctx.state.currentProjectId && chip('accent', icon('folder-opened'), t('badge.current'))),
    h('div.ps-deadline', { class: c.urgent ? 'urgent' : '' },
      h('div.ps-dl-top', h('span.ps-dl-label', t(`gauge.${c.key}`)), h('span.ps-dl-time.num', timeText)),
      h('div.ps-rail', { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': t('milestone.elapsed', { pct }) },
        h('i', { style: { width: `${pct}%` } })),
      h('span.ps-dl-sub.num', `${dateOnly(c.target, lang)} · ${timeOnly(c.target, lang)}`)),
    h('div.ps-key',
      h('div.ps-stat',
        h('span.ps-stat-label', t('app.project.bestScore')),
        best !== null ? h('span.ps-big.num', String(best), h('small', '%')) : h('span.ps-big.none', '-'),
        h('span.ps-stat-sub', history.length ? count(ctx, 'app.project.attempts', history.length) : t('app.project.neverRun')),
        scores.length > 1 && sparkArea(scores.slice(-12), { width: 120, height: 36, aria: count(ctx, 'app.project.attempts', history.length) })),
      q && h('div.ps-stat',
        h('span.ps-stat-label', t('app.project.tokensLeft')),
        h('span.ps-big.num', String(q.remaining), h('small', `/${q.total}`)),
        tokenBlocks(q.remaining, q.total))));
}

/** Warnings about the last graded commit, shown inline on the row they concern. */
function commitWarnings(ctx: Ctx, p: ProjectVM, graded: string | null): HTMLElement[] {
  const state = ctx.state.commitStates?.[p.id];
  if (!state) return [];
  const differs = !!graded && state.head.toLowerCase() !== graded.toLowerCase();
  const out: HTMLElement[] = [];
  if (differs) out.push(h('span.ps-warn', icon('warning'), ctx.t('commit.different')));
  if (state.dirty) out.push(h('span.ps-warn', icon('warning'), ctx.t('commit.dirty')));
  return out;
}

function work(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx;
  const g: GraderVM | undefined = ctx.graders.get(p.id);
  const history: TestResultSummary[] = g?.history ?? [], latest = history.at(-1);
  const checks = deliveryChecks(ctx, p);
  const verdict = readinessVerdict(ctx.readiness.get(p.id), checks);
  const failing = checks.filter(c => c.status === 'fail').length;
  const vg = ctx.valgrind?.get(p.id), leaks = vg?.run?.leaks.length ?? 0;
  const lastRun = latest ? t('app.project.lastRun', { when: relative(latest.date, lang) }) : t('app.project.neverRun');
  return listGroup(t('app.project.work'),
    listRow({
      icon: 'beaker', tone: 'accent', label: t('tab.grader'), onclick: go(ctx, 'grader'),
      detail: h('span', latest?.total ? count(ctx, 'app.project.testsCount', latest.total, { passed: latest.passed, total: latest.total }) : lastRun, ...commitWarnings(ctx, p, latest?.commit ?? null)),
      meta: latest?.score != null ? h('span.ps-score.num', `${latest.score}%`) : null,
    }),
    listRow({
      icon: 'checklist', tone: VERDICT_TONE[verdict] ?? '', label: t('tab.prepare'), onclick: go(ctx, 'prepare'),
      detail: [t(`sb.verdict.${verdict}`), failing ? count(ctx, 'app.project.toFix', failing) : null].filter(Boolean).join(' · '),
    }),
    listRow({
      icon: 'debug-alt', tone: vg?.run ? (leaks ? 'fail' : 'pass') : '', label: t('tab.valgrind'), onclick: go(ctx, 'valgrind'),
      detail: vg?.run ? (leaks ? count(ctx, 'app.project.leaks', leaks) : null)
        : ctx.state.currentProjectId === p.id ? t('app.project.neverRun') : t('app.project.valgrindOpenFirst'),
    }),
    listRow({
      icon: 'history', label: t('tab.history'), onclick: go(ctx, 'history'),
      detail: history.length ? count(ctx, 'app.project.runs', history.length) : t('app.project.neverRun'),
    }));
}

function school(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx;
  const slots = (ctx.activities.get(p.id) ?? []).flatMap(a => a.slots ?? []).filter(s => s.mine);
  const next = slots.filter(s => Date.parse(s.startDate) > Date.now()).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0];
  return listGroup(t('app.project.school'),
    listRow({ icon: 'file-pdf', label: t('tab.subject'), onclick: go(ctx, 'subject') }),
    listRow({
      icon: 'calendar', tone: slots.length ? 'pass' : '', label: t('tab.activities'), onclick: go(ctx, 'activities'),
      detail: next ? t('app.project.nextSlot', { when: `${dateOnly(next.startDate, lang)} ${timeOnly(next.startDate, lang)}` })
        : t(slots.length ? 'app.project.booked' : 'app.project.notBooked'),
    }),
    listRow({
      icon: 'info', label: t('tab.details'), onclick: go(ctx, 'details'),
      detail: [p.groupName, `${dateOnly(p.startDate, lang)} · ${dateOnly(p.endDate, lang)}`].filter(Boolean).join(' · '),
    }));
}

/** The one primary action (Run) with Check beside it, pinned above the tab bar. */
function actionBar(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  const { t } = ctx, g = ctx.graders.get(p.id);
  if (!g) return null;
  if (!g.canRun && g.history.length === 0 && (g.reason === 'not_registered' || g.reason === 'repo_disabled')) return null;
  const rs = runState(ctx, p, g);
  const vm = ctx.readiness.get(p.id), flow = ctx.guided.get(p.id);
  const checking = vm?.status === 'running' || flow?.status === 'running';
  const busy = !!rs.active || g.running;
  const local = ctx.state.commitStates?.[p.id] !== null;
  const latest = g.history.at(-1), q = g.quota;
  const line = busy ? t(rs.active?.state === 'submitted' ? 'sb.inQueue' : 'sb.executing')
    : checking ? t('sb.checking')
    : latest ? t('sb.lastRunLine', { score: latest.score === null ? '-' : `${latest.score}%`, when: relative(latest.date, ctx.lang) })
    : q ? t('sb.firstRun', { left: q.remaining, total: q.total }) : t('grader.noRuns');
  const check = checking
    ? h('button.bb.bb-secondary', { type: 'button', title: t('delivery.stop'), onclick: () => ctx.post({ type: 'cancelLocal', projectId: p.id }) }, icon('debug-stop'), h('span', t('sb.stop')))
    : bigButton(t('sb.check'), 'checklist', () => ctx.post({ type: 'checkReadiness', projectId: p.id }), 'secondary',
      { disabled: !local || busy, title: local ? t('delivery.scope') : t('sb.noLocal') });
  const run = bigButton(busy ? t('grader.running') : t('sb.run'), busy ? 'loading' : 'play', () => ctx.post({ type: 'runGrader', projectId: p.id }), 'primary',
    { disabled: rs.disabled, title: rs.hint });
  return h('div.ps-bar', { class: busy || checking ? 'busy' : '', role: 'region', 'aria-label': t('sb.dock') },
    h('p.ps-bar-status', { role: 'status' }, icon(busy || checking ? 'loading' : 'history', busy || checking ? 'spin' : ''), h('span', line)),
    h('div.ps-bar-actions', check, run));
}

const remoteAsked = new Set<number>();

/** The grader page before any run: the pushed commit that will be graded, what is left to do, one Run. */
function firstRun(ctx: Ctx, p: ProjectVM, g: GraderVM): HTMLElement {
  const { t, lang } = ctx;
  const remote = g.remoteCommit, state = ctx.state.commitStates?.[p.id];
  if (!remote && !remoteAsked.has(p.id)) { remoteAsked.add(p.id); ctx.post({ type: 'refreshRemoteCommit', projectId: p.id }); }
  const sha = remote?.status === 'ready' ? remote.sha : null;
  const notPushed = !!sha && !!state && state.head.toLowerCase() !== sha.toLowerCase();
  const rs = runState(ctx, p, g);
  const checks = deliveryChecks(ctx, p);
  const verdict = readinessVerdict(ctx.readiness.get(p.id), checks);
  const failing = checks.filter(c => c.status === 'fail').length;
  const q = g.quota;
  const commit = h('section.fr-next',
    h('div.fr-next-head', h('span.fr-next-title', icon('git-commit'), t('app.project.next.title')),
      iconAction(t('remote.refresh'), 'refresh', () => ctx.post({ type: 'refreshRemoteCommit', projectId: p.id }), { disabled: remote?.status === 'loading' })),
    sha
      ? h('button.fr-sha', { type: 'button', title: t('app.project.next.copy'), 'aria-label': `${t('app.project.next.copy')} ${sha}`, onclick: () => ctx.post({ type: 'copy', text: sha }) },
        h('span.fr-sha-id.num', sha.slice(0, 7)), remote?.branch ? h('span.fr-branch', icon('git-branch'), remote.branch) : null, icon('copy', 'fr-copy'))
      : h('p.fr-muted', t(remote?.status === 'loading' || !remote ? 'remote.loading' : 'remote.unavailable')),
    h('p.fr-muted', sha && remote?.pushedAt ? `${t('app.project.next.sub')} ${t('app.project.next.pushed', { when: relative(remote.pushedAt, lang) })}` : t('app.project.next.sub')),
    notPushed ? h('p.ps-warn.fr-warn', icon('warning'), t('app.project.next.notPushed')) : null,
    state?.dirty ? h('p.ps-warn.fr-warn', icon('warning'), t('commit.dirty')) : null);
  return h('div.fr',
    h('div.fr-empty', icon('beaker'), h('strong', t('app.project.next.none'))),
    commit,
    listGroup(null,
      listRow({ icon: 'checklist', tone: VERDICT_TONE[verdict] ?? '', label: t('tab.prepare'), onclick: go(ctx, 'prepare'),
        detail: [t(`sb.verdict.${verdict}`), failing ? count(ctx, 'app.project.toFix', failing) : null].filter(Boolean).join(' · ') }),
      q ? listRow({ icon: 'circle-filled', tone: q.remaining ? 'accent' : 'fail', label: t('app.project.next.tokens'), meta: h('span.ps-score.num', `${q.remaining}/${q.total}`) }) : null),
    bigButton(t('sb.run'), 'play', () => ctx.post({ type: 'runGrader', projectId: p.id }), 'primary', { disabled: rs.disabled, title: rs.hint }),
    rs.disabled && rs.hint ? h('p.fr-muted.fr-hint', rs.hint) : null);
}

/** Details page: the project's reference facts as phone lists (schedule, group, unit), description last. */
function details(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx;
  const mid = projectMidpoint(p, ctx.activities.get(p.id));
  const now = Date.now();
  const when = (iso: string | null | undefined) => iso ? h('span.ps-when', h('span', dateOnly(iso, lang)), h('span.ps-when-t', timeOnly(iso, lang))) : null;
  const step = (icon: string, label: string, iso: string | null | undefined, detail?: string) => iso ? listRow({
    icon, tone: Date.parse(iso) < now ? '' : 'accent', label, detail, meta: when(iso), chevron: false,
  }) : null;
  const people = (list: Array<{ name: string; login: string }> | undefined) => (list ?? []).map(m => listRow({ label: personTag(ctx, m, 28), chevron: false }));
  const fact = (icon: string, label: string, value: string | null | undefined) => value ? listRow({ icon, label, meta: value, chevron: false }) : null;
  return h('div.ps-details',
    p.description ? h('p.ps-desc', p.description) : null,
    listGroup(t('overview.schedule'),
      step('play', t('timeline.open'), p.startDate),
      mid.date ? step('milestone', t('timeline.mid'), mid.date, t(`activities.mid.${mid.source}`)) : listRow({ icon: 'milestone', label: t('timeline.mid'), meta: t('activities.mid.unknown'), chevron: false }),
      step('person-add', t('overview.regEnd'), p.endRegistrationDate),
      step('target', t('timeline.close'), p.endDate)),
    listGroup(t('overview.group'),
      listRow({ icon: p.registered ? 'pass' : 'circle-slash', tone: p.registered ? 'pass' : 'warn', label: t('overview.registration'),
        meta: p.registered ? t('badge.registered') : t('badge.notRegistered'), chevron: false }),
      fact('organization', t('overview.groupName'), p.groupName),
      fact('person', t('overview.groupSize'), p.groupSizeMax > 1 ? `${p.groupSizeMin}–${p.groupSizeMax}` : t('overview.solo')),
      fact('account', t('overview.participants'), p.registrationsCount ? String(p.registrationsCount) : null),
      fact('feedback', t('overview.peerEval'), p.peerEvaluation ? t('common.yes') : null)),
    p.groupMembers?.length ? listGroup(t('people.members'), ...people(p.groupMembers)) : null,
    listGroup(t('overview.unit'),
      fact('mortar-board', t('overview.unitName'), p.unitName),
      fact('symbol-key', t('overview.unitCode'), [p.unitCode, p.instanceCode].filter(Boolean).join(' · '))),
    p.responsibles?.length ? listGroup(t('overview.responsibles'), ...people(p.responsibles)) : null,
    p.unitDescription ? h('details.ps-unit-desc', { dataset: { detailId: 'unit-description' } },
      h('summary', icon('chevron-right', 'chev'), t('overview.unitDescription')),
      h('div.ps-unit-body', renderMarkdown(p.unitDescription, url => ctx.post({ type: 'openExternal', url })))) : null);
}
