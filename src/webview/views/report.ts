import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { GraderVM, TestResultDetail, TestResultSummary, TestTask } from '../../shared/types';
import { dateTime, shortSha } from '../format';
import { taskEvidence, resultEvidence } from '../../domain/graderEvidence';
import { compareResults } from '../../domain/graderComparison';
import { renderTaskAnalysis } from './graderAnalysis';
import { history } from './comparison';
import { chip, gut, type Tone } from '../ui';
import { ring, stackBar, tokenBlocks } from '../charts';
import { enterPart } from '../motion';
import { scoreTrend } from './trend';

export function scoreClass(score: number | null): string {
  return score === null ? 'none' : score >= 100 ? 'perfect' : score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad';
}

export function selectResult(ctx: Ctx, projectId: number, id: number): void {
  ctx.ui.selectedResult[projectId] = id;
  ctx.ui.traceQuery = '';
  if (!ctx.results.has(id)) {
    ctx.results.set(id, { loading: true, detail: null, error: null });
    ctx.post({ type: 'loadResult', projectId, resultId: id });
  }
  ctx.rerender();
}

/** The selected run: navigator, score line, style chips, failures first, then folded passes and raw output. */
export function renderReport(ctx: Ctx, grader: GraderVM, selected: number): HTMLElement | null {
  const index = grader.history.findIndex(r => r.id === selected), summary = grader.history[index];
  if (!summary) return null;
  const { t } = ctx, id = grader.projectId;
  const root = h('section.report.inline-result', { 'aria-label': t('result.title'), dataset: { detailId: 'grader-runs' } },
    h('div.report-head',
      statusGlyph(summary),
      h('h2', t('result.title')),
      h('span.when', dateTime(summary.date, ctx.lang)),
      summary.commit && commitButton(ctx, id, summary.commit),
      summary.commit && index < grader.history.length - 1 && commitStatus(ctx, id, summary.commit),
      h('div.run-selector',
        h('select', { value: String(selected), 'aria-label': t('grader.selectRun'), onchange: (e: Event) => selectResult(ctx, id, Number((e.target as HTMLSelectElement).value)) },
          [...grader.history].reverse().map(run => h('option', { value: String(run.id), selected: run.id === selected },
            `${dateTime(run.date, ctx.lang)} · ${run.score ?? '—'}%${run.commit ? ` · ${shortSha(run.commit)}` : ''}`))),
        h('button.icon-btn', { disabled: index <= 0, title: t('grader.olderRun'), 'aria-label': t('grader.olderRun'), onclick: () => selectResult(ctx, id, grader.history[index - 1].id) }, icon('chevron-left')),
        h('button.icon-btn', { disabled: index >= grader.history.length - 1, title: t('grader.newerRun'), 'aria-label': t('grader.newerRun'), onclick: () => selectResult(ctx, id, grader.history[index + 1].id) }, icon('chevron-right')))));
  if (summary.flags.length) root.append(h('div.chips-row', summary.flags.map(f => chip('fail', icon('warning'), t(`flag.${f}`)))));
  const entry = ctx.results.get(summary.id);
  if (!entry || entry.loading) {
    root.append(h('div.skeleton', h('div.sk.w80'), h('div.sk.w60'), h('div.sk.w40')));
    return root;
  }
  if (entry.error || !entry.detail) {
    root.append(h('div.notice.error', icon('error'), h('div', entry.error ?? t('result.loadError'),
      h('button.btn.small', { onclick: () => (ctx.results.delete(summary.id), selectResult(ctx, id, summary.id)) }, icon('refresh'), t('action.retry')))));
    return root;
  }
  fillResult(ctx, root, entry.detail, grader, index);
  return root;
}

function statusGlyph(r: TestResultSummary): HTMLElement {
  if (r.score === null) return icon('circle-slash', 'ic-muted');
  return r.score >= 100 ? icon('pass-filled', 'ic-success') : icon('error', 'ic-danger');
}

