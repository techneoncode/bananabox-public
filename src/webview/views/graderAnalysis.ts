import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import type { Cause, TaskAnalysis } from '../../domain/graderTrace';
import type { TaskTriangulation, Triangulation } from '../../domain/triangulation';
import { diffLines, firstDifference } from '../../domain/textDiff';

function fileButton(ctx: Ctx, id: number, file: string, line = 1, task?: string, column = 1): HTMLElement {
  return h('button.btn.ghost.small.mono', { onclick: () => ctx.post({ type: 'openFile', projectId: id, file, line, column, task }) }, icon('go-to-file'), `${file}${line > 1 ? `:${line}` : ''}`);
}
function cause(ctx: Ctx, id: number, value: Cause, task: string, column = 1): HTMLElement {
  return h('div.trace-cause', h('span.label.attention', ctx.t(`analysis.phase.${value.phase}`)),
    h('strong', ctx.t(`analysis.cause.${value.kind}`, value.params)),
    value.file && fileButton(ctx, id, value.file, value.line, task, column),
    value.params.message && h('div.mono.small', String(value.params.message)));
}

export function renderOutputDiff(ctx: Ctx, expected: string, got: string, ignoreTrailingNewline = true): HTMLElement {
  const first = firstDifference(expected, got, { ignoreTrailingNewline });
  const ops = diffLines(expected, got);
  const root = h('div.output-diff', h('div.insights-heading', icon('diff'), h('strong', ctx.t('analysis.outputs'))),
    first && h('p.small', ctx.t('analysis.firstDifference', { line: first.line, column: first.column ?? '—' }), ' · ', ctx.t(`analysis.difference.${first.kind}`)),
    h('div.output-legend', h('span', ctx.t('analysis.expected')), h('span', ctx.t('analysis.got'))),
    h('div.compare-traces', h('pre.trace-mini', { 'aria-label': ctx.t('analysis.expected') }, expected || ctx.t('analysis.emptyOutput')),
      h('pre.trace-mini', { 'aria-label': ctx.t('analysis.got') }, got || ctx.t('analysis.emptyOutput'))),
    h('details', h('summary', ctx.t('analysis.lineDiff')), h('pre.line-diff', ops.slice(0, 200).map(op =>
      h('span.diff-line', { class: op.kind }, `${op.kind === 'added' ? '+' : op.kind === 'removed' ? '−' : ' '} ${op.text}`)))),
    ops.length > 200 && h('p.muted.tiny', ctx.t('analysis.diffLimited')));
  return root;
}

export function renderTaskAnalysis(ctx: Ctx, id: number, task: TaskAnalysis | undefined, comparison?: TaskTriangulation): HTMLElement | null {
  if (!task || !task.cause && !task.commands.length && !task.build.style.length && !task.run.failures.length && !comparison?.before) return null;
  const root = h('div.grader-analysis', h('div.insights-heading', icon('search'), h('strong', ctx.t('analysis.title'))));
  if (task.cause) root.append(cause(ctx, id, task.cause, task.name, task.build.errors.find(i => i.file === task.cause?.file && i.line === task.cause?.line)?.column));
  if (comparison) {
    if (comparison.before && comparison.before.signature !== comparison.after?.signature) root.append(h('p.small', ctx.t('analysis.previousCause'), ' ', ctx.t(`analysis.cause.${comparison.before.kind}`, comparison.before.params)));
    if (comparison.mismatch && comparison.previousMismatch) root.append(h('p.small', ctx.t('analysis.outputProgress', { before: comparison.previousMismatch.distance, after: comparison.mismatch.distance })));
    if (comparison.suspects.length) root.append(h('div.suspects', h('strong.small', ctx.t('analysis.suspects')), h('span.label', ctx.t(`analysis.confidence.${comparison.confidence}`)),
      comparison.suspects.map(s => h('div.suspect', fileButton(ctx, id, s.file, s.line, task.name),
        h('span.muted.small', s.reasons.map(r => ctx.t(`analysis.reason.${r}`)).join(' · '))))));
  }
  const mismatch = task.run.failures.find(f => f.expected !== undefined && f.got !== undefined);
  if (mismatch) root.append(renderOutputDiff(ctx, mismatch.expected!, mismatch.got!));
  if (task.build.style.length) root.append(h('details', h('summary', ctx.t('analysis.styleCount', { n: task.build.style.length })),
    task.build.style.slice(0, 20).map(issue => h('div.small', h('span.label', issue.bucket ?? 'info'), issue.external ? h('span.mono', `${issue.file}:${issue.line}`) : fileButton(ctx, id, issue.file, issue.line, task.name), issue.rule ?? '', ' ', issue.message))));
  if (task.commands.length) root.append(h('details.grader-commands', h('summary', ctx.t('analysis.commands')),
    task.commands.slice(0, 30).map(c => h('div.small', h('code', `${c.cwd}> ${c.text}`), !c.chain && h('span.muted', ` · ${ctx.t('analysis.commandManual')}`)))));
  return root;
}

export function renderTriangulation(ctx: Ctx, comparison: Triangulation, loading: boolean): HTMLElement {
  return h('div.triangulation-summary', h('p.muted.small', ctx.t(loading ? 'analysis.historyLoading' : comparison.changedFiles === null ? 'analysis.noHistory' : 'analysis.history', { n: comparison.changedFiles?.length ?? 0 })),
    comparison.shared.map(c => h('div.notice.small', icon('link'), h('div', h('strong', ctx.t('analysis.shared', { n: c.tasks.length })), ' · ', ctx.t(`analysis.cause.${c.kind}`, c.params), h('div.muted.small', c.tasks.join(' · '))))),
    (comparison.style.introduced.length > 0 || comparison.style.resolved.length > 0) && h('p.small', ctx.t('analysis.styleDelta', { added: comparison.style.introduced.length, resolved: comparison.style.resolved.length })),
    comparison.otherChanges.length > 0 && h('details', h('summary', ctx.t('analysis.otherChanges')), h('div.mono.small', comparison.otherChanges.join(' · '))));
}
