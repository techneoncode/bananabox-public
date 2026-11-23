/** Dev-only screen fixtures for reviewing every webview route in a browser. All data is synthetic. */
import { createT } from '../../src/shared/i18n';
import type { Ctx, UiState } from '../../src/webview/ctx';
import type { ActivityVM, GraderVM, ProjectVM, TestResultDetail, TestResultSummary } from '../../src/shared/types';
import { renderList } from '../../src/webview/views/list';
import { renderHome } from '../../src/webview/views/home';
import { renderProject } from '../../src/webview/views/detail';
import { renderLogin } from '../../src/webview/views/login';
import { renderAvailability, renderLensRestriction } from '../../src/webview/views/availability';
import { remoteStatus, type RemoteConfig, type RemoteFeature } from '../../src/domain/remotePolicy';
import { h } from '../../src/webview/dom';
import { markFresh } from '../../src/webview/motion';
import { renderAppearance } from '../../src/webview/views/appearance';
import { applyPalette } from '../../src/webview/palette';
import { PALETTE_PRESETS } from '../../src/shared/palette';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'grader';
const lang = (q.get('lang') ?? 'en') as 'en' | 'fr';
const surface = (q.get('surface') ?? 'panel') as 'sidebar' | 'panel';
const now = Date.now(), H = 3_600_000, D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();
const sha = (n: number) => (n.toString(16).repeat(40)).slice(0, 40).replace(/^0/, 'a');

const project = (over: Partial<ProjectVM>): ProjectVM => ({
  id: 1, name: 'hashtable', description: 'Implement a hash table and a small encryption library in C.', unitName: 'Elementary Programming in C', unitCode: 'B-CPE-110', instanceCode: 'PAR-1-1', schoolYear: 2026,
  startDate: iso(now - 11 * D), endDate: iso(now + 2 * D + 14 * H), endRegistrationDate: iso(now - 4 * D), midDate: iso(now - 3 * D), midEstimated: false, status: 'ongoing',
  registered: true, registrationId: 9, groupName: 'hashtable-sam', groupMemberCount: 3, isGroupLeader: true, groupSizeMin: 2, groupSizeMax: 3, registrationsCount: 412, repoEnabled: true,
  repoLink: 'https://github.com/EpitechPGEPromo2030/B-CPE-110-PAR-1-1-hashtable-sam', subjectUrl: null, projectCode: 'hashtable', hermesUrl: 'https://hermes.epitech.eu/', intranetUrl: 'https://my.epitech.eu/units/2026/B-CPE-110/PAR-1-1/projects/1',
  responsibles: [{ name: 'Alice Martin', login: 'alice.martin@epitech.eu' }, { name: 'Hugo Bernard', login: 'hugo.bernard@epitech.eu' }], peerEvaluation: false,
  groupMembers: [{ name: 'Sam Durand', login: 'sam.durand@epitech.eu' }, { name: 'Léa Dubois', login: 'lea.dubois@epitech.eu' }, { name: 'Tom Lefèvre', login: 'tom.lefevre@epitech.eu' }],
  unitDescription: 'Learn the **fundamentals** of programming in C:\n- pointers and memory\n- data structures\n- the Epitech coding style', ...over,
});
const projects: ProjectVM[] = [
  project({}),
  project({ id: 2, name: 'mini_printf', startDate: iso(now - 13 * D), endDate: iso(now + 18 * H), unitCode: 'B-CPE-110', groupName: null, groupMembers: [], groupSizeMin: 1, groupSizeMax: 1, groupMemberCount: 1 }),
  project({ id: 3, name: 'raytracer', unitCode: 'B-MUL-100', unitName: 'Multimedia', startDate: iso(now - 5 * D), endDate: iso(now + 9 * D), groupSizeMax: 2, groupSizeMin: 1, registered: false }),
  project({ id: 4, name: 'shell_v1', unitCode: 'B-PSU-100', unitName: 'Unix Programming', status: 'upcoming', startDate: iso(now + 3 * D), endDate: iso(now + 17 * D) }),
  project({ id: 7, name: 'sokoban', unitCode: 'B-PSU-100', unitName: 'Unix Programming', startDate: iso(now - 2 * D), endDate: iso(now + 19 * D), groupName: 'sokoban-team', groupMemberCount: 2, groupSizeMin: 2, groupSizeMax: 3, endRegistrationDate: iso(now + 2 * D) }),
  project({ id: 8, name: 'navy', unitCode: 'B-PSU-100', unitName: 'Unix Programming', status: 'upcoming', startDate: iso(now + 12 * D), endDate: iso(now + 33 * D), registered: false, endRegistrationDate: iso(now + 15 * D) }),
  project({ id: 5, name: 'calculator', unitCode: 'B-CPE-110', status: 'past', startDate: iso(now - 40 * D), endDate: iso(now - 26 * D) }),
  project({ id: 6, name: 'sort_stacks', unitCode: 'B-CPE-110', status: 'past', startDate: iso(now - 30 * D), endDate: iso(now - 16 * D) }),
];

