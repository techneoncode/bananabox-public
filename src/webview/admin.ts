import { h, icon } from './dom';
import { chip, notice, section, tabs, waitBlock } from './ui';
import { ring } from './charts';
import { rollNumber, resetMotion } from './motion';
import { relative } from './format';
import { timelineChart, versionBars } from './adminCharts';
import { createT } from '../shared/i18n';
import { matchesUsername, type RemoteFeature } from '../domain/remotePolicy';
import type {
  AdminHostMessage,
  AdminSnapshot,
  AdminViewState,
  AdminWebviewMessage,
  ListEntry,
} from '../shared/adminTypes';

declare function acquireVsCodeApi(): { postMessage(message: AdminWebviewMessage): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;

const FEATURES: readonly RemoteFeature[] = ['lens_active', 'my_api_active'];
type Tab = 'overview' | 'users' | 'moderation' | 'policy';
type PolicyKey = 'lens_active' | 'my_api_active';

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
};

const send = (message: AdminWebviewMessage) => vscode.postMessage(message);

function render(): void {
  const t = createT(state.lang);
  document.documentElement.lang = state.lang;
  const enter = animate;
  animate = false;
  const page = h('div.admin', { class: enter ? 'admin-enter' : '' });
  if (state.busy) page.append(h('div.adm-busy', { role: 'progressbar', 'aria-label': t('admin.working') }));
  if (state.phase === 'loading') page.append(waitBlock(t('admin.loading')));
  else if (state.phase === 'login' || !state.snapshot) page.append(loginPage(t));
  else page.append(dashboard(state.snapshot, t));
  app.replaceChildren(page);
  rise(page);
}

/** Staggers the entrance of the direct children of every `.adm-stagger` block. */
function rise(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.adm-stagger').forEach((block) =>
    [...block.children].forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i))));
}

type T = ReturnType<typeof createT>;

const featureLabel = (t: T, feature: RemoteFeature) => t(feature === 'lens_active' ? 'admin.feature.lens' : 'admin.feature.myApi');

function errorNotice(t: T): HTMLElement | null {
  const error = state.error;
  if (!error) return null;
  const key = `admin.error.${error.code}`;
  const text = t(key);
  return h('div', { role: 'alert' }, notice('error', 'error', text === key ? error.message : text));
}

// ───────────────────────── login ─────────────────────────

function loginPage(t: T): HTMLElement {
  const email = h('input.adm-input', { type: 'email', id: 'adm-email', autocomplete: 'username', required: true, value: draft.email, disabled: state.busy, oninput: () => { draft.email = email.value; } });
  const password = h('input.adm-input', { type: 'password', id: 'adm-password', autocomplete: 'current-password', required: true, maxLength: 128, disabled: state.busy });
  const submit = (e: Event) => {
    e.preventDefault();
    if (state.busy) return;
    send({ type: 'login', email: email.value, password: password.value });
  };
  return h('form.adm-login.adm-stagger', { onsubmit: submit },
    h('div.adm-login-head', icon('shield'), h('h1', t('admin.login.title'))),
    h('p.muted.small', t('admin.login.hint')),
    errorNotice(t),
    h('label.adm-field', h('span', t('admin.login.email')), email),
    h('label.adm-field', h('span', t('admin.login.password')), password),
    h('button.btn.primary', { type: 'submit', disabled: state.busy }, icon('sign-in'), t('admin.login.submit')));
}

// ───────────────────────── dashboard shell ─────────────────────────

function dashboard(snapshot: AdminSnapshot, t: T): HTMLElement {
  const busy = !!state.busy;
  const select = (next: Tab) => { tab = next; confirming = null; banning = null; animate = true; render(); };
  const items: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: t('admin.tab.overview') },
    { id: 'users', label: t('admin.tab.users') },
    { id: 'moderation', label: t('admin.tab.moderation') },
    { id: 'policy', label: t('admin.tab.policy') },
  ];
  const body = { overview, users, moderation, policy }[tab](snapshot, t);
  return h('div.adm-dashboard',
    h('header.adm-head',
      h('div.adm-who', h('strong', t('admin.title')), h('span.muted.small.adm-email', state.session?.email ?? '')),
      h('div.adm-tools',
        h('button.icon-btn', { type: 'button', title: t('admin.refresh'), 'aria-label': t('admin.refresh'), disabled: busy, onclick: () => send({ type: 'refresh' }) }, icon('refresh')),
        h('button.icon-btn', { type: 'button', title: t('admin.logout'), 'aria-label': t('admin.logout'), disabled: busy, onclick: () => { resetMotion(); send({ type: 'logout' }); } }, icon('sign-out')))),
    errorNotice(t),
    tabs(items, tab, select, t('admin.tabs')),
    h('div.adm-body', { role: 'tabpanel' }, body),
    h('p.muted.small.adm-updated', t('admin.updated', { when: relative(new Date(snapshot.fetchedAt).toISOString(), state.lang) })));
}

