import type { HostMessage, StateSnapshot, WebviewMessage } from '../shared/protocol';
import type { ValgrindCheck, ValgrindVM } from '../shared/types';
import { createT } from '../shared/i18n';
import type { Ctx, UiState } from './ctx';
import { clear, h, icon } from './dom';
import { relative } from './format';
import { renderProject } from './views/detail';
import { renderList } from './views/list';
import { renderAppearance } from './views/appearance';
import { resetStrips } from './views/strip';
import { resetTrends } from './views/trend';
import { resetAvatars } from './avatars';
import { renderHome } from './views/home';
import { renderLogin } from './views/login';
import { renderCalendar } from './views/calendar';
import { clearPdfHosts } from './views/subject';
import { classify, sortProjects } from '../domain/projects';
import { detailChoiceKey } from './sections';
import { renderAvailability, renderLensRestriction } from './views/availability';
import { hostTab } from './ctx';
import { notice } from './ui';
import { applyPalette } from './palette';
import { enterRoute, entrySince, reducedMotion, liveCountdown, markFresh, navigate, resetMotion, tickClocks, type NavDirection } from './motion';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): unknown; setState(state: unknown): void };
const vscode = acquireVsCodeApi();

const app = document.getElementById('app')!;
const surface = (document.body.dataset.surface as 'sidebar' | 'panel') ?? 'sidebar';
const fixedProjectId = document.body.dataset.projectId ? Number(document.body.dataset.projectId) : null;
const isHome = document.body.dataset.home === '1';
const isCalendar = document.body.dataset.calendar === '1';

const ui: UiState = { search: '', filter: 'all', showList: false, tab: null, selectedResult: {}, openTasks: new Set(), traceQuery: '', showFullTrace: false, comparisons: {} };

const emptyState: StateSnapshot = {
  auth: { status: 'signedOut', login: null, firstname: null, lastname: null, promotion: null, cursus: null, campus: null, expiresAt: null, busy: false, error: null, pending: null },
  projects: null,
  loading: true,
  error: null,
  currentProjectId: null,
  lastUpdated: null,
  lang: 'en',
  partialErrors: [],
};

let received = false;
const ctx: Ctx = {
  surface,
  home: isHome,
  fixedProjectId,
  lang: 'en',
  state: emptyState,
  ui,
  graders: new Map(),
  results: new Map(),
  subjects: new Map(),
  activities: new Map(),
  activityErrors: new Map(),
  activityPending: new Set(),
  activityLimits: new Map(),
  styleScans: new Map(),
  readiness: new Map(),
  functionRules: new Map(),
  reproductions: new Map(),
  guided: new Map(),
  comparisonFiles: new Map(),
  calendarSlots: new Map(),
  calendarPeople: new Map(),
  graderCommands: new Map(),
  avatars: new Map(),
  t: createT('en'),
  post: (msg: WebviewMessage) => vscode.postMessage(msg),
  rerender: () => schedule(),
  toast: (level, text) => showToast(level, text),
  // A glance (cards, rows) asks once for cached attempts; opening a project asks once for everything.
  loadProject: (id: number, peek = false) => {
    if (requested.has(id) || (peek && peeked.has(id))) return;
    (peek ? peeked : requested).add(id);
    ctx.post({ type: 'loadProject', projectId: id, ...(peek ? { peek: true } : {}) });
  },
};

// ───────────────────────── rendering ─────────────────────────

let frame = 0;
/** True while a view transition waits to swap the page; renders asked meanwhile run right after. */
let swapping = false, deferred = false;
function schedule(): void {
  if (swapping) { deferred = true; return; }
  if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }
}

const requested = new Set<number>(), peeked = new Set<number>();
let focused: number | null | undefined;
let lastRoute = '';
let pendingTab: UiState['tab'] = null;
const savedUi = vscode.getState() as { sections?: Record<string, boolean>; nav?: { project: number | null; tab: UiState['tab']; list: boolean } } | null;
if (surface === 'sidebar' && !isCalendar && savedUi?.nav) {
  ui.sidebarProject = typeof savedUi.nav.project === 'number' ? savedUi.nav.project : null;
  ui.showList = savedUi.nav.list === true;
  pendingTab = savedUi.nav.tab ?? null;
}
const detailsChoice = new Map<string, boolean>(Object.entries(savedUi?.sections ?? {}).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));

