import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import { notice } from '../ui';
import { termsUrl } from '../../shared/terms';
import type { StateSnapshot } from '../../shared/protocol';
import chromeLogo from '../browsers/chrome.svg';
import edgeLogo from '../browsers/edge.svg';
import braveLogo from '../browsers/brave.svg';
import chromiumLogo from '../browsers/chromium.svg';
import firefoxLogo from '../browsers/firefox.svg';

type Browser = NonNullable<StateSnapshot['browsers']>[number];
type Method = 'microsoft' | 'token';

const LOGOS: Record<string, string> = { chrome: chromeLogo, edge: edgeLogo, brave: braveLogo, chromium: chromiumLogo, firefox: firefoxLogo };

/** Survive re-renders (each host push redraws the page); the token stays in memory only. */
let method: Method = 'microsoft';
let tokenDraft = '';

/**
 * Sign-in page. Wide (editor tab, or a wide sidebar): guide on the left, action on the right.
 * Narrow: action first, guide below.
 */
export function renderLogin(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const { auth } = state;
  const expired = auth.status === 'expired';
  const step = !state.termsAccepted ? 0 : auth.pending ? 2 : 1;
  return h('div.login',
    h('header.login-hero',
      h('span.logo-halo', h('img.logo', { src: document.body.dataset.logo, alt: '', width: 56, height: 56 })),
      h('div', h('h1', 'Bananabox'), h('p.muted', t('login.tagline'))),
      ctx.surface === 'sidebar' && h('button.btn.ghost.small.login-expand', { onclick: () => ctx.post({ type: 'openHome' }), title: t('login.expandHint') }, icon('screen-full'), t('login.expand'))),
    h('ol.login-steps', { 'aria-label': t('login.progress') },
      [t('login.stepTerms'), t('login.stepMethod'), t('login.stepConnect')].map((label, i) =>
        h('li', { class: i < step ? 'done' : i === step ? 'current' : '' }, h('span.num', i < step ? icon('check') : String(i + 1)), label))),
    h('div.login-body',
      h('section.login-card',
        expired && !auth.pending && notice('warn', 'warning', h('strong', t('login.expiredTitle')), h('span', t('login.expiredBody'))),
        auth.error && notice('error', 'error', auth.error),
        !state.termsAccepted ? renderTerms(ctx)
          : auth.pending ? renderPending(ctx) : renderChoices(ctx, expired, auth.busy)),
      renderGuide(ctx)));
}

/** Signing in is closed until the terms are accepted; the host enforces it too. Reading the full text is offered, not required. */
function renderTerms(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const accept = h('button.btn.primary.block.big', { disabled: true, onclick: () => ctx.post({ type: 'acceptTerms' }) }, icon('check'), t('terms.accept'));
  const box = h('input', { type: 'checkbox', id: 'terms-agree', onchange: () => { (accept as HTMLButtonElement).disabled = !(box as HTMLInputElement).checked; } });
  // Signed in already: this installation predates the terms screen.
  const upgraded = ctx.state.auth.status === 'signedIn';
  return h('section.terms',
    upgraded && notice('accent', 'rocket', h('strong', t('terms.upgradeTitle')), h('span', t('terms.upgradeBody'))),
    h('p.small', icon('shield'), ' ', t('terms.summary')),
    h('p', h('button.btn.ghost', { onclick: () => ctx.post({ type: 'openExternal', url: termsUrl(ctx.state.lang) }) }, icon('link-external'), t('terms.read'))),
    h('label.small', { htmlFor: 'terms-agree' }, box, ' ', t('terms.agree')),
    accept);
}

function renderChoices(ctx: Ctx, expired: boolean, busy: boolean): HTMLElement {
  const { t } = ctx;
  const pick = (m: Method) => () => { method = m; ctx.rerender(); };
  const tab = (m: Method, glyph: string, label: string, badge?: string) =>
    h('button.login-tab', { role: 'tab', 'aria-selected': String(method === m), class: method === m ? 'on' : '', onclick: pick(m) },
      icon(glyph), label, badge && h('span.login-badge', badge));
  return h('div.login-choices',
    h('div.login-tabs', { role: 'tablist' },
      tab('microsoft', 'account', 'Microsoft', t('login.recommended')),
      tab('token', 'key', t('login.token'))),
    method === 'microsoft' ? renderMicrosoft(ctx, expired, busy) : renderToken(ctx, busy));
}

