import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPipeline as renderReadiness } from '../webview/views/pipeline';
import { renderReadout } from '../webview/views/readout';
import { renderComparison } from '../webview/views/comparison';
import { renderReproduction } from '../webview/views/reproduction';
import { renderProject } from '../webview/views/detail';
import { renderActivities } from '../webview/views/activities';
import { renderList } from '../webview/views/list';
import { renderGrader } from '../webview/views/grader';
import { renderValgrind } from '../webview/views/valgrind';
import { createT } from '../shared/i18n';
import type { Ctx } from '../webview/ctx';
import type { ProjectVM, GraderVM, TestResultDetail, TestResultSummary } from '../shared/types';
import type { ReadinessVM } from '../shared/deliveryTypes';
import { renderOutputDiff } from '../webview/views/graderAnalysis';
import { renderAvailability, renderLensRestriction } from '../webview/views/availability';
import { remoteStatus, type RemoteConfig } from '../domain/remotePolicy';

/** Test the rendered controls and their host messages without requiring a browser server. */
class DomNode {
  childNodes: DomNode[] = [];
  constructor(public value = '') {}
  append(...nodes: Array<DomNode | string>) { this.childNodes.push(...nodes.map(n => typeof n === 'string' ? new DomNode(n) : n)); }
  prepend(...nodes: Array<DomNode | string>) { this.childNodes.unshift(...nodes.map(n => typeof n === 'string' ? new DomNode(n) : n)); }
  replaceChildren(...nodes: Array<DomNode | string>) { this.childNodes = []; this.append(...nodes); }
  get textContent(): string { return this.value + this.childNodes.map(n => n.textContent).join(' '); }
  set textContent(value: string) { this.value = value; this.childNodes = []; }
}
class DomElement extends DomNode {
  attrs: Record<string, string> = {}; dataset: Record<string, string> = {}; style = {}; events: Record<string, (e: unknown) => void> = {}; open = false; hidden = false;
  className = ''; classList = { add: (...classes: string[]) => { this.className += ` ${classes.join(' ')}`; } };
  constructor(readonly tagName: string) { super(); }
  addEventListener(name: string, fn: (e: unknown) => void) { const old = this.events[name]; this.events[name] = e => { old?.(e); fn(e); }; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  all(tag: string): DomElement[] { return [this, ...this.childNodes.flatMap(n => n instanceof DomElement ? n.all(tag) : [])].filter(e => e.tagName === tag); }
  get firstElementChild(): DomElement | null { return this.childNodes.find(n => n instanceof DomElement) as DomElement ?? null; }
  get childElementCount(): number { return this.childNodes.filter(n => n instanceof DomElement).length; }
  querySelectorAll(selector: string): DomElement[] { return selector.split(',').flatMap(tag => this.all(tag.trim())).filter(node => node !== this); }
  click() { this.events.click?.({ preventDefault() {} }); }
  focus() {}
}
Object.assign(globalThis, { Node: DomNode, document: { createElement: (tag: string) => new DomElement(tag), createTextNode: (text: string) => new DomNode(text),
  createElementNS: (_namespace: string, tag: string) => new DomElement(tag), querySelector: () => null } });
function context() {
  const messages: unknown[] = [];
  const project = { id: 1, name: 'Project', registered: true, repoEnabled: true, endDate: new Date(Date.now() + 86_400_000).toISOString() } as ProjectVM;
  const grader: GraderVM = { projectId: 1, loading: false, error: null, running: false, canRun: true, reason: null, quota: { total: 3, remaining: 2, consumed: 1, override: null }, history: [], runs: [] };
  const ctx = { t: createT('fr'), lang: 'fr', state: { commitStates: { 1: { head: 'a'.repeat(40), dirty: false, ahead: 0, hasUpstream: true } } },
    ui: { comparisons: {}, selectedResult: {}, traceQuery: '', openTasks: new Set() }, graders: new Map([[1, grader]]), results: new Map(), readiness: new Map(), styleScans: new Map(), functionRules: new Map([[1, { names: [] }]]), reproductions: new Map(), guided: new Map(), post: (message: unknown) => messages.push(message), rerender() {} } as unknown as Ctx;
  return { ctx, project, grader, messages };
}
const summary = (id: number): TestResultSummary => ({ id, date: '2026-10-11T12:00:00Z', score: 50, commit: String(id).repeat(40), skills: [],
  passed: 1, total: 2, flags: [], style: { fatal: 0, major: 0, minor: 0, info: 0 }, prerequisitesMark: null });

test('revoked access renders a branded alert with two paragraphs and functional Appeal/Uninstall buttons', () => {
  const { ctx, messages } = context();
  ctx.t = createT('en');
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.3', latest: '', authorized: [], banned: [{ user: 'niels', features: ['lens_active', 'my_api_active'] }] };
  ctx.state.availability = remoteStatus(policy, '0.5.3', 'nielsLaptop');
  const rendered = renderAvailability(ctx)!;
  assert.equal(rendered.key, 'connection-refused');
  const root = rendered.node as unknown as DomElement;
  assert.match(root.textContent, /Your access has been revoked/);
  assert.match(root.textContent, /No reason was given/);
  assert.match(root.textContent, /The Bananabox team/);
  assert.match(root.textContent, /Microsoft Teams/);
  assert.ok(root.all('section').some(element => element.attrs.role === 'alert'));
  assert.ok(root.all('span').some(element => element.className.includes('codicon-shield')));
  const copy = root.all('div').find(element => element.className.split(' ').includes('access-copy'))!;
  assert.equal(copy.all('p').length, 1);
  const buttons = root.all('button');
  assert.equal(buttons.length, 3);
  buttons.find(button => button.textContent.includes('Appeal'))!.click();
  buttons.find(button => button.textContent.includes('Uninstall'))!.click();
  assert.deepEqual(messages, [{ type: 'appeal' }, { type: 'uninstall' }]);
});

test('a promotion ban says whom it targets, why, who decided and what still works', () => {
  const { ctx } = context();
  ctx.t = createT('en');
  const policy: RemoteConfig = {
    lens_active: true, my_api_active: true, version: '0.5.3', latest: '', authorized: [], banned: [],
    banned_groups: [{ scope: 'promotion', value: 'pge:2027', features: ['my_api_active'], reason: 'API abuse', by: 'admin.one', since: Date.UTC(2026, 10, 20) }],
  };
  ctx.state.availability = remoteStatus(policy, '0.5.3', 'zoe', false, { promotion: 2027, cursus: 'pge', campus: 'Paris' });
  const text = (renderAvailability(ctx)!.node as unknown as DomElement).textContent;
  for (const expected of [/Your promotion/, /pge:2027/, /API abuse/, /admin\.one/, /2026/, /Lens \(coding style\)\s*Available/, /My interface \(MyEpitech\)\s*Restricted/]) assert.match(text, expected);
  ctx.state.availability = remoteStatus(policy, '0.5.3', 'zoe', false, { promotion: 2027, cursus: 'bachelor', campus: 'Paris' });
  assert.equal(renderAvailability(ctx), null, 'another cursus of the same year is not concerned');
});

test('a campus ban hides the banner name when anonymous and only shows the Lens notice for Lens bans', () => {
  const { ctx } = context();
  ctx.t = createT('en');
  const policy: RemoteConfig = {
    lens_active: true, my_api_active: true, version: '0.5.3', latest: '', authorized: [], banned: [],
    banned_groups: [{ scope: 'campus', value: 'Sète', features: ['lens_active'], reason: null, by: null }],
  };
  ctx.state.availability = remoteStatus(policy, '0.5.3', 'zoe', false, { promotion: null, cursus: null, campus: 'sete' });
  assert.equal(renderAvailability(ctx), null, 'a Lens-only ban leaves the My interface usable');
  const notice = (renderLensRestriction(ctx) as unknown as DomElement).textContent;
  assert.match(notice, /Your campus/);
  assert.match(notice, /The Bananabox team/);
});

test('My disabled screen exposes Refresh, Uninstall and Fetch version before sign-in', () => {
  const { ctx, messages } = context();
  ctx.t = createT('en');
  ctx.state.availability = remoteStatus({ lens_active: true, my_api_active: false, version: '0.5.3', latest: '', authorized: [], banned: [] }, '0.5.3', 'guest');
  const rendered = renderAvailability(ctx)!;
  assert.equal(rendered.key, 'api-disabled');
  const root = rendered.node as unknown as DomElement;
  assert.match(root.textContent, /rate limits or suspension/);
  const buttons = root.all('button');
  assert.equal(buttons.length, 4);
  for (const label of ['Refresh', 'Uninstall', 'Fetch version']) buttons.find(button => button.textContent.includes(label))!.click();
  assert.deepEqual(messages, [{ type: 'refresh' }, { type: 'uninstall' }, { type: 'fetchVersion' }]);
});

test('Lens-only restriction leaves My usable and shows a notice; My-only restriction preserves Lens', () => {
  const { ctx, messages } = context();
  ctx.t = createT('en');
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.3', latest: '', authorized: [], banned: [{ user: 'niels', features: ['lens_active'] }] };
  ctx.state.availability = remoteStatus(policy, '0.5.3', 'nielsLaptop');
  assert.equal(renderAvailability(ctx), null);
  const notice = renderLensRestriction(ctx) as unknown as DomElement;
  assert.match(notice.textContent, /Lens access has been revoked/);
  assert.match(notice.textContent, /does not block access to My/);
  notice.all('button')[0].click();
  assert.deepEqual(messages.at(-1), { type: 'appeal' });
  ctx.state.availability = remoteStatus({ ...policy, banned: [{ user: 'niels', features: ['my_api_active'] }] }, '0.5.3', 'nielsLaptop');
  assert.equal(renderLensRestriction(ctx), null);
  assert.equal(ctx.state.availability.lensActive, true);
  assert.match(renderAvailability(ctx)!.node.textContent!, /access to 'My' has been revoked/);
});

test('endpoint activity displays only observed counters and handles an empty session without invented calls', () => {
  const { ctx } = context(); ctx.t = createT('en');
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.5', latest: '', authorized: [], banned: [{ user: 'niels', features: ['lens_active', 'my_api_active'] }] };
  ctx.state.apiActivity = { startedAt: 1234, endpoints: [
    { method: 'GET', route: '/api/students/profile', calls: 7, rateLimitedResponses: 1 },
    { method: 'POST', route: '/api/auth/refresh', calls: 2, rateLimitedResponses: 0 },
  ] };
  for (const bannedFeatures of [['my_api_active'], ['lens_active', 'my_api_active']] as const) {
    ctx.state.availability = remoteStatus({ ...policy, banned: [{ user: 'niels', features: [...bannedFeatures] }] }, '0.5.5', 'niels');
    const root = renderAvailability(ctx)!.node as unknown as DomElement;
    assert.match(root.textContent, /Endpoints called/);
    assert.match(root.textContent, /Local session/);
    assert.match(root.textContent, /do not establish why access was revoked/);
    assert.match(root.textContent, /HTTP 429/);
    assert.doesNotMatch(root.textContent, /Illustrative|Example|random/);
    assert.ok(root.all('code').every(element => element.textContent.startsWith('/api/')));
    const rerendered = renderAvailability(ctx)!.node as unknown as DomElement;
    assert.equal(root.all('table')[0].textContent, rerendered.all('table')[0].textContent);
    const rows = root.all('tbody')[0].all('tr');
    assert.deepEqual(rows.map(row => row.all('td').slice(1).map(cell => cell.textContent)), [['7', '1'], ['2', '0']]);
  }
  ctx.state.apiActivity = { startedAt: 1234, endpoints: [] };
  let empty = renderAvailability(ctx)!.node as unknown as DomElement;
  assert.match(empty.textContent, /No API calls have been observed/);
  assert.equal(empty.all('table').length, 0);
  delete ctx.state.apiActivity;
  empty = renderAvailability(ctx)!.node as unknown as DomElement;
  assert.match(empty.textContent, /No API calls have been observed/);
  ctx.state.availability = remoteStatus({ ...policy, banned: [], my_api_active: false }, '0.5.5', 'niels');
  assert.equal((renderAvailability(ctx)!.node as unknown as DomElement).all('table').length, 0);
  ctx.state.availability = remoteStatus(policy, '0.5.5', 'niels', true);
  assert.equal((renderAvailability(ctx)!.node as unknown as DomElement).all('table').length, 0);
});

test('Refresh VSCode is disabled until uninstallation succeeds on every page with uninstall controls', () => {
  const { ctx, messages } = context(); ctx.t = createT('en');
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.5', latest: '', authorized: [], banned: [{ user: 'niels', features: ['lens_active', 'my_api_active'] }] };
  const scenarios = [
    remoteStatus(policy, '0.5.5', 'niels'),
    remoteStatus({ ...policy, banned: [{ user: 'niels', features: ['my_api_active'] }] }, '0.5.5', 'niels'),
    remoteStatus({ ...policy, banned: [{ user: 'niels', features: ['lens_active'] }] }, '0.5.5', 'niels'),
    remoteStatus({ ...policy, banned: [], my_api_active: false }, '0.5.5', 'niels'),
    remoteStatus({ ...policy, banned: [] }, '0.5.4', 'niels'),
  ];
  for (const state of scenarios) {
    ctx.state.availability = state;
    for (const uninstall of [undefined, 'uninstalling', 'error', 'uninstalled'] as const) {
      state.uninstall = uninstall;
      const root = (renderAvailability(ctx)?.node ?? renderLensRestriction(ctx)) as unknown as DomElement;
      const refresh = root.all('button').find(button => button.textContent.trim() === 'Refresh VSCode')!;
      assert.ok(refresh);
      assert.equal('disabled' in refresh.attrs, uninstall !== 'uninstalled');
      const before = messages.length;
      refresh.click();
      assert.equal(messages.length - before, uninstall === 'uninstalled' ? 1 : 0);
    }
  }
  assert.ok(messages.every(message => (message as any).type === 'refreshVSCode'));
});

test('offline and version restrictions keep priority over usable feature settings', () => {
  const { ctx } = context();
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.3', latest: '', authorized: [], banned: [{ user: 'niels', features: ['lens_active'] }] };
  ctx.state.availability = remoteStatus(policy, '0.5.3', 'nielsLaptop', true);
  assert.equal(renderAvailability(ctx)!.key, 'offline-disabled');
  assert.equal(renderLensRestriction(ctx), null);
  ctx.state.availability = remoteStatus(policy, '0.5.2', 'nielsLaptop');
  assert.equal(renderAvailability(ctx)!.key, 'version-disabled');
  assert.equal(renderLensRestriction(ctx), null);
});

test('update view shows real download progress and enables Reload VSCode only after installation succeeds', () => {
  const { ctx, messages } = context();
  ctx.t = createT('en');
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.5.3', latest: '', authorized: [], banned: [] };
  const state = remoteStatus(policy, '0.5.2', 'guest');
  ctx.state.availability = state;
  for (const phase of ['idle', 'downloading', 'verifying', 'installing', 'error', 'installed'] as const) {
    state.update = phase;
    state.updateProgress = { receivedBytes: 45, totalBytes: 100 };
    const root = renderAvailability(ctx)!.node as unknown as DomElement;
    assert.match(root.textContent, /v0\.5\.2/);
    assert.match(root.textContent, /v0\.5\.3/);
    assert.match(root.textContent, /Your version/);
    assert.match(root.textContent, /New version/);
    assert.match(root.textContent, /Update needed/);
    assert.match(root.textContent, /Recommended/);
    assert.equal(root.all('li').length, 3);
    const reload = root.all('button').find(button => button.textContent.includes('Reload VSCode'))!;
    assert.ok(reload);
    assert.equal('disabled' in reload.attrs, phase !== 'installed');
    reload.click();
    assert.equal(messages.length, phase === 'installed' ? 1 : 0);
    const progress = root.all('div').find(element => element.attrs.role === 'progressbar')!;
    assert.equal(progress.attrs['aria-valuenow'], phase === 'downloading' ? '45' : phase === 'installed' ? '100' : undefined);
    assert.equal(progress.className.includes('indeterminate'), ['idle', 'verifying', 'installing'].includes(phase));
  }
  assert.deepEqual(messages, [{ type: 'reloadVSCode' }]);
  state.update = 'downloading'; state.updateProgress = { receivedBytes: 42 };
  let root = renderAvailability(ctx)!.node as unknown as DomElement;
  assert.equal(root.all('div').find(element => element.attrs.role === 'progressbar')!.attrs['aria-valuenow'], undefined);
  state.update = 'error'; state.updateError = 'Download failed';
  root = renderAvailability(ctx)!.node as unknown as DomElement;
  assert.match(root.all('details')[0].textContent, /Download failed/);
  root.all('button').find(button => button.textContent.includes('Retry update'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'refresh' });
});

test('readiness renders clear next actions, handles stale evidence and resumes a paused flow', () => {
  const { ctx, project, messages } = context();
  const vm: ReadinessVM = { projectId: 1, status: 'done', configured: false, detected: true, taskCount: 2, commands: ['make -C task01', 'make -C task02'], stale: false,
    checks: ['style', 'build', 'tests', 'files', 'functions', 'binary'].map(id => ({ id: id as any, status: 'pass', detail: 'OK' })), checkedAt: Date.now(), error: null, commit: null };
  ctx.readiness.set(1, vm);
  const root = renderReadiness(ctx, project) as unknown as DomElement;
  assert.equal(root.tagName, 'section');
  assert.equal(root.dataset.detailId, 'readiness');
  assert.equal(root.all('button').filter(b => b.className.includes('readiness-check')).length, 10);
  assert.match(root.textContent, /Prêt pour le grader/); assert.match(root.textContent, /Commandes détectées automatiquement/);
  root.all('button').find(b => b.textContent.includes('Préparer le rendu'))!.click();
  assert.deepEqual(messages[0], { type: 'guidedDelivery', projectId: 1, milestone: 'delivery' });
  vm.stale = true;
  ctx.guided.set(1, { projectId: 1, status: 'paused', step: 'check', completed: ['save'], message: null });
  const resumed = renderReadiness(ctx, project) as unknown as DomElement;
  assert.match(resumed.textContent, /Bilan à actualiser/); assert.match(resumed.textContent, /Reprendre le rendu/);
});

test('comparison automatically follows new attempts while manual selection remains available', () => {
  const { ctx, grader, messages } = context();
  grader.history = [1, 2, 3].map(summary);
  let root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.equal(root.tagName, 'details'); assert.equal(root.dataset.detailId, 'grader-comparison'); assert.equal(root.open, true);
  assert.match(root.textContent, /Comparaison automatique/);
  assert.equal(root.all('details').length, 1); // No extra disclosure hides the two selectors.
  assert.equal(root.all('select').length, 2);
  for (const select of root.all('select')) assert.equal(select.all('option').length, 3);
  // Changing a filter keeps automatic tracking enabled.
  ctx.ui.comparisons[1] = { before: 2, after: 3, filter: 'regressed' };
  grader.history.push({ ...grader.history[2], id: 4 });
  renderComparison(ctx, grader);
  assert.ok(messages.some(m => (m as any).resultId === 4));
  // Selecting a particular report opts into manual mode.
  root = renderComparison(ctx, grader) as unknown as DomElement;
  root.all('select')[0].events.change({ target: { value: '1' } });
  assert.equal(ctx.ui.comparisons[1].automatic, false);
  root = renderComparison(ctx, grader) as unknown as DomElement;
  root.all('select')[1].events.change({ target: { value: '2' } });
  assert.deepEqual(ctx.ui.comparisons[1], { before: 1, after: 2, filter: 'regressed', automatic: false });
  grader.history.push({ ...grader.history[3], id: 5 });
  root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.ok(!messages.some(m => (m as any).resultId === 5));
  root.all('button').find(b => b.textContent.includes('Suivre les derniers essais'))!.click();
  renderComparison(ctx, grader);
  assert.ok(messages.some(m => (m as any).resultId === 5));
});

test('comparison exposes automatic diagnostics, named-test changes and clickable evidence locations', () => {
  const { ctx, grader, messages } = context();
  grader.history = [1, 2].map(summary);
  for (const id of [1, 2]) ctx.results.set(id, { loading: false, error: null, detail: {
    ...grader.history[id - 1], rawTrace: null, staticTrace: null, coverage: { lines: null, branches: null, log: null }, makeError: null, deliveryError: null, bannedFunctions: null,
    tasks: [{ name: 'task01', count: 2, passed: 1, crashed: 0, mandatoryFailed: 0, status: 'failed',
      trace: id === 1 ? '[FAIL] suite::empty\nProcess timed out' : '[PASS] suite::empty\nsrc/main.c:8:2: error: missing value', steps: [] }] } });
  const root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.match(root.textContent, /Analyse automatique des traces/);
  assert.match(root.textContent, /Erreur de compilation/);
  assert.match(root.textContent, /Tests identifiés : 1 corrigés/);
  assert.match(root.textContent, /Une absence dans ce log ne prouve pas une correction/);
  root.all('button').find(b => b.textContent.includes('src/main.c:8'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openFile', projectId: 1, file: 'src/main.c', line: 8, column: 2, task: 'task01' });
});

test('comparison defaults to the latest two attempts and loads only those reports', () => {
  const { ctx, grader, messages } = context();
  grader.history = [1, 2, 3].map(summary);
  renderComparison(ctx, grader);
  assert.deepEqual(messages, [{ type: 'loadResult', projectId: 1, resultId: 2 }, { type: 'loadResult', projectId: 1, resultId: 3 }]);
  for (const id of [2, 3]) ctx.results.set(id, { loading: false, error: null, detail: { ...grader.history[id - 1],
    rawTrace: null, staticTrace: null, coverage: { lines: null, branches: null, log: null }, makeError: null, deliveryError: null, bannedFunctions: null,
    tasks: [{ name: 'task01', count: 3, passed: id === 2 ? 3 : 2, crashed: 0, mandatoryFailed: 0, status: id === 2 ? 'passed' : 'failed', trace: 'log', steps: [] }] } satisfies TestResultDetail });
  const root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.match(root.textContent, /Régressions/); assert.match(root.textContent, /3\/3 → 2\/3/);
  root.all('button').find(b => b.textContent.includes('Ouvrir le diff'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'compareCommits', projectId: 1, before: 2, after: 3 });
});

test('automatic build reproduction explains its scope and exposes a one-click rerun', () => {
  const { ctx, messages } = context();
  ctx.reproductions.set(1, { projectId: 1, resultId: 3, task: 'task01', status: 'passed', mode: 'build', detected: true, command: 'make -C task01', stdout: 'compiled', stderr: '', expectedStdout: null, expectedExitCode: 0, exitCode: 0, durationMs: 100, error: null });
  const root = renderReproduction(ctx, 1) as unknown as DomElement;
  assert.match(root.textContent, /La tâche compile/); assert.match(root.textContent, /tests cachés du grader ne sont pas reproduits/);
  root.all('button').find(b => b.textContent.includes('Relancer'))!.click();
  assert.deepEqual(messages[0], { type: 'reproduce', projectId: 1, resultId: 3, task: 'task01' });
});

test('inline function input adds lists, rejects invalid names, removes chips and retains an unfinished draft', () => {
  const { ctx, project, messages } = context();
  ctx.ui.pipelineFocus = { 1: 'functions' };
  let root = renderReadiness(ctx, project) as unknown as DomElement;
  let input = root.all('input').find(i => i.attrs['aria-label'] === createT('fr')('functions.input'))!, form = root.all('form').find(f => f.className.includes('function-rule-form'))!;
  input.value = 'write, printf'; form.events.submit({ preventDefault() {} });
  assert.deepEqual(messages.at(-1), { type: 'setFunctionRules', projectId: 1, names: ['write', 'printf'] });
  assert.equal(ctx.functionRules.get(1)?.pending, true);
  ctx.functionRules.set(1, { names: ['write', 'printf'] });
  root = renderReadiness(ctx, project) as unknown as DomElement;
  input = root.all('input').find(i => i.attrs['aria-label'] === createT('fr')('functions.input'))!; form = root.all('form').find(f => f.className.includes('function-rule-form'))!;
  input.value = 'system'; input.events.input({ target: { value: 'system' } });
  root = renderReadiness(ctx, project) as unknown as DomElement;
  assert.equal(root.all('input').find(i => i.attrs['aria-label'] === createT('fr')('functions.input'))!.value, 'system');
  input = root.all('input').find(i => i.attrs['aria-label'] === createT('fr')('functions.input'))!; form = root.all('form').find(f => f.className.includes('function-rule-form'))!;
  input.value = 'printf(42)'; const count = messages.length;
  form.events.submit({ preventDefault() {} });
  assert.equal(messages.length, count);
  assert.equal(root.all('div').find(d => d.className.includes('function-rule-error'))!.hidden, false);
  root.all('button').find(b => b.attrs['aria-label'] === 'Supprimer write')!.click();
  assert.deepEqual(messages.at(-1), { type: 'setFunctionRules', projectId: 1, names: ['printf'] });
});

test('Grader tab holds the run control and the selected run, no preparation; the readout carries tokens in fixed cells', () => {
  const { ctx, project, grader } = context();
  grader.history = [1, 2].map(summary);
  ctx.ui.selectedResult[1] = 2;
  for (const run of grader.history) ctx.results.set(run.id, { loading: false, error: null, detail: { ...run, rawTrace: null, staticTrace: null,
    coverage: { lines: null, branches: null, log: null }, makeError: null, deliveryError: null, bannedFunctions: null,
    tasks: ['task01', 'task02'].map(name => ({ name, count: 1, passed: 0, crashed: 0, mandatoryFailed: 0, status: 'failed', trace: '', steps: [] })) } });
  let root = renderGrader(ctx, project) as unknown as DomElement;
  const loop = root.all('div').find(d => d.className.includes('loop'))!;
  const control = loop.all('div').find(d => d.className.includes('grader-control'))!;
  const report = loop.all('section').find(d => d.dataset.detailId === 'grader-runs')!;
  assert.equal(control.all('section').some(s => s.dataset.detailId === 'readiness'), false);
  assert.ok(control.all('button').some(b => b.textContent.includes('Lancer')));
  assert.ok(report.className.includes('inline-result')); assert.match(report.textContent, /Essai/);
  // Two failures: the first opens on its own, the second stays one line.
  assert.deepEqual(report.all('button').filter(b => b.className.includes('task-head')).map(b => b.attrs['aria-expanded']), ['true', 'false']);
  const readout = renderReadout(ctx, project) as unknown as DomElement;
  assert.match(readout.textContent, /Jetons/);
  assert.ok(readout.all('div').some(d => d.className.split(' ').includes('tokens')));
  assert.equal(readout.all('div').filter(d => d.className.includes('chart')).length, 0); // the readout is fixed cells; the chart lives in History
  report.all('button').find(b => b.attrs['aria-label'] === 'Essai précédent')!.click(); assert.equal(ctx.ui.selectedResult[1], 1);
  root = renderGrader(ctx, project) as unknown as DomElement;
  const first = root.all('section').find(d => d.dataset.detailId === 'grader-runs')!;
  assert.equal(first.all('select')[0].value, '1');
  first.all('button').find(b => b.attrs['aria-label'] === 'Essai suivant')!.click();
  assert.equal(ctx.ui.selectedResult[1], 2);
});


test('project page reads header, readout, tabs; the project style scan sits in the Style stage', () => {
  const { ctx, project, messages } = context();
  Object.assign(project, { startDate: '2026-10-01T12:00:00Z', midDate: '2026-10-08T12:00:00Z', status: 'ongoing', responsibles: [] });
  ctx.activities = new Map([[1, []]]); ctx.activityErrors = new Map();
  for (const tab of ['details', 'grader'] as const) {
    ctx.ui.tab = tab;
    const root = renderProject(ctx, project) as unknown as DomElement;
    const children = root.childNodes.filter(n => n instanceof DomElement) as DomElement[];
    assert.deepEqual(children.slice(0, 4).map(n => n.tagName), ['header', 'section', 'nav', 'div']);
    assert.match(children[1].className, /readout/);
    assert.match(children[2].className, /ms-strip/);
    assert.match(children[3].className, /tabs/);
    assert.ok(children[3].all('button').some(n => n.textContent.includes('Activités')));
  }
  ctx.ui.pipelineFocus = { 1: 'style' };
  const pipeline = renderReadiness(ctx, project) as unknown as DomElement;
  assert.equal(pipeline.all('div').filter(n => n.dataset.detailId === 'coding-style').length, 1);
  pipeline.all('button').find(b => b.textContent.includes('Analyser le projet'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'scanStyle', projectId: 1 });
});


test('comparison uses history breakdowns for sparse details and keeps totals independent of filters', () => {
  const { ctx, grader } = context();
  grader.history = [1, 2].map(id => ({ ...summary(id), score: id === 1 ? 25 : 100,
    skills: [{ name: '01 - task01', count: 4, passed: id === 1 ? 1 : 4, crashed: 0, mandatoryFailed: 0 }] }));
  for (const id of [1, 2]) ctx.results.set(id, { loading: false, error: null, detail: { ...summary(id), score: null, skills: [], rawTrace: null, staticTrace: null, coverage: { lines: null, branches: null, log: null },
    makeError: null, deliveryError: null, bannedFunctions: null,
    tasks: [{ name: 'task01', count: 0, passed: 0, crashed: 0, mandatoryFailed: 0, status: 'unknown', trace: '', steps: [] }] } });
  for (const filter of ['changed', 'regressed', 'fixed', 'stillFailing', 'all']) {
    ctx.ui.comparisons[1] = { before: 1, after: 2, automatic: false, filter };
    const root = renderComparison(ctx, grader) as unknown as DomElement;
    assert.match(root.textContent, /25% → 100%/);
    assert.match(root.textContent, /\+75 points de pourcentage/);
    const stats = root.all('div').find(n => n.className.includes('compare-stats'))!;
    assert.deepEqual(stats.all('strong').map(n => n.textContent), ['1', '0', '0']);
    if (filter === 'fixed' || filter === 'all' || filter === 'changed') assert.match(root.textContent, /1\/4 → 4\/4/);
  }
});


test('comparison distinguishes missing task evidence from confirmed zero changes', () => {
  const { ctx, grader } = context();
  grader.history = [1, 2].map(id => ({ ...summary(id), score: id === 1 ? 25 : 100 }));
  for (const id of [1, 2]) ctx.results.set(id, { loading: false, error: null, detail: { ...summary(id), score: null,
    rawTrace: null, staticTrace: null, coverage: { lines: null, branches: null, log: null }, makeError: null, deliveryError: null, bannedFunctions: null, tasks: [] } });
  const root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.match(root.textContent, /25% → 100%/);
  assert.match(root.textContent, /Aucun résultat de tâche comparable/);
  const stats = root.all('div').find(n => n.className.includes('compare-stats'))!;
  assert.deepEqual(stats.all('strong').map(n => n.textContent), ['—', '—', '—']);
});

test('comparison displays cross-checked suspects, output progress and accessible output differences', () => {
  const { ctx, grader, messages } = context();
  grader.history = [1, 2].map(summary);
  ctx.comparisonFiles = new Map([['1:1:2', { loading: false, files: ['src/main.c'] }]]);
  for (const id of [1, 2]) ctx.results.set(id, { loading: false, error: null, detail: { ...summary(id), rawTrace: null, staticTrace: null,
    coverage: { lines: null, branches: null, log: null }, deliveryError: null, makeError: null, bannedFunctions: null,
    tasks: [{ name: 'task01', count: 1, passed: id === 1 ? 1 : 0, crashed: 0, mandatoryFailed: 0, status: id === 1 ? 'passed' : 'failed', steps: [],
      trace: id === 1 ? '# Building...\n# OK' : '# Building...\nsrc/main.c:8:2: error: missing value' }] } });
  let root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.match(root.textContent, /Croisement avec 1 fichiers/);
  assert.match(root.textContent, /Confiance élevée/);
  assert.match(root.textContent, /Modifié entre les commits évalués/);
  root.all('button').find(b => b.textContent.includes('src/main.c:8'))!.click();
  assert.equal((messages.at(-1) as any).type, 'openFile');
  for (const id of [1, 2]) {
    const detail = ctx.results.get(id)!.detail!;
    ctx.results.set(id, { loading: false, error: null, detail: { ...detail, tasks: [{ ...detail.tasks[0], status: 'failed', passed: 0,
      trace: `# Executing all tests...\n# Got:\n${id === 1 ? 'wrong\nextra' : 'wrong'}\n# But expected:\nOK\n# Test failed: invalid output.\n` }] } });
  }
  root = renderComparison(ctx, grader) as unknown as DomElement;
  assert.match(root.textContent, /Progression vers la réussite/);
  assert.match(root.textContent, /Lignes différentes : 3 → 2/);
  assert.match(root.textContent, /Première différence : ligne 1/);
  const diff = renderOutputDiff(ctx, 'a\n<hello>', 'a\n<script>') as unknown as DomElement;
  assert.match(diff.textContent, /<script>/);
  assert.equal(diff.all('script').length, 0);
});

test('first-attempt grader command saves without triggering checks and the Grader commit sits in the readout', () => {
  const { ctx, project, grader, messages } = context();
  ctx.ui.pipelineFocus = { 1: 'tests' };
  let root = renderReadiness(ctx, project) as unknown as DomElement;
  const input = root.all('input').find(i => i.attrs.id === 'grader-command-1')!;
  input.value = 'make re && make tests_run';
  root.all('form').find(f => f.className.includes('command-form'))!.events.submit({ preventDefault() {} });
  assert.deepEqual(messages.at(-1), { type: 'setGraderCommand', projectId: 1, command: 'make re && make tests_run' });
  assert.ok(!messages.some((m: any) => m.type === 'checkReadiness'));
  const sha = '7bce58de06b87eb27454bb3563463ad31270ae52';
  const commitUrl = `https://github.com/school/project/commit/${sha}`;
  grader.remoteCommit = { status: 'ready', sha, branch: 'main', commitUrl, checkedAt: Date.now(), error: null };
  root = renderReadout(ctx, project) as unknown as DomElement;
  const header = root.all('div').find(d => d.className.includes('remote-commit'))!;
  assert.match(header.textContent, /Le Grader voit/);
  assert.match(header.textContent, /7bce58d/);
  assert.match(header.textContent, /main/);
  header.all('button').find(b => b.textContent.includes('7bce58d'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openExternal', url: commitUrl });
  header.all('button').find(b => b.attrs['aria-label'] === 'Actualiser le commit du Grader')!.click();
  assert.deepEqual(messages.at(-1), { type: 'refreshRemoteCommit', projectId: 1 });
});

test('missing Grader delivery does not display a historical commit as the next delivery or suggest GitHub sign-in', () => {
  const { ctx, project, grader } = context();
  grader.history = [summary(1)];
  grader.remoteCommit = { status: 'unavailable', sha: null, branch: null, checkedAt: Date.now(), error: null };
  const root = renderReadout(ctx, project) as unknown as DomElement;
  const header = root.all('div').find(d => d.className.includes('remote-commit'))!;
  assert.match(header.textContent, /Aucun commit signalé/);
  assert.doesNotMatch(header.textContent, /1111111|GitHub/);
});

test('group notice opens Teams and disappears for a solo registration', () => {
  const { ctx, project, messages } = context();
  const now = Date.now();
  Object.assign(project, { startDate: new Date(now - 100000).toISOString(), endDate: new Date(now + 200000).toISOString(),
    midDate: new Date(now + 50000).toISOString(), status: 'ongoing', responsibles: [], groupMemberCount: 2 });
  ctx.activities = new Map([[1, []]]); ctx.activityErrors = new Map(); ctx.ui.tab = 'details';
  const root = renderProject(ctx, project) as unknown as DomElement;
  assert.match(root.textContent, /Toujours éligible à la notation séparée/);
  root.all('button').find(b => b.textContent.includes('Demander la notation séparée'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openExternal', url: 'https://teams.microsoft.com/' });
  project.groupMemberCount = 1;
  assert.doesNotMatch(renderProject(ctx, project).textContent!, /notation séparée/);
});

test('grader hides redundant notes and absent quota overrides, and disables non-leader run button', () => {
  const { ctx, project, grader } = context();
  ctx.t = createT('en'); ctx.lang = 'en';
  grader.quota = { total: 4, consumed: 0, remaining: 4 } as any;
  grader.remoteCommit = { status: 'ready', sha: 'a'.repeat(40), branch: 'main', checkedAt: 0, pushedAt: null, commitUrl: null, error: null };
  const both = () => `${renderGrader(ctx, project).textContent} ${renderReadout(ctx, project).textContent}`;
  assert.doesNotMatch(both(), /undefined|Quota override|Reported by the Grader|Grades the latest pushed commit/);
  assert.match(both(), /0 of 4 used/);
  grader.quota!.override = 0;
  assert.match(both(), /Quota override: 0/);
  let root: DomElement;
  Object.assign(project, { groupMemberCount: 2, isGroupLeader: false });
  root = renderGrader(ctx, project) as unknown as DomElement;
  assert.equal(root.all('button').find(b => b.textContent.trim() === 'Run grader')?.attrs.disabled, '');
  assert.match(root.textContent, /Only the group leader/);
});

test('result prerequisites hide absent or invalid marks and preserve a real zero', () => {
  const { ctx, project, grader } = context();
  ctx.t = createT('en');
  const run = summary(1);
  grader.history = [run];
  const detail: TestResultDetail = { ...run, rawTrace: null, staticTrace: null,
    coverage: { lines: null, branches: null, log: null }, makeError: null, deliveryError: null, bannedFunctions: null, tasks: [] };
  ctx.results.set(run.id, { loading: false, error: null, detail });
  for (const mark of [undefined, null, NaN, Infinity]) {
    detail.prerequisitesMark = mark as any;
    const text = renderGrader(ctx, project).textContent!;
    assert.doesNotMatch(text, /Prerequisites|undefined|NaN|Infinity/);
  }
  for (const mark of [0, 10]) {
    detail.prerequisitesMark = mark;
    const root = renderGrader(ctx, project) as unknown as DomElement;
    const cell = root.all('div').find(n => n.className.includes('stat-cell') && n.textContent.includes('Prerequisites'))!;
    assert.ok(cell);
    assert.equal(cell.all('span').at(-1)?.textContent, String(mark));
  }
});

test('Activities has its own category, with no sessions disclosure left in the milestone', () => {
  const { ctx, project } = context();
  Object.assign(project, { startDate: '2026-10-01T12:00:00Z', midDate: '2026-10-08T12:00:00Z', midEstimated: true, status: 'ongoing', responsibles: [] });
  ctx.activities = new Map([[1, []]]); ctx.activityErrors = new Map(); ctx.ui.tab = 'details';
  let root = renderProject(ctx, project) as unknown as DomElement;
  assert.match(root.textContent, /Non annoncé/);
  assert.doesNotMatch(root.textContent, /estimée/);
  const nav = root.all('div').find(n => n.className.includes('tabs'))!;
  assert.deepEqual(nav.all('button').map(b => b.textContent.trim()), ['Grader', 'Préparer', 'Valgrind', 'Historique', 'Sujet', 'Activités', 'Détails']);
  nav.all('button')[5].click();
  assert.equal(ctx.ui.tab, 'activities');
  root = renderProject(ctx, project) as unknown as DomElement;
  assert.match(root.textContent, /Aucune activité disponible/);
});

test('Activities shows group members and requires confirmation before booking or cancelling a slot', () => {
  const { ctx, project, messages } = context();
  ctx.t = createT('en'); ctx.lang = 'en'; ctx.activityErrors = new Map(); ctx.activityPending = new Set();
  project.intranetUrl = 'https://my.epitech.eu/units/2026/G-CPE-110/STG-1/projects/1';
  const future = new Date(Date.now() + 86_400_000).toISOString(), end = new Date(Date.now() + 90_000_000).toISOString();
  const activity = { id: 12, eventId: 42, name: 'Midterm defense', kind: 'midterm' as const, startDate: future, endDate: end, mandatory: true, hasDocuments: false, status: 'not_registered',
    slots: [{ id: 8, startDate: future, endDate: end, mine: false, available: true, groupName: null, members: [] },
      { id: 9, startDate: future, endDate: end, mine: false, available: false, groupName: 'Other team', members: [{ login: 'alice@example.test', name: 'Alice Example' }] }] };
  ctx.activities = new Map([[1, [activity]]]);
  let root = renderActivities(ctx, project) as unknown as DomElement;
  assert.match(root.textContent, /Other team/); assert.match(root.textContent, /Alice Example/);
  root.all('button').find(b => b.textContent === 'Book this slot')!.click();
  assert.equal(messages.length, 0);
  root.all('button').find(b => b.textContent === 'Confirm')!.click();
  assert.deepEqual(messages.at(-1), { type: 'changeActivitySlot', projectId: 1, activityId: 12, slotId: 8, cancel: false });
  assert.equal(ctx.activityPending.has(1), true);
  ctx.activityPending.clear(); activity.slots[0].mine = true; activity.slots[0].available = false;
  root = renderActivities(ctx, project) as unknown as DomElement;
  assert.match(root.textContent, /Your booked time/);
  assert.equal(root.all('button').filter(b => b.textContent === 'Book this slot').length, 0);
  root.all('button').find(b => b.textContent === 'Cancel booking')!.click();
  root.all('button').find(b => b.textContent === 'Confirm')!.click();
  assert.deepEqual(messages.at(-1), { type: 'changeActivitySlot', projectId: 1, activityId: 12, slotId: 8, cancel: true });
  ctx.activityPending.clear();
  root.all('button').find(b => b.textContent === 'Available')!.click();
  root = renderActivities(ctx, project) as unknown as DomElement;
  assert.doesNotMatch(root.textContent, /Other team/);
});

test('in the sidebar every project row pushes its summary in place, without opening an editor', () => {
  const { ctx, project, messages } = context();
  ctx.surface = 'sidebar'; ctx.ui.showList = true; ctx.ui.filter = 'all'; ctx.ui.search = ''; ctx.t = createT('en');
  Object.assign(project, { status: 'ongoing', startDate: '2026-10-01T12:00:00Z' });
  Object.assign(ctx.state, { projects: [project, { ...project, id: 2, name: 'Other project' }], currentProjectId: 1, auth: { firstname: 'Test', lastname: 'User' }, partialErrors: [] });
  const root = renderList(ctx) as unknown as DomElement;
  root.all('button').find(b => b.attrs['aria-label'] === 'Project')!.click();
  assert.equal(ctx.ui.showList, false); assert.equal(ctx.ui.sidebarProject, 1); assert.deepEqual(messages, []);
  ctx.ui.showList = true;
  root.all('button').find(b => b.attrs['aria-label'] === 'Other project')!.click();
  assert.equal(ctx.ui.sidebarProject, 2); assert.deepEqual(messages, []);
});

test('Activities exposes a red Test popup button next to Refresh, even when there are no sessions', () => {
  const { ctx, project, messages } = context(); ctx.t = createT('en');
  ctx.activities = new Map([[1, []]]); ctx.activityErrors = new Map();
  const root = renderActivities(ctx, project) as unknown as DomElement;
  const actions = root.all('div').find(n => n.className.includes('activity-header-actions'))!;
  assert.deepEqual(actions.all('button').map(b => b.textContent.trim()), ['Refresh', 'Test popup']);
  const testButton = actions.all('button')[1];
  assert.match(testButton.className, /activity-test-popup/); testButton.click();
  assert.deepEqual(messages, [{ type: 'testDefensePopup', projectId: 1 }]);
});

test('switching a slot asks confirmation, sends the old and new slot exactly once, and obeys cooldowns', () => {
  const { ctx, project, messages } = context(); ctx.t = createT('en'); ctx.lang = 'en';
  const oldTime = new Date(Date.now() + 86_400_000).toISOString(), newTime = new Date(Date.now() + 90_000_000).toISOString();
  const end = new Date(Date.now() + 93_600_000).toISOString();
  ctx.activityPending = new Set(); ctx.activityErrors = new Map();
  ctx.activities = new Map([[1, [{ id: 12, eventId: 42, name: 'Defense', kind: 'defense', startDate: oldTime, endDate: end, mandatory: true, hasDocuments: false, status: 'registered',
    slots: [{ id: 8, startDate: oldTime, endDate: newTime, mine: true, available: false, groupName: 'Our group', members: [] },
      { id: 9, startDate: newTime, endDate: end, mine: false, available: true, groupName: null, members: [] }] }]]]);
  let root = renderActivities(ctx, project) as unknown as DomElement;
  const switchButton = root.all('button').find(b => b.textContent === 'Switch time slot')!;
  switchButton.click(); assert.equal(messages.length, 0);
  assert.match(root.textContent, /Switch your booking from/); assert.match(root.textContent, /current slot is released first/);
  const confirm = root.all('button').find(b => b.textContent === 'Confirm')!;
  confirm.click(); confirm.click();
  assert.deepEqual(messages, [{ type: 'switchActivitySlot', projectId: 1, activityId: 12, fromSlotId: 8, slotId: 9 }]);
  ctx.activityPending.clear();
  ctx.activityLimits = new Map([[1, { refreshAfter: Date.now() + 30_000, changeAfter: Date.now() + 15_000, rateLimited: false }]]);
  root = renderActivities(ctx, project) as unknown as DomElement;
  for (const label of ['Switch time slot', 'Cancel booking', 'Refresh']) {
    const b = root.all('button').find(b => b.textContent.trim() === label)!;
    assert.ok('disabled' in b.attrs); b.click();
  }
  assert.equal(messages.length, 1, 'cooldown controls do not send new host messages');
});

test('Valgrind tab: checks on the left, the selected one on the right, errors and leaks each open their line', () => {
  const { ctx, project, messages } = context();
  ctx.state.currentProjectId = 1;
  const read = { kind: 'read' as const, what: 'Invalid read of size 4', file: 'src/map.c', line: 57, column: 16, fn: 'tile_at', count: 37, code: '    return map->tiles[i];',
    detail: "0 bytes after a block of size 400 alloc'd", origin: { fn: 'load_map', file: 'src/map.c', line: 31 },
    stack: [{ fn: 'tile_at', file: 'src/map.c', line: 57 }, { fn: 'main', file: 'src/main.c', line: 48 }] };
  const sprites = { file: 'src/sprites.c', line: 42, column: 23, lost: '2.4 kB', bytes: 2400 }, score = { file: 'src/score.c', line: 18, column: 18, lost: '100 B', bytes: 100 };
  const base = { status: 'done' as const, command: './my_hunter', durationMs: 1840, history: [], omitted: 14, unlocated: 0, signal: null, exitCode: 0, error: null, detail: null,
    heap: { allocs: 1284, frees: 1279, bytes: 52345, allocated: '52.3 kB', inUse: 4200, freed: '48.1 kB', reachable: '1.7 kB' } };
  const first = { ...base, at: 1, lost: '5.1 kB', bytes: 5100, leaks: [sprites, score], errors: [] };
  const second = { ...base, at: 2, lost: '2.5 kB', bytes: 2500, leaks: [sprites], errors: [read] };
  const history = [{ at: 1, bytes: 5100, lost: '5.1 kB', errors: 0, run: first }, { at: 2, bytes: 2500, lost: '2.5 kB', errors: 37, run: second }];
  ctx.valgrind = new Map([[1, { command: './my_hunter', history, run: { ...second, history } }]]);
  let root = renderValgrind(ctx, project) as unknown as DomElement;
  assert.ok(root.all('div').some(d => d.className.includes('loop')), 'the Grader\'s two columns');
  assert.match(root.textContent, /Check 2/);
  assert.match(root.textContent, /2\.5 kB/);
  assert.match(root.textContent, /37/);
  assert.ok(root.all('svg').some(s => s.attrs.class?.includes('vg-seismo')), 'the checks over time');
  assert.ok(root.all('div').some(d => d.className.includes('vg-ledger-bar')), 'where the heap went');
  assert.match(root.textContent, /1 corrigé/); assert.match(root.textContent, /1 nouveau/); assert.match(root.textContent, /1 toujours là/);
  assert.match(root.textContent, /14/);

  // The first error is open: its line, the block it overran, its stack.
  root.all('button').find(b => b.className.includes('vg-peek') && b.textContent.includes('src/map.c:57'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openFile', projectId: 1, file: 'src/map.c', line: 57, column: 16 });
  root.all('button').find(b => b.textContent.includes('load_map'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openFile', projectId: 1, file: 'src/map.c', line: 31, column: 1 });
  // A leak shows its allocating line and lens without unfolding, and opens it.
  assert.match(root.textContent, /VALGRIND: 2\.4 kB never freed/);
  root.all('button').find(b => b.className.includes('vg-leak-head') && b.textContent.includes('src/sprites.c:42'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openFile', projectId: 1, file: 'src/sprites.c', line: 42, column: 23 });
  // The selected check's recap comes first, before the command.
  assert.ok(root.textContent.indexOf('Check 2') < root.textContent.indexOf('./my_hunter'));

  // Picking the older check shows its report.
  root.all('button').find(b => b.className.includes('vg-check') && b.textContent.includes('5.1 kB'))!.click();
  assert.equal(ctx.ui.valgrindSelected?.[1], 1);
  root = renderValgrind(ctx, project) as unknown as DomElement;
  assert.match(root.textContent, /Check 1/);
  assert.ok(root.all('button').some(b => b.className.includes('vg-leak-head') && b.textContent.includes('src/score.c:18')));
  delete ctx.ui.valgrindSelected![1];

  root.all('button').find(b => b.className.includes('primary'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'runValgrind', projectId: 1 });
  // The click itself starts the clock on the button, before the host answers.
  assert.equal(ctx.valgrind.get(1)!.run!.status, 'running');
  assert.match((renderValgrind(ctx, project) as unknown as DomElement).all('button').find(b => b.className.includes('vg-run-btn'))!.textContent, /0:0\d/);
  ctx.valgrind.set(1, { command: './my_hunter', history, run: { ...second, history } });

  // The -g button shows only when the Makefile lacks -g.
  assert.ok(!root.all('button').some(b => b.textContent.includes('make re')));
  ctx.valgrind.set(1, { ...ctx.valgrind.get(1)!, debug: false });
  (renderValgrind(ctx, project) as unknown as DomElement).all('button').find(b => b.textContent.includes('make re'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'addDebugFlag', projectId: 1 });
  ctx.valgrind.set(1, { ...ctx.valgrind.get(1)!, debug: true });
  assert.ok(!(renderValgrind(ctx, project) as unknown as DomElement).all('button').some(b => b.textContent.includes('make re')));

  // A clean check: a green row with its streak, no finding list, the heap all freed.
  const cleanRun = { ...base, at: 4, lost: '0 B', bytes: 0, leaks: [], errors: [], heap: { ...base.heap, frees: 1284, inUse: 0, freed: '52.3 kB', reachable: '0 B' } };
  const clean = [...history, { at: 3, bytes: 0, lost: '0 B', errors: 0, run: { ...cleanRun, at: 3 } }, { at: 4, bytes: 0, lost: '0 B', errors: 0, run: cleanRun }];
  ctx.valgrind.set(1, { command: './my_hunter', history: clean, run: { ...cleanRun, history: clean } });
  const done = renderValgrind(ctx, project) as unknown as DomElement;
  assert.ok(!done.all('div').some(d => d.className.includes('vg-finding')));
  assert.ok(done.all('div').some(d => d.className.includes('vg-clean')));
  assert.match(done.textContent, /2 checks/);
  assert.match(done.textContent, /1[\s\u202f]?284/);

  // In flight: a live clock, the program's output, and Stop.
  ctx.valgrind.set(1, { command: './my_hunter', history: clean, run: { ...cleanRun, status: 'running', at: Date.now() - 12_000, tail: ['map loaded', 'solving…'], history: clean } });
  const running = renderValgrind(ctx, project) as unknown as DomElement;
  assert.match(running.textContent, /0:1[12]/);
  assert.match(running.textContent, /solving…/);
  running.all('button').find(b => b.textContent.includes('Stop') || b.textContent.includes('Arrêter'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'cancelValgrind', projectId: 1 });

  ctx.state.currentProjectId = null;
  assert.match((renderValgrind(ctx, project) as unknown as DomElement).textContent, /vérifier sa mémoire/);
});