/** Tokens left as cubes on the stats line: lit for each one left, hollow for each one used. */
function tokenCell(ctx: Ctx, remaining: number, total: number): HTMLElement {
  const blocks = tokenBlocks(remaining, total);
  blocks.classList.add('tok-cubes');
  return h('div.stat-cell.stat-tokens', h('span.l', ctx.t('grader.tokens')),
    h('span.v', { class: remaining <= 0 ? 'bad' : '', title: ctx.t('report.tokensLeft', { n: remaining, total }) }, blocks, h('span.tok-count', `${remaining}/${total}`)));
}

function cell(label: string, value: Node | string, tone = ''): HTMLElement {
  return h('div.stat-cell', h('span.l', label), h('span.v', { class: tone }, value));
}

function fillResult(ctx: Ctx, root: HTMLElement, d: TestResultDetail, grader: GraderVM, index: number): void {
  const { t } = ctx, projectId = grader.projectId;
  const score = d.score ?? grader.history[index]?.score ?? null;
  const testsTone = d.total > 0 && d.passed === d.total ? 'ok' : d.total > 0 ? 'warn' : '';
  // Picking another run re-plays the numbers' entrance, so the change reads as "this is another run now".
  const part = <E extends HTMLElement>(el: E) => enterPart(el, `report-${projectId}`, String(d.id));
  const q = grader.quota;
  root.append(part(h('div.score-line',
    h('div.score-ring',
      ring(score === null ? 0 : score / 100, { size: 76, stroke: 7, tone: score === null ? 'done' : score >= 100 ? 'pass' : score >= 50 ? 'warn' : 'fail', label: score === null ? '—' : `${score}%`, sub: d.total > 0 ? `${d.passed}/${d.total}` : undefined, aria: `${t('gauge.score')} ${score ?? '—'}%` }),
      h('span.sr-only.big-score', { class: scoreClass(score) }, score === null ? '—' : `${score}%`)),
    h('div.stat-grid',
      cell(t('result.tests'), d.total > 0 ? `${d.passed}/${d.total}` : '—', testsTone),
      d.coverage.lines && cell(t('result.lines'), `${Math.round((d.coverage.lines[0] / d.coverage.lines[1]) * 100)}%`),
      d.coverage.branches && cell(t('result.branches'), `${Math.round((d.coverage.branches[0] / d.coverage.branches[1]) * 100)}%`),
      typeof d.prerequisitesMark === 'number' && Number.isFinite(d.prerequisitesMark) && cell(t('result.prereq'), String(d.prerequisitesMark)),
      q && q.total > 0 && q.total <= 24 && tokenCell(ctx, q.remaining, q.total)))));
  const clean = (['fatal', 'major', 'minor', 'info'] as const).every(b => d.style[b] === 0);
  const style = stackBar((['fatal', 'major', 'minor', 'info'] as const).map(bucket => ({ value: d.style[bucket], tone: bucket, label: t(`style.bucket.${bucket}`) })), t('result.styleLegend'));
  if (clean) style.append(h('span.style-clean', h('span.codicon.codicon-check', { 'aria-hidden': 'true' }), t('report.styleClean')));
  const trend = scoreTrend(ctx, grader, d.id, rid => selectResult(ctx, projectId, rid));
  root.append(h('div.report-visuals', { class: trend ? '' : 'no-trend' },
    trend,
    h('div.style-dist', { title: t('result.styleLegend') }, style),
    h('div.chips-row.style-chips',
      (['fatal', 'major', 'minor', 'info'] as const).map(bucket => chip(d.style[bucket] > 0 ? bucket : '', h('span.num', String(d.style[bucket])), t(`style.bucket.${bucket}`))))));
  const previous = grader.history[index - 1];
  const before = previous && ctx.results.get(previous.id)?.detail;
  if (before) {
    const counts = { fixed: 0, regressed: 0, stillFailing: 0 };
    compareResults(before, d, previous, grader.history[index]).forEach(c => { if (c.kind in counts) counts[c.kind as keyof typeof counts]++; });
    if (counts.fixed + counts.regressed + counts.stillFailing > 0) root.append(part(h('div.compare-line', icon('git-compare'), t('report.vsPrevious'),
      counts.fixed > 0 && chip('pass', t('report.fixed', { n: counts.fixed })), counts.regressed > 0 && chip('fail', t('report.regressed', { n: counts.regressed })),
      counts.stillFailing > 0 && chip('warn', t('report.stillFailing', { n: counts.stillFailing })),
      h('button.btn.ghost.small', { onclick: () => { ctx.ui.tab = 'history'; ctx.rerender(); } }, t('report.openComparison'), icon('arrow-right')))));
  }
  const errors = h('div.errors');
  for (const [label, text] of [
    [t('result.deliveryError'), d.deliveryError],
    [t('result.makeError'), d.makeError],
    [t('result.banned'), d.bannedFunctions?.length ? d.bannedFunctions.join(', ') : null],
  ] as Array<[string, string | null]>) {
    if (text) errors.append(h('div.notice.error', icon('error'), h('div', h('strong', label), h('pre.trace-mini', text))));
  }
  if (errors.childElementCount) root.append(errors);
  if (!d.tasks.length) for (const evidence of resultEvidence(d)) {
    const analysis = renderTaskAnalysis(ctx, projectId, evidence);
    if (analysis) root.append(analysis);
  }

  if (d.tasks.length > 0) {
    const q = ctx.ui.traceQuery.trim().toLowerCase();
    const tasks = q ? d.tasks.filter(x => x.name.toLowerCase().includes(q) || x.trace.toLowerCase().includes(q)) : d.tasks;
    const passedCount = d.tasks.filter(x => x.status === 'passed').length;
    root.append(h('div.tasks-head',
      h('h3', t('result.tasks'), h('span.counter', `${passedCount}/${d.tasks.length}`)),
      h('div.searchbar.small', icon('search'), h('input.search', { type: 'search', placeholder: t('result.filterTraces'), 'aria-label': t('result.filterTraces'), value: ctx.ui.traceQuery, dataset: { keep: 'trace' },
        oninput: (e: Event) => ((ctx.ui.traceQuery = (e.target as HTMLInputElement).value), ctx.rerender()) }))));
    const failing = tasks.filter(x => x.status !== 'passed'), passing = tasks.filter(x => x.status === 'passed');
    const list = h('div.g-list');
    failing.forEach((task, i) => list.append(taskRow(ctx, d, task, q, projectId, i + 1)));
    if (passing.length && (q || !failing.length)) passing.forEach((task, i) => list.append(taskRow(ctx, d, task, q, projectId, failing.length + i + 1)));
    root.append(part(list));
    if (passing.length && !q && failing.length) {
      const shown = ctx.ui.showPassed?.has(d.id) ?? false;
      const group = h('details.passed-group', { open: shown, ontoggle: (e: Event) => {
        const set = ctx.ui.showPassed ??= new Set();
        if ((e.target as HTMLDetailsElement).open) set.add(d.id); else set.delete(d.id);
      } }, h('summary', gut(null, 'pass'), icon('chevron-right', 'chev'), h('span.muted.small', t('report.passed', { n: passing.length }))));
      if (shown) passing.forEach((task, i) => group.append(taskRow(ctx, d, task, q, projectId, failing.length + i + 1)));
      root.append(group);
    }
    if (tasks.length === 0) root.append(h('p.muted.small', t('list.noMatch')));
  } else if (d.total === 0) {
    root.append(h('p.muted.small', t('result.noTasks')));
  }

  if (d.rawTrace || d.staticTrace || d.coverage.log) {
    const raw = h('details.raw', { dataset: { detailId: 'raw-output' } }, h('summary', icon('chevron-right', 'chev'), t('result.fullOutput')));
    if (d.rawTrace) raw.append(traceBlock(d.rawTrace, '', t('result.moulinette'), ctx));
    if (d.staticTrace) raw.append(traceBlock(d.staticTrace, '', t('result.static'), ctx));
    if (d.coverage.log) raw.append(traceBlock(d.coverage.log, '', t('result.coverageLog'), ctx));
    root.append(raw);
  }
}

