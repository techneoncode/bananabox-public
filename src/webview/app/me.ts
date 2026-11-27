import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import { termsUrl } from '../../shared/terms';
import { relative } from '../format';
import { appBar, listGroup, listRow } from './kit';

/** Me tab: the account, the look and settings of the sidebar, the data, and sign out. */
export function renderMeTab(ctx: Ctx): HTMLElement {
  const { t, state, lang, ui } = ctx, a = state.auth;
  const name = [a.firstname, a.lastname].filter(Boolean).join(' ') || a.login || '';
  const initials = ((a.firstname?.[0] ?? '') + (a.lastname?.[0] ?? '') || (a.login?.[0] ?? '?')).toUpperCase();
  const meta = [a.promotion != null ? t('app.me.promotion', { n: a.promotion }) : '', a.cursus ?? '', a.campus ?? ''].filter(Boolean).join(' · ');
  const card = h('section.me-card',
    h('span.me-avatar', { 'aria-hidden': 'true' }, initials),
    h('div.me-id', h('strong', name), a.login && a.login !== name ? h('span', a.login) : null, meta ? h('span.me-meta', meta) : null));
  const updated = state.lastUpdated ? t('toolbar.updated', { when: relative(new Date(state.lastUpdated).toISOString(), lang) }) : t('app.me.neverUpdated');

  return h('div.me-tab', appBar({ title: t('app.tab.me'), large: true }), card,
    listGroup(t('app.me.group.app'),
      listRow({ icon: 'symbol-color', label: t('appearance.title'), chevron: true, onclick: () => { ui.page = 'appearance'; ctx.rerender(); } }),
      remindersRow(ctx),
      bananaThemeRow(ctx),
      listRow({ icon: 'globe', label: t('app.me.language'), meta: lang === 'fr' ? 'Français' : 'English', chevron: true,
        onclick: () => ctx.post({ type: 'openSettings', query: 'bananabox.language' }) }),
      listRow({ icon: 'clock', label: t('app.me.timeFormat'), meta: state.timeFormat ?? t('app.me.timeFormatAuto'), chevron: true,
        onclick: () => ctx.post({ type: 'openSettings', query: 'bananabox.timeFormat' }) }),
      listRow({ icon: 'settings-gear', label: t('app.me.settings'), detail: t('app.me.settingsSub'), meta: icon('link-external'), chevron: false,
        onclick: () => ctx.post({ type: 'openSettings', query: 'bananabox' }) })),
    listGroup(t('app.me.group.data'),
      listRow({ icon: 'refresh', label: t('app.me.refresh'), detail: updated, disabled: state.loading, onclick: () => ctx.post({ type: 'refresh' }) }),
      listRow({ icon: 'shield', label: t('app.me.terms'), meta: icon('link-external'), chevron: false, onclick: () => ctx.post({ type: 'openExternal', url: termsUrl(lang) }) })),
    listGroup('',
      listRow({ icon: 'sign-out', tone: 'fail', label: t('app.me.signOut'), chevron: false, onclick: () => ctx.post({ type: 'signOut' }) })));
}

/** A switch row of the Me tab, flipped at once and saved to the matching setting by the host. */
function switchRow(ctx: Ctx, opts: { on: boolean; glyph: string; label: string; detail: string; toggle(on: boolean): void }): HTMLElement {
  return h('button.lr.me-switch-row', { type: 'button', role: 'switch', 'aria-checked': String(opts.on), onclick: () => { opts.toggle(!opts.on); ctx.rerender(); } },
    h('span.lr-ic.t-accent', icon(opts.glyph)),
    h('span.lr-text', h('span.lr-label', opts.label), h('span.lr-detail', opts.detail)),
    h('span.me-switch', { class: opts.on ? 'on' : '', 'aria-hidden': 'true' }, h('span.me-knob')));
}

/** Switch: Bananabox's accent on buttons instead of the VS Code theme's (setting bananabox.bananaTheme). */
function bananaThemeRow(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  return switchRow(ctx, { on: ctx.state.bananaTheme === true, glyph: 'paintcan', label: t('app.me.bananaTheme'), detail: t('app.me.bananaThemeSub'),
    toggle: (on) => { ctx.state.bananaTheme = on; document.body.classList.toggle('bb-brand', on); ctx.post({ type: 'setBananaTheme', value: on }); } });
}

/** Switch: the full-screen defense countdown (setting bananabox.defenseReminders, off by default). */
function remindersRow(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  return switchRow(ctx, { on: ctx.state.defenseReminders === true, glyph: 'bell', label: t('app.me.reminders'), detail: t('app.me.remindersSub'),
    toggle: (on) => { ctx.state.defenseReminders = on; ctx.post({ type: 'setDefenseReminders', value: on }); } });
}
