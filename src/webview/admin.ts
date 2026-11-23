import { h, icon } from './dom';
import { chip, notice, tabs, waitBlock } from './ui';
import { ring, sparkArea, stackBar } from './charts';
import { rollNumber, resetMotion } from './motion';
import { BAN_MAX_AHEAD as MAX_AHEAD, expiryOf, relative, type BanDuration } from './format';
import { initialsOf } from './avatars';
import { countBars, heatGrid, timelineChart, versionBars } from './adminCharts';
import { cumulative, donut, gauge, histogram, radialBars, scatter, sunburst, topWithOther, treemap } from './adminViz';
import { createT } from '../shared/i18n';
import { compareVersions, matchesGroup, type BanScope, type RemoteFeature } from '../domain/remotePolicy';
import type {
  AdminHostMessage,
  AdminSnapshot,
  AdminUser,
  AdminViewState,
  AdminWebviewMessage,
  ListEntry,
  ReleaseStep,
} from '../shared/adminTypes';

declare function acquireVsCodeApi(): { postMessage(message: AdminWebviewMessage): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;

const FEATURES: readonly RemoteFeature[] = ['lens_active', 'my_api_active'];
type Tab = 'overview' | 'cohorts' | 'graphs' | 'users' | 'moderation' | 'policy' | 'admins';
type PolicyKey = 'lens_active' | 'my_api_active';
type Child = Node | string | number | false | null | undefined | Child[];

const TAB_ICON: Record<Tab, string> = { overview: 'dashboard', cohorts: 'pie-chart', graphs: 'graph', users: 'organization', moderation: 'shield', policy: 'settings-gear', admins: 'key' };
const FEATURE_ICON: Record<RemoteFeature, string> = { lens_active: 'eye', my_api_active: 'globe' };

let state: AdminViewState = { lang: 'en', phase: 'loading' };
let tab: Tab = 'overview';
/** Entrance motion plays when a page is first shown, not on every refresh. */
let animate = true;
let search = '';
/** Person (user id) whose inline ban form is open in the Users tab. */
let banning: string | null = null;
/** Admin account waiting for the second click that removes it. */
let confirmingAdmin: number | null = null;
/** Switch waiting for its confirmation: turning a feature off hits every user. */
let confirming: PolicyKey | null = null;
const draft = {
  email: '',
  banName: '', banPerson: '', banReason: '', banFeatures: new Set<RemoteFeature>(FEATURES), banScope: 'uid' as BanScope, banAnonymous: false,
  banDuration: 'permanent' as BanDuration, banUntil: '',
  inlineReason: '', inlineFeatures: new Set<RemoteFeature>(FEATURES), inlineScope: 'uid' as BanScope, inlineAnonymous: false,
  inlineDuration: 'permanent' as BanDuration, inlineUntil: '',
  adminEmail: '', adminWhoami: '', whoamiEdits: {} as Record<number, string>,
  allowName: '', allowReason: '',
  releaseNotes: '',
};
/** VSIX chosen for the next release, and whether a file is dragged over the drop zone. */
let picked: File | null = null;
let dragging = false;
const RELEASE_STEPS: ReleaseStep[] = ['reading', 'account', 'creating', 'uploading', 'policy', 'apiJson'];

const send = (message: AdminWebviewMessage) => vscode.postMessage(message);

function render(): void {
  const t = createT(state.lang);
  document.documentElement.lang = state.lang;
  const enter = animate;
  animate = false;
  // Every host message re-renders the page: keep the scroll position and the field being typed into.
  const top = enter ? 0 : app.querySelector('.adm-scroll')?.scrollTop ?? 0;
  const active = document.activeElement instanceof HTMLInputElement && document.activeElement.id ? document.activeElement : null;
  const caret = active && active.type !== 'checkbox' ? [active.selectionStart, active.selectionEnd] : null;

  const page = h('div.admin', { class: enter ? 'admin-enter' : '' });
  if (state.busy) page.append(h('div.adm-busy', { role: 'progressbar', 'aria-label': t('admin.working') }));
  if (state.phase === 'loading') page.append(h('div.adm-loading', waitBlock(t('admin.loading'))));
  else if (state.phase === 'login' || !state.snapshot) page.append(loginPage(t));
  else page.append(dashboard(state.snapshot, t));
  const scroll = h('div.scroll.adm-scroll', page);
  app.replaceChildren(scroll);
  scroll.scrollTop = top;
  if (active) {
    const again = document.getElementById(active.id);
    if (again instanceof HTMLInputElement && !again.disabled) {
      again.focus();
      if (caret) again.setSelectionRange(caret[0], caret[1]);
    }
  }
  rise(page);
}

/** Staggers the entrance of the direct children of every `.adm-stagger` block. */
function rise(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.adm-stagger').forEach((block) =>
    [...block.children].forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i))));
}

type T = ReturnType<typeof createT>;

const featureLabel = (t: T, feature: RemoteFeature) => t(feature === 'lens_active' ? 'admin.feature.lens' : 'admin.feature.myApi');
const ago = (ms: number) => relative(new Date(ms).toISOString(), state.lang);
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function errorNotice(t: T): HTMLElement | null {
  const error = state.error;
  if (!error) return null;
  const key = `admin.error.${error.code}`;
  const text = t(key);
  return h('div.adm-rise', { role: 'alert' }, notice('error', 'error', text === key ? error.message : text));
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label.adm-field', h('span.adm-label', label), input);
}

function input(id: string, attrs: Record<string, unknown>, value: string, onInput: (value: string) => void): HTMLInputElement {
  const el = h('input.adm-input', { id, type: 'text', value, disabled: state.busy, ...attrs, oninput: () => onInput(el.value) });
  return el;
}

/** A raised card with an icon, a title, an optional hint below it and a value on the right. */
function block(title: string, o: { glyph: string; hint?: string; meta?: Child; tone?: string }, ...children: Child[]): HTMLElement {
  return h('section.panel.adm-block.adm-rise', { class: o.tone ?? '' },
    h('header.adm-block-head',
      h('span.adm-glyph', icon(o.glyph)),
      h('div.adm-block-titles', h('h2', title), o.hint ? h('span.adm-hint', o.hint) : null),
      o.meta !== undefined && o.meta !== null ? h('span.adm-block-meta', o.meta) : null),
    ...children);
}

function empty(glyph: string, text: string): HTMLElement {
  return h('div.adm-empty', icon(glyph), h('span', text));
}

function avatar(name: string, tone = ''): HTMLElement {
  return h('span.adm-avatar', { class: tone, 'aria-hidden': 'true' }, initialsOf('', name));
}

// ───────────────────────── login ─────────────────────────

function loginPage(t: T): HTMLElement {
  const email = input('adm-email', { type: 'email', autocomplete: 'username', required: true }, draft.email, (v) => { draft.email = v; });
  const password = h('input.adm-input', { type: 'password', id: 'adm-password', autocomplete: 'current-password', required: true, maxLength: 128, disabled: state.busy });
  const submit = (e: Event) => {
    e.preventDefault();
    if (state.busy) return;
    send({ type: 'login', email: email.value, password: password.value });
  };
  return h('div.login.adm-login.adm-stagger',
    h('div.login-hero.adm-rise',
      h('span.logo-halo', h('img.logo', { src: document.body.dataset.logo, alt: '', width: 56, height: 56 })),
      h('h1', 'Bananabox'),
      chip('accent', icon('shield'), t('admin.badge'))),
    h('form.panel.adm-login-card.adm-rise', { onsubmit: submit },
      h('div.adm-login-head', h('h2', t('admin.login.title')), h('p.adm-hint', t('admin.login.hint'))),
      errorNotice(t),
      field(t('admin.login.email'), email),
      field(t('admin.login.password'), password),
      h('button.btn.primary.big.block', { type: 'submit', disabled: state.busy }, icon(state.busy ? 'loading' : 'sign-in', state.busy ? 'spin' : ''), t('admin.login.submit'))),
    h('p.login-hint.adm-rise', icon('lock'), t('admin.login.secure')));
}

// ───────────────────────── dashboard shell ─────────────────────────