const scores = [24, 41, 41, 64, 72];
const history: TestResultSummary[] = scores.map((score, i) => ({ id: 100 + i, date: iso(now - (scores.length - i) * 9 * H), commit: sha(i + 3), score,
  passed: Math.round(score / 4), total: 25, flags: i === 1 ? ['banned-function'] : [], style: { fatal: 0, major: i < 3 ? 2 : 1, minor: 3, info: 2 }, prerequisitesMark: null,
  skills: i === scores.length - 1 ? [
    { name: 'encrypt_long', count: 3, passed: 0, crashed: 3, mandatoryFailed: 1 },
    { name: 'errors', count: 5, passed: 4, crashed: 0, mandatoryFailed: 0 },
    { name: 'decrypt', count: 2, passed: 1, crashed: 0, mandatoryFailed: 0 },
    { name: 'hash_table', count: 9, passed: 9, crashed: 0, mandatoryFailed: 0 },
    { name: 'basic_shift', count: 6, passed: 6, crashed: 0, mandatoryFailed: 0 },
  ] : [] }));
const trace = `# Building...\n~/.> make re\ngcc -Wall -Wextra -c src/cipher.c -o src/cipher.o\nsrc/cipher.c:48:12: warning: unused variable 'len'\n# Executing all tests...\n# Test 'encrypt_long_input'\n# Got:\n(no output)\n# But expected:\nKhoor, Zruog!\n# Test failed: segmentation fault.\n# KO`;
const detail = (s: TestResultSummary, i: number): TestResultDetail => ({ ...s, rawTrace: trace, staticTrace: null, coverage: { lines: [81, 100], branches: [64, 100], log: null }, makeError: null, deliveryError: null, bannedFunctions: null,
  tasks: [
    { name: '01 - basic_shift', status: 'passed', count: 6, passed: 6, crashed: 0, mandatoryFailed: 0, steps: [], trace: '# OK' },
    { name: '02 - encrypt_long_input', status: 'failed', count: 3, passed: 0, crashed: 3, mandatoryFailed: 1, steps: [{ label: 'Build', ok: true, lines: [] }, { label: 'Run encrypt with 4 KiB input', ok: false, lines: [] }], trace },
    { name: '03 - decrypt_empty_key', status: 'failed', count: 2, passed: i > 3 ? 1 : 0, crashed: 0, mandatoryFailed: 0, steps: [], trace: '# Got:\n\n# But expected:\nError: empty key\n# Test failed: invalid output.' },
    { name: '04 - error_handling', status: 'failed', count: 5, passed: 4, crashed: 0, mandatoryFailed: 0, steps: [], trace: '# KO: exit status 0, expected 84' },
    { name: '05 - hash_table_insert', status: 'passed', count: 4, passed: 4, crashed: 0, mandatoryFailed: 0, steps: [], trace: '# OK' },
    { name: '06 - hash_table_delete', status: 'passed', count: 5, passed: 5, crashed: 0, mandatoryFailed: 0, steps: [], trace: '# OK' },
  ] });

const grader: GraderVM = { projectId: 1, loading: false, error: null, quota: { total: 5, consumed: 2, remaining: 3, override: null }, runs: screen === 'running' ? [{ id: 9, state: 'started', resultId: null, requestedAt: iso(now - 4 * 60_000), startedAt: null, finishedAt: null }] : [],
  history, running: screen === 'running', canRun: true, reason: null,
  remoteCommit: { status: 'ready', sha: sha(7), branch: 'main', commitUrl: null, checkedAt: now, error: null } };

