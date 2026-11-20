import { h, icon } from './dom';
import { chip, notice, tabs, waitBlock } from './ui';
import { ring, sparkArea, stackBar } from './charts';
import { rollNumber, resetMotion } from './motion';
import { relative } from './format';
import { initialsOf } from './avatars';
import { timelineChart, versionBars } from './adminCharts';
import { createT } from '../shared/i18n';
import { matchesUsername, type RemoteFeature } from '../domain/remotePolicy';
import type {
  AdminHostMessage,
  AdminSnapshot,
  AdminViewState,
  AdminWebviewMessage,
  ListEntry,
  ReleaseStep,
} from '../shared/adminTypes';

declare function acquireVsCodeApi(): { postMessage(message: AdminWebviewMessage): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;

const FEATURES: readonly RemoteFeature[] = ['lens_active', 'my_api_active'];
type Tab = 'overview' | 'users' | 'moderation' | 'policy';
type PolicyKey = 'lens_active' | 'my_api_active';
type Child = Node | string | number | false | null | undefined | Child[];

const TAB_ICON: Record<Tab, string> = { overview: 'dashboard', users: 'organization', moderation: 'shield', policy: 'settings-gear' };
const FEATURE_ICON: Record<RemoteFeature, string> = { lens_active: 'eye', my_api_active: 'globe' };

let state: AdminViewState = { lang: 'en', phase: 'loading' };
let tab: Tab = 'overview';
/** Entrance motion plays when a page is first shown, not on every refresh. */
let animate = true;
let search = '';
/** Account whose inline ban form is open in the Users tab. */
let banning: string | null = null;
/** Switch waiting for its confirmation: turning a feature off hits every user. */
let confirming: PolicyKey | null = null;
const draft = {
  email: '',
  banName: '', banReason: '', banFeatures: new Set<RemoteFeature>(FEATURES),
  inlineReason: '', inlineFeatures: new Set<RemoteFeature>(FEATURES),
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
  const select = (next: Tab) => { tab = next; confirming = null; banning = null; animate = true; render(); };
  const off = FEATURES.filter((f) => !snapshot.policy[f]).length;
  const items: Array<{ id: Tab; label: string; icon: string; count?: number }> = [
    { id: 'overview', label: t('admin.nav.overview'), icon: TAB_ICON.overview },
    { id: 'users', label: t('admin.nav.users'), icon: TAB_ICON.users, count: snapshot.stats.users.length },
    { id: 'moderation', label: t('admin.nav.moderation'), icon: TAB_ICON.moderation, count: snapshot.banned.length },
    { id: 'policy', label: t('admin.nav.policy'), icon: TAB_ICON.policy, count: off },
  ];
  const body = { overview, users, moderation, policy }[tab](snapshot, t);
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

function overview(snapshot: AdminSnapshot, t: T): Child[] {
  const { stats } = snapshot;
  const upToDate = Math.max(0, stats.active - stats.obsolete_active);
  const added = stats.timeline.reduce((n, d) => n + d.new, 0);
  const peak = Math.max(1, ...stats.timeline.map((d) => d.new));
  const perInstall = stats.installs ? stats.launches / stats.installs : 0;
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

  const tiles = h('div.adm-tiles.adm-stagger',
    tile('installs', 'package', t('admin.kpi.installs'), stats.installs, t('admin.kpi.installsSub', { n: added }), '',
      sparkArea(stats.timeline.map((d) => (d.new / peak) * 100), { width: 120, height: 26, aria: t('admin.growth.aria') })),
    tile('launches', 'rocket', t('admin.kpi.launches'), stats.launches,
      t('admin.kpi.launchesSub', { n: perInstall.toLocaleString(state.lang, { maximumFractionDigits: 1 }) })),
    tile('obsolete', 'warning', t('admin.kpi.obsolete'), stats.obsolete_active,
      t('admin.kpi.obsoleteSub', { pct: percent(stats.obsolete_active, stats.active) }), stats.obsolete_active ? 'warn' : ''),
    tile('banned', 'circle-slash', t('admin.kpi.banned'), snapshot.banned.length,
      t('admin.kpi.bannedSub', { n: snapshot.authorized.length }), snapshot.banned.length ? 'bad' : ''));

  const growth = block(t('admin.growth.title'), { glyph: 'graph', hint: t('admin.growth.meta'), meta: h('span.adm-delta', icon('arrow-up'), t('admin.growth.total', { n: added })) },
    h('div.adm-pad',
      timelineChart(stats.timeline, { aria: t('admin.growth.aria'), tip: (day, created, seen) => t('admin.growth.tip', { day, created, seen }) }),
      h('div.adm-axis', h('span', dayLabel(stats.timeline[0]?.day)), h('span', dayLabel(stats.timeline.at(-1)?.day))),
      h('div.adm-legend', legendKey('bar', t('admin.growth.new')), legendKey('line', t('admin.growth.seen')))));

  const versions = block(t('admin.versions.title'), { glyph: 'versions', meta: h('span.adm-ver.now', stats.current_version), hint: t('admin.versions.hint') },
    h('div.adm-pad', stats.versions.length
      ? [versionBars(stats.versions, t('admin.versions.aria'), { active: t('admin.kpi.active'), installs: t('admin.kpi.installs') }, stats.current_version),
        h('div.adm-legend', legendKey('pass', t('admin.kpi.active')), legendKey('track', t('admin.kpi.installs')))]
      : empty('versions', t('admin.empty'))));

  const updates = block(t('admin.updates.title'), { glyph: 'cloud-download', meta: snapshot.updates.length || null },
    snapshot.updates.length
      ? h('ul.adm-list', snapshot.updates.map((u) => h('li.adm-li',
        h('span.adm-upd',
          h('span.adm-ver', u.from_version),
          icon('arrow-right', 'adm-arrow'),
          h('span.adm-ver', { class: u.to_version === stats.current_version ? 'now' : '' }, u.to_version)),
        h('span.adm-when', ago(u.at)))))
      : h('div.adm-pad', empty('cloud-download', t('admin.empty'))));

  return [hero, tiles, growth, versions, updates];
}

// ───────────────────────── users ─────────────────────────

const exact = (entries: ListEntry[], name: string) => entries.find((e) => e.name === name);
const matching = (entries: ListEntry[], name: string) => entries.filter((e) => matchesUsername(name, [e.name]));

/** Feature checkboxes drawn as toggle pills; the native input keeps keyboard and screen-reader support. */
function featurePills(t: T, chosen: Set<RemoteFeature>, name: string): HTMLElement {
  return h('div.adm-pills', { role: 'group', 'aria-label': t('admin.ban.restrict') }, FEATURES.map((feature) => h('label.adm-pill',
    h('input', { type: 'checkbox', name, checked: chosen.has(feature), disabled: state.busy, onchange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) chosen.add(feature); else chosen.delete(feature);
    } }),
    icon(FEATURE_ICON[feature]),
    h('span', featureLabel(t, feature)))));
}

