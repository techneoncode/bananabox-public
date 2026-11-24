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
      bananaThemeRow(ctx),
      listRow({ icon: 'globe', label: t('app.me.language'), meta: lang === 'fr' ? 'Français' : 'English', chevron: true,
        onclick: () => ctx.post({ type: 'openSettings', query: 'bananabox.language' }) }),
      listRow({ icon: 'settings-gear', label: t('app.me.settings'), detail: t('app.me.settingsSub'), meta: icon('link-external'), chevron: false,
        onclick: () => ctx.post({ type: 'openSettings', query: 'bananabox' }) })),
    listGroup(t('app.me.group.data'),
      listRow({ icon: 'refresh', label: t('app.me.refresh'), detail: updated, disabled: state.loading, onclick: () => ctx.post({ type: 'refresh' }) }),
      listRow({ icon: 'shield', label: t('app.me.terms'), meta: icon('link-external'), chevron: false, onclick: () => ctx.post({ type: 'openExternal', url: termsUrl(lang) }) })),
    listGroup('',
      listRow({ icon: 'sign-out', tone: 'fail', label: t('app.me.signOut'), chevron: false, onclick: () => ctx.post({ type: 'signOut' }) })));
}

/** Switch: Bananabox's accent on buttons instead of the VS Code theme's (setting bananabox.bananaTheme). */
function bananaThemeRow(ctx: Ctx): HTMLElement {
  const { t } = ctx, on = ctx.state.bananaTheme === true;
  const toggle = () => {
    ctx.state.bananaTheme = !on;
    document.body.classList.toggle('bb-brand', !on);
    ctx.post({ type: 'setBananaTheme', value: !on });
    ctx.rerender();
  };
  return h('button.lr.me-switch-row', { type: 'button', role: 'switch', 'aria-checked': String(on), onclick: toggle },
    h('span.lr-ic.t-accent', icon('paintcan')),
    h('span.lr-text', h('span.lr-label', t('app.me.bananaTheme')), h('span.lr-detail', t('app.me.bananaThemeSub'))),
    h('span.me-switch', { class: on ? 'on' : '', 'aria-hidden': 'true' }, h('span.me-knob')));
}