/** Other projects of the season, so the overview carousel has real-looking neighbours. */
const others: GraderVM[] = [
  { projectId: 2, loading: false, error: null, quota: { total: 4, consumed: 3, remaining: 1, override: null }, runs: [], running: false, canRun: true, reason: null,
    history: [12, 30, 48].map((score, i) => ({ ...history[0], id: 200 + i, score, date: iso(now - (3 - i) * 20 * H), commit: sha(i + 1), skills: [] })) },
  { projectId: 7, loading: false, error: null, quota: { total: 6, consumed: 0, remaining: 6, override: null }, runs: [], running: false, canRun: true, reason: null, history: [] },
  { projectId: 3, loading: false, error: null, quota: null, runs: [], running: false, canRun: false, reason: 'not_registered', history: [] },
  // Finished projects: their attempts come from the disk cache, drawn under their rows.
  { projectId: 5, loading: false, error: null, quota: { total: 5, consumed: 5, remaining: 0, override: null }, runs: [], running: false, canRun: false, reason: null,
    history: [20, 55, 55, 90, 100].map((score, i) => ({ ...history[0], id: 500 + i, score, date: iso(now - 40 * D + (i * 3 + 1) * D), commit: sha(i + 4), skills: [] })) },
  { projectId: 6, loading: false, error: null, quota: { total: 5, consumed: 2, remaining: 3, override: null }, runs: [], running: false, canRun: false, reason: null,
    history: [38, 46].map((score, i) => ({ ...history[0], id: 600 + i, score, date: iso(now - 25 * D + i * 6 * D), commit: sha(i + 6), skills: [] })) },
];

const activities: ActivityVM[] = [
  { id: 12, eventId: 42, name: 'Follow-up review', kind: 'midterm', startDate: iso(now + 1 * D), endDate: iso(now + 1 * D + 3 * H), location: 'Paris · Room 3.04', mandatory: true, hasDocuments: true, status: 'registered',
    slots: [
      { id: 1, startDate: iso(now + 1 * D), endDate: iso(now + 1 * D + 20 * 60_000), mine: true, available: false, groupName: 'hashtable-sam', members: [{ name: 'Sam Durand', login: 'sam.durand@epitech.eu' }, { name: 'Léa Dubois', login: 'lea.dubois@epitech.eu' }, { name: 'Tom Lefèvre', login: 'tom.lefevre@epitech.eu' }] },
      { id: 2, startDate: iso(now + 1 * D + 20 * 60_000), endDate: iso(now + 1 * D + 40 * 60_000), mine: false, available: true, groupName: null, members: [] },
      { id: 3, startDate: iso(now + 1 * D + 40 * 60_000), endDate: iso(now + 1 * D + 60 * 60_000), mine: false, available: false, groupName: 'hashtable-lea', members: [{ name: 'Inès Garnier', login: 'ines.garnier@epitech.eu' }, { name: 'Paul Roux', login: 'paul.roux@epitech.eu' }] },
      { id: 4, startDate: iso(now + 1 * D + 60 * 60_000), endDate: iso(now + 1 * D + 80 * 60_000), mine: false, available: true, groupName: null, members: [] },
    ] },
  { id: 14, eventId: 44, name: 'Defense', kind: 'defense', startDate: iso(now + 4 * D), endDate: iso(now + 4 * D + 2 * H), location: 'Paris · Room 2.11', mandatory: true, hasDocuments: false, status: 'registered',
    slots: [{ id: 21, startDate: iso(now + 4 * D + 30 * 60_000), endDate: iso(now + 4 * D + 50 * 60_000), mine: true, available: false, groupName: 'hashtable-sam', members: [{ name: 'Sam Durand', login: 'sam.durand@epitech.eu' }] }] },
  { id: 13, eventId: 43, name: 'Kick-off', kind: 'kickoff', startDate: iso(now - 10 * D), endDate: iso(now - 10 * D + 2 * H), location: 'Amphi Turing', mandatory: false, hasDocuments: false, status: 'registered', slots: [] },
] as ActivityVM[];