function users(snapshot: AdminSnapshot, t: T): Child[] {
  const busy = !!state.busy;
  const list = h('ul.adm-list');
  const count = h('span');
  const total = snapshot.stats.users.length;
  const fill = () => {
    const needle = search.trim().toLowerCase();
    const shown = snapshot.stats.users.filter((name) => name.toLowerCase().includes(needle));
    count.textContent = needle ? `${shown.length} / ${total}` : String(total);
    count.title = t('admin.users.count', { shown: shown.length, total });
    list.replaceChildren(...(shown.length
      ? shown.map((name) => userRow(snapshot, name, t, busy))
      : [h('li', empty(needle ? 'search' : 'organization', needle ? t('admin.users.none') : t('admin.empty')))]));
  };
  const box = h('input.search', { id: 'adm-search', type: 'search', placeholder: t('admin.users.search'), 'aria-label': t('admin.users.search'), value: search, oninput: () => { search = box.value; fill(); } });
  fill();
  return [
    h('label.searchbar.adm-search.adm-rise', icon('search'), box),
    block(t('admin.users.title'), { glyph: 'organization', meta: count, hint: t('admin.users.hint') }, list),
  ];
}

function userRow(snapshot: AdminSnapshot, name: string, t: T, busy: boolean): HTMLElement {
  const own = exact(snapshot.banned, name);
  const bans = matching(snapshot.banned, name);
  const allowed = matching(snapshot.authorized, name).length > 0;
  const features = [...new Set(bans.flatMap((b) => b.features))];
  const open = banning === name;
  const toggle = () => {
    banning = open ? null : name;
    draft.inlineReason = '';
    draft.inlineFeatures = new Set(FEATURES);
    render();
  };
  const confirm = () => {
    if (!draft.inlineFeatures.size) return;
    send({ type: 'ban', name, features: [...draft.inlineFeatures], ...(draft.inlineReason && { reason: draft.inlineReason }) });
    banning = null;
  };
  const reason = input('adm-inline-reason', { maxLength: 200, placeholder: t('admin.ban.reason'), 'aria-label': t('admin.ban.reason') }, draft.inlineReason, (v) => { draft.inlineReason = v; });
  const tags = [
    allowed ? chip('pass', icon('verified'), t('admin.authorized')) : null,
    ...features.map((f) => chip('fail', icon(FEATURE_ICON[f]), featureLabel(t, f))),
  ].filter(Boolean);
  return h('li.adm-user', { class: `${bans.length ? 'banned' : allowed ? 'allowed' : ''} ${open ? 'open' : ''}` },
    h('div.adm-user-row',
      avatar(name, bans.length ? 'bad' : allowed ? 'good' : ''),
      h('div.adm-user-main',
        h('span.mono.adm-name', { title: name }, name),
        tags.length ? h('span.adm-chips', tags) : null,
        bans.length && !own ? h('span.adm-sub', t('admin.users.viaFragment', { fragment: bans.map((b) => b.name).join(', ') })) : null),
      own
        ? h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unban', id: own.id }) }, icon('unlock'), t('admin.unban'))
        : h('button.btn.ghost.small.adm-ban', { type: 'button', disabled: busy, 'aria-expanded': String(open), onclick: toggle }, icon(open ? 'chevron-up' : 'circle-slash'), t('admin.ban'))),
    open ? h('div.adm-inline',
      h('span.adm-label', t('admin.ban.restrict')),
      featurePills(t, draft.inlineFeatures, `inline-${name}`),
      reason,
      h('div.adm-actions',
        h('button.btn.danger.solid', { type: 'button', disabled: busy, onclick: confirm }, icon('circle-slash'), t('admin.ban.confirm', { name })),
        h('button.btn.ghost', { type: 'button', onclick: toggle }, t('admin.cancel')))) : null);
}