// ───────────────────────── overview ─────────────────────────

function kpi(key: string, label: string, value: number, tone = ''): HTMLElement {
  return h('div.adm-kpi.adm-rise', { class: tone }, h('span.adm-kpi-value', rollNumber(`kpi.${key}`, value)), h('span.adm-kpi-label', label));
}

function overview(snapshot: AdminSnapshot, t: T): HTMLElement {
  const { stats } = snapshot;
  const ratio = stats.installs ? stats.active / stats.installs : 0;
  return h('div.adm-page',
    h('div.adm-hero.adm-rise',
      ring(ratio, { size: 92, stroke: 9, tone: 'pass', label: `${Math.round(ratio * 100)}%`, sub: t('admin.kpi.active'), aria: t('admin.ring.aria', { active: stats.active, installs: stats.installs }) }),
      h('div.adm-hero-text', h('strong', t('admin.hero.title', { days: stats.active_window_days })), h('span.muted.small', t('admin.hero.sub', { active: stats.active, installs: stats.installs })))),
    h('div.adm-kpis.adm-stagger',
      kpi('installs', t('admin.kpi.installs'), stats.installs),
      kpi('active', t('admin.kpi.active'), stats.active, 'good'),
      kpi('inactive', t('admin.kpi.inactive'), stats.inactive),
      kpi('obsolete', t('admin.kpi.obsolete'), stats.obsolete_active, stats.obsolete_active ? 'warn' : ''),
      kpi('launches', t('admin.kpi.launches'), stats.launches),
      kpi('banned', t('admin.kpi.banned'), snapshot.banned.length, snapshot.banned.length ? 'bad' : '')),
    section(t('admin.growth.title'), { meta: t('admin.growth.meta') },
      h('div.adm-card.adm-rise',
        timelineChart(stats.timeline, { aria: t('admin.growth.aria'), tip: (day, created, seen) => t('admin.growth.tip', { day, created, seen }) }),
        h('div.adm-legend', h('span.adm-key.k-bar', t('admin.growth.new')), h('span.adm-key.k-line', t('admin.growth.seen'))),
        h('div.adm-axis', h('span.muted.small', stats.timeline[0]?.day ?? ''), h('span.muted.small', stats.timeline.at(-1)?.day ?? '')))),
    section(t('admin.versions.title'), { meta: t('admin.versions.current', { version: stats.current_version }) },
      h('div.adm-card.adm-rise', stats.versions.length
        ? versionBars(stats.versions, t('admin.versions.aria'), { active: t('admin.kpi.active'), installs: t('admin.kpi.installs') })
        : h('p.muted.small', t('admin.empty')))),
    section(t('admin.updates.title'), {},
      snapshot.updates.length
        ? h('ul.adm-list.adm-rise', snapshot.updates.map((u) =>
          h('li.adm-row', h('span.mono', `${u.from_version} → ${u.to_version}`), h('span.muted.small', relative(new Date(u.at).toISOString(), state.lang)))))
        : h('p.muted.small', t('admin.empty'))));
}

// ───────────────────────── users ─────────────────────────

const exact = (entries: ListEntry[], name: string) => entries.find((e) => e.name === name);
const matching = (entries: ListEntry[], name: string) => entries.filter((e) => matchesUsername(name, [e.name]));

function featureCheckboxes(t: T, chosen: Set<RemoteFeature>, name: string): HTMLElement {
  return h('div.adm-checks', FEATURES.map((feature) => h('label.adm-check',
    h('input', { type: 'checkbox', name, checked: chosen.has(feature), disabled: state.busy, onchange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) chosen.add(feature); else chosen.delete(feature);
    } }),
    h('span', featureLabel(t, feature)))));
}

