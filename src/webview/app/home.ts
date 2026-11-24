import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { tokenBlocks } from '../charts';
import { compactDuration, progress, timeOnly } from '../format';
import { runState } from '../views/grader';
import { emptyState, iconAction, listGroup, listRow, openProject, openSheet, switchTab } from './kit';

const HOUR = 3_600_000, DAY = 24 * HOUR;

/** One reason a project needs the student. Lower rank is more urgent. */
interface Reason { rank: number; at: number; tone: string; icon: string; text: string; go: () => void }
/** A session from the calendar, or from the activities when the calendar is not loaded. */
interface Session { iso: string; title: string; sub: string; registered: boolean; projectId: number | null }
/** One item of "Coming up": a session, or a project deadline. */
interface Soon { at: number; iso: string; title: string; sub: string; go: () => void }

/** Home tab: what needs the student now, the open project, what is coming, and every project one tap away. */
export function renderHomeTab(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const projects = state.projects;
  const root = h('div.home-tab');
  root.append(h('header.hm-head',
    h('div.hm-row', h('h1.hm-title', greeting(ctx)),
      iconAction(t('action.refresh'), 'refresh', () => ctx.post({ type: 'refresh' }), { disabled: state.loading })),
    projects ? h('p.hm-sub', subLine(ctx, projects)) : null));
  if (!projects) {
    root.append(state.error ? emptyState('warning', state.error) : h('div.hm-skel', { role: 'status' }, icon('loading', 'spin'), h('span', t('home.loading'))));
    return root;
  }
  if (projects.length === 0) {
    root.append(emptyState('folder', t('home.none')));
    return root;
  }
  const rows = needsRows(ctx, projects);
  root.append(
    rows.length ? needsSection(ctx, rows) : clearSection(ctx, projects),
    openSection(ctx, projects),
    soonSection(ctx, comingUp(ctx, projects)),
    summarySection(ctx, projects));
  return root;
}

/** Singular or plural string by `n`: `key.one` when n is 1, else `key.other`. */
function counted(ctx: Ctx, key: string, n: number): string {
  return ctx.t(`${key}.${n === 1 ? 'one' : 'other'}`, { n });
}

function greeting(ctx: Ctx): string {
  const { t, state } = ctx;
  const hour = new Date().getHours();
  const name = state.auth.firstname || state.auth.login || '';
  return t(hour < 12 ? 'home.morning' : hour < 18 ? 'home.afternoon' : 'home.evening', { name });
}

function subLine(ctx: Ctx, projects: ProjectVM[]): string | HTMLElement {
  const { t } = ctx;
  const next = nextDeadline(projects);
  const inProgress = counted(ctx, 'home.inProgress', projects.filter(p => p.status === 'ongoing').length);
  return next ? h('span', inProgress, ' · ', t('sb.closesNext', { name: next.name }), ' ', compactDuration(Date.parse(next.endDate) - Date.now(), ctx.lang))
    : inProgress;
}

/** The ongoing project whose end is the soonest in the future. */
function nextDeadline(projects: ProjectVM[]): ProjectVM | undefined {
  const now = Date.now();
  return projects.filter(p => p.status === 'ongoing' && Date.parse(p.endDate) > now)
    .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))[0];
}

/** Sessions from the loaded calendar; the activities stand in while it is not loaded. */
function sessionsOf(ctx: Ctx): Session[] {
  const events = ctx.calendar?.events;
  if (events) {
    return events.map(e => ({ iso: e.mySlot?.start ?? e.start, title: e.title, sub: e.unitName, registered: e.registered, projectId: e.projectId }));
  }
  const out: Session[] = [];
  for (const [projectId, acts] of ctx.activities) {
    for (const a of acts) {
      out.push({ iso: a.startDate, title: a.name, sub: a.location ?? a.kind,
        registered: a.status === 'registered' || !!a.slots?.some(s => s.mine), projectId });
    }
  }
  return out;
}

/**
 * Needs you: one row per project (or per unplaced session), its reasons as lines.
 * The row takes the tone, icon and target of its most urgent reason; at most four rows.
 */