const ui: UiState = { search: '', filter: 'all', showList: true, tab: null, selectedResult: {}, openTasks: new Set(), traceQuery: '', showFullTrace: false, comparisons: {} };
const results = new Map(history.map((s, i) => [s.id, { loading: false, detail: detail(s, i), error: null }]));
// A run with a clean coding style (the green block in the report).
if (screen === 'grader-clean') for (const r of results.values()) r.detail.style = { fatal: 0, major: 0, minor: 0, info: 0 };
const ctx = {
  surface, fixedProjectId: null, lang, ui, t: createT(lang),
  state: { auth: { status: 'signedIn', login: 'sam.durand@epitech.eu', firstname: 'Sam', lastname: 'Durand', promotion: 2030, cursus: 'bachelor/classic', campus: 'PAR', expiresAt: null, busy: false, error: null, pending: null },
    projects, loading: false, error: null, currentProjectId: 1, lastUpdated: now - 120_000, lang, partialErrors: [],
    commitStates: { 1: { head: sha(9), dirty: true, ahead: 2, hasUpstream: true, dirtyCount: 2 } }, availability: undefined, apiActivity: { startedAt: now, endpoints: [] },
    localProjects: [1, 7], palette: {}, network: { active: 0, queued: 0, lastMinute: 3, pausedUntil: null } },
  graders: new Map([[1, grader], ...others.map(g => [g.projectId, g] as const)]), results, subjects: new Map([[1, { status: 'unavailable' }]]), activities: new Map([[1, activities]]), activityErrors: new Map(), activityPending: new Set(), activityLimits: new Map(),
  styleScans: new Map([[1, { status: 'done', files: 14, summary: { fatal: 0, major: 1, minor: 3, info: 2 }, truncated: false, issues: [
    { file: 'src/cipher.c', line: 48, column: 12, bucket: 'major', rule: 'C-F3', message: 'Line too long' },
    { file: 'src/hash.c', line: 12, column: 1, bucket: 'minor', rule: 'C-L4', message: 'Misplaced curly bracket' },
    { file: 'src/main.c', line: 3, column: 1, bucket: 'info', rule: 'C-G1', message: 'Missing file header' }] }]]),
  readiness: new Map([[1, { projectId: 1, status: 'done', configured: false, stale: false, checkedAt: now - 600_000, error: null, commit: sha(9), detected: true, taskCount: 6, commands: ['make re', 'make tests_run'], commandSource: 'grader',
    checks: [
      { id: 'style', status: 'pass', detail: 'No fatal or major issue' },
      { id: 'build', status: 'pass', detail: 'make re · 3.1s' },
      { id: 'tests', status: 'fail', detail: '2 of 18 local tests failing', output: 'tests/test_cipher.c:31: Assertion failed: encrypt("Hello", 3)', files: [{ file: 'tests/test_cipher.c', line: 31, column: 1, message: 'Assertion failed' }] },
      { id: 'files', status: 'pass', detail: 'All required files are present' },
      screen === 'functions'
        ? { id: 'functions', status: 'fail', detail: '2 function(s) outside the allowed list: printf, memcpy', files: [{ file: 'src/display.c', line: 42, column: 9, message: 'printf' }, { file: 'src/sort.c', line: 17, column: 5, message: 'memcpy' }] }
        : screen === 'functions-sudo'
          ? { id: 'functions', status: 'fail', detail: '2 function(s) the subject forbids: vfork, getpwnam', files: [{ file: 'src/exec.c', line: 12, column: 9, message: 'vfork' }, { file: 'src/user.c', line: 8, column: 24, message: 'getpwnam' }] }
          : { id: 'functions', status: 'pass', detail: 'Only allowed functions (22 on the list)' },
    ] }]]),
  functionRules: new Map([[1, screen === 'functions-sudo' ? { names: [], subject: { status: 'found', doc: 'G-PSU-100_my_sudo.pdf', at: now - 3_600_000, names: [],
    forbidden: ['getpw*', '*getsp*', 'getgr*', '*fork*', '*clone*', 'openat*', 'getpass', 'getlogin*', 'cuserid', 'system'] } } : { names: ['strlen'], subject: { status: 'found', doc: 'B-PSU-100_my_ls.pdf', at: now - 3_600_000,
    names: ['opendir', 'readdir', 'closedir', 'stat', 'lstat', 'write', 'getpwuid', 'getgrgid', 'time', 'ctime', 'readlink', 'va_start', 'va_arg', 'va_end', 'malloc', 'free', 'perror', 'strerror', 'exit', 'gnu_dev_major', 'gnu_dev_minor'] } }]]), reproductions: new Map(), guided: new Map(screen === 'guided' ? [[1, { projectId: 1, status: 'running', step: 'push', completed: ['save', 'check', 'review', 'commit'], message: null }]] : []),
  comparisonFiles: new Map(), graderCommands: new Map(), avatars: fakeAvatars(),
  post: (m: unknown) => console.log('post', JSON.stringify(m)), rerender: () => draw(), toast: () => {},
} as unknown as Ctx;