function renderMicrosoft(ctx: Ctx, expired: boolean, busy: boolean): HTMLElement {
  const { t } = ctx;
  const browsers = ctx.state.browsers ?? [];
  return h('div.login-pane',
    h('div.login-label', t('login.browser')),
    browsers.length
      ? h('div.browser-grid', { role: 'radiogroup', 'aria-label': t('login.browser') },
        browsers.map((b) => h('button.browser-tile', {
          role: 'radio', 'aria-checked': String(b.selected), class: b.selected ? 'on' : '', title: b.path, disabled: busy,
          onclick: () => !b.selected && ctx.post({ type: 'selectBrowser', path: b.path }),
        }, browserLogo(b), h('span', b.name), b.selected && icon('pass-filled', 'tick'))))
      : notice('warn', 'warning', h('strong', t('login.noBrowser')), h('span', t('login.noBrowserBody'))),
    h('button.btn.primary.block.big', { onclick: () => ctx.post({ type: 'signInMicrosoft' }), disabled: busy },
      busy ? icon('loading', 'spin') : icon('account'), busy ? t('login.signingIn') : expired ? t('login.microsoftAgain') : t('login.microsoft')),
    h('button.btn.ghost.small.block', { onclick: () => ctx.post({ type: 'signInPaste' }), disabled: busy }, icon('link-external'), t('login.ownBrowser')));
}

function renderToken(ctx: Ctx, busy: boolean): HTMLElement {
  const { t } = ctx;
  const submit = (): void => {
    if (!tokenDraft.trim()) return;
    ctx.post({ type: 'signInToken', token: tokenDraft });
    tokenDraft = '';
  };
  const input = h('input.login-token', {
    type: 'password', value: tokenDraft, placeholder: 'eyJhbGciOi…', autocomplete: 'off', spellcheck: false,
    'aria-label': t('login.tokenField'), dataset: { keep: 'login-token' }, disabled: busy,
    oninput: () => { tokenDraft = input.value; },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') submit(); },
    // Pasting is the whole interaction: submit as soon as something lands.
    onpaste: () => setTimeout(() => { tokenDraft = input.value; submit(); }, 0),
  });
  return h('div.login-pane',
    h('ol.login-howto',
      h('li', h('button.btn.small', { onclick: () => ctx.post({ type: 'openExternal', url: 'https://my.epitech.eu' }) }, icon('link-external'), t('login.tokenOpen'))),
      h('li', h('span', t('login.tokenDevtools'))),
      h('li', h('span', t('login.tokenCopy')))),
    h('div.login-label', t('login.tokenField')),
    h('div.login-token-row', input,
      h('button.btn.primary', { onclick: submit, disabled: busy }, busy ? icon('loading', 'spin') : icon('arrow-right'), t('login.connect'))),
    h('p.login-hint', icon('lock'), t('login.secure')));
}

function renderPending(ctx: Ctx): HTMLElement {
  return ctx.state.auth.pending!.mode === 'browser' ? renderBrowserPending(ctx) : renderPastePending(ctx);
}