function route(): { key: string; node: HTMLElement } {
  const { t, state } = ctx;
  if (!received) {
    return { key: 'boot', node: h('div.empty', icon('loading', 'spin')) };
  }
  const unavailable = renderAvailability(ctx);
  if (unavailable) return unavailable;
  if (state.auth.status !== 'signedIn') {
    return { key: 'login', node: renderLogin(ctx) };
  }
  if (isCalendar) return { key: 'calendar', node: renderCalendar(ctx) };
  if (ui.page === 'appearance' && (isHome || surface === 'sidebar')) {
    return { key: 'appearance', node: renderAppearance(ctx) };
  }
  if (isHome) {
    return { key: 'home', node: renderHome(ctx, (id) => { if (!requested.has(id)) { requested.add(id); ctx.post({ type: 'loadProject', projectId: id }); } }) };
  }
  const projectId = fixedProjectId ?? (!ui.showList ? ui.sidebarProject ?? state.currentProjectId : null);
  if (projectId === null) {
    return { key: 'list', node: renderList(ctx) };
  }
  const project = state.projects?.find((p) => p.id === projectId);
  if (!project) {
    if (surface === 'sidebar' && ui.sidebarProject != null && state.projects) {
      // The pushed project is gone (another account, a new year): fall back to the overview.
      ui.sidebarProject = null;
      return route();
    }
    if (!state.projects) {
      return { key: `p${projectId}`, node: h('div.skeletons', h('div.card.skeleton', h('div.sk.w60'), h('div.sk.w80'))) };
    }
    return {
      key: `p${projectId}`,
      node: h('div.empty', icon('question'), h('p', t('detail.notFound')), surface === 'sidebar' ? h('button.btn', { onclick: () => ((ui.showList = true), ctx.rerender()) }, t('action.back')) : null),
    };
  }
  ctx.loadProject!(project.id);
  return { key: `p${project.id}`, node: renderProject(ctx, project) };
}

let lastView = '', lastDepth = -1, renderGen = 0;