function users(snapshot: AdminSnapshot, t: T): HTMLElement {
  const busy = !!state.busy;
  const list = h('ul.adm-list');
  const count = h('span.meta');
  const fill = () => {
    const needle = search.trim().toLowerCase();
    const shown = snapshot.stats.users.filter((name) => name.toLowerCase().includes(needle));
    count.textContent = t('admin.users.count', { shown: shown.length, total: snapshot.stats.users.length });
    list.replaceChildren(...(shown.length ? shown.map((name) => userRow(snapshot, name, t, busy)) : [h('li.muted.small', t('admin.empty'))]));
  };
  const input = h('input.adm-input', { type: 'search', placeholder: t('admin.users.search'), 'aria-label': t('admin.users.search'), value: search, oninput: () => { search = input.value; fill(); } });
  fill();
  return h('div.adm-page.adm-stagger',
    h('div.adm-rise', input),
    h('div.adm-rise.adm-count', count),
    h('div.adm-card.adm-rise.flush', list));
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
    send({ type: 'ban', name, features: [...draft.inlineFeatures], ...(draft.inlineReason && { reason: draft.inlineReason }) });
    banning = null;
  };
  const reason = h('input.adm-input', { type: 'text', maxLength: 200, placeholder: t('admin.ban.reason'), 'aria-label': t('admin.ban.reason'), value: draft.inlineReason, disabled: busy, oninput: () => { draft.inlineReason = reason.value; } });
  return h('li.adm-user', { class: bans.length ? 'banned' : '' },
    h('div.adm-row',
      h('span.mono.adm-name', name),
      h('span.adm-chips',
        allowed ? chip('accent', t('admin.authorized')) : null,
        features.map((f) => chip('fail', featureLabel(t, f)))),
      own
        ? h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unban', id: own.id }) }, icon('unlock'), t('admin.unban'))
        : h('button.btn.ghost.small.danger', { type: 'button', disabled: busy, 'aria-expanded': String(open), onclick: toggle }, icon('circle-slash'), t('admin.ban'))),
    bans.length && !own ? h('p.muted.small', t('admin.users.viaFragment', { fragment: bans.map((b) => b.name).join(', ') })) : null,
    open ? h('div.adm-inline',
      featureCheckboxes(t, draft.inlineFeatures, `inline-${name}`),
      reason,
      h('div.adm-actions',
        h('button.btn.danger', { type: 'button', disabled: busy, onclick: confirm }, t('admin.ban.confirm', { name })),
        h('button.btn.ghost', { type: 'button', onclick: toggle }, t('admin.cancel')))) : null);
}

// ───────────────────────── moderation ─────────────────────────