function taskTone(task: TestTask): Tone {
  return task.status === 'passed' ? 'pass' : task.status === 'failed' ? (task.crashed > 0 || task.passed === 0 ? 'fail' : 'warn') : 'muted';
}

function taskRow(ctx: Ctx, d: TestResultDetail, task: TestTask, query: string, projectId: number, n: number): HTMLElement {
  const key = `${d.id}:${task.name}`;
  const firstFailure = d.tasks.find(x => x.status === 'failed') === task;
  const defaultOpen = query.length > 0 || (firstFailure && d.tasks.filter(x => x.status === 'failed').length <= 3);
  const open = defaultOpen !== ctx.ui.openTasks.has(key);
  const toggle = () => {
    if (ctx.ui.openTasks.has(key)) ctx.ui.openTasks.delete(key);
    else ctx.ui.openTasks.add(key);
    ctx.rerender();
  };
  const row = h('div.task', { class: `${task.status} ${open ? 'open' : ''}` },
    h('button.g-row.task-head', { 'aria-expanded': String(open), onclick: toggle },
      gut(n, taskTone(task)),
      h('span.g-main', icon('chevron-right', 'chev'), h('span.name', task.name),
        task.crashed > 0 && chip('fail', ctx.t('result.crashed', { n: task.crashed })),
        task.mandatoryFailed > 0 && chip('fail', ctx.t('result.mandatory', { n: task.mandatoryFailed }))),
      h('span.g-side', task.count > 0 ? `${task.passed}/${task.count}` : '')));
  if (open) {
    const body = h('div.task-body');
    const analysis = renderTaskAnalysis(ctx, projectId, taskEvidence(d, task));
    if (analysis) body.append(analysis);
    body.append(task.trace ? traceBlock(task.trace, query, ctx.t('result.output'), ctx) : h('p.muted.small', ctx.t('result.noOutput')));
    const grader = ctx.graders.get(projectId);
    if (grader) body.append(history(ctx, grader, task.name));
    if (task.status === 'failed') body.append(h('div.actions',
      h('button.btn.small', { disabled: ctx.reproductions.get(projectId)?.status === 'running', onclick: () => ctx.post({ type: 'reproduce', projectId, resultId: d.id, task: task.name }) }, icon('debug-alt'), ctx.t('reproduce.run')),
      h('button.icon-btn.small', { title: ctx.t('reproduce.configure'), 'aria-label': ctx.t('reproduce.configure'), onclick: () => ctx.post({ type: 'reproduce', projectId, resultId: d.id, task: task.name, configure: true }) }, icon('settings-gear'))));
    if (task.steps.length) body.append(h('ul.steps', task.steps.map(s => h('li', { class: s.ok === true ? 'ok' : s.ok === false ? 'ko' : '' }, icon(s.ok === true ? 'check' : s.ok === false ? 'close' : 'circle-small'), s.label))));
    row.append(body);
  }
  return row;
}