function render(): void {
  const gen = ++renderGen;
  if (ctx.state.projects) ctx.state.projects = sortProjects(ctx.state.projects.map((p) => ({ ...p, status: classify(p.startDate, p.endDate) })));
  const scroller = app.querySelector<HTMLElement>('.scroll');
  const scrollTop = scroller?.scrollTop ?? 0;
  const active = document.activeElement as HTMLInputElement | null;
  const keep = active?.dataset?.keep;
  const selection = keep ? [active!.selectionStart, active!.selectionEnd] : null;
  const keptScroll = new Map<string, number>();
  app.querySelectorAll<HTMLElement>('[data-keep-scroll]').forEach(el => keptScroll.set(el.dataset.keepScroll!, el.scrollLeft));

  const shownProject = fixedProjectId ?? (!ui.showList ? ui.sidebarProject ?? ctx.state.currentProjectId : null);
  // Tell the host which project the sidebar shows in detail: only that one gets its delivery state polled.
  if (surface === 'sidebar' && ctx.state.auth.status === 'signedIn' && !isHome && !isCalendar && shownProject !== focused) {
    focused = shownProject;
    ctx.post({ type: 'focusProject', projectId: shownProject });
  }
  const nextKey = ctx.state.auth.status !== 'signedIn' ? 'login' : isHome ? 'home' : isCalendar ? 'calendar' : String(shownProject);
  const changedRoute = nextKey !== lastRoute;
  if (changedRoute) {
    ui.tab = null;
    ui.traceQuery = '';
    lastRoute = nextKey;
  }
  if (pendingTab) { ui.tab = pendingTab; pendingTab = null; }
  const { key, node } = route();

  // A view is a route plus, in the sidebar, the page pushed over it; views decide entrances and navigation.
  const project = key.startsWith('p');
  const view = surface === 'sidebar' && project ? `${key}/${ui.tab ?? ''}` : key;
  const depth = key === 'list' ? 0 : key === 'appearance' ? 1 : project ? (surface === 'sidebar' && ui.tab ? 2 : 1) : -1;
  const changedView = view !== lastView;
  if (changedView) enterRoute();
  const direction: NavDirection | null = changedView && surface === 'sidebar' && lastDepth >= 0 && depth >= 0
    ? depth > lastDepth ? 'push' : depth < lastDepth ? 'pop' : 'swap' : null;
  lastView = view;
  lastDepth = depth;
  const since = reducedMotion() ? null : entrySince();

  // Every surface enters the same way: anchored to when the view opened, so a re-render continues the entrance.
  const shell = h('div.shell', { class: `surface-${surface}${isHome ? ' surface-home' : ''}${since !== null ? ' sb-enter' : ''}` });
  if (since !== null) shell.style.setProperty('--since', `${since}ms`);
  // Loops (shimmer, network sweep) are anchored to the clock so a re-render continues them instead of restarting.
  shell.style.setProperty('--phase', `${-(Date.now() % 1600)}ms`);
  const net = ctx.state.network;
  if (surface === 'panel' && ctx.state.auth.status === 'signedIn' && ctx.state.availability?.myApiActive !== false) {
    shell.append(toolbar());
  }
  const paused = ctx.state.auth.status === 'signedIn' && net?.pausedUntil ? notice('warn', 'shield',
    h('span', ctx.t('net.paused'), ' ', h('b', liveCountdown(new Date(net.pausedUntil).toISOString())))) : null;
  const content = h('div.scroll', h('div.content', paused, renderLensRestriction(ctx), node));
  shell.append(content);

  const swap = () => {
    if (gen !== renderGen) return;
    // Same view: keep the very element that scrolls and only replace what is inside it. Rebuilding it would cut
    // a scroll in progress (wheel easing, trackpad inertia, a dragged scrollbar) and snap back to where it was
    // when this render started; re-renders are frequent while data arrives during entrances.
    const oldShell = app.firstElementChild as HTMLElement | null;
    const kept = !changedView && oldShell?.classList.contains('shell') ? oldShell.querySelector<HTMLElement>(':scope > .scroll') : null;
    let scroller: HTMLElement = content;
    if (oldShell && kept) {
      oldShell.className = shell.className;
      oldShell.style.cssText = shell.style.cssText;
      Array.from(oldShell.children).forEach(child => { if (child !== kept) child.remove(); });
      Array.from(shell.children).forEach(child => { if (child !== content) oldShell.insertBefore(child, kept); });
      kept.replaceChildren(...Array.from(content.childNodes));
      scroller = kept;
    } else {
      clear(app);
      app.append(shell);
      content.scrollTop = changedView ? 0 : scrollTop;
    }
    app.querySelectorAll<HTMLElement>('[data-keep-scroll]').forEach(el => { const left = keptScroll.get(el.dataset.keepScroll!); if (left) el.scrollLeft = left; });
    const nav = app.querySelector<HTMLElement>('.sb-nav');
    const stick = nav ? () => nav.classList.toggle('stuck', scroller.scrollTop > 36) : null;
    stick?.();
    // One handler per scroller, replaced on every render (not stacked).
    scroller.onscroll = stick;

    // Restore <details> the user toggled by hand.
    const scopeIndices = new Map<string, number>();
    app.querySelectorAll('details').forEach((d) => {
      const scope = d.parentElement?.closest<HTMLElement>('[data-detail-id]')?.dataset.detailId ?? ui.tab ?? 'overview';
      const index = scopeIndices.get(scope) ?? 0;
      scopeIndices.set(scope, index + 1);
      const k = detailChoiceKey(key, d.dataset.detailId ?? '', scope, index, d.className);
      d.dataset.k = k;
      if (detailsChoice.has(k)) {
        d.open = detailsChoice.get(k)!;
      }
    });
    if (keep) {
      const el = app.querySelector<HTMLInputElement>(`[data-keep="${keep}"]`);
      if (el) {
        el.focus();
        if (selection && selection[0] != null && typeof el.setSelectionRange === 'function') {
          el.setSelectionRange(selection[0], selection[1]);
        }
      }
    }
  };

  if (direction) {
    swapping = true;
    navigate(direction, () => {
      swapping = false;
      swap();
      if (deferred) { deferred = false; schedule(); }
    }, shell);
    // Should the transition never call back, never leave rendering frozen.
    setTimeout(() => { if (swapping) { swapping = false; swap(); if (deferred) { deferred = false; schedule(); } } }, 600);
  } else {
    swap();
  }
  if (changedView && surface === 'sidebar') persist();
}