/** Synthetic placeholder portraits (never real photos); one login stays without a picture to show initials. */
function fakeAvatars(): Map<string, string | null> {
  const face = (bg: string, skin: string, hair: string) => 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${bg}"/><circle cx="48" cy="40" r="19" fill="${skin}"/><path d="M29 36a19 19 0 0 1 38 0c-6-7-13-9-19-9s-13 2-19 9z" fill="${hair}"/><path d="M14 96c4-20 18-30 34-30s30 10 34 30z" fill="${hair}" opacity=".85"/></svg>`);
  return new Map<string, string | null>([
    ['sam.durand@epitech.eu', face('#3b4a6b', '#e8c4a2', '#2b2118')],
    ['lea.dubois@epitech.eu', face('#6b4a5c', '#f0d0b6', '#8a4b2a')],
    ['alice.martin@epitech.eu', face('#3f5f55', '#d9a988', '#1c1c1c')],
    ['ines.garnier@epitech.eu', face('#5a4f3a', '#c58c6a', '#3a2a1e')],
    ['tom.lefevre@epitech.eu', null],
  ]);
}

function availability(kind: string): void {
  const policy: RemoteConfig = { lens_active: true, my_api_active: true, version: '0.6.1', latest: '', authorized: [], banned: [] };
  const ban = (...features: RemoteFeature[]) => { policy.banned = [{ user: 'preview', features }]; };
  if (kind === 'revoked') ban('lens_active', 'my_api_active');
  if (kind === 'my_revoked') ban('my_api_active');
  if (kind === 'lens_revoked') ban('lens_active');
  if (kind === 'my_disabled') { policy.my_api_active = false; }
  const updating = kind.startsWith('update_');
  const status = remoteStatus(policy, updating ? '0.6.0' : '0.6.1', 'preview', kind === 'offline');
  if (updating) {
    status.update = kind === 'update_installed' ? 'installed' : kind === 'update_error' ? 'error' : 'downloading';
    status.updateProgress = { receivedBytes: 4.5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 };
    if (kind === 'update_error') status.updateError = 'HTTP 404 while downloading bananabox-0.6.1.vsix';
  }
  (ctx.state as { availability?: unknown }).availability = status;
  ctx.state.apiActivity = { startedAt: now, endpoints: kind === 'revoked' ? [{ method: 'GET', route: '/api/projects', calls: 14, rateLimitedResponses: 1 }, { method: 'POST', route: '/api/activities/{id}/slots/{id}', calls: 2, rateLimitedResponses: 0 }] : [] } as never;
}

