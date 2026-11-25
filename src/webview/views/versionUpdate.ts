import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import { uninstallControls } from './uninstallControls';
import { statusHeading } from './availability';
import { chip } from '../ui';
import { renderMarkdown } from './markdown';
import type { RemoteStatus } from '../../domain/remotePolicy';

export function renderVersionUpdate(ctx: Ctx): HTMLElement {
  const state = ctx.state.availability!, { t } = ctx;
  const installed = state.update === 'installed';
  const failed = state.update === 'error';
  const activeStep = ['downloading', 'verifying', 'installing'].indexOf(state.update);
  const progress = state.updateProgress;
  const percentage = installed ? 100 : state.update === 'downloading' && progress?.totalBytes
    ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : undefined;
  const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const downloadDetail = progress && progress.receivedBytes > 0
    ? progress.totalBytes ? `${size(progress.receivedBytes)} / ${size(progress.totalBytes)}` : size(progress.receivedBytes) : '';
  const phase = t(installed ? 'update.finished' : failed ? 'update.failed' : `availability.${state.update}`);
  return h('div.connection-screen.update-screen',
    statusHeading(ctx, chip(installed ? 'pass' : failed ? 'fail' : 'accent', t(installed ? 'update.ready' : 'update.badge'))),
    h('section.status-card.update-card', { dataset: { update: state.update }, 'aria-labelledby': 'update-title' },
      h('h2.status-title', { id: 'update-title' },
        icon(installed ? 'check' : failed ? 'warning' : 'cloud-download', installed ? 'ic-success' : failed ? 'ic-danger' : 'ic-accent'),
        h('span', t(installed ? 'update.readyTitle' : failed ? 'update.errorTitle' : 'update.title'))),
      h('div.access-copy', h('p', t(installed ? 'update.readyCopy' : failed ? 'update.errorCopy' : 'update.copy'))),
      h('table.update-versions', { 'aria-label': t('update.comparison') },
        h('thead', h('tr', h('th', { scope: 'col' }, t('update.current')), h('th', { scope: 'col' }, t('update.target')))),
        h('tbody', h('tr',
          h('td.update-current', h('strong.mono', `v${state.installedVersion}`), chip('fail', t('update.outdated'))),
          h('td.update-target', h('strong.mono', `v${state.requiredVersion ?? '…'}`), chip('pass', t('update.recommended')))))),
      h('div.update-progress',
        h('div.update-progress-label',
          h('span', { role: 'status', 'aria-live': 'polite' }, phase),
          h('strong.mono', percentage !== undefined ? `${percentage}%` : installed ? t('update.complete') : '')),
        h('div.update-progress-track', {
          class: percentage === undefined && !failed ? 'indeterminate' : '',
          role: 'progressbar', 'aria-label': t('update.progress'), 'aria-valuemin': 0, 'aria-valuemax': 100,
          'aria-valuenow': percentage, 'aria-valuetext': phase,
        }, h('span.update-progress-fill', { style: { width: percentage !== undefined ? `${percentage}%` : failed ? '0%' : undefined } })),
        downloadDetail && state.update === 'downloading' ? h('p.update-transfer.mono', downloadDetail) : null),
      h('ol.update-steps', ...['downloading', 'verifying', 'installing'].map((step, index) => {
        const done = installed || activeStep > index;
        const active = !failed && activeStep === index;
        return h('li', { class: done ? 'is-done' : active ? 'is-active' : '', 'aria-current': active ? 'step' : undefined },
          h('span.update-step-icon', done ? icon('check') : active ? icon('sync', 'spin') : String(index + 1)),
          h('span', t(`update.step.${step}`)),
          h('span.update-step-state', t(done ? 'update.done' : active ? 'update.inProgress' : 'update.pending')));
      })),
      failed && state.updateError ? h('details.update-error', h('summary', t('update.details')), h('p', state.updateError)) : null,
      h('div.connection-actions',
        h('button.btn.primary', { type: 'button', disabled: !installed, onclick: () => { if (installed) ctx.post({ type: 'reloadVSCode' }); } }, icon('refresh'), t('update.reload')),
        h('button.btn', { type: 'button', disabled: activeStep >= 0, onclick: () => ctx.post({ type: 'refresh' }) },
          icon(failed ? 'debug-restart' : 'versions'), t(failed ? 'update.retry' : 'availability.fetchVersion')),
        uninstallControls(ctx))),
    h('p.update-hint', icon(installed ? 'check' : 'lock'), h('span', t(installed ? 'update.reloadHint' : 'update.pausedHint'))),
    renderWhatsNew(ctx, state));
}

/** What changed between the installed and the required version, below the update screen. */
function renderWhatsNew(ctx: Ctx, state: RemoteStatus): HTMLElement | null {
  const { t } = ctx;
  const changelog = state.changelog;
  if (!changelog) return null;
  const releaseUrl = `https://github.com/techneoncode/bananabox-public/releases/tag/v${state.requiredVersion}`;
  const ready = changelog.state === 'ready' && changelog.entries.length > 0;
  return h('section.status-card.whats-new', { 'aria-labelledby': 'whats-new-title' },
    h('h2.status-title', { id: 'whats-new-title' }, icon('note', 'ic-accent'), h('span', t('whatsNew.title'))),
    changelog.state === 'loading'
      ? h('p.whats-new-status', { role: 'status' }, icon('sync', 'spin'), h('span', t('whatsNew.loading')))
      : ready
        ? h('div.whats-new-list', { tabIndex: 0 }, ...changelog.entries.map((entry) =>
          h('article.whats-new-entry', h('h3', h('span.mono', `v${entry.version}`), entry.date ? h('span.whats-new-date.mono', entry.date) : null),
            renderMarkdown(entry.body, (url) => ctx.post({ type: 'openExternal', url })))))
        : h('p.whats-new-status', h('span', t('whatsNew.unavailable'))),
    changelog.state === 'loading' || ready ? null
      : h('p.whats-new-link', h('a', { href: releaseUrl, onclick: (e: Event) => { e.preventDefault(); ctx.post({ type: 'openExternal', url: releaseUrl }); } }, icon('link-external'), t('whatsNew.release'))));
}