function dashboard(snapshot: AdminSnapshot, t: T): HTMLElement {
  const busy = !!state.busy;
  const select = (next: Tab) => { tab = next; confirming = null; banning = null; confirmingAdmin = null; animate = true; render(); };
  const off = FEATURES.filter((f) => !snapshot.policy[f]).length;
  const items: Array<{ id: Tab; label: string; icon: string; count?: number }> = [
    { id: 'overview', label: t('admin.nav.overview'), icon: TAB_ICON.overview },
    { id: 'cohorts', label: t('admin.nav.cohorts'), icon: TAB_ICON.cohorts },
    { id: 'graphs', label: t('admin.nav.graphs'), icon: TAB_ICON.graphs },
    { id: 'users', label: t('admin.nav.users'), icon: TAB_ICON.users, count: snapshot.stats.users.length },
    { id: 'moderation', label: t('admin.nav.moderation'), icon: TAB_ICON.moderation, count: snapshot.banned.length },
    { id: 'policy', label: t('admin.nav.policy'), icon: TAB_ICON.policy, count: off },
    { id: 'admins', label: t('admin.nav.admins'), icon: TAB_ICON.admins },
  ];
  const body = { overview, cohorts, graphs, users, moderation, policy, admins }[tab](snapshot, t);
  return h('div.adm-dashboard',
    h('header.adm-appbar',
      h('img.adm-logo', { src: document.body.dataset.logo, alt: '', width: 18, height: 18 }),
      h('span.adm-brand', 'Bananabox'),
      chip('accent', t('admin.badge')),
      h('span.spacer'),
      h('button.icon-btn', { type: 'button', title: t('admin.refresh'), 'aria-label': t('admin.refresh'), disabled: busy, onclick: () => send({ type: 'refresh' }) }, icon('refresh', busy ? 'spin' : '')),
      h('button.icon-btn', { type: 'button', title: t('admin.logout'), 'aria-label': t('admin.logout'), disabled: busy, onclick: () => { resetMotion(); send({ type: 'logout' }); } }, icon('sign-out'))),
    h('div.adm-title.adm-rise',
      h('h1', t(`admin.tab.${tab}`)),
      h('div.adm-meta',
        h('span.adm-meta-item.ellipsis', icon('account'), state.session?.email ?? ''),
        h('span.adm-meta-item', icon('history'), t('admin.updated', { when: ago(snapshot.fetchedAt) })))),
    h('nav.adm-nav', { class: off ? 'policy-off' : '' }, tabs(items, tab, select, t('admin.tabs'))),
    errorNotice(t),
    h('div.adm-body.adm-stagger', { role: 'tabpanel', 'aria-label': t(`admin.tab.${tab}`) }, body));
}

// ───────────────────────── overview ─────────────────────────

function tile(key: string, glyph: string, label: string, value: number, sub: string, tone = '', extra: Child = null): HTMLElement {
  return h('div.panel.adm-tile.adm-rise', { class: tone },
    h('span.adm-tile-label', icon(glyph), label),
    h('span.adm-tile-value', rollNumber(`kpi.${key}`, value)),
    extra,
    h('span.adm-tile-sub', sub));
}

const legendKey = (tone: string, label: string, value?: number) =>
  h('span.adm-key', { class: `k-${tone}` }, label, value !== undefined ? h('b', value) : null);

/** Charts side by side on a wide panel, stacked on a narrow one; a last odd chart takes the whole row. */
const grid = (...cells: Child[]) => h('div.adm-grid.adm-stagger', cells);

function overview(snapshot: AdminSnapshot, t: T): Child[] {
  const { stats } = snapshot;
  const added = stats.timeline.reduce((n, d) => n + d.new, 0);
  const peak = Math.max(1, ...stats.timeline.map((d) => d.new));
  const perInstall = stats.installs ? stats.launches / stats.installs : 0;
  const c = activityCharts(snapshot, t);

  const tiles = h('div.adm-tiles.adm-stagger',
    tile('installs', 'package', t('admin.kpi.installs'), stats.installs, t('admin.kpi.installsSub', { n: added }), '',
      sparkArea(stats.timeline.map((d) => (d.new / peak) * 100), { width: 120, height: 26, aria: t('admin.growth.aria') })),
    tile('launches', 'rocket', t('admin.kpi.launches'), stats.launches,
      t('admin.kpi.launchesSub', { n: perInstall.toLocaleString(state.lang, { maximumFractionDigits: 1 }) })),
    tile('obsolete', 'warning', t('admin.kpi.obsolete'), stats.obsolete_active,
      t('admin.kpi.obsoleteSub', { pct: percent(stats.obsolete_active, stats.active) }), stats.obsolete_active ? 'warn' : ''),
    tile('banned', 'circle-slash', t('admin.kpi.banned'), snapshot.banned.length,
      t('admin.kpi.bannedSub', { n: snapshot.authorized.length }), snapshot.banned.length ? 'bad' : ''));

  const updates = block(t('admin.updates.title'), { glyph: 'cloud-download', meta: snapshot.updates.length || null },
    snapshot.updates.length
      ? h('ul.adm-list', snapshot.updates.map((u) => h('li.adm-li',
        h('span.adm-upd',
          h('span.adm-ver', u.from_version),
          icon('arrow-right', 'adm-arrow'),
          h('span.adm-ver', { class: u.to_version === stats.current_version ? 'now' : '' }, u.to_version)),
        h('span.adm-when', ago(u.at)))))
      : h('div.adm-pad', empty('cloud-download', t('admin.empty'))));

  return [tiles, c.gauges, grid(c.cumulative, c.versionPie), grid(c.histogram, c.punch), grid(c.banPie, updates)];
}

// ───────────────────────── graphs ─────────────────────────

/** Every chart of the dashboard, by theme: the other tabs show a chosen few. */
function graphs(snapshot: AdminSnapshot, t: T): Child[] {
  const a = activityCharts(snapshot, t);
  const c = cohortCharts(snapshot, t);
  const section = (title: string, glyph: string, wide: Child[], cells: Child[]) =>
    [h('h2.adm-section.adm-rise', icon(glyph), title), ...wide, grid(...cells)];
  return [
    ...section(t('admin.graphs.activity'), 'pulse', [a.gauges], [a.hero, a.timeline, a.cumulative, a.histogram, a.banPie, a.punch]),
    ...section(t('admin.graphs.versions'), 'versions', [], [a.versionBars, a.versionPie, c.adoption]),
    ...section(t('admin.graphs.cohorts'), 'mortar-board', [c.heat],
      [c.promotions, c.campuses, c.radial, c.sunburst, c.campusPie, c.treemap, c.launches, c.scatter, c.cursus]),
  ];
}

const LAUNCH_BINS: Array<[number, number]> = [[1, 1], [2, 3], [4, 7], [8, 15], [16, 31], [32, 63], [64, Infinity]];