function moderation(snapshot: AdminSnapshot, t: T): HTMLElement {
  const busy = !!state.busy;
  const name = h('input.adm-input', { type: 'text', maxLength: 64, required: true, placeholder: t('admin.ban.name'), 'aria-label': t('admin.ban.name'), value: draft.banName, disabled: busy, oninput: () => { draft.banName = name.value; } });
  const reason = h('input.adm-input', { type: 'text', maxLength: 200, placeholder: t('admin.ban.reason'), 'aria-label': t('admin.ban.reason'), value: draft.banReason, disabled: busy, oninput: () => { draft.banReason = reason.value; } });
  const ban = (e: Event) => {
    e.preventDefault();
    if (!draft.banName.trim() || !draft.banFeatures.size) return;
    send({ type: 'ban', name: draft.banName.trim(), features: [...draft.banFeatures], ...(draft.banReason && { reason: draft.banReason }) });
    draft.banName = '';
    draft.banReason = '';
  };
  const allowName = h('input.adm-input', { type: 'text', maxLength: 64, required: true, placeholder: t('admin.ban.name'), 'aria-label': t('admin.ban.name'), value: draft.allowName, disabled: busy, oninput: () => { draft.allowName = allowName.value; } });
  const allowReason = h('input.adm-input', { type: 'text', maxLength: 200, placeholder: t('admin.ban.reason'), 'aria-label': t('admin.ban.reason'), value: draft.allowReason, disabled: busy, oninput: () => { draft.allowReason = allowReason.value; } });
  const allow = (e: Event) => {
    e.preventDefault();
    if (!draft.allowName.trim()) return;
    send({ type: 'authorize', name: draft.allowName.trim(), ...(draft.allowReason && { reason: draft.allowReason }) });
    draft.allowName = '';
    draft.allowReason = '';
  };
  return h('div.adm-page',
    section(t('admin.ban.title'), { meta: t('admin.ban.hint') },
      h('form.adm-card.adm-form.adm-rise', { onsubmit: ban },
        name, featureCheckboxes(t, draft.banFeatures, 'ban'), reason,
        h('button.btn.danger', { type: 'submit', disabled: busy }, icon('circle-slash'), t('admin.ban')))),
    section(t('admin.banlist.title'), { meta: String(snapshot.banned.length) },
      snapshot.banned.length
        ? h('ul.adm-list.adm-card.flush.adm-rise', snapshot.banned.map((entry) => bannedRow(entry, t, busy)))
        : h('p.muted.small', t('admin.banlist.empty'))),
    section(t('admin.allow.title'), { meta: t('admin.allow.hint') },
      h('form.adm-card.adm-form.adm-rise', { onsubmit: allow }, allowName, allowReason,
        h('button.btn', { type: 'submit', disabled: busy }, icon('add'), t('admin.allow.add'))),
      snapshot.authorized.length
        ? h('ul.adm-list.adm-card.flush.adm-rise', snapshot.authorized.map((entry) =>
          h('li.adm-user', h('div.adm-row', h('span.mono.adm-name', entry.name),
            h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unauthorize', id: entry.id }) }, icon('close'), t('admin.remove'))),
          entry.reason ? h('p.muted.small', entry.reason) : null)))
        : h('p.muted.small', t('admin.allow.empty'))));
}

function bannedRow(entry: ListEntry, t: T, busy: boolean): HTMLElement {
  // A ban always keeps at least one feature; lifting every feature is "unban".
  const flip = (feature: RemoteFeature) => {
    const next = entry.features.includes(feature) ? entry.features.filter((f) => f !== feature) : [...entry.features, feature];
    if (next.length) send({ type: 'updateBan', id: entry.id, features: next });
  };
  return h('li.adm-user', { class: 'banned' },
    h('div.adm-row',
      h('span.mono.adm-name', entry.name),
      h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => send({ type: 'unban', id: entry.id }) }, icon('unlock'), t('admin.unban'))),
    h('div.adm-chips', FEATURES.map((feature) => {
      const on = entry.features.includes(feature);
      return h('button.adm-toggle', {
        type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), disabled: busy || (on && entry.features.length === 1),
        title: on && entry.features.length === 1 ? t('admin.ban.lastFeature') : t('admin.ban.toggle'), onclick: () => flip(feature),
      }, featureLabel(t, feature));
    })),
    entry.reason ? h('p.muted.small', entry.reason) : null);
}

// ───────────────────────── policy ─────────────────────────

function policy(snapshot: AdminSnapshot, t: T): HTMLElement {
  const busy = !!state.busy;
  const { policy: current } = snapshot;
  const row = (key: PolicyKey, title: string, hint: string) => {
    const on = current[key];
    const pending = confirming === key;
    const apply = (value: boolean) => { confirming = null; send({ type: 'setPolicy', [key]: value }); };
    return h('div.adm-switch-row.adm-rise', { class: on ? '' : 'off' },
      h('div.adm-switch-text', h('strong', title), h('span.muted.small', hint)),
      h('button.adm-switch', {
        type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': title, disabled: busy,
        onclick: () => { if (on) { confirming = key; render(); } else apply(true); },
      }, h('span.adm-knob')),
      pending ? h('div.adm-confirm', { role: 'alertdialog', 'aria-label': t('admin.policy.confirmTitle') },
        h('p', t('admin.policy.confirm', { feature: title })),
        h('div.adm-actions',
          h('button.btn.danger', { type: 'button', disabled: busy, onclick: () => apply(false) }, t('admin.policy.disable')),
          h('button.btn.ghost', { type: 'button', onclick: () => { confirming = null; render(); } }, t('admin.cancel')))) : null);
  };
  return h('div.adm-page',
    !current.lens_active || !current.my_api_active ? notice('warn', 'warning', t('admin.policy.off')) : null,
    section(t('admin.policy.title'), { meta: t('admin.policy.hint') },
      h('div.adm-card.adm-stagger.flush',
        row('lens_active', t('admin.feature.lens'), t('admin.policy.lensHint')),
        row('my_api_active', t('admin.feature.myApi'), t('admin.policy.myApiHint')))),
    h('p.muted.small', t('admin.policy.version', { version: current.version })));
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