function needsRows(ctx: Ctx, projects: ProjectVM[]): Array<{ label: string; reasons: Reason[] }> {
  const { t, state, lang } = ctx;
  const now = Date.now(), startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const rows = new Map<string, { label: string; reasons: Reason[] }>();
  const add = (key: string, label: string, r: Reason) => {
    const row = rows.get(key) ?? { label, reasons: [] };
    row.reasons.push(r);
    rows.set(key, row);
  };
  for (const p of projects.filter(x => x.status === 'ongoing')) {
    const end = Date.parse(p.endDate), left = end - now, closingSoon = left > 0 && left < 2 * DAY, key = String(p.id);
    if (closingSoon) {
      add(key, p.name, { rank: left < DAY ? 0 : 1, at: end, tone: left < DAY ? 'fail' : 'warn', icon: 'clock',
        text: t('home.why.deadline', { time: compactDuration(left, lang) }), go: () => openSheet(ctx, p.id) });
    }
    const last = ctx.graders.get(p.id)?.history.at(-1);
    if (last && last.total > last.passed) {
      add(key, p.name, { rank: closingSoon ? 1 : 2, at: now, tone: closingSoon ? 'fail' : 'warn', icon: 'beaker',
        text: counted(ctx, 'home.why.failing', last.total - last.passed), go: () => openProject(ctx, p.id, 'grader') });
    }
    const vm = ctx.readiness.get(p.id), failing = vm?.checks.filter(c => c.status === 'fail').length ?? 0;
    if (vm && !vm.stale && failing > 0) {
      add(key, p.name, { rank: 2, at: now, tone: 'warn', icon: 'checklist',
        text: counted(ctx, 'home.why.readiness', failing), go: () => openProject(ctx, p.id, 'prepare') });
    }
    const cs = state.commitStates?.[p.id];
    if (cs && (cs.dirty || (cs.ahead ?? 0) > 0)) {
      add(key, p.name, { rank: 3, at: now, tone: '', icon: 'git-commit',
        text: cs.dirty ? counted(ctx, 'home.why.dirty', cs.dirtyCount ?? 1) : counted(ctx, 'home.why.ahead', cs.ahead ?? 0),
        go: () => openProject(ctx, p.id, 'grader') });
    }
    if (!p.registered) {
      add(key, p.name, { rank: 4, at: end, tone: '', icon: 'add', text: t('home.why.notRegistered'), go: () => openSheet(ctx, p.id) });
    }
  }
  for (const [i, s] of sessionsOf(ctx).entries()) {
    const at = Date.parse(s.iso);
    if (!s.registered || at < startToday || at >= startToday + 2 * DAY) continue;
    const today = at < startToday + DAY;
    const r: Reason = { rank: today ? 1 : 2, at, tone: today ? 'warn' : '', icon: 'calendar',
      text: t(today ? 'home.why.today' : 'home.why.tomorrow', { time: timeOnly(s.iso, lang) }),
      go: () => s.projectId != null ? openProject(ctx, s.projectId, 'activities') : switchTab(ctx, 'agenda') };
    if (s.projectId != null) {
      const p = projects.find(x => x.id === s.projectId);
      if (p) add(String(p.id), p.name, r);
    } else {
      add(`s${i}`, s.title, r);
    }
  }
  return [...rows.values()]
    .map(row => ({ ...row, reasons: row.reasons.sort((a, b) => a.rank - b.rank || a.at - b.at) }))
    .sort((a, b) => a.reasons[0].rank - b.reasons[0].rank || a.reasons[0].at - b.reasons[0].at)
    .slice(0, 4);
}

function needsSection(ctx: Ctx, rows: Array<{ label: string; reasons: Reason[] }>): HTMLElement {
  return listGroup(ctx.t('home.needs'), ...rows.map(row => {
    const top = row.reasons[0];
    return listRow({
      icon: top.icon, tone: top.tone || undefined, label: row.label, onclick: top.go,
      detail: h('span.hm-lines', ...row.reasons.map(r => h('span', r.text))),
    });
  }));
}

function clearSection(ctx: Ctx, projects: ProjectVM[]): HTMLElement {
  const { t, lang } = ctx, next = nextDeadline(projects);
  return h('section.hm-sec', h('h2.hm-h', t('home.needs')),
    h('div.hm-clear', icon('pass-filled', 'hm-clear-ic'),
      h('div', h('strong', t('home.allClear')), h('p', t('home.allClearText')),
        h('p.hm-muted', next ? t('sb.closesNext', { name: next.name }) + ' ' + compactDuration(Date.parse(next.endDate) - Date.now(), lang) : t('home.noDeadline')))));
}