/** Installations, versions, launches and bans: every chart about activity, by name. */
function activityCharts(snapshot: AdminSnapshot, t: T) {
  const { stats } = snapshot;
  const people = stats.users;
  const upToDate = Math.max(0, stats.active - stats.obsolete_active);
  const added = stats.timeline.reduce((n, d) => n + d.new, 0);
  const dayLabel = (day: string | undefined) => day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString(state.lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : '';

  const hero = h('div.panel.adm-hero.adm-rise',
    ring(stats.installs ? stats.active / stats.installs : 0, {
      size: 88, stroke: 8, tone: 'pass', label: `${percent(stats.active, stats.installs)}%`, sub: t('admin.kpi.active'),
      aria: t('admin.ring.aria', { active: stats.active, installs: stats.installs }),
    }),
    h('div.adm-hero-body',
      h('span.adm-eyebrow', h('span.adm-live', { 'aria-hidden': 'true' }), t('admin.hero.title', { days: stats.active_window_days })),
      h('div.adm-hero-value', rollNumber('kpi.active', stats.active), h('small', t('admin.hero.of', { installs: stats.installs }))),
      stackBar([
        { value: upToDate, tone: 'pass', label: t('admin.mix.current') },
        { value: stats.obsolete_active, tone: 'warn', label: t('admin.kpi.obsolete') },
        { value: stats.inactive, tone: 'muted', label: t('admin.kpi.inactive') },
      ], t('admin.mix.aria')),
      h('div.adm-legend',
        legendKey('pass', t('admin.mix.current'), upToDate),
        legendKey('warn', t('admin.kpi.obsolete'), stats.obsolete_active),
        legendKey('muted', t('admin.kpi.inactive'), stats.inactive))));

  const timeline = block(t('admin.growth.title'), { glyph: 'graph', hint: t('admin.growth.meta'), meta: h('span.adm-delta', icon('arrow-up'), t('admin.growth.total', { n: added })) },
    h('div.adm-pad',
      timelineChart(stats.timeline, { aria: t('admin.growth.aria'), tip: (day, created, seen) => t('admin.growth.tip', { day, created, seen }) }),
      h('div.adm-axis', h('span', dayLabel(stats.timeline[0]?.day)), h('span', dayLabel(stats.timeline.at(-1)?.day))),
      h('div.adm-legend', legendKey('bar', t('admin.growth.new')), legendKey('line', t('admin.growth.seen')))));

  const versionList = block(t('admin.versions.title'), { glyph: 'versions', meta: h('span.adm-ver.now', stats.current_version), hint: t('admin.versions.hint') },
    h('div.adm-pad', stats.versions.length
      ? [versionBars(stats.versions, t('admin.versions.aria'), { active: t('admin.kpi.active'), installs: t('admin.kpi.installs') }, stats.current_version),
        h('div.adm-legend', legendKey('pass', t('admin.kpi.active')), legendKey('track', t('admin.kpi.installs')))]
      : empty('versions', t('admin.empty'))));

  const identified = people.filter((u) => u.promotion !== null || u.campus !== null).length;
  const banned = people.filter((u) => matching(snapshot.banned, u).length).length;
  const share = (part: number, whole: number) => (whole ? part / whole : 0);
  const g = (ratio: number, label: string, tone: 'pass' | 'warn' | 'fail' | 'accent') =>
    gauge(ratio, { label, tone, aria: `${label}: ${Math.round(ratio * 100)}%` });
  const gauges = block(t('admin.viz.gauges'), { glyph: 'dashboard', tone: 'viz-block', hint: t('admin.viz.gaugesHint') },
    h('div.adm-pad.viz-gauges',
      g(share(stats.active, stats.installs), t('admin.viz.activeShare'), 'pass'),
      g(share(stats.active - stats.obsolete_active, stats.active), t('admin.viz.upToDate'), stats.obsolete_active ? 'warn' : 'pass'),
      g(share(identified, people.length), t('admin.viz.identified'), 'accent'),
      g(share(banned, people.length), t('admin.viz.banned'), 'fail')));

  const versionPie = block(t('admin.viz.versionPie'), { glyph: 'pie-chart', tone: 'viz-block', hint: t('admin.viz.versionPieHint') },
    h('div.adm-pad', stats.installs
      ? donut(topWithOther(stats.versions.map((v) => ({ label: v.version, value: v.installs })), t('admin.viz.other')), {
        aria: t('admin.viz.versionPie'), center: String(stats.installs), sub: t('admin.kpi.installs'),
        tip: (s, pct) => t('admin.viz.sliceTip', { label: s.label, n: s.value, pct }),
      })
      : empty('pie-chart', t('admin.empty'))));

  const before = stats.installs - added;
  let running = before;
  const totals = stats.timeline.map((d) => (running += d.new));
  const cumulativeChart = block(t('admin.viz.cumulative'), { glyph: 'graph-line', tone: 'viz-block', meta: h('span.adm-delta', icon('arrow-up'), `+${added}`), hint: t('admin.viz.cumulativeHint') },
    h('div.adm-pad', cumulative(totals, { aria: t('admin.viz.cumulative'), tip: (i, v) => t('admin.viz.cumulativeTip', { day: stats.timeline[i].day, n: v }) })));

  const bins = LAUNCH_BINS.map(([lo, hi]) => ({
    label: hi === Infinity ? `${lo}+` : lo === hi ? String(lo) : `${lo}–${hi}`,
    value: people.filter((u) => u.launches >= lo && u.launches <= hi).length,
  }));
  const histo = block(t('admin.viz.histogram'), { glyph: 'graph', tone: 'viz-block', hint: t('admin.viz.histogramHint') },
    h('div.adm-pad', people.length
      ? histogram(bins, { aria: t('admin.viz.histogram'), tip: (b) => t('admin.viz.histogramTip', { label: b.label, n: b.value }) })
      : empty('graph', t('admin.empty'))));

  // When people last opened Bananabox, in the admin's local time: a weekday × 4-hour punch card.
  const day = (i: number) => new Intl.DateTimeFormat(state.lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  const days = Array.from({ length: 7 }, (_, i) => day(i));
  const hours = Array.from({ length: 6 }, (_, i) => `${i * 4}h`);
  const slot = (u: AdminUser) => { const d = new Date(u.last_seen); return [days[(d.getDay() + 6) % 7], hours[Math.floor(d.getHours() / 4)]]; };
  const punch = block(t('admin.viz.punch'), { glyph: 'calendar', tone: 'viz-block', hint: t('admin.viz.punchHint') },
    h('div.adm-pad', people.length
      ? heatGrid(days, hours, (r, c) => people.filter((u) => { const [a, b] = slot(u); return a === r && b === c; }).length,
        { aria: t('admin.viz.punch'), tip: (r, c, n) => t('admin.viz.punchTip', { day: r, hour: c, n }) })
      : empty('calendar', t('admin.empty'))));

  // What the bans target: one person, a promotion, a campus or a former account name. Nothing to show without bans.
  const scopes = [...bansByScope(snapshot.banned)];
  const banPie = snapshot.banned.length
    ? block(t('admin.viz.banPie'), { glyph: 'shield', tone: 'viz-block', hint: t('admin.viz.banPieHint') },
      h('div.adm-pad', donut(topWithOther(scopes.map(([scope, n]) => ({ label: t(`admin.scope.${scope}`), value: n })), t('admin.viz.other')), {
        aria: t('admin.viz.banPie'), center: String(snapshot.banned.length), sub: t('admin.kpi.banned'),
        tip: (s, pct) => t('admin.viz.sliceTip', { label: s.label, n: s.value, pct }),
      })))
    : null;

  return { hero, timeline, versionBars: versionList, gauges, versionPie, cumulative: cumulativeChart, histogram: histo, punch, banPie };
}

const bansByScope = (entries: ListEntry[]) => {
  const counts = new Map<BanScope, number>();
  for (const e of entries) counts.set(e.scope, (counts.get(e.scope) ?? 0) + 1);
  return counts;
};

// ───────────────────────── users ─────────────────────────

const SCOPES: readonly BanScope[] = ['uid', 'promotion', 'campus'];
const SCOPE_ICON: Record<BanScope, string> = { user: 'terminal', uid: 'account', promotion: 'mortar-board', campus: 'location' };
const DAY = 86_400_000;

/** "Zoé M.", or a short id for a person who never signed in. */
const personName = (t: T, u: AdminUser) =>
  [u.first_name, u.last_initial && `${u.last_initial}.`].filter(Boolean).join(' ') || t('admin.users.unnamed', { id: u.user_id.slice(0, 6) });
const isActive = (snapshot: AdminSnapshot, u: AdminUser) => u.last_seen >= snapshot.fetchedAt - snapshot.stats.active_window_days * DAY;

const exact = (entries: ListEntry[], user: AdminUser) => entries.find((e) => e.scope === 'uid' && e.name === user.user_id);
/** The bans that apply to this person: their id, their promotion and their campus. Former name fragments cannot be matched. */
const matching = (entries: ListEntry[], user: AdminUser) => entries.filter((e) => e.scope !== 'user'
  && matchesGroup({ scope: e.scope, value: e.name }, { ...user, userId: user.user_id }));

const promotionOf = (user: AdminUser) => (user.promotion === null ? null : `${user.cursus ? `${user.cursus.toLowerCase()}:` : ''}${user.promotion}`);
/** What a ban of this scope targets for this person; null when it was never reported. */
const targetOf = (user: AdminUser, scope: BanScope) => (scope === 'uid' ? user.user_id : scope === 'promotion' ? promotionOf(user) : scope === 'campus' ? user.campus : null);
const affected = (users: AdminUser[], scope: BanScope, name: string) =>
  scope === 'user' ? null : users.filter((u) => matchesGroup({ scope, value: name }, { ...u, userId: u.user_id })).length;

/** How the dashboard names a ban: the person for a uid ban, the promotion or campus otherwise. */
function banTitle(t: T, entry: ListEntry, users: AdminUser[]): string {
  if (entry.scope !== 'uid') return entry.name;
  const person = users.find((u) => u.user_id === entry.name);
  return entry.label ?? (person ? personName(t, person) : t('admin.users.unnamed', { id: entry.name.slice(0, 6) }));
}
const banLabel = (t: T, entry: ListEntry, users: AdminUser[]) =>
  (entry.scope === 'uid' ? banTitle(t, entry, users) : `${t(`admin.scope.${entry.scope}`)} ${entry.name}`);

/** Feature checkboxes drawn as toggle pills; the native input keeps keyboard and screen-reader support. */
function featurePills(t: T, chosen: Set<RemoteFeature>, name: string): HTMLElement {
  return h('div.adm-pills', { role: 'group', 'aria-label': t('admin.ban.restrict') }, FEATURES.map((feature) => h('label.adm-pill',
    h('input', { type: 'checkbox', name, checked: chosen.has(feature), disabled: state.busy, onchange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) chosen.add(feature); else chosen.delete(feature);
    } }),
    icon(FEATURE_ICON[feature]),
    h('span', featureLabel(t, feature)))));
}