/** Valgrind tab states: `valgrind` (errors + leaks), `valgrind-leaks`, `valgrind-clean`, `valgrind-running`, `valgrind-first`, `valgrind-crash`. */
function valgrind(kind: string): void {
  const sprites = { file: 'src/sprites.c', line: 42, column: 21, lost: '2.4 kB', bytes: 2400, allocator: 'malloc', code: '    sprites->frames = malloc(sizeof(sfIntRect) * count);' };
  const score = { file: 'src/score.c', line: 18, column: 18, lost: '64 B', bytes: 64, allocator: 'malloc', code: '    char *text = malloc(sizeof(char) * (len + 1));' };
  const itoa = { file: 'lib/my/my_itoa.c', line: 12, column: 17, lost: '36 B', bytes: 36, allocator: 'malloc', code: '    char *str = malloc(12);' };
  const read = { kind: 'read', what: 'Invalid read of size 4', file: 'src/map.c', line: 57, column: 16, fn: 'tile_at', count: 37, code: '    return map->tiles[y * map->width + x];',
    detail: "0 bytes after a block of size 400 alloc'd", origin: { fn: 'load_map', file: 'src/map.c', line: 31 },
    stack: [{ fn: 'tile_at', file: 'src/map.c', line: 57 }, { fn: 'draw_map', file: 'src/render.c', line: 22 }, { fn: 'main', file: 'src/main.c', line: 48 }] };
  const uninit = { kind: 'uninit', what: 'Conditional jump or move depends on uninitialised value(s)', file: 'lib/my/my_putstr.c', line: 6, column: 15, fn: 'my_putstr', via: 'strlen', count: 1,
    code: '    write(1, str, strlen(str));', stack: [{ fn: 'my_putstr', file: 'lib/my/my_putstr.c', line: 6 }, { fn: 'print_score', file: 'src/score.c', line: 25 }] };
  const free = { kind: 'free', what: 'Invalid free() / delete / delete[] / realloc()', file: 'src/sprites.c', line: 77, column: 5, fn: 'destroy_sprites', via: 'free', count: 1,
    code: '    free(sprites->frames);', detail: "0 bytes inside a block of size 2,400 free'd", origin: { fn: 'destroy_sprites', file: 'src/sprites.c', line: 76 },
    stack: [{ fn: 'destroy_sprites', file: 'src/sprites.c', line: 77 }, { fn: 'main', file: 'src/main.c', line: 61 }] };
  const plan: Array<{ leaks: unknown[]; errors: unknown[]; bytes: number; lost: string; signal?: string }> =
    kind === 'valgrind-clean' ? [
      { leaks: [sprites, score], errors: [read], bytes: 5100, lost: '5.1 kB' }, { leaks: [sprites], errors: [], bytes: 2500, lost: '2.5 kB' },
      { leaks: [], errors: [], bytes: 0, lost: '0 B' }, { leaks: [], errors: [], bytes: 0, lost: '0 B' }]
    : kind === 'valgrind-first' ? [{ leaks: [sprites, itoa], errors: [read, uninit], bytes: 2436, lost: '2.4 kB' }]
    : kind === 'valgrind-crash' ? [{ leaks: [sprites], errors: [read], bytes: 2400, lost: '2.4 kB' }, { leaks: [], errors: [read, free], bytes: 0, lost: '0 B', signal: 'SIGSEGV' }]
    : kind === 'valgrind-leaks' ? [
      { leaks: [sprites, score, itoa], errors: [], bytes: 5300, lost: '5.3 kB' }, { leaks: [sprites, score, itoa], errors: [], bytes: 2500, lost: '2.5 kB' }]
    : [
      { leaks: [sprites, score, itoa], errors: [read, uninit, free], bytes: 5300, lost: '5.3 kB' }, { leaks: [sprites, score, itoa], errors: [read, uninit], bytes: 5100, lost: '5.1 kB' },
      { leaks: [sprites, score], errors: [read, uninit], bytes: 3800, lost: '3.8 kB' }, { leaks: [], errors: [], bytes: 0, lost: '0 B' },
      { leaks: [sprites, score], errors: [read], bytes: 3800, lost: '3.8 kB' }, { leaks: [sprites, itoa], errors: [read, uninit], bytes: 2500, lost: '2.5 kB' }];
  const history = plan.map((c, i) => {
    const at = now - (plan.length - i) * 3_600_000 + 3_510_000;
    const leaks = c.leaks as Array<{ bytes: number }>;
    const run = { status: 'done', command: './my_hunter maps/level_1.txt', leaks, errors: c.errors, errorsOmitted: c.errors.length ? 3 : 0, lost: c.lost, bytes: c.bytes, history: [],
      omitted: 14, unlocated: 0, signal: c.signal ?? null, exitCode: c.signal ? null : 0, error: null, detail: null, at, durationMs: 1840,
      heap: { allocs: 1284, frees: c.bytes ? 1279 : 1284, bytes: 52345, allocated: '52.3 kB', inUse: c.bytes + (c.bytes ? 1700 : 0),
        freed: c.bytes ? `${((52345 - c.bytes - 1700) / 1000).toFixed(1)} kB` : '52.3 kB', reachable: c.bytes ? '1.7 kB' : '0 B' } };
    return { at, bytes: c.bytes, lost: c.lost, errors: (c.errors as Array<{ count: number }>).reduce((n, e) => n + e.count, 0), run };
  });
  const last = history.at(-1)!.run;
  const running = kind === 'valgrind-running'
    ? { ...last, status: 'running', at: now - 14_000, tail: ['Loading maps/level_1.txt (10000x10000)', 'Building sprites… done', 'Frame 118 · 60 fps', 'Frame 119 · 60 fps', 'Frame 120 · 59 fps'] } : last;
  // `valgrind-none`: never run; `valgrind-missing`: valgrind is not installed, earlier checks kept.
  const missing = { ...last, status: 'error', error: 'not_installed', at: now - 5_000 };
  (ctx as { valgrind?: Map<number, unknown> }).valgrind = new Map([[1, kind === 'valgrind-none' ? { command: last.command, history: [], run: null, debug: true }
    : { command: last.command, history, run: kind === 'valgrind-missing' ? missing : running, debug: kind !== 'valgrind' }]]);
}