/** The project open in this window: name, time left, best score, tokens, and the grader run. */
function openSection(ctx: Ctx, projects: ProjectVM[]): HTMLElement {
  const { t, state } = ctx;
  const p = projects.find(x => x.id === state.currentProjectId);
  return h('section.hm-sec', h('h2.hm-h', t('home.here')), p ? openCard(ctx, p) : h('p.hm-muted', t('home.noOpen')));
}

function openCard(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx, g = ctx.graders.get(p.id), q = g?.quota ?? null;
  const rs = g ? runState(ctx, p, g) : null;
  const scores = (g?.history ?? []).map(r => r.score).filter((s): s is number => s != null);
  return h('article.hm-open',
    h('button.hm-open-head', { type: 'button', onclick: () => openSheet(ctx, p.id) },
      h('span.hm-open-name', p.name), h('span.hm-muted', p.unitName)),
    h('div.hm-time', h('span', t('home.timeLeft')), h('span.num', compactDuration(Date.parse(p.endDate) - Date.now(), lang))),
    h('div.hm-rail', h('span.hm-rail-fill', { style: { width: `${Math.round(progress(p.startDate, p.endDate) * 100)}%` } })),
    h('dl.hm-stats',
      h('div', h('dt', t('home.best')), h('dd.num', scores.length ? `${Math.max(...scores)}%` : '—')),
      h('div', h('dt', t('home.tokens')), h('dd.num', q ? `${q.remaining}/${q.total}` : '—'), q && tokenBlocks(q.remaining, q.total))),
    h('button.bb.bb-primary', { type: 'button', onclick: () => ctx.post({ type: 'runGrader', projectId: p.id }),
      disabled: rs?.disabled ?? true, title: rs?.hint ?? t('wait.grader') }, icon('play'), h('span', t('sb.run'))));
}

/** Coming up: the next three sessions the student is registered to, and project deadlines, across every project. */
function comingUp(ctx: Ctx, projects: ProjectVM[]): Soon[] {
  const now = Date.now(), out: Soon[] = [];
  for (const s of sessionsOf(ctx)) {
    const at = Date.parse(s.iso);
    if (s.registered && at > now) out.push({ at, iso: s.iso, title: s.title, sub: s.sub,
      go: () => s.projectId != null ? openProject(ctx, s.projectId, 'activities') : switchTab(ctx, 'agenda') });
  }
  for (const p of projects) {
    if (p.status === 'ongoing' && Date.parse(p.endDate) > now) {
      out.push({ at: Date.parse(p.endDate), iso: p.endDate, title: p.name, sub: ctx.t('home.deadline'), go: () => openProject(ctx, p.id) });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 3);
}

function soonSection(ctx: Ctx, soon: Soon[]): HTMLElement {
  const { t, lang } = ctx;
  const body = soon.length
    ? h('div.hm-stack', ...soon.map(s => {
      const d = new Date(s.iso);
      return h('button.hm-soon', { type: 'button', onclick: s.go },
        h('span.hm-day', h('b', String(d.getDate())), h('span', new Intl.DateTimeFormat(lang, { month: 'short' }).format(d))),
        h('span.hm-text', h('strong.ellipsis', s.title), h('span.hm-why', s.sub)),
        h('span.hm-soon-time', timeOnly(s.iso, lang)));
    }))
    : h('p.hm-muted', t('home.nothingSoon'));
  return h('section.hm-sec', h('h2.hm-h', t('home.comingUp')), body);
}

/** All projects: three counts, each one tap to the Projects tab on that column. */
function summarySection(ctx: Ctx, projects: ProjectVM[]): HTMLElement {
  const count = (s: ProjectVM['status']) => projects.filter(p => p.status === s).length;
  const rows = ([
    ['ongoing', 'home.rowOngoing', 'folder'],
    ['upcoming', 'home.rowUpcoming', 'clock'],
    ['past', 'home.rowPast', 'check'],
  ] as const).map(([col, label, ic]) => listRow({ icon: ic, label: ctx.t(label), meta: String(count(col)),
    onclick: () => { ctx.ui.boardColumn = col; switchTab(ctx, 'projects'); } }));
  return listGroup(ctx.t('home.all'), ...rows);
}