/** Who a ban targets: one person, a whole promotion or a whole campus. */
function scopePicker(t: T, group: string, chosen: BanScope, available: (scope: BanScope) => boolean, pick: (scope: BanScope) => void): HTMLElement {
  return h('div.adm-pills', { role: 'radiogroup', 'aria-label': t('admin.ban.scope') }, SCOPES.map((scope) => h('label.adm-pill.pick',
    h('input', { type: 'radio', name: group, checked: scope === chosen, disabled: state.busy || !available(scope), onchange: () => pick(scope) }),
    icon(SCOPE_ICON[scope]),
    h('span', t(`admin.scope.${scope}`)))));
}

const DURATIONS: readonly BanDuration[] = ['permanent', '1h', '24h', '7d', '30d', 'custom'];

/** `datetime-local` wants the local wall-clock time without zone. */
const localInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fullDate = (ms: number) => new Date(ms).toLocaleString(state.lang, { dateStyle: 'medium', timeStyle: 'short' });

/** How long a ban lasts: permanent, a preset, or until a chosen date and time. */
function durationPicker(t: T, group: string, chosen: BanDuration, custom: string, pick: (d: BanDuration) => void, setCustom: (v: string) => void): HTMLElement {
  const now = Date.now();
  return h('div.adm-duration',
    h('div.adm-pills', { role: 'radiogroup', 'aria-label': t('admin.ban.duration') }, DURATIONS.map((d) => h('label.adm-pill.pick',
      h('input', { type: 'radio', name: group, checked: d === chosen, disabled: state.busy, onchange: () => pick(d) }),
      icon(d === 'permanent' ? 'lock' : d === 'custom' ? 'calendar' : 'watch'),
      h('span', t(`admin.ban.duration.${d}`))))),
    chosen === 'custom' ? h('input.adm-input', {
      type: 'datetime-local', id: `${group}-until`, value: custom, required: true, disabled: state.busy,
      min: localInput(now + 60_000), max: localInput(now + MAX_AHEAD), 'aria-label': t('admin.ban.until'),
      oninput: (e: Event) => { const el = e.target as HTMLInputElement; el.setCustomValidity(''); setCustom(el.value); },
    }) : null);
}

/** Resolves the picker at submit time; flags the date field and returns undefined when it is unusable. */
function submittedExpiry(t: T, group: string, choice: BanDuration, custom: string): number | null | undefined {
  const at = expiryOf(choice, custom);
  if (at === undefined) {
    const el = document.getElementById(`${group}-until`) as HTMLInputElement | null;
    el?.setCustomValidity(t('admin.ban.untilInvalid'));
    el?.reportValidity();
  }
  return at;
}

/** "Ends in 3 days" with the exact date in the tooltip, "Expired" once past, or "Permanent". */
function expiryChip(t: T, expiresAt: number | null): HTMLElement {
  if (expiresAt === null) return chip('muted', icon('lock'), t('admin.ban.permanent'));
  if (expiresAt <= Date.now()) return h('span', { title: fullDate(expiresAt) }, chip('muted', icon('history'), t('admin.ban.expired')));
  return h('span', { title: t('admin.ban.endsAt', { date: fullDate(expiresAt) }) }, chip('warn', icon('watch'), t('admin.ban.endsIn', { when: ago(expiresAt) })));
}

