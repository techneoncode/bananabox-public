import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import { collapsible } from '../sections';
import { renderOutputDiff } from './graderAnalysis';

export function renderReproduction(ctx: Ctx, id: number): HTMLElement | null {
  const { t } = ctx, vm = ctx.reproductions.get(id);
  if (!vm) return null;
  return collapsible(h('div.box.reproduction', h('div.box-header', h('h3', icon('debug-alt'), t('reproduce.title')), h('span.label', { class: vm.status === 'failed' || vm.status === 'error' ? 'danger' : vm.status === 'passed' ? 'success' : '' },
      vm.status === 'passed' && vm.mode === 'build' ? t('reproduce.buildOk') : vm.status === 'passed' && vm.expectedStdout === null ? t('reproduce.exitMatched') : t(`reproduce.status.${vm.status}`))),
    h('div.box-body', h('strong', vm.task), h('div.muted.small.mono', vm.command),
      vm.detected && h('div.notice.small', icon('sparkle'), t(vm.mode === 'build' ? 'reproduce.buildOnly' : 'reproduce.detected')),
      h('p.muted.small', `${t('delivery.exit', { code: vm.exitCode ?? '—' })} · ${(vm.durationMs / 1000).toFixed(1)}s`),
      vm.error && h('div.notice.error', vm.error),
      vm.expectedStdout !== null ? renderOutputDiff(ctx, vm.expectedStdout, vm.stdout, vm.expectedFromLog === true) : h('div', h('h3', t('reproduce.actual')), h('pre.trace-mini', vm.stdout || t('result.noOutput'))),
      vm.stderr && h('details', h('summary', t('reproduce.stderr')), h('pre.trace-mini', vm.stderr)),
      h('div.actions', vm.status === 'running' ? h('button.btn', { onclick: () => ctx.post({ type: 'cancelLocal', projectId: id }) }, icon('debug-stop'), t('delivery.stop')) :
        h('button.btn', { onclick: () => ctx.post({ type: 'reproduce', projectId: id, resultId: vm.resultId, task: vm.task }) }, icon('refresh'), t('reproduce.again')),
        h('button.btn', { disabled: vm.status === 'running', onclick: () => ctx.post({ type: 'configureChecks', projectId: id, advanced: true }) }, icon('edit'), t('reproduce.editExpected'))),
      h('p.muted.tiny', t('reproduce.scope')))), `reproduction:${vm.resultId}:${vm.task}`);
}