function draw(): void {
  const app = document.getElementById('app')!;
  let node: HTMLElement;
  const p = projects[0];
  if (screen === 'list') node = renderList(ctx);
  else if (surface === 'sidebar' && ['summary', 'running', 'fresh', 'summary-other', 'summary-local'].includes(screen)) {
    ui.tab = null;
    node = renderProject(ctx, screen === 'summary-other' ? projects[1] : screen === 'summary-local' ? projects[4] : p);
  }
  else if (screen === 'appearance') { ctx.home = surface === 'panel'; ui.page = 'appearance'; node = renderAppearance(ctx); }
  else if (screen === 'list-loading') {
    // First open on a cold cache: the network sweep, shimmering cards and strips while attempts are read.
    ctx.graders.clear();
    ctx.state.network = { active: 2, queued: 3, lastMinute: 7, pausedUntil: null };
    node = renderList(ctx);
  }
  else if (screen === 'summary-loading') { ctx.graders.clear(); ctx.activities.clear(); ui.tab = null; node = renderProject(ctx, p); }
  else if (screen === 'paused') { ctx.state.network = { active: 0, queued: 0, lastMinute: 9, pausedUntil: now + 14 * 60_000 + 32_000 }; node = renderList(ctx); }
  else if (screen === 'home') { ctx.home = true; node = renderHome(ctx, () => undefined); }
  else if (screen.startsWith('login')) {
    ctx.state.auth = { ...ctx.state.auth, status: screen === 'login-expired' ? 'expired' : 'signedOut', pending: screen === 'login-browser' ? { mode: 'browser', url: 'https://login.microsoftonline.com/' } : screen === 'login-paste' ? { mode: 'paste', url: 'https://login.microsoftonline.com/' } : null } as never;
    node = renderLogin(ctx);
  } else if (['offline', 'revoked', 'my_revoked', 'my_disabled', 'update_downloading', 'update_installed', 'update_error'].includes(screen)) {
    availability(screen); node = renderAvailability(ctx)!.node;
  } else {
    if (screen === 'lens_revoked') availability('lens_revoked');
    if (screen.startsWith('valgrind')) { ui.tab = 'valgrind'; valgrind(screen); }
    if (screen === 'functions-sudo') ui.tab = 'prepare';
    ui.tab ??= (['history', 'subject', 'activities', 'details'].includes(screen) ? screen : 'grader') as UiState['tab'];
    if (screen === 'grader-clean' || screen === 'grader') ui.selectedResult[1] ??= history.at(-2)!.id;
    if (screen === 'empty-pipeline') { ctx.readiness.clear(); }
    node = renderProject(ctx, p);
    const lens = renderLensRestriction(ctx);
    if (lens) node.prepend(lens);
  }
  const shell = h('div.shell', { class: `surface-${surface}${screen === 'home' ? ' surface-home' : ''}` });
  if (surface === 'panel' && !screen.startsWith('login') && !(ctx.state as { availability?: unknown }).availability) shell.append(h('div.toolbar', h('span.brand', h('img', { src: document.body.dataset.logo, alt: '', width: 16, height: 16 }), 'Bananabox'), h('span.who', 'sam.durand@epitech.eu'), h('span.spacer'), h('span', ctx.t('toolbar.updated', { when: '2 min ago' }))));
  const net = ctx.state.network;
  const paused = net?.pausedUntil ? h('div.notice.warn', h('span.codicon.codicon-shield'), h('span', ctx.t('net.paused'), ' ', h('b', '14:32'))) : null;
  shell.append(h('div.scroll', h('div.content', paused, node)));
  app.replaceChildren(shell);
}
if (screen === 'fresh') markFresh(1);
if (screen === 'functions') { const r = ctx.readiness.get(1); if (r) r.disallowed = ['printf', 'memcpy']; (ctx.ui.pipelineFocus ??= {})[1] = 'functions'; }
if (screen === 'functions-sudo') { const r = ctx.readiness.get(1); if (r) r.disallowed = ['vfork', 'getpwnam']; (ctx.ui.pipelineFocus ??= {})[1] = 'functions'; }
const preset = PALETTE_PRESETS.find(x => x.id === q.get('palette'));
if (preset) { ctx.state.palette = preset.palette; applyPalette(preset.palette); }
draw();
draw(); // second pass measures the mounted scroller, as the app does on every refresh
document.documentElement.dataset.ready = 'true';