/** Hides the name of the admin who bans from the banned user. */
function anonymousPill(t: T, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  return h('label.adm-pill.pick', { title: t('admin.ban.anonymousHint') },
    h('input', { type: 'checkbox', checked, disabled: state.busy, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    icon('eye-closed'),
    h('span', t('admin.ban.anonymous')));
}

function users(snapshot: AdminSnapshot, t: T): Child[] {
  const busy = !!state.busy;
  const list = h('ul.adm-list');
  const count = h('span');
  const total = snapshot.stats.users.length;
  const fill = () => {
    const needle = search.trim().toLowerCase();
    const shown = snapshot.stats.users.filter((u) => [personName(t, u), u.campus, u.cursus, u.promotion].filter(Boolean).join(' ').toLowerCase().includes(needle));
    count.textContent = needle ? `${shown.length} / ${total}` : String(total);
    count.title = t('admin.users.count', { shown: shown.length, total });
    list.replaceChildren(...(shown.length
      ? shown.map((user) => userRow(snapshot, user, t, busy))
      : [h('li', empty(needle ? 'search' : 'organization', needle ? t('admin.users.none') : t('admin.empty')))]));
  };
  const box = h('input.search', { id: 'adm-search', type: 'search', placeholder: t('admin.users.search'), 'aria-label': t('admin.users.search'), value: search, oninput: () => { search = box.value; fill(); } });
  fill();
  return [
    h('label.searchbar.adm-search.adm-rise', icon('search'), box),
    block(t('admin.users.title'), { glyph: 'organization', meta: count, hint: t('admin.users.hint') }, list),
  ];
}

function userRow(snapshot: AdminSnapshot, user: AdminUser, t: T, busy: boolean): HTMLElement {
  const id = user.user_id;
  const name = personName(t, user);
  const own = exact(snapshot.banned, user);
  const bans = matching(snapshot.banned, user);
  const others = bans.filter((b) => b !== own);
  const features = [...new Set(bans.flatMap((b) => b.features))];
  const open = banning === id;
  const scope = draft.inlineScope;
  const target = targetOf(user, scope);
  const toggle = () => {
    banning = open ? null : id;
    draft.inlineReason = '';
    draft.inlineFeatures = new Set(FEATURES);
    draft.inlineScope = 'uid';
    draft.inlineAnonymous = false;
    draft.inlineDuration = 'permanent';
    draft.inlineUntil = '';
    render();
  };
  const confirm = () => {
    if (!draft.inlineFeatures.size || !target) return;
    const expiresAt = submittedExpiry(t, `inline-dur-${id}`, draft.inlineDuration, draft.inlineUntil);
    if (expiresAt === undefined) return;
    send({
      type: 'ban', name: target, scope, features: [...draft.inlineFeatures],
      ...(scope === 'uid' && { label: name }),
      ...(draft.inlineReason && { reason: draft.inlineReason }),
      ...(draft.inlineAnonymous && { anonymous: true }),
      ...(expiresAt !== null && { expiresAt }),
    });
    banning = null;
  };
  const reason = input('adm-inline-reason', { maxLength: 200, placeholder: t('admin.ban.reasonShown'), 'aria-label': t('admin.ban.reasonShown') }, draft.inlineReason, (v) => { draft.inlineReason = v; });
  const promotion = promotionOf(user);
  const identity = [
    promotion ? chip('muted', icon(SCOPE_ICON.promotion), promotion) : null,
    user.campus ? chip('muted', icon(SCOPE_ICON.campus), user.campus) : null,
    chip(isActive(snapshot, user) ? 'pass' : 'muted', h('span.mono', `v${user.version}`)),
  ].filter(Boolean);
  const tags = [
    ...features.map((f) => chip('fail', icon(FEATURE_ICON[f]), featureLabel(t, f))),
    // A person under a permanent ban stays banned whatever the temporary ones say: only show the ends that matter.
    ...(bans.some((b) => b.expires_at === null) ? [] : bans.map((b) => expiryChip(t, b.expires_at))),
  ];
  const what = (s: BanScope, value: string) => (s === 'uid' ? name : `${t(`admin.scope.${s}`)} ${value}`);
  return h('li.adm-user', { class: `${bans.length ? 'banned' : ''} ${open ? 'open' : ''}` },
    h('div.adm-user-row',
      avatar(name, bans.length ? 'bad' : ''),
      h('div.adm-user-main',
        h('span.adm-name', { title: t('admin.users.seen', { when: ago(user.last_seen), n: user.launches }) }, name),
        h('span.adm-chips', identity),
        tags.length ? h('span.adm-chips', tags) : null,
        others.length ? h('span.adm-sub', t('admin.users.via', { what: others.map((b) => what(b.scope, b.name)).join(', ') })) : null),
      own
        ? h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unban', id: own.id }) }, icon('unlock'), t('admin.unban'))
        : h('button.btn.ghost.small.adm-ban', { type: 'button', disabled: busy, 'aria-expanded': String(open), onclick: toggle }, icon(open ? 'chevron-up' : 'circle-slash'), t('admin.ban'))),
    open ? h('div.adm-inline',
      h('span.adm-label', t('admin.ban.scope')),
      scopePicker(t, `inline-scope-${id}`, scope, (s) => targetOf(user, s) !== null, (s) => { draft.inlineScope = s; render(); }),
      target && scope !== 'uid' ? h('span.adm-sub', t('admin.ban.affects', { what: what(scope, target), n: affected(snapshot.stats.users, scope, target) ?? 0 })) : null,
      h('span.adm-label', t('admin.ban.restrict')),
      featurePills(t, draft.inlineFeatures, `inline-${id}`),
      reason,
      anonymousPill(t, draft.inlineAnonymous, (v) => { draft.inlineAnonymous = v; }),
      h('span.adm-label', t('admin.ban.duration')),
      durationPicker(t, `inline-dur-${id}`, draft.inlineDuration, draft.inlineUntil, (d) => { draft.inlineDuration = d; render(); }, (v) => { draft.inlineUntil = v; }),
      h('div.adm-actions',
        h('button.btn.danger.solid', { type: 'button', disabled: busy || !target, onclick: confirm }, icon('circle-slash'), t('admin.ban.confirm', { name: target ? what(scope, target) : name })),
        h('button.btn.ghost', { type: 'button', onclick: toggle }, t('admin.cancel')))) : null);
}

// ───────────────────────── moderation ─────────────────────────

function moderation(snapshot: AdminSnapshot, t: T): Child[] {
  const busy = !!state.busy;
  const scope = draft.banScope;
  const known = snapshot.stats.users;
  const suggestions = scope === 'promotion'
    ? known.flatMap((u) => [promotionOf(u), u.promotion === null ? null : String(u.promotion)])
    : scope === 'campus' ? known.map((u) => u.campus) : [];
  const options = [...new Set(suggestions.filter((s): s is string => !!s))].sort();
  const person = known.find((u) => u.user_id === draft.banPerson);
  const target = scope === 'uid'
    ? h('select.adm-input', { id: 'adm-ban-person', disabled: busy, onchange: (e: Event) => { draft.banPerson = (e.target as HTMLSelectElement).value; } },
      h('option', { value: '', selected: !person }, t('admin.ban.pickPerson')),
      [...known].sort((a, b) => personName(t, a).localeCompare(personName(t, b))).map((u) => h('option', { value: u.user_id, selected: u === person },
        [personName(t, u), promotionOf(u), u.campus].filter(Boolean).join(' · '))))
    : input('adm-ban-name', {
      maxLength: 64, required: true, autocomplete: 'off', list: 'adm-ban-suggest',
      placeholder: scope === 'promotion' ? 'pge:2027' : 'Paris',
    }, draft.banName, (v) => { draft.banName = v; });
  const reason = input('adm-ban-reason', { maxLength: 200, placeholder: t('admin.ban.reasonShown') }, draft.banReason, (v) => { draft.banReason = v; });
  const ban = (e: Event) => {
    e.preventDefault();
    const picked = known.find((u) => u.user_id === draft.banPerson);
    const name = scope === 'uid' ? picked?.user_id : draft.banName.trim();
    if (!name || !draft.banFeatures.size) return;
    const expiresAt = submittedExpiry(t, 'ban-dur', draft.banDuration, draft.banUntil);
    if (expiresAt === undefined) return;
    send({
      type: 'ban', name, scope, features: [...draft.banFeatures],
      ...(scope === 'uid' && picked && { label: personName(t, picked) }),
      ...(draft.banReason && { reason: draft.banReason }),
      ...(draft.banAnonymous && { anonymous: true }),
      ...(expiresAt !== null && { expiresAt }),
    });
    draft.banName = '';
    draft.banPerson = '';
    draft.banReason = '';
    draft.banUntil = '';
  };
  const allowName = input('adm-allow-name', { maxLength: 64, required: true, placeholder: t('admin.ban.name'), 'aria-label': t('admin.ban.name'), autocomplete: 'off' }, draft.allowName, (v) => { draft.allowName = v; });
  const allowReason = input('adm-allow-reason', { maxLength: 200, placeholder: t('admin.ban.reason'), 'aria-label': t('admin.ban.reason') }, draft.allowReason, (v) => { draft.allowReason = v; });
  const allow = (e: Event) => {
    e.preventDefault();
    if (!draft.allowName.trim()) return;
    send({ type: 'authorize', name: draft.allowName.trim(), ...(draft.allowReason && { reason: draft.allowReason }) });
    draft.allowName = '';
    draft.allowReason = '';
  };
  return [
    block(t('admin.ban.title'), { glyph: 'circle-slash', hint: t(`admin.ban.hint.${scope}`), tone: 'danger' },
      h('form.adm-pad.adm-form', { onsubmit: ban },
        h('div.adm-field', h('span.adm-label', t('admin.ban.scope')),
          scopePicker(t, 'ban-scope', scope, (s) => s !== 'uid' || known.length > 0, (s) => { draft.banScope = s; draft.banName = ''; render(); })),
        field(t(`admin.ban.name.${scope}`), target),
        scope === 'uid' ? null : h('datalist', { id: 'adm-ban-suggest' }, options.map((value) => h('option', { value }))),
        h('div.adm-field', h('span.adm-label', t('admin.ban.restrict')), featurePills(t, draft.banFeatures, 'ban')),
        field(t('admin.ban.reasonShown'), reason),
        anonymousPill(t, draft.banAnonymous, (v) => { draft.banAnonymous = v; }),
        h('div.adm-field', h('span.adm-label', t('admin.ban.duration')),
          durationPicker(t, 'ban-dur', draft.banDuration, draft.banUntil, (d) => { draft.banDuration = d; render(); }, (v) => { draft.banUntil = v; })),
        h('button.btn.danger.solid.block', { type: 'submit', disabled: busy }, icon('circle-slash'), t('admin.ban')))),
    block(t('admin.banlist.title'), { glyph: 'shield', meta: snapshot.banned.length },
      snapshot.banned.length
        ? h('ul.adm-list', snapshot.banned.map((entry) => bannedRow(entry, known, t, busy)))
        : h('div.adm-pad', empty('pass', t('admin.banlist.empty')))),
    block(t('admin.allow.title'), { glyph: 'verified', hint: t('admin.allow.hint'), meta: snapshot.authorized.length },
      h('form.adm-pad.adm-form.adm-allow', { onsubmit: allow }, allowName, allowReason,
        h('button.btn.block', { type: 'submit', disabled: busy }, icon('add'), t('admin.allow.add'))),
      snapshot.authorized.length
        ? h('ul.adm-list', snapshot.authorized.map((entry) =>
          h('li.adm-user.allowed',
            h('div.adm-user-row',
              avatar(entry.name, 'good'),
              h('div.adm-user-main',
                h('span.mono.adm-name', { title: entry.name }, entry.name),
                h('span.adm-sub', t('admin.allow.since', { when: ago(entry.created_at) }))),
              h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unauthorize', id: entry.id }) }, icon('close'), t('admin.remove'))),
            entry.reason ? h('p.adm-reason', icon('quote'), entry.reason) : null)))
        : h('div.adm-pad', empty('verified', t('admin.allow.empty')))),
  ];
}

function bannedRow(entry: ListEntry, users: AdminUser[], t: T, busy: boolean): HTMLElement {
  // A ban always keeps at least one feature; lifting every feature is "unban".
  const flip = (feature: RemoteFeature) => {
    const next = entry.features.includes(feature) ? entry.features.filter((f) => f !== feature) : [...entry.features, feature];
    if (next.length) send({ type: 'updateBan', id: entry.id, features: next });
  };
  const reach = affected(users, entry.scope, entry.name);
  const sub = [
    t('admin.banlist.since', { when: ago(entry.created_at) }),
    t('admin.banlist.by', { who: entry.banned_by ?? t('admin.banlist.unknownBy') }),
    ...(entry.scope === 'promotion' || entry.scope === 'campus' ? [t('admin.banlist.affects', { n: reach ?? 0 })] : []),
  ].join(' · ');
  const title = banTitle(t, entry, users);
  return h('li.adm-user.banned',
    h('div.adm-user-row',
      entry.scope === 'uid' ? avatar(title, 'bad') : h('span.adm-avatar.bad', { 'aria-hidden': 'true' }, icon(SCOPE_ICON[entry.scope])),
      h('div.adm-user-main',
        h('span.adm-name', { class: entry.scope === 'uid' ? '' : 'mono', title: banLabel(t, entry, users) }, title),
        h('span.adm-chips', chip(entry.scope === 'user' ? 'warn' : 'muted', icon(SCOPE_ICON[entry.scope]), t(`admin.scope.${entry.scope}`)), expiryChip(t, entry.expires_at)),
        h('span.adm-sub', sub)),
      h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unban', id: entry.id }) }, icon('unlock'), t('admin.unban'))),
    h('div.adm-toggles',
      FEATURES.map((feature) => {
        const on = entry.features.includes(feature);
        return h('button.adm-toggle', {
          type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), disabled: busy || (on && entry.features.length === 1),
          title: on && entry.features.length === 1 ? t('admin.ban.lastFeature') : t('admin.ban.toggle'), onclick: () => flip(feature),
        }, icon(on ? 'circle-slash' : FEATURE_ICON[feature]), featureLabel(t, feature));
      }),
      h('button.adm-toggle.soft', {
        type: 'button', class: entry.anonymous ? 'on' : '', 'aria-pressed': String(entry.anonymous), disabled: busy,
        title: t('admin.ban.anonymousHint'), onclick: () => send({ type: 'updateBan', id: entry.id, anonymous: !entry.anonymous }),
      }, icon(entry.anonymous ? 'eye-closed' : 'eye'), t('admin.ban.anonymous'))),
    h('div.adm-toggles', durationActions(entry, t, busy)),
    entry.reason ? h('p.adm-reason', icon('quote'), entry.reason) : null);
}

/**
 * Quick changes to how long a ban lasts. Extending adds to the time left (from now if the end already passed);
 * a permanent ban is not "extended", it can only become temporary.
 */
function durationActions(entry: ListEntry, t: T, busy: boolean): HTMLElement[] {
  const set = (expiresAt: number | null) => send({ type: 'updateBan', id: entry.id, expiresAt });
  const action = (glyph: string, label: string, title: string, onclick: () => void) =>
    h('button.adm-toggle.soft', { type: 'button', disabled: busy, title, onclick }, icon(glyph), label);
  if (entry.expires_at === null) return [action('watch', t('admin.ban.makeTemporary'), t('admin.ban.makeTemporaryHint'), () => set(Date.now() + DAY))];
  const from = Math.max(entry.expires_at, Date.now());
  return [
    action('add', t('admin.ban.extend24h'), t('admin.ban.extendHint'), () => set(from + DAY)),
    action('add', t('admin.ban.extend7d'), t('admin.ban.extendHint'), () => set(Math.min(from + 7 * DAY, Date.now() + MAX_AHEAD))),
    action('lock', t('admin.ban.makePermanent'), t('admin.ban.makePermanentHint'), () => set(null)),
  ];
}

// ───────────────────────── cohorts ─────────────────────────

const countBy = <K>(items: AdminUser[], key: (u: AdminUser) => K | null) => {
  const groups = new Map<K, AdminUser[]>();
  for (const u of items) {
    const k = key(u);
    if (k === null) continue;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  return groups;
};

function cohorts(snapshot: AdminSnapshot, t: T): Child[] {
  const people = snapshot.stats.users;
  const known = people.filter((u) => u.promotion !== null || u.campus !== null);
  const byPromotion = [...countBy(people, (u) => u.promotion)].sort((a, b) => b[0] - a[0]);
  const byCampus = [...countBy(people, (u) => u.campus)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const byCursus = [...countBy(people, (u) => u.cursus?.toLowerCase() ?? null)].sort((a, b) => b[1].length - a[1].length);
  const top = byCampus[0];
  const c = cohortCharts(snapshot, t);

  const tiles = h('div.adm-tiles.adm-stagger',
    tile('identified', 'person', t('admin.cohorts.identified'), known.length, t('admin.cohorts.identifiedSub', { pct: percent(known.length, people.length), total: people.length })),
    tile('promotions', 'mortar-board', t('admin.cohorts.promotions'), byPromotion.length, byPromotion.length ? t('admin.cohorts.range', { from: byPromotion.at(-1)![0], to: byPromotion[0][0] }) : '—'),
    tile('campuses', 'location', t('admin.cohorts.campuses'), byCampus.length, top ? t('admin.cohorts.top', { campus: top[0], n: top[1].length }) : '—'),
    tile('cursus', 'library', t('admin.cohorts.cursus'), byCursus.length, byCursus.map(([name]) => name).join(' · ') || '—'));

  return [tiles, grid(c.sunburst, c.treemap), c.heat, grid(c.adoption, c.scatter)];
}

/** Promotions, campuses and cursus: every chart about who the users are, by name. */
function cohortCharts(snapshot: AdminSnapshot, t: T) {
  const people = snapshot.stats.users;
  const active = (u: AdminUser) => isActive(snapshot, u);
  const byPromotion = [...countBy(people, (u) => u.promotion)].sort((a, b) => b[0] - a[0]);
  const byCampus = [...countBy(people, (u) => u.campus)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const byCursus = [...countBy(people, (u) => u.cursus?.toLowerCase() ?? null)].sort((a, b) => b[1].length - a[1].length);
  const n = (v: number) => v.toLocaleString(state.lang, { maximumFractionDigits: 1 });
  const row = (label: string, group: AdminUser[]) => ({
    label, total: group.length, part: group.filter(active).length,
    title: t('admin.cohorts.tip', { label, total: group.length, active: group.filter(active).length }),
  });

  const legend = h('div.adm-legend', legendKey('pass', t('admin.kpi.active')), legendKey('track', t('admin.cohorts.people')));
  const promotions = block(t('admin.cohorts.byPromotion'), { glyph: 'mortar-board', hint: t('admin.cohorts.byPromotionHint') },
    h('div.adm-pad', byPromotion.length
      ? [countBars(byPromotion.map(([year, group]) => row(String(year), group)), t('admin.cohorts.byPromotion')), legend.cloneNode(true)]
      : empty('mortar-board', t('admin.cohorts.empty'))));
  const campuses = block(t('admin.cohorts.byCampus'), { glyph: 'location', hint: t('admin.cohorts.byCampusHint') },
    h('div.adm-pad', byCampus.length
      ? [countBars(byCampus.map(([campus, group]) => row(campus, group)), t('admin.cohorts.byCampus')), legend.cloneNode(true)]
      : empty('location', t('admin.cohorts.empty'))));

  // The 8 largest campuses by every promotion: where the users are.
  const rows = byCampus.slice(0, 8).map(([c]) => c);
  const cols = byPromotion.map(([y]) => String(y)).reverse();
  const heat = block(t('admin.cohorts.heat'), { glyph: 'table', hint: t('admin.cohorts.heatHint') },
    h('div.adm-pad', rows.length && cols.length
      ? heatGrid(rows, cols, (c, y) => people.filter((u) => u.campus === c && String(u.promotion) === y).length,
        { aria: t('admin.cohorts.heat'), tip: (c, y, count) => t('admin.cohorts.heatTip', { campus: c, year: y, n: count }) })
      : empty('table', t('admin.cohorts.empty'))));

  // Share of each promotion already on the required version: who lags behind the updates.
  const adoption = block(t('admin.cohorts.adoption'), { glyph: 'versions', hint: t('admin.cohorts.adoptionHint', { version: snapshot.stats.current_version }) },
    h('div.adm-pad', byPromotion.length
      ? [h('div.adm-adoption', byPromotion.map(([year, group]) => {
        const current = group.filter((u) => compareVersions(u.version, snapshot.stats.current_version) >= 0).length;
        return [
          h('span.mono', String(year)),
          stackBar([
            { value: current, tone: 'pass', label: t('admin.mix.current') },
            { value: group.length - current, tone: 'warn', label: t('admin.kpi.obsolete') },
          ], t('admin.cohorts.adoptionAria', { year })),
          h('span.adm-pct', `${percent(current, group.length)}%`),
        ];
      })), h('div.adm-legend', legendKey('pass', t('admin.mix.current')), legendKey('warn', t('admin.kpi.obsolete')))]
      : empty('versions', t('admin.cohorts.empty'))));

  // Activity rate per cursus, and how much each promotion launches Bananabox.
  const cursus = block(t('admin.cohorts.activity'), { glyph: 'pulse', hint: t('admin.cohorts.activityHint', { days: snapshot.stats.active_window_days }) },
    h('div.adm-pad', byCursus.length
      ? h('div.adm-rings', byCursus.map(([name, group]) => {
        const on = group.filter(active).length;
        return h('div.adm-ring',
          ring(group.length ? on / group.length : 0, { size: 72, stroke: 7, tone: 'pass', label: `${percent(on, group.length)}%`, aria: t('admin.cohorts.ringAria', { cursus: name, active: on, total: group.length }) }),
          h('strong', name), h('span', t('admin.cohorts.ringSub', { active: on, total: group.length })));
      }))
      : empty('pulse', t('admin.cohorts.empty'))));
  const launches = block(t('admin.cohorts.launches'), { glyph: 'rocket', hint: t('admin.cohorts.launchesHint') },
    h('div.adm-pad', byPromotion.length
      ? countBars(byPromotion.map(([year, group]) => {
        const avg = group.reduce((s, u) => s + u.launches, 0) / group.length;
        return { label: String(year), total: avg, title: t('admin.cohorts.launchesTip', { year, n: n(avg) }) };
      }), t('admin.cohorts.launches'), n)
      : empty('rocket', t('admin.cohorts.empty'))));

  const campusPie = block(t('admin.viz.campusPie'), { glyph: 'pie-chart', tone: 'viz-block', hint: t('admin.viz.campusPieHint') },
    h('div.adm-pad', byCampus.length
      ? donut(topWithOther(byCampus.map(([c, g]) => ({ label: c, value: g.length })), t('admin.viz.other')), {
        aria: t('admin.viz.campusPie'), center: String(byCampus.length), sub: t('admin.cohorts.campuses'),
        tip: (s, pct) => t('admin.viz.sliceTip', { label: s.label, n: s.value, pct }),
      })
      : empty('pie-chart', t('admin.cohorts.empty'))));

  const sun = block(t('admin.viz.sunburst'), { glyph: 'circle-large-outline', tone: 'viz-block', hint: t('admin.viz.sunburstHint') },
    h('div.adm-pad', byCursus.length
      ? sunburst(byCursus.map(([name, group]) => ({
        label: name, value: group.length,
        children: [...countBy(group, (u) => u.promotion)].sort((a, b) => a[0] - b[0]).map(([y, g]) => ({ label: String(y), value: g.length })),
      })), { aria: t('admin.viz.sunburst'), center: String(byCursus.length), sub: t('admin.cohorts.cursus'),
        tip: (path, count, pct) => t('admin.viz.sliceTip', { label: path, n: count, pct }) })
      : empty('circle-large-outline', t('admin.cohorts.empty'))));

  const tree = block(t('admin.viz.treemap'), { glyph: 'layout', tone: 'viz-block', hint: t('admin.viz.treemapHint') },
    h('div.adm-pad', byCampus.length
      ? treemap(byCampus.map(([c, g]) => ({ label: c, value: g.length, ratio: g.filter(active).length / g.length })), {
        aria: t('admin.viz.treemap'),
        tip: (label, count, ratio) => t('admin.viz.treemapTip', { label, n: count, pct: Math.round(ratio * 100) }),
      })
      : empty('layout', t('admin.cohorts.empty'))));

  const radial = block(t('admin.viz.radial'), { glyph: 'mortar-board', tone: 'viz-block', hint: t('admin.viz.radialHint') },
    byPromotion.length
      ? h('div.adm-pad.viz-pie', radialBars(byPromotion.slice(0, 8).map(([y, g]) => ({ label: String(y), value: g.length })), {
        aria: t('admin.viz.radial'), tip: (s) => t('admin.cohorts.tip', { label: s.label, total: s.value, active: byPromotion.find(([y]) => String(y) === s.label)![1].filter(active).length }),
      }))
      : h('div.adm-pad', empty('mortar-board', t('admin.cohorts.empty'))));

  const window = snapshot.stats.active_window_days;
  const dots = block(t('admin.viz.scatter'), { glyph: 'symbol-misc', tone: 'viz-block', hint: t('admin.viz.scatterHint', { days: window }) },
    h('div.adm-pad', people.length
      ? [scatter(people.map((u) => ({
        x: Math.max(0, (snapshot.fetchedAt - u.last_seen) / DAY), y: u.launches, active: active(u),
        tip: t('admin.viz.scatterTip', { name: personName(t, u), n: u.launches, when: ago(u.last_seen) }),
      })), { aria: t('admin.viz.scatter'), window, xLabel: (d) => t('admin.viz.daysAgo', { n: Math.round(d) }) }),
        h('div.adm-legend', legendKey('s1', t('admin.kpi.active')), legendKey('muted', t('admin.kpi.inactive')))]
      : empty('symbol-misc', t('admin.empty'))));

  return { promotions, campuses, heat, adoption, cursus, launches, campusPie, sunburst: sun, treemap: tree, radial, scatter: dots };
}

// ───────────────────────── admins ─────────────────────────

function admins(_snapshot: AdminSnapshot, t: T): Child[] {
  const busy = !!state.busy;
  if (!state.root) {
    const token = h('input.adm-input', { type: 'password', id: 'adm-root-token', autocomplete: 'off', required: true, maxLength: 512, disabled: busy, placeholder: t('admin.admins.token') });
    const unlock = (e: Event) => { e.preventDefault(); if (token.value.trim()) send({ type: 'rootUnlock', token: token.value }); };
    return [block(t('admin.admins.lockedTitle'), { glyph: 'key', hint: t('admin.admins.lockedHint') },
      h('form.adm-pad.adm-form', { onsubmit: unlock },
        field(t('admin.admins.token'), token),
        h('p.adm-hint', icon('lock'), ' ', t('admin.admins.tokenNote')),
        h('button.btn.primary.block', { type: 'submit', disabled: busy }, icon('unlock'), t('admin.admins.unlock'))))];
  }
  const accounts = state.root.admins;
  const email = input('adm-new-email', { type: 'email', required: true, maxLength: 128, placeholder: 'prenom.nom@epitech.eu', autocomplete: 'off' }, draft.adminEmail, (v) => { draft.adminEmail = v; });
  const whoami = input('adm-new-whoami', { required: true, maxLength: 64, placeholder: 'whoami', autocomplete: 'off' }, draft.adminWhoami, (v) => { draft.adminWhoami = v; });
  const password = h('input.adm-input', { type: 'password', id: 'adm-new-password', required: true, minLength: 12, maxLength: 128, autocomplete: 'new-password', disabled: busy });
  const create = (e: Event) => {
    e.preventDefault();
    if (!draft.adminEmail.trim() || !draft.adminWhoami.trim() || password.value.length < 12) return;
    send({ type: 'createAdmin', email: draft.adminEmail, whoami: draft.adminWhoami, password: password.value });
    draft.adminEmail = '';
    draft.adminWhoami = '';
  };
  return [
    block(t('admin.admins.title'), { glyph: 'key', meta: accounts.length, hint: t('admin.admins.hint') },
      h('div.adm-pad', h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'rootLock' }) }, icon('lock'), t('admin.admins.lock'))),
      h('ul.adm-list', accounts.map((account) => {
        const edit = input(`adm-whoami-${account.id}`, { maxLength: 64, placeholder: 'whoami', 'aria-label': t('admin.admins.whoami') },
          draft.whoamiEdits[account.id] ?? account.whoami ?? '', (v) => { draft.whoamiEdits[account.id] = v; });
        const removing = confirmingAdmin === account.id;
        return h('li.adm-user',
          h('div.adm-user-row',
            avatar(account.email.split('@')[0].replace('.', ' ')),
            h('div.adm-user-main',
              h('span.adm-name.ellipsis', { title: account.email }, account.email),
              h('span.adm-sub', [
                account.whoami ? `whoami ${account.whoami}` : t('admin.admins.noWhoami'),
                account.last_login ? t('admin.admins.lastLogin', { when: ago(account.last_login) }) : t('admin.admins.never'),
              ].join(' · '))),
            h('button.btn.ghost.small', { type: 'button', disabled: busy, class: removing ? 'danger' : '',
              onclick: () => { if (removing) { confirmingAdmin = null; send({ type: 'deleteAdmin', id: account.id }); } else { confirmingAdmin = account.id; render(); } } },
            icon(removing ? 'warning' : 'trash'), removing ? t('admin.admins.confirmRemove') : t('admin.remove'))),
          h('div.adm-admin-edit', edit,
            h('button.btn.small', { type: 'button', disabled: busy, onclick: () => {
              const value = (draft.whoamiEdits[account.id] ?? '').trim();
              if (value && value !== account.whoami) send({ type: 'setAdminWhoami', id: account.id, whoami: value });
            } }, icon('save'), t('admin.admins.save'))));
      }))),
    block(t('admin.admins.addTitle'), { glyph: 'person-add', hint: t('admin.admins.addHint') },
      h('form.adm-pad.adm-form', { onsubmit: create },
        field(t('admin.login.email'), email),
        field(t('admin.admins.whoami'), whoami),
        field(t('admin.admins.password'), password),
        h('button.btn.primary.block', { type: 'submit', disabled: busy }, icon('person-add'), t('admin.admins.add')))),
  ];
}

// ───────────────────────── policy ─────────────────────────

function policy(snapshot: AdminSnapshot, t: T): Child[] {
  const busy = !!state.busy;
  const { policy: current } = snapshot;
  const row = (key: PolicyKey, title: string, hint: string) => {
    const on = current[key];
    const pending = confirming === key;
    const apply = (value: boolean) => { confirming = null; send({ type: 'setPolicy', [key]: value }); };
    return h('div.adm-switch-row', { class: `${on ? 'on' : 'off'} ${pending ? 'pending' : ''}` },
      h('span.adm-feature', icon(FEATURE_ICON[key])),
      h('div.adm-switch-text',
        h('strong', title),
        h('span.adm-hint', hint),
        h('span.adm-state', h('i', { 'aria-hidden': 'true' }), on ? t('admin.policy.live') : t('admin.policy.cut'))),
      h('button.adm-switch', {
        type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': title, disabled: busy,
        onclick: () => { if (on) { confirming = pending ? null : key; render(); } else apply(true); },
      }, h('span.adm-knob')),
      pending ? h('div.adm-confirm', { role: 'alertdialog', 'aria-label': t('admin.policy.confirmTitle') },
        h('p', icon('warning'), t('admin.policy.confirm', { feature: title })),
        h('div.adm-actions',
          h('button.btn.danger.solid', { type: 'button', disabled: busy, onclick: () => apply(false) }, icon('debug-disconnect'), t('admin.policy.disable')),
          h('button.btn.ghost', { type: 'button', onclick: () => { confirming = null; render(); } }, t('admin.cancel')))) : null);
  };
  const allOn = current.lens_active && current.my_api_active;
  return [
    h('div.adm-status.adm-rise', { class: allOn ? 'ok' : 'warn', role: 'status' },
      icon(allOn ? 'pass-filled' : 'warning'), h('span', allOn ? t('admin.policy.allOn') : t('admin.policy.off'))),
    block(t('admin.policy.title'), { glyph: 'settings-gear', hint: t('admin.policy.hint') },
      h('div.adm-switches',
        row('lens_active', t('admin.feature.lens'), t('admin.policy.lensHint')),
        row('my_api_active', t('admin.feature.myApi'), t('admin.policy.myApiHint')))),
    block(t('admin.versions.title'), { glyph: 'versions' },
      h('div.adm-pad.adm-facts',
        h('div.adm-fact', h('span.adm-label', t('admin.policy.required')), h('span.adm-fact-value.mono', current.version)),
        h('div.adm-fact', h('span.adm-label', t('admin.policy.latest')), h('span.adm-fact-value.mono', current.latest)))),
    releaseBlock(t),
  ];
}

function releaseBlock(t: T): HTMLElement {
  const release = state.release;
  const publishing = !!release && release.step !== 'done' && release.step !== 'error';
  const choose = (file: File | undefined) => {
    if (!file || publishing) return;
    picked = file.name.toLowerCase().endsWith('.vsix') ? file : null;
    render();
  };
  const fileInput = h('input', { type: 'file', accept: '.vsix', hidden: true, onchange: (e: Event) => choose((e.target as HTMLInputElement).files?.[0]) });
  const publish = () => {
    const file = picked;
    if (!file || publishing) return;
    const reader = new FileReader();
    reader.onload = () => send({ type: 'publishRelease', file: file.name, data: String(reader.result).split(',')[1] ?? '', notes: draft.releaseNotes });
    reader.readAsDataURL(file);
    picked = null;
  };
  const at = release ? RELEASE_STEPS.indexOf(release.failed ?? release.step) : -1;
  return block(t('admin.release.title'), { glyph: 'cloud-upload', hint: t('admin.release.hint') },
    h('div.adm-pad.adm-release',
      h('label.adm-drop', {
        class: `${dragging ? 'over' : ''} ${publishing ? 'disabled' : ''}`,
        ondragover: (e: DragEvent) => { e.preventDefault(); if (!dragging) { dragging = true; render(); } },
        ondragleave: () => { dragging = false; render(); },
        ondrop: (e: DragEvent) => { e.preventDefault(); dragging = false; choose(e.dataTransfer?.files[0]); },
      },
        icon('package'),
        h('strong', picked ? picked.name : t('admin.release.drop')),
        h('span.adm-hint', picked ? t('admin.release.size', { mb: (picked.size / 1048576).toFixed(1) }) : t('admin.release.browse')),
        fileInput),
      h('textarea.adm-input.adm-notes', { id: 'adm-release-notes', rows: 4, placeholder: t('admin.release.notes'), disabled: publishing,
        value: draft.releaseNotes, oninput: (e: Event) => { draft.releaseNotes = (e.target as HTMLTextAreaElement).value; } }),
      h('div.adm-actions',
        h('button.btn.primary', { type: 'button', disabled: !picked || publishing || !!state.busy, onclick: publish },
          icon(publishing ? 'loading' : 'rocket', publishing ? 'spin' : ''), t('admin.release.publish'))),
      release && h('ol.adm-steps', { 'aria-label': release.file },
        RELEASE_STEPS.map((step, i) => {
          const done = release.step === 'done' || i < at;
          const failed = release.step === 'error' && i === at;
          return h('li', { class: done ? 'done' : failed ? 'failed' : i === at ? 'current' : '' },
            icon(done ? 'pass-filled' : failed ? 'error' : i === at ? 'loading' : 'circle-large-outline', i === at && publishing ? 'spin' : ''),
            t(`admin.release.step.${step}`, { version: release.version ?? '' }));
        })),
      release?.step === 'error' && notice('error', 'error', release.error ?? ''),
      release?.step === 'done' && notice('accent', 'pass-filled', h('span', t('admin.release.done', { version: release.version ?? '' })),
        release.url && h('a', { href: release.url }, t('admin.release.open')))));
}

// ───────────────────────── wiring ─────────────────────────

window.addEventListener('message', (event: MessageEvent<AdminHostMessage>) => {
  if (event.data?.type !== 'state') return;
  const previous = state;
  state = event.data.state;
  if (previous.phase !== state.phase) animate = true;
  if (state.phase === 'login') { tab = 'overview'; confirming = null; banning = null; confirmingAdmin = null; }
  render();
});
render();
send({ type: 'ready' });