/** Disclosure choices and, in the sidebar, where the user was; never grader traces or authentication data. */
function persist(): void {
  vscode.setState({
    sections: Object.fromEntries([...detailsChoice].slice(-500)),
    nav: surface === 'sidebar' && !isCalendar ? { project: ui.sidebarProject ?? null, tab: ui.tab, list: ui.showList } : undefined,
  });
}

/** One step back in the sidebar: a pushed page to its summary, a summary to the overview. */
function goBack(): boolean {
  if (ui.page && ctx.state.auth.status === 'signedIn') {
    ui.page = null;
    ui.paletteDraft = undefined;
    applyPalette(ctx.state.palette);
    schedule();
    return true;
  }
  if (surface !== 'sidebar' || ctx.state.auth.status !== 'signedIn') return false;
  if (ui.tab) { ui.tab = null; schedule(); return true; }
  if (!ui.showList && fixedProjectId === null && (ui.sidebarProject ?? ctx.state.currentProjectId) !== null) {
    ui.showList = true;
    ui.sidebarProject = null;
    schedule();
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;
  const typing = !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
  const back = (e.altKey && e.key === 'ArrowLeft' && !typing) || (e.key === 'Escape' && (!target || target === document.body));
  if (back && !document.querySelector('.menu:not([hidden])') && goBack()) e.preventDefault();
}, true);

app.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.tagName === 'DETAILS' && d.dataset.k) {
      detailsChoice.set(d.dataset.k, d.open);
      persist();
    }
  },
  true,
);

function toolbar(): HTMLElement {
  const { t, state, lang } = ctx;
  const logo = document.body.dataset.logo;
  return h(
    'div.toolbar',
    h('span.brand', logo ? h('img', { src: logo, alt: '', width: 16, height: 16 }) : icon('beaker'), 'Bananabox'),
    state.auth.login && h('span.who', state.auth.login),
    h('span.spacer'),
    state.lastUpdated && h('span', { title: new Date(state.lastUpdated).toLocaleString(lang) }, t('toolbar.updated', { when: relative(new Date(state.lastUpdated).toISOString(), lang) })),
    h('button.icon-btn', { title: t('action.refresh'), 'aria-label': t('action.refresh'), onclick: () => ctx.post({ type: 'refresh' }), disabled: state.loading }, icon(state.loading ? 'loading' : 'refresh', state.loading ? 'spin' : '')),
  );
}

// ───────────────────────── toasts ─────────────────────────

const toasts = h('div.toasts', { 'aria-live': 'polite' });
document.body.append(toasts);