/** Default flow: sign in inside the window Bananabox opened; it closes by itself. */
function renderBrowserPending(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const browser = ctx.state.browsers?.find((b) => b.selected);
  return h('section.pending', { 'aria-live': 'polite' },
    h('div.pending-title', browser ? browserLogo(browser) : icon('loading', 'spin'), h('span', t('login.browserTitle', { browser: browser?.name ?? 'Microsoft' }))),
    h('ul.pending-list',
      h('li', icon('account'), t('login.browserBody')),
      h('li', icon('pass'), t('login.browserStay')),
      h('li', icon('close'), t('login.browserCloses'))),
    h('div.pending-wait', icon('loading', 'spin'), t('login.waiting')),
    h('div.pending-actions',
      h('button.btn.small', { onclick: () => { ctx.post({ type: 'cancelSignIn' }); ctx.post({ type: 'signInMicrosoft' }); } }, icon('refresh'), t('login.retry')),
      h('button.btn.ghost.small', { onclick: () => ctx.post({ type: 'signInPaste' }) }, icon('link-external'), t('login.ownBrowser')),
      h('span.spacer'),
      h('button.btn.ghost.small', { onclick: () => ctx.post({ type: 'cancelSignIn' }) }, t('login.cancel'))));
}

/** Fallback flow: sign in on Microsoft's page, then paste the redirect address back. */
function renderPastePending(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const pending = ctx.state.auth.pending!;
  const input = h('textarea.pending-input', {
    rows: 3, spellcheck: false, placeholder: t('login.pendingPlaceholder'), 'aria-label': t('login.pendingStep3'),
    // Pasting is the whole interaction: submit as soon as something lands.
    onpaste: () => setTimeout(() => input.value.trim() && submit(), 0),
  });
  const submit = (): void => ctx.post({ type: 'submitRedirect', url: input.value });
  return h('section.pending',
    pending.reason && notice('warn', 'info', h('strong', t('login.fallbackWhy')), h('span', pending.reason)),
    h('div.pending-title', icon('link-external'), h('span', t('login.pendingTitle'))),
    h('ol.login-howto', h('li', h('span', t('login.pendingStep1'))), h('li', h('span', t('login.pendingStep2'))), h('li', h('span', t('login.pendingStep3')))),
    input,
    h('div.pending-actions',
      h('button.btn.primary', { onclick: submit }, icon('check'), t('login.pendingValidate')),
      h('button.btn', { onclick: () => ctx.post({ type: 'openExternal', url: pending.url }) }, icon('link-external'), t('login.pendingReopen')),
      h('span.spacer'),
      h('button.btn.ghost', { onclick: () => ctx.post({ type: 'cancelSignIn' }) }, t('login.cancel'))),
    h('p.muted.small', t('login.pendingHint')));
}

/** What happens, in keywords, and what to do when it sticks. */
function renderGuide(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const row = (glyph: string, title: string, body: string) =>
    h('li', h('span.feature-icon', icon(glyph)), h('div', h('strong', title), h('span', body)));
  const token = method === 'token' && !ctx.state.auth.pending;
  return h('aside.login-guide',
    h('h2', t('login.howTitle')),
    h('ul.login-points', token
      ? [row('key', t('login.gTokenWhat'), t('login.gTokenWhatBody')),
        row('clock', t('login.gTokenLife'), t('login.gTokenLifeBody')),
        row('lock', t('login.gSafe'), t('login.secure'))]
      : [row('window', t('login.gWindow'), t('login.gWindowBody')),
        row('shield', t('login.gMfa'), t('login.gMfaBody')),
        row('sync', t('login.gRenew'), t('login.gRenewBody')),
        row('lock', t('login.gSafe'), t('login.secure'))]),
    h('details.login-help', { dataset: { detailId: 'login-help' } },
      h('summary', icon('chevron-right', 'chev'), t('login.helpTitle')),
      h('dl',
        h('dt', t('login.hFirefox')), h('dd', t('login.hFirefoxFix')),
        h('dt', t('login.hNoWindow')), h('dd', t('login.hNoWindowFix')),
        h('dt', t('login.hLoop')), h('dd', t('login.hLoopFix')),
        h('dt', t('login.hOther')), h('dd',
          h('button.btn.ghost.small', { onclick: () => ctx.post({ type: 'openSettings', query: 'bananabox.browserPath' }) }, icon('gear'), t('login.hOtherFix'))))));
}

function browserLogo(b: Browser): HTMLElement {
  const src = LOGOS[b.id];
  return src ? h('img.browser-logo', { src, alt: '', width: 24, height: 24 }) : icon('globe', 'browser-logo');
}
