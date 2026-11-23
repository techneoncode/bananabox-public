import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import type { WebviewMessage } from '../../shared/protocol';
import type { RemoteFeature, RemoteStatus, Restriction } from '../../domain/remotePolicy';
import { renderVersionUpdate } from './versionUpdate';
import { uninstallControls } from './uninstallControls';
import { renderEndpointActivity } from './endpointActivity';
import { chip } from '../ui';

/** Brand line shared by every status page. */
export function statusHeading(ctx: Ctx, badge: HTMLElement): HTMLElement {
  const state = ctx.state.availability!, logo = document.body?.dataset.logo;
  return h('div.connection-heading',
    h('div.brand', logo ? h('img.access-logo', { src: logo, alt: '', width: 18, height: 18 }) : icon('package'), 'Bananabox'),
    badge,
    h('span.mono', `v${state.installedVersion}`));
}

const FEATURE_NAME: Record<RemoteFeature, string> = { lens_active: 'availability.feature.lens', my_api_active: 'availability.feature.my' };
const FEATURE_ICON: Record<RemoteFeature, string> = { lens_active: 'eye', my_api_active: 'globe' };
const SCOPE_ICON = { user: 'account', uid: 'account', promotion: 'mortar-board', campus: 'location' } as const;

/** One row per feature: what works, what a ban took away, what is paused for everyone. */
function featureStatus(ctx: Ctx, state: RemoteStatus): HTMLElement {
  const { t } = ctx;
  const rows = (['lens_active', 'my_api_active'] as const).map((feature) => {
    const active = feature === 'lens_active' ? state.lensActive : state.myApiActive;
    const [tone, label] = state.restrictedFeatures.includes(feature)
      ? ['fail', 'restricted'] as const
      : active ? ['pass', 'available'] as const : ['warn', 'paused'] as const;
    return h('li.feature-row', icon(FEATURE_ICON[feature]), h('span', t(FEATURE_NAME[feature])), chip(tone, t(`availability.state.${label}`)));
  });
  return h('ul.feature-status', { 'aria-label': t('availability.featuresHeading') }, rows);
}

/** Who decided, why, and who it applies to: a ban the user can understand without asking. */
function banCard(ctx: Ctx, restriction: Restriction): HTMLElement {
  const { t } = ctx;
  const facts: Array<[string, string]> = [
    [t('availability.reason'), restriction.reason || t('availability.noReason')],
    [t('availability.by'), restriction.by || t('availability.byTeam')],
  ];
  if (restriction.since) facts.push([t('availability.since'), new Date(restriction.since).toLocaleDateString(ctx.lang, { dateStyle: 'long' })]);
  return h('article.ban-card',
    h('header.ban-card-head',
      icon(SCOPE_ICON[restriction.scope]),
      h('strong', t(`availability.scope.${restriction.scope}`)),
      restriction.scope === 'promotion' || restriction.scope === 'campus' ? h('span.mono', restriction.target) : null),
    h('dl.ban-facts', facts.flatMap(([key, value]) => [h('dt', key), h('dd', value)])));
}

/** Recovery actions remain available before sign-in and while remote access is disabled. */
export function renderAvailability(ctx: Ctx): { key: string; node: HTMLElement } | null {
  const state = ctx.state.availability;
  if (!state || (!state.offline && !state.versionMismatch && state.myApiActive)) return null;
  if (!state.offline && state.versionMismatch && !state.restrictedFeatures.includes('my_api_active')) {
    return { key: 'version-disabled', node: renderVersionUpdate(ctx) };
  }
  const { t } = ctx;
  const action = (message: WebviewMessage, label: string, glyph: string, style = '') =>
    h('button.btn', { class: style, type: 'button', onclick: () => ctx.post(message) }, icon(glyph), t(label));
  const refresh = () => action({ type: 'refresh' }, 'action.refresh', 'refresh', 'primary');
  const fetchVersion = () => action({ type: 'fetchVersion' }, 'availability.fetchVersion', 'versions');

  let key: string, title: string, copy: string, glyph: string;
  let actions: HTMLElement[];
  if (state.offline) {
    key = 'offline-disabled'; title = 'availability.offlineTitle'; copy = 'availability.offline'; glyph = 'debug-disconnect';
    actions = [refresh()];
  } else if (state.restrictedFeatures.includes('my_api_active')) {
    key = 'connection-refused';
    title = state.restrictedFeatures.includes('lens_active') ? 'availability.connectionTitle' : 'availability.myRevokedTitle';
    copy = state.restrictedFeatures.includes('lens_active') ? 'availability.connectionRefused' : 'availability.myRevoked';
    glyph = 'shield';
    actions = [action({ type: 'appeal' }, 'availability.appeal', 'comment-discussion', 'primary'), uninstallControls(ctx)];
  } else {
    key = 'api-disabled'; title = 'availability.apiTitle'; copy = 'availability.apiDisabled'; glyph = 'shield';
    actions = [refresh(), fetchVersion(), uninstallControls(ctx)];
  }
  const banned = state.restrictions ?? [];
  // A ban explains itself with its own cards; only the appeal advice remains.
  const message = t(key === 'connection-refused' && banned.length ? 'availability.appealHint' : copy, { installed: state.installedVersion, required: state.requiredVersion ?? '' });
  return { key, node: h('div.connection-screen',
    statusHeading(ctx, chip('fail', t('availability.restricted'))),
    h('section.status-card', { role: 'alert', 'aria-labelledby': 'access-title' },
      h('h2.status-title', { id: 'access-title' }, icon(glyph, 'ic-danger'), h('span', t(title))),
      key === 'connection-refused' ? h('div.ban-cards', banned.map(restriction => banCard(ctx, restriction))) : null,
      featureStatus(ctx, state),
      h('div.access-copy', ...message.split('\n\n').map(paragraph => h('p', paragraph))),
      h('div.connection-actions', ...actions),
      key === 'connection-refused' ? renderEndpointActivity(ctx) : null)) };
}

/** A Lens-only restriction must leave the MyEpitech interface usable. */
export function renderLensRestriction(ctx: Ctx): HTMLElement | null {
  const state = ctx.state.availability;
  if (!state || state.offline || state.versionMismatch || !state.restrictedFeatures.includes('lens_active') || state.restrictedFeatures.includes('my_api_active')) return null;
  return h('section.connection-notice', { role: 'status' },
    h('h2.status-title', icon('shield', 'ic-danger'), h('span', ctx.t('availability.lensRevokedTitle'))),
    h('div.ban-cards', (state.restrictions ?? []).map(restriction => banCard(ctx, restriction))),
    featureStatus(ctx, state),
    h('p.muted.small', ctx.t('availability.lensRevoked')),
    h('div.connection-actions',
      h('button.btn.small', { type: 'button', onclick: () => ctx.post({ type: 'appeal' }) }, icon('comment-discussion'), ctx.t('availability.appeal')),
      uninstallControls(ctx)));
}