// ───────────────────────── moderation ─────────────────────────

function moderation(snapshot: AdminSnapshot, t: T): Child[] {
  const busy = !!state.busy;
  const name = input('adm-ban-name', { maxLength: 64, required: true, placeholder: 'login.name', autocomplete: 'off' }, draft.banName, (v) => { draft.banName = v; });
  const reason = input('adm-ban-reason', { maxLength: 200, placeholder: t('admin.ban.reason') }, draft.banReason, (v) => { draft.banReason = v; });
  const ban = (e: Event) => {
    e.preventDefault();
    if (!draft.banName.trim() || !draft.banFeatures.size) return;
    send({ type: 'ban', name: draft.banName.trim(), features: [...draft.banFeatures], ...(draft.banReason && { reason: draft.banReason }) });
    draft.banName = '';
    draft.banReason = '';
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
    block(t('admin.ban.title'), { glyph: 'circle-slash', hint: t('admin.ban.hint'), tone: 'danger' },
      h('form.adm-pad.adm-form', { onsubmit: ban },
        field(t('admin.ban.name'), name),
        h('div.adm-field', h('span.adm-label', t('admin.ban.restrict')), featurePills(t, draft.banFeatures, 'ban')),
        field(t('admin.ban.reason'), reason),
        h('button.btn.danger.solid.block', { type: 'submit', disabled: busy }, icon('circle-slash'), t('admin.ban')))),
    block(t('admin.banlist.title'), { glyph: 'shield', meta: snapshot.banned.length },
      snapshot.banned.length
        ? h('ul.adm-list', snapshot.banned.map((entry) => bannedRow(entry, t, busy)))
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

function bannedRow(entry: ListEntry, t: T, busy: boolean): HTMLElement {
  // A ban always keeps at least one feature; lifting every feature is "unban".
  const flip = (feature: RemoteFeature) => {
    const next = entry.features.includes(feature) ? entry.features.filter((f) => f !== feature) : [...entry.features, feature];
    if (next.length) send({ type: 'updateBan', id: entry.id, features: next });
  };
  return h('li.adm-user.banned',
    h('div.adm-user-row',
      avatar(entry.name, 'bad'),
      h('div.adm-user-main',
        h('span.mono.adm-name', { title: entry.name }, entry.name),
        h('span.adm-sub', t('admin.banlist.since', { when: ago(entry.created_at) }))),
      h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unban', id: entry.id }) }, icon('unlock'), t('admin.unban'))),
    h('div.adm-toggles', FEATURES.map((feature) => {
      const on = entry.features.includes(feature);
      return h('button.adm-toggle', {
        type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), disabled: busy || (on && entry.features.length === 1),
        title: on && entry.features.length === 1 ? t('admin.ban.lastFeature') : t('admin.ban.toggle'), onclick: () => flip(feature),
      }, icon(on ? 'circle-slash' : FEATURE_ICON[feature]), featureLabel(t, feature));
    })),
    entry.reason ? h('p.adm-reason', icon('quote'), entry.reason) : null);
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
  if (state.phase === 'login') { tab = 'overview'; confirming = null; banning = null; }
  render();
});
render();
send({ type: 'ready' });
