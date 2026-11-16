import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHome, homeSelection } from '../webview/views/home';
import { renderList } from '../webview/views/list';
import { barFill, seasonProjects } from '../webview/views/season';
import { renderAppearance, toHex } from '../webview/views/appearance';
import { scoreTrend, smoothPath } from '../webview/views/trend';
import { paletteCss, sanitizePalette } from '../shared/palette';
import { renderNextUp } from '../webview/views/focus';
import { renderProject } from '../webview/views/detail';
import { createT } from '../shared/i18n';
import type { Ctx } from '../webview/ctx';
import type { ProjectVM } from '../shared/types';

/** Minimal DOM, enough for the hyperscript helper and the SVG charts. */
class DomNode {
  childNodes: DomNode[] = [];
  constructor(public value = '') {}
  append(...nodes: Array<DomNode | string>) { this.childNodes.push(...nodes.map(n => typeof n === 'string' ? new DomNode(n) : n)); }
  prepend(...nodes: Array<DomNode | string>) { this.childNodes.unshift(...nodes.map(n => typeof n === 'string' ? new DomNode(n) : n)); }
  get textContent(): string { return this.value + this.childNodes.map(n => n.textContent).join(' '); }
  set textContent(value: string) { this.value = value; this.childNodes = []; }
}
class DomElement extends DomNode {
  attrs: Record<string, string> = {}; dataset: Record<string, string> = {}; style: Record<string, string> = {}; events: Record<string, (e: unknown) => void> = {};
  className = ''; title = ''; classList = { add: (...classes: string[]) => { this.className += ` ${classes.join(' ')}`; } };
  constructor(readonly tagName: string) { super(); }
  addEventListener(name: string, fn: (e: unknown) => void) { this.events[name] = fn; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  all(tag: string): DomElement[] { return [this, ...this.childNodes.flatMap(n => n instanceof DomElement ? n.all(tag) : [])].filter(e => e.tagName === tag); }
  has(cls: string): DomElement[] { return [this, ...this.childNodes.flatMap(n => n instanceof DomElement ? n.has(cls) : [])].filter(e => `${e.className} ${e.attrs.class ?? ''}`.split(' ').includes(cls)); }
  click() { this.events.click?.({ preventDefault() {} }); }
}
Object.assign(globalThis, { Node: DomNode, document: { createElement: (tag: string) => new DomElement(tag), createTextNode: (text: string) => new DomNode(text),
  createElementNS: (_ns: string, tag: string) => new DomElement(tag), querySelector: () => null } });

const D = 86_400_000, now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const project = (id: number, name: string, over: Partial<ProjectVM> = {}): ProjectVM => ({
  id, name, description: '', unitName: 'Unit', unitCode: 'B-XXX-100', instanceCode: 'PAR-1-1', schoolYear: 2026, startDate: iso(now - 5 * D), endDate: iso(now + 5 * D),
  endRegistrationDate: null, midDate: iso(now), midEstimated: true, status: 'ongoing', registered: true, registrationId: 1, groupName: null, groupMemberCount: 1, isGroupLeader: true,
  groupSizeMin: 1, groupSizeMax: 1, registrationsCount: 1, repoEnabled: true, repoLink: null, subjectUrl: null, projectCode: null, hermesUrl: null, intranetUrl: `https://intra/${id}`,
  responsibles: [], groupMembers: [], peerEvaluation: false, unitDescription: '', ...over,
});

function context(projects: ProjectVM[], currentProjectId: number | null = null) {
  const messages: unknown[] = [];
  const ctx = {
    surface: 'panel', home: true, fixedProjectId: null, lang: 'en', t: createT('en'),
    state: { auth: { status: 'signedIn', firstname: 'Ada', login: 'ada@epitech.eu' }, projects, loading: false, error: null, currentProjectId, lastUpdated: null, lang: 'en', partialErrors: [] },
    ui: { search: '', filter: 'all', showList: false, tab: null, selectedResult: {}, openTasks: new Set(), traceQuery: '', showFullTrace: false, comparisons: {} },
    graders: new Map(), results: new Map(), subjects: new Map(), activities: new Map(), activityErrors: new Map(), styleScans: new Map(), readiness: new Map(),
    functionRules: new Map(), reproductions: new Map(), guided: new Map(),
    post: (m: unknown) => messages.push(m), rerender() {}, toast() {},
  } as unknown as Ctx;
  return { ctx, messages };
}

const projects = [
  project(1, 'alpha', { endDate: iso(now + 6 * D) }),
  project(2, 'bravo', { endDate: iso(now + 10 * 3_600_000) }),
  project(3, 'charlie', { status: 'upcoming', startDate: iso(now + 3 * D), endDate: iso(now + 20 * D) }),
  project(4, 'delta', { status: 'past', startDate: iso(now - 60 * D), endDate: iso(now - 45 * D) }),
];

test('Home follows the open repository, else the next project to close', () => {
  assert.equal(homeSelection(context(projects, 1).ctx)?.name, 'alpha');
  assert.equal(homeSelection(context(projects).ctx)?.name, 'bravo');
  assert.equal(homeSelection(context([projects[2]]).ctx)?.name, 'charlie');
  const { ctx } = context(projects, 1);
  ctx.ui.homeSelected = 3;
  assert.equal(homeSelection(ctx)?.name, 'charlie');
});

test('Home renders timeline, selected project, agenda and the full project browser', () => {
  const { ctx, messages } = context(projects, 1);
  const loaded: number[] = [];
  const root = renderHome(ctx, id => loaded.push(id)) as unknown as DomElement;
  assert.deepEqual(loaded, [1]);
  assert.match(root.textContent, /Ada/);
  assert.match(root.textContent, /1 closing within 24h/);
  // Timeline: ongoing by close date, then upcoming; past projects outside the window are left out.
  const lanes = root.has('lane-name').map(n => n.textContent);
  assert.deepEqual(lanes, ['bravo', 'alpha', 'charlie']);
  assert.equal(root.has('lane').find(l => l.className.includes('urgent'))?.textContent.includes('bravo'), true);
  // Selecting a bar moves the card; the card opens the project.
  root.has('bar')[2].click();
  assert.equal(ctx.ui.homeSelected, 3);
  const card = root.has('home-card')[0];
  assert.match(card.textContent, /alpha/);
  card.all('button').find(b => b.textContent.includes('Overview'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openProject', projectId: 1 });
  // The card speaks the sidebar summary's language; its pieces open the project's tab on the matching page.
  assert.equal(card.has('sb-banner').length, 1);
  card.has('sb-tile').find(b => b.textContent.includes('Last score'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openProject', projectId: 1, tab: 'history' });
  card.has('sb-row-link').find(b => b.textContent.includes('Delivery'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'openProject', projectId: 1, tab: 'grader' });
  // Agenda lists what closes next, most pressing first.
  const agenda = root.has('agenda-title').map(n => n.textContent.trim());
  assert.match(agenda[0], /bravo closes/);
  // The project browser keeps search and the four filters with counts.
  assert.equal(root.all('input').some(i => i.attrs.type === 'search' || (i as unknown as { type: string }).type === 'search'), true);
  assert.deepEqual(root.has('filter').filter(b => b.has('counter').length > 0).map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    ['All 4', 'In progress 2', 'Upcoming 1', 'Past 1']);
});

test('timeline range switch and the sidebar Home button post the right messages', () => {
  const { ctx, messages } = context(projects, 1);
  const root = renderHome(ctx, () => undefined) as unknown as DomElement;
  root.has('filter').find(b => b.textContent.trim() === 'All' && b.has('counter').length === 0)!.click();
  assert.equal(ctx.ui.homeRange, 'all');
  ctx.surface = 'sidebar';
  const side = renderList(ctx) as unknown as DomElement;
  side.has('home-btn')[0].click();
  assert.deepEqual(messages.at(-1), { type: 'openHome' });
});

test('seasonProjects keeps only projects that intersect the window', () => {
  const inWindow = seasonProjects(projects, { start: now - 7 * D, end: now + 21 * D }).map(p => p.name);
  assert.deepEqual(inWindow, ['bravo', 'alpha', 'charlie']);
});

test('sidebar summary: skyline signature, state rows, next up and the loop dock; everything pushes a page', () => {
  const members = [{ name: 'Ada Lovelace', login: 'ada@epitech.eu' }, { name: 'Bob Kay', login: 'bob@epitech.eu' }];
  const p = project(1, 'alpha', { groupName: 'alpha-ada', groupMembers: members, groupSizeMin: 2, groupSizeMax: 3 });
  const { ctx, messages } = context([p], 1);
  ctx.surface = 'sidebar';
  ctx.avatars = new Map([['ada@epitech.eu', 'data:image/jpeg;base64,AAAA']]);
  ctx.activities.set(1, [{ id: 3, eventId: 4, name: 'Defense', kind: 'defense', startDate: iso(now + 7 * D), endDate: iso(now + 7 * D + 3_600_000), location: 'Room 1', mandatory: true, hasDocuments: false, status: 'registered',
    slots: [{ id: 9, startDate: iso(now + 7 * D), endDate: iso(now + 7 * D + 1_200_000), mine: true, available: false, groupName: 'alpha-ada', members }] }] as never);
  const run = (id: number, score: number, skills: unknown[] = []) => ({ id, date: iso(now - (3 - id) * D), commit: String(id).repeat(40), score, passed: score / 4, total: 25, flags: [], style: { fatal: 0, major: 0, minor: 0, info: 0 }, prerequisitesMark: null, skills });
  ctx.graders.set(1, { projectId: 1, loading: false, error: null, running: false, canRun: true, reason: null, runs: [],
    quota: { total: 5, remaining: 3, consumed: 2, override: null },
    history: [run(1, 40), run(2, 72, [{ name: 'cipher', count: 4, passed: 2, crashed: 1, mandatoryFailed: 0 }])] } as never);
  ctx.state.commitStates = { 1: { head: 'b'.repeat(40), dirty: true, dirtyCount: 2, ahead: 1, hasUpstream: true } };

  const root = renderProject(ctx, p) as unknown as DomElement;
  // The signature draws real data only: two attempts, three tokens still to spend.
  assert.equal(root.has('sky-bar').length, 2);
  assert.equal(root.has('sky-slot').length, 3);
  assert.match(root.textContent, /2 attempts/);
  assert.match(root.textContent, /3 tokens left/);
  // State rows: delivery, graded code against local HEAD, style, last run with its skills.
  assert.match(root.textContent, /Delivery/);
  assert.match(root.textContent, /Graded code[\s\S]*Different/);
  assert.match(root.textContent, /2 modified/);
  assert.match(root.textContent, /1 to push/);
  assert.equal(root.has('skill-row').length, 1);
  assert.equal(root.all('img').length, 1);
  assert.deepEqual(root.has('agenda-title').map(n => n.textContent.trim()), ['Defense']);
  // The style row scans on demand; the dock checks and runs.
  root.all('button').find(b => b.textContent.includes('Scan project'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'scanStyle', projectId: 1 });
  const dock = root.has('sb-dock')[0];
  dock.all('button').find(b => b.textContent.includes('Check'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'checkReadiness', projectId: 1 });
  dock.all('button').find(b => b.textContent.includes('Run'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'runGrader', projectId: 1 });
  // Tiles and links push their page; a pushed page goes back to the summary, the summary to the overview.
  root.has('sb-tile')[1].click();
  assert.equal(ctx.ui.tab, 'history');
  ctx.ui.tab = null;
  root.has('sb-link-row').find(b => b.textContent.includes('Activities'))!.click();
  assert.equal(ctx.ui.tab, 'activities');
  const page = renderProject(ctx, p) as unknown as DomElement;
  assert.equal(page.has('sb-page-head')[0].textContent.trim().startsWith('Activities'), true);
  page.has('sb-back')[0].click();
  assert.equal(ctx.ui.tab, null);
  (renderProject(ctx, p) as unknown as DomElement).has('sb-back')[0].click();
  assert.equal(ctx.ui.showList, true);
  // Next up still lists the booked slot for this project.
  assert.deepEqual((renderNextUp(ctx, p) as unknown as DomElement).has('agenda-title').map(n => n.textContent.trim()), ['Defense']);
  // A defense split into a morning and an afternoon window is still one event.
  const afternoon = { ...(ctx.activities.get(1) as never[])[0] as any, id: 5, eventId: 6, location: 'Room 2' };
  afternoon.slots = [{ ...afternoon.slots[0], id: 10, startDate: iso(now + 7 * D + 4 * 3_600_000) }];
  ctx.activities.set(1, [...ctx.activities.get(1)!, afternoon] as never);
  const rows = (renderNextUp(ctx, p) as unknown as DomElement);
  assert.deepEqual(rows.has('agenda-title').map(n => n.textContent.trim()), ['Defense']);
  assert.match(rows.has('agenda-sub')[0].textContent, /,.*Room 1, Room 2/);
});

test('sidebar summary without grader runs or tokens draws nothing invented and hides the dock when it cannot run', () => {
  const p = project(1, 'alpha', { registered: false });
  const { ctx } = context([p], 1);
  ctx.surface = 'sidebar';
  ctx.graders.set(1, { projectId: 1, loading: false, error: null, running: false, canRun: false, reason: 'not_registered', runs: [], quota: null, history: [] } as never);
  const root = renderProject(ctx, p) as unknown as DomElement;
  assert.equal(root.has('sky-bar').length, 0);
  assert.equal(root.has('sky-slot').length, 0);
  assert.equal(root.has('sb-dock').length, 0);
  assert.equal(root.has('skill-row').length, 0);
});

test('sidebar overview: greeting with the next close, one card per live project, cards push the summary in place', () => {
  const { ctx, messages } = context(projects, 1);
  ctx.surface = 'sidebar';
  ctx.ui.showList = true;
  const loaded: number[] = [];
  ctx.loadProject = id => { loaded.push(id); };
  const root = renderList(ctx) as unknown as DomElement;
  assert.match(root.textContent, /bravo closes in/);
  const cards = root.has('sb-pcard');
  // The open repository first, then what closes soonest, then what opens within a week.
  assert.deepEqual(cards.map(c => c.has('name')[0].textContent), ['alpha', 'bravo', 'charlie']);
  assert.deepEqual(loaded, [1, 2, 3]);
  cards[1].click();
  assert.equal(ctx.ui.sidebarProject, 2);
  assert.equal(ctx.ui.showList, false);
  assert.deepEqual(messages, []);
});

// ── Round 5: Season fill, Open vs overview, progress strips, colours ──

test('season: each bar is filled up to the Now line over its visible (clipped) span', () => {
  assert.equal(barFill(10, 50, 30), 0.5);
  assert.equal(barFill(10, 50, 5), 0);
  assert.equal(barFill(10, 50, 80), 1);
  // A bar clipped at the window start: the fill ends on Now, not where the full project span would put it.
  assert.equal(barFill(0, 40, 20), 0.5);
  assert.equal(barFill(20, 20, 20), 1);
});

test('sidebar: a project already opened locally gets Open (its folder, this window) and a separate overview button', () => {
  const ps = [project(1, 'alpha'), project(2, 'bravo'), project(3, 'charlie')];
  const { ctx, messages } = context(ps, 1);
  ctx.surface = 'sidebar';
  ctx.home = false;
  ctx.state.localProjects = [1, 2];
  const local = renderProject(ctx, ps[1]) as unknown as DomElement;
  const open = local.all('button').find(b => b.textContent.trim() === 'Open')!;
  open.click();
  assert.deepEqual(messages.at(-1), { type: 'openFolder', projectId: 2 });
  local.has('sb-overview')[0].click();
  assert.deepEqual(messages.at(-1), { type: 'openProject', projectId: 2 });
  // Not on disk: only the overview, labelled, and cloning stays in the menu.
  const remote = renderProject(ctx, ps[2]) as unknown as DomElement;
  assert.equal(remote.all('button').some(b => b.textContent.trim() === 'Open'), false);
  remote.all('button').find(b => b.textContent.trim() === 'Overview')!.click();
  assert.deepEqual(messages.at(-1), { type: 'openProject', projectId: 3 });
  // The folder open in this window: nothing to open, the overview only.
  const current = renderProject(ctx, ps[0]) as unknown as DomElement;
  assert.equal(current.has('sb-overview').length, 0);
});

test('sidebar list: each row carries a progress strip with one dot per scored attempt, the latest lit', () => {
  const ps = [project(1, 'alpha'), project(4, 'delta', { status: 'past', startDate: iso(now - 60 * D), endDate: iso(now - 45 * D) }), project(3, 'charlie', { status: 'upcoming', startDate: iso(now + 3 * D), endDate: iso(now + 20 * D) })];
  const { ctx } = context(ps, null);
  ctx.surface = 'sidebar';
  ctx.home = false;
  const run = (id: number, score: number | null, at: number) => ({ id, date: iso(at), commit: String(id).repeat(40), score, passed: 0, total: 0, flags: [], style: { fatal: 0, major: 0, minor: 0, info: 0 }, prerequisitesMark: null, skills: [] });
  ctx.graders.set(4, { projectId: 4, loading: false, error: null, running: false, canRun: false, reason: null, runs: [], quota: null,
    history: [run(1, 20, now - 58 * D), run(2, null, now - 55 * D), run(3, 75, now - 50 * D)] } as never);
  const root = renderList(ctx) as unknown as DomElement;
  const strips = root.has('pstrip-row');
  assert.ok(strips.length >= 3);
  const delta = strips.find(s => s.attrs['aria-label']?.includes('2 attempts'))!;
  assert.ok(delta, 'the past project with two scored attempts is described');
  const dots = delta.has('pstrip-dots')[0].all('i');
  assert.equal(dots.length, 2);
  assert.ok(dots[1].className.includes('latest'));
  assert.match(delta.textContent, /75%/);
  // Nothing invented for a project that has not opened.
  const charlie = strips.find(s => s.attrs['aria-label'] === 'Upcoming');
  assert.ok(charlie);
  assert.equal(charlie!.has('pstrip-dots').length, 0);
});

test('palette: only known keys with valid hex survive, and the CSS sets the accent and readable text on it', () => {
  assert.deepEqual(sanitizePalette({ accent: '#ABC', pass: 'nope', evil: '#000000', fail: 'f48771' }), { accent: '#aabbcc', fail: '#f48771' });
  assert.deepEqual(sanitizePalette('x'), {});
  const css = paletteCss({ accent: '#ffd84d' });
  assert.match(css, /--banana:#ffd84d/);
  assert.match(css, /--banana-on:#1e1e1e/);
  assert.match(paletteCss({ accent: '#1a237e' }), /--banana-on:#ffffff/);
  assert.equal(paletteCss({}), '');
  assert.equal(toHex('rgb(255, 216, 77)'), '#ffd84d');
  assert.equal(toHex('color(srgb 1 0 0.5)'), '#ff0080');
});

test('colours page: a preset and a typed hex are saved; a bad hex is refused with a message', () => {
  const body = Object.assign(new DomElement('body'), { classList: { add() {}, toggle() {} } });
  Object.assign((globalThis as { document: object }).document, { getElementById: () => null, head: new DomElement('head'), body });
  const { ctx, messages } = context(projects, 1);
  ctx.surface = 'sidebar';
  ctx.home = false;
  ctx.state.palette = {};
  let root = renderAppearance(ctx) as unknown as DomElement;
  root.has('ap-preset').find(b => b.textContent.includes('Ocean'))!.click();
  assert.deepEqual(messages.at(-1), { type: 'setPalette', palette: { accent: '#5cc8ff', accent2: '#2f7bff' } });
  root = renderAppearance(ctx) as unknown as DomElement;
  const hex = root.has('ap-hex')[2] as DomElement & { value: string };
  hex.value = 'zz';
  hex.events.change({});
  assert.equal(hex.attrs['aria-invalid'], 'true');
  assert.equal(messages.length, 1);
  hex.value = '#0F0';
  hex.events.change({});
  assert.deepEqual(messages.at(-1), { type: 'setPalette', palette: { accent: '#5cc8ff', accent2: '#2f7bff', pass: '#00ff00' } });
});

test('score trend: one point per scored attempt, the pick is pressed, another pick selects that run', () => {
  const { ctx } = context(projects, 1);
  ctx.surface = 'sidebar';
  const run = (id: number, score: number | null) => ({ id, date: iso(now - (5 - id) * D), commit: String(id).repeat(40), score, passed: 0, total: 0, flags: [], style: { fatal: 0, major: 0, minor: 0, info: 0 }, prerequisitesMark: null, skills: [] });
  const grader = { projectId: 1, loading: false, error: null, running: false, canRun: true, reason: null, runs: [], quota: { total: 5, consumed: 2, remaining: 3, override: null },
    history: [run(1, 20), run(2, null), run(3, 64), run(4, 100)] } as never;
  const picked: number[] = [];
  const root = scoreTrend(ctx, grader, 3, id => picked.push(id)) as unknown as DomElement;
  const points = root.has('trend-pt');
  assert.equal(points.length, 3);
  assert.deepEqual(points.map(p => p.attrs['aria-pressed']), ['false', 'true', 'false']);
  assert.match(root.textContent, /64%/);
  points[2].click();
  points[1].click();
  assert.deepEqual(picked, [4]);
});

test('score trend curve never overshoots the attempts it joins', () => {
  const d = smoothPath([[0, 50], [10, 2], [20, 2], [30, 60], [40, 58]]);
  const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => Number(m[2]));
  assert.ok(Math.min(...ys) >= 2 && Math.max(...ys) <= 60, d);
});
