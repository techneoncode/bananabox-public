import type { Ctx } from '../ctx';
import { h, icon } from '../dom';

export function uninstallControls(ctx: Ctx): HTMLElement {
  const state = ctx.state.availability;
  const busy = state?.uninstall === 'uninstalling';
  const done = state?.uninstall === 'uninstalled';
  return h('div.uninstall-controls',
    h('button.btn.access-uninstall', {
      type: 'button', disabled: busy || done,
      onclick: () => { if (!busy && !done) ctx.post({ type: 'uninstall' }); },
    }, icon(busy ? 'loading' : done ? 'check' : 'trash', busy ? 'spin' : ''), ctx.t(busy ? 'availability.uninstalling' : done ? 'availability.uninstalled' : 'availability.uninstall')),
    h('button.btn', {
      type: 'button', disabled: !done,
      title: ctx.t(done ? 'availability.refreshAfterUninstall' : 'availability.refreshAfterUninstallPending'),
      onclick: () => { if (done) ctx.post({ type: 'refreshVSCode' }); },
    }, icon('refresh'), ctx.t('availability.refreshVSCode')),
    state?.uninstallError ? h('span.uninstall-error', { role: 'alert' }, state.uninstallError) : null);
}
