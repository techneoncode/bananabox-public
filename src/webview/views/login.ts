import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import { notice } from '../ui';
import { termsUrl } from '../../shared/terms';

export function renderLogin(ctx: Ctx): HTMLElement {
  const { t, state } = ctx;
  const { auth } = state;
  const expired = auth.status === 'expired';
  return h('div.login',
    h('div.login-hero', h('span.logo-halo', h('img.logo', { src: document.body.dataset.logo, alt: '', width: 56, height: 56 })), h('h1', 'Bananabox'), h('p.muted', t('login.tagline'))),
    !auth.pending && h('ul.login-features',
      ([['calendar', 'login.feature.timeline'], ['beaker', 'login.feature.grader'], ['checklist', 'login.feature.style']] as const).map(([glyph, key]) =>
        h('li', h('span.feature-icon', icon(glyph)), h('span', t(key))))),
    expired && !auth.pending && notice('warn', 'warning', h('strong', t('login.expiredTitle')), h('span', t('login.expiredBody'))),
    auth.error && notice('error', 'error', auth.error),
    !state.termsAccepted ? renderTerms(ctx)
      : auth.pending ? renderPending(ctx) : renderChoices(ctx, expired, auth.busy));
}

/** Whether the terms link was opened; kept here because every state push redraws the page. */
let termsRead = false;

/** Signing in is closed until the terms are accepted; the host enforces it too. */
function renderTerms(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const accept = h('button.btn.primary.block.big', { disabled: true, onclick: () => ctx.post({ type: 'acceptTerms' }) }, icon('check'), t('terms.accept'));
  const box = h('input', { type: 'checkbox', id: 'terms-agree', disabled: !termsRead, onchange: () => { (accept as HTMLButtonElement).disabled = !(box as HTMLInputElement).checked; } });
  const read = () => {
    termsRead = true;
    (box as HTMLInputElement).disabled = false;
    ctx.post({ type: 'openExternal', url: termsUrl(ctx.state.lang) });
  };
  return h('section.terms',
    h('p', h('button.btn.ghost', { onclick: read }, icon('link-external'), t('terms.read'))),
    h('label.small', { htmlFor: 'terms-agree' }, box, ' ', t('terms.agree')),
    accept);
}

function renderChoices(ctx: Ctx, expired: boolean, busy: boolean): HTMLElement[] {
  const { t } = ctx;
  return [
    h('div.login-main',
      h('button.btn.primary.block.big', { onclick: () => ctx.post({ type: 'signInMicrosoft' }), disabled: busy },
        busy ? icon('loading', 'spin') : icon('account'), busy ? t('login.signingIn') : expired ? t('login.microsoftAgain') : t('login.microsoft')),
      h('p.login-hint', icon('lock'), t('login.microsoftHint'))),
    h('details.howto', { dataset: { detailId: 'login-token' } },
      h('summary', icon('chevron-right', 'chev'), t('login.useToken')),
      h('div.howto-body',
        h('ol', h('li', t('login.step1')), h('li', t('login.step2')), h('li', t('login.step3')), h('li', t('login.step4'))),
        h('button.btn.block', { onclick: () => ctx.post({ type: 'signIn' }), disabled: busy }, icon('key'), t('login.signIn')),
        h('p.login-hint', icon('lock'), t('login.secure')))),
  ];
}

function renderPending(ctx: Ctx): HTMLElement {
  return ctx.state.auth.pending!.mode === 'browser' ? renderBrowserPending(ctx) : renderPastePending(ctx);
}

/** Default flow: sign in inside the window Bananabox opened; it closes by itself. */
function renderBrowserPending(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  return h('section.pending', { 'aria-live': 'polite' },
    h('div.pending-title', icon('loading', 'spin'), h('span', t('login.browserTitle'))),
    h('p', t('login.browserBody')),
    h('p.muted.small', t('login.browserStay')),
    h('div.pending-actions',
      h('button.btn.ghost.small', { onclick: () => ctx.post({ type: 'signInPaste' }) }, t('login.browserFallback')),
      h('span.spacer'),
      h('button.btn.small', { onclick: () => ctx.post({ type: 'cancelSignIn' }) }, t('login.cancel'))));
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
    h('div.pending-title', icon('account'), h('span', t('login.pendingTitle'))),
    h('ol', h('li', t('login.pendingStep1')), h('li', t('login.pendingStep2')), h('li', t('login.pendingStep3'))),
    input,
    h('div.pending-actions',
      h('button.btn.primary', { onclick: submit }, icon('check'), t('login.pendingValidate')),
      h('button.btn', { onclick: () => ctx.post({ type: 'openExternal', url: pending.url }) }, icon('link-external'), t('login.pendingReopen')),
      h('span.spacer'),
      h('button.btn.ghost', { onclick: () => ctx.post({ type: 'cancelSignIn' }) }, t('login.cancel'))),
    h('p.muted.small', t('login.pendingHint')));
}