function highlight(line: string, query: string): Array<Node | string> {
  if (!query) return [line];
  const out: Array<Node | string> = [];
  const lower = line.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, i)) {
    out.push(line.slice(i, at), h('mark', line.slice(at, at + query.length)));
    i = at + query.length;
  }
  out.push(line.slice(i));
  return out;
}

function lineClass(line: string): string {
  if (/^#\s*OK\b|:\s+(SUCCESS|PASSED)\s*$/.test(line)) return 'l-ok';
  if (/^#\s*(KO|FAIL|FAILED|CRASH|TIMEOUT|ERROR)\b|:\s+(FAILED|FAIL|KO|CRASH|ERROR)\s*$|\berror:/i.test(line)) return 'l-ko';
  if (/segmentation fault|core dumped|\babort|timed? ?out|\bfailed\b/i.test(line)) return 'l-ko';
  if (/\bwarning:/i.test(line)) return 'l-warn';
  if (/^#\s/.test(line) || /^~\/\.>/.test(line)) return 'l-dim';
  return '';
}

/** Log viewer with a line-number gutter, like the editor. */
export function traceBlock(text: string, query: string, label: string, ctx: Ctx): HTMLElement {
  const q = query.toLowerCase();
  const pre = h('pre.trace', { tabindex: 0, 'aria-label': label });
  text.split('\n').forEach((line, i) => pre.append(h('span.line', { class: lineClass(line), dataset: { n: String(i + 1) } }, ...highlight(line, q))));
  return h('div.trace-wrap',
    h('div.trace-bar', h('span.tiny', label), h('button.icon-btn.small', { title: ctx.t('action.copy'), 'aria-label': ctx.t('action.copy'), onclick: () => ctx.post({ type: 'copy', text, what: label }) }, icon('copy'))),
    pre);
}

export function commitButton(ctx: Ctx, projectId: number, commit: string, large = false): HTMLElement {
  const valid = /^[a-f0-9]{40}$/i.test(commit) && !/^0+$/.test(commit);
  return h('button.label.btn-tag.mono', {
    class: large ? 'large' : '', disabled: !valid, title: `${commit} · ${ctx.t(valid ? 'commit.actions' : 'commit.invalid')}`,
    onclick: (e: Event) => { e.stopPropagation(); ctx.post({ type: 'openCommit', projectId, commit }); },
  }, icon('git-commit'), shortSha(commit), icon('chevron-down'));
}

export function commitStatus(ctx: Ctx, projectId: number, commit: string): HTMLElement {
  const state = ctx.state.commitStates?.[projectId];
  const equal = state?.head.toLowerCase() === commit.toLowerCase();
  const key = !state ? 'unknown' : !equal ? 'different' : state.dirty ? 'dirty' : 'current';
  const tone = key === 'current' ? 't-pass' : key === 'unknown' ? '' : 't-warn';
  return h('span.chip', { class: tone, title: state ? `HEAD: ${state.head}` : '' },
    icon(key === 'current' ? 'check' : 'info'), ctx.t(`commit.${key}`),
    state?.dirty && !equal ? ` · ${ctx.t('commit.dirty')}` : '');
}

/** The commit the Grader will evaluate next, as reported by the Grader itself. */
export function remoteCommit(ctx: Ctx, projectId: number, grader: GraderVM): HTMLElement {
  const remote = grader.remoteCommit;
  const ready = remote?.status === 'ready' && remote.sha;
  return h('div.remote-commit', h('span', ctx.t('remote.title')),
    h('div.actions', ready ? h('button.label.btn-tag.mono', { title: [remote.sha, remote.branch].filter(Boolean).join(' · '), onclick: () => {
      if (remote.commitUrl) { ctx.post({ type: 'openExternal', url: remote.commitUrl }); return; }
      const repo = ctx.state.projects?.find(p => p.id === projectId)?.repoLink;
      if (repo && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(repo)) ctx.post({ type: 'openExternal', url: `${repo.replace(/\.git\/?$/, '').replace(/\/$/, '')}/commit/${remote.sha}` });
      else ctx.post({ type: 'copy', text: remote.sha! });
    } }, icon('git-commit'), shortSha(remote.sha), h('span.muted', remote.branch ?? '')) : h('span', ctx.t(remote?.status === 'loading' ? 'remote.loading' : 'remote.unavailable')),
    h('button.icon-btn.small', { disabled: remote?.status === 'loading', title: ctx.t('remote.refresh'), 'aria-label': ctx.t('remote.refresh'), onclick: () => ctx.post({ type: 'refreshRemoteCommit', projectId }) }, icon('refresh'))));
}