function showToast(level: 'info' | 'warn' | 'error', text: string): void {
  const el = h('div.toast', { class: level, role: level === 'error' ? 'alert' : 'status' }, icon(level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info'), text);
  toasts.append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

// ───────────────────────── host messages ─────────────────────────

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const m = event.data;
  switch (m.type) {
    case 'selectTab':
      pendingTab = hostTab(m.tab);
      schedule();
      break;
    case 'state': {
      received = true;
      applyPalette(m.state.palette);
      if (m.state.lang !== ctx.lang) {
        ctx.lang = m.state.lang;
        ctx.t = createT(m.state.lang);
      }
      if (ctx.state.auth.status === 'signedIn' && (m.state.auth.status !== 'signedIn' || m.state.auth.login !== ctx.state.auth.login || m.state.availability?.myApiActive === false)) {
        requested.clear();
        peeked.clear();
        resetStrips();
        resetTrends();
        focused = undefined;
        ctx.graders.clear();
        ctx.results.clear();
        ctx.subjects.clear();
        ctx.activities.clear();
        ctx.activityErrors.clear();
        ctx.activityPending?.clear();
        ctx.activityLimits?.clear();
        ctx.styleScans.clear();
        ctx.valgrind?.clear();
        ui.valgrindDrafts = {};
        ctx.readiness.clear();
        ctx.functionRules.clear();
        ui.functionDrafts = {};
        ctx.reproductions.clear();
        ctx.guided.clear();
        ctx.comparisonFiles?.clear();
        ctx.graderCommands?.clear();
        resetAvatars(ctx);
        ui.commandDrafts = {};
        ui.comparisons = {};
        clearPdfHosts();
        lastSeenLatest.clear();
        ui.selectedResult = {};
        ui.openTasks.clear();
        detailsChoice.clear();
        resetMotion();
        ui.sidebarProject = null;
        vscode.setState({ sections: {} });
      }
      if (m.state.currentProjectId !== ctx.state.currentProjectId && m.state.currentProjectId !== null) {
        ui.showList = false;
        ui.sidebarProject = null;
      }
      document.documentElement.lang = m.state.lang;
      ctx.state = m.state;
      schedule();
      break;
    }
    case 'grader': {
      if (ctx.state.auth.status !== 'signedIn') break;
      ctx.graders.set(m.projectId, m.grader);
      const latest = m.grader.history[m.grader.history.length - 1];
      const selected = ui.selectedResult[m.projectId] ?? latest?.id;
      if (selected !== undefined && !ctx.results.has(selected)) {
        ctx.results.set(selected, { loading: true, detail: null, error: null });
        ctx.post({ type: 'loadResult', projectId: m.projectId, resultId: selected });
      }
      // A freshly finished run becomes the selection automatically.
      if (latest && ui.selectedResult[m.projectId] !== undefined && ui.selectedResult[m.projectId] !== latest.id && !m.grader.running && lastSeenLatest.get(m.projectId) !== latest.id && lastSeenLatest.has(m.projectId)) {
        ui.selectedResult[m.projectId] = latest.id;
        if (!ctx.results.has(latest.id)) {
          ctx.results.set(latest.id, { loading: true, detail: null, error: null });
          ctx.post({ type: 'loadResult', projectId: m.projectId, resultId: latest.id });
        }
      }
      if (latest) {
        // A result that lands while the view is open rises into the skyline; first loads stay still.
        if (lastSeenLatest.has(m.projectId) && lastSeenLatest.get(m.projectId) !== latest.id) {
          markFresh(m.projectId);
          setTimeout(schedule, 2700);
        }
        lastSeenLatest.set(m.projectId, latest.id);
      }
      schedule();
      break;
    }
    case 'result':
      if (ctx.state.auth.status !== 'signedIn') break;
      ctx.results.set(m.resultId, { loading: false, detail: m.detail, error: m.error });
      schedule();
      break;
    case 'comparisonFiles':
      if (ctx.state.auth.status !== 'signedIn') break;
      ctx.comparisonFiles?.set(`${m.projectId}:${m.before}:${m.after}`, { loading: false, files: m.files });
      schedule();
      break;
    case 'graderCommand':
      if (ctx.state.auth.status !== 'signedIn') break;
      if (!m.error && ctx.graderCommands?.get(m.projectId)?.pending) delete ui.commandDrafts?.[m.projectId];
      ctx.graderCommands?.set(m.projectId, { command: m.command, error: m.error });
      schedule();
      break;
    case 'avatars':
      for (const [login, src] of Object.entries(m.avatars ?? {})) if (typeof src === 'string' ? src.startsWith('data:image/') : src === null) ctx.avatars?.set(login, src);
      schedule();
      break;
    case 'subject':
      if (ctx.state.auth.status !== 'signedIn') break;
      ctx.subjects.set(m.projectId, m.subject);
      schedule();
      break;
    case 'activities':
      if (ctx.state.auth.status !== 'signedIn') break;
      ctx.activities.set(m.projectId, m.activities);
      if (m.limits) {
        ctx.activityLimits?.set(m.projectId, m.limits);
        const now = Date.now();
        for (const until of [m.limits.refreshAfter, m.limits.changeAfter]) {
          if (until > now) setTimeout(schedule, until - now + 50);
        }
      }
      if (m.pending) ctx.activityPending?.add(m.projectId);
      else ctx.activityPending?.delete(m.projectId);
      if (m.error) ctx.activityErrors.set(m.projectId, m.error);
      else ctx.activityErrors.delete(m.projectId);
      schedule();
      break;
    case 'valgrind':
      if (ctx.state.auth.status !== 'signedIn') break;
      {
        const map = ctx.valgrind ??= new Map(), before = map.get(m.projectId);
        // A check that just finished lands its bar on the skyline.
        const landedAt = before?.run?.status === 'running' && m.run?.status === 'done' ? Date.now() : before?.landedAt;
        // A check that lands is the one to read.
        if (landedAt !== before?.landedAt && ui.valgrindSelected) delete ui.valgrindSelected[m.projectId];
        // A run in flight posts its history without the reports: keep the ones already here.
        const reports = new Map<number, ValgrindVM | undefined>(((before?.history ?? []) as ValgrindCheck[]).filter(c => c.run).map(c => [c.at, c.run]));
        const history = m.history.map(c => c.run || !reports.has(c.at) ? c : { ...c, run: reports.get(c.at) });
        map.set(m.projectId, { command: m.command, run: m.run, history, landedAt,
          debug: m.debug !== undefined ? m.debug : before?.debug, building: m.building ?? before?.building });
      }
      schedule();
      break;
    case 'styleScan':
      if (ctx.state.auth.status !== 'signedIn') break;
      if (m.scan) ctx.styleScans.set(m.projectId, m.scan);
      else ctx.styleScans.delete(m.projectId);
      schedule();
      break;
    case 'toast':
      showToast(m.level, m.text);
      break;
    case 'readiness':
      if (ctx.state.auth.status !== 'signedIn') break;
      if (m.readiness) ctx.readiness.set(m.projectId, m.readiness);
      else ctx.readiness.delete(m.projectId);
      schedule();
      break;
    case 'calendar':
      if (ctx.calendar && !m.calendar.loading && ctx.calendar.loading) { ctx.calendarSlots.clear(); ctx.calendarPeople.clear(); }
      ctx.calendar = m.calendar;
      ctx.calendarRequested = undefined;
      schedule();
      break;
    case 'calendarPeople':
      ctx.calendarPeople.set(m.eventId, { loading: false, people: m.people, missing: m.missing, error: m.error });
      schedule();
      break;
    case 'calendarSlots':
      ctx.calendarSlots.set(m.eventId, { loading: false, slots: m.slots, error: m.error });
      schedule();
      break;
    case 'functionRules':
      if (ctx.state.auth.status !== 'signedIn') break;
      ctx.functionRules.set(m.projectId, { names: m.names, subject: m.subject, disabled: m.disabled });
      schedule();
      break;
    case 'reproduction':
      if (ctx.state.auth.status !== 'signedIn') break;
      if (m.reproduction) ctx.reproductions.set(m.projectId, m.reproduction);
      else ctx.reproductions.delete(m.projectId);
      schedule();
      break;
    case 'guided':
      if (ctx.state.auth.status !== 'signedIn') break;
      if (m.guided) ctx.guided.set(m.projectId, m.guided);
      else ctx.guided.delete(m.projectId);
      schedule();
      break;
  }
});

const lastSeenLatest = new Map<number, number>();

// Live clocks beat every second in place; no re-render.
setInterval(() => {
  if (document.visibilityState === 'visible' && received) tickClocks(app);
}, 1000);

// Keep countdowns and "x minutes ago" labels fresh without hammering the DOM.
setInterval(() => {
  if (document.visibilityState === 'visible' && received && ctx.state.auth.status === 'signedIn') {
    schedule();
  }
}, 30_000);

window.addEventListener('resize', () => schedule());

render();
vscode.postMessage({ type: 'ready', surface, projectId: fixedProjectId ?? undefined } satisfies WebviewMessage);
