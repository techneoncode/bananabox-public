import type { Ctx } from '../ctx';
import type { InsightDelta, LogDiagnostic } from '../../domain/graderInsights';
import { h, icon } from '../dom';

const priority: Record<LogDiagnostic['kind'], number> = { delivery: 0, build: 1, linker: 2, forbidden: 3, style: 4, crash: 5, memory: 6, timeout: 7, assertion: 8, output: 9, test: 10 };
const diagnosticId = (key: string) => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
};

export function renderInsights(ctx: Ctx, projectId: number, delta: InsightDelta, scope: string, compact = false, task?: string): HTMLElement {
  const { t } = ctx, current = [...delta.after.diagnostics].sort((a, b) => priority[a.kind] - priority[b.kind]);
  const fixed = delta.tests.filter(test => test.after === 'passed'), regressed = delta.tests.filter(test => test.before === 'passed' && test.after !== 'passed');
  const root = h('div.log-insights', h('div.insights-heading', icon('sparkle'), h('strong', t('insights.title'))));
  if (!current.length && !delta.before.diagnostics.length && !delta.tests.length) {
    root.append(h('p.muted.small', t('insights.noEvidence')));
  } else {
    root.append(h('p.muted.small', t('insights.summary', { added: delta.introduced.length, persistent: delta.persisting.length, absent: delta.noLongerObserved.length })));
    for (const diagnosis of current.slice(0, compact ? 3 : 5)) root.append(diagnostic(ctx, projectId, diagnosis, delta.introduced.some(d => d.key === diagnosis.key) ? 'new' : 'persistent', scope, task));
    if (current.length > (compact ? 3 : 5)) root.append(h('details', { dataset: { detailId: `${scope}:more-diagnostics` } }, h('summary', t('insights.more', { n: current.length - (compact ? 3 : 5) })),
      ...current.slice(compact ? 3 : 5).map(d => diagnostic(ctx, projectId, d, delta.introduced.some(i => i.key === d.key) ? 'new' : 'persistent', scope, task))));
    if (delta.noLongerObserved.length) root.append(h('details', { dataset: { detailId: `${scope}:absent-diagnostics` } }, h('summary', t('insights.absent', { n: delta.noLongerObserved.length })),
      h('p.muted.tiny', t('insights.absentNote')), ...delta.noLongerObserved.map(d => diagnostic(ctx, projectId, d, 'absent', scope, task))));
    if (delta.tests.length) root.append(h('div.named-test-changes', h('strong', t('insights.namedTests', { fixed: fixed.length, regressed: regressed.length })),
      ...delta.tests.slice(0, 20).map(test => h('div.small', icon(test.after === 'passed' ? 'pass-filled' : 'error', test.after === 'passed' ? 'ic-success' : 'ic-danger'),
        h('span.mono', test.name), `${t(`insights.test.${test.before}`)} → ${t(`insights.test.${test.after}`)}`))));
  }
  const failedStep = delta.after.steps.find(step => step.ok === false);
  if (failedStep) root.append(h('div.notice.small', icon('debug-breakpoint'), h('div', h('strong', t('insights.failedStep')), h('div.small', failedStep.label))));
  if (delta.before.truncated || delta.after.truncated) root.append(h('p.muted.small', t('insights.truncated')));
  if (!compact) root.append(h('p.muted.tiny', t('insights.scope')));
  return root;
}
function diagnostic(ctx: Ctx, projectId: number, d: LogDiagnostic, change: 'new' | 'persistent' | 'absent', scope: string, task?: string): HTMLElement {
  const { t } = ctx;
  return h('div.log-diagnostic', h('div.insights-heading', h('span.label', { class: change === 'new' ? 'danger' : change === 'absent' ? 'success' : 'attention' }, t(`insights.change.${change}`)), h('strong', t(`insights.kind.${d.kind}`))),
    d.tasks?.length && h('div.muted.small', d.tasks.join(' · ')),
    h('div.mono.small.diagnostic-message', d.message),
    d.file && h('button.btn.ghost.small', { onclick: () => ctx.post({ type: 'openFile', projectId, file: d.file!, line: d.line!, column: d.column ?? 1,
      ...(task || d.tasks?.length === 1 ? { task: task ?? d.tasks![0] } : {}) }) }, icon('go-to-file'), `${d.file}:${d.line}`),
    h('details', { dataset: { detailId: `${scope}:${change}:${diagnosticId(d.key)}` } }, h('summary', d.source === 'report' ? t('insights.reportEvidence') : t('insights.evidence', { line: d.traceLine })), h('pre.trace-mini', d.evidence)));
}
