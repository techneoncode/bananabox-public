import type { Ctx } from '../ctx';
import { h, icon, svg } from '../dom';
import type { ProjectVM, ValgrindCheck, ValgrindErrorVM, ValgrindLeakVM, ValgrindVM } from '../../shared/types';
import { dateTime, relative } from '../format';
import { enterPart, liveElapsed } from '../motion';
import { chip, gut, notice, type Tone } from '../ui';

type State = NonNullable<Ctx['valgrind']> extends Map<number, infer S> ? S : never;
type Delta = 'new' | 'still';
/** A finding of the selected check, an error or a leak, with how it compares to the check before. */
type Finding = { key: string; delta?: Delta } & ({ type: 'error'; error: ValgrindErrorVM } | { type: 'leak'; leak: ValgrindLeakVM });

/**
 * Valgrind tab, on the Grader's loop: the command and the project's checks on the left, the selected check on the
 * right (its numbers, where the heap went, the checks over time, then each memory error and leak at its project line).
 */
export function renderValgrind(ctx: Ctx, p: ProjectVM): HTMLElement {
  const local = p.id === ctx.state.currentProjectId || (ctx.state.localProjects ?? []).includes(p.id);
  if (!local) return h('div.empty', icon('folder'), h('p', ctx.t('valgrind.noLocalCopy')));
  const state: State = ctx.valgrind?.get(p.id) ?? { command: '', run: null, history: [] };
  const running = state.run?.status === 'running';
  const checks = state.history;
  const reports = checks.map((c, i) => c.run ?? (i === checks.length - 1 && state.run?.status === 'done' ? state.run : undefined));
  const picked = ctx.ui.valgrindSelected?.[p.id];
  const index = checks.length ? Math.max(0, picked !== undefined ? checks.findIndex(c => c.at === picked) : checks.length - 1) : -1;
  const select = (i: number): void => {
    const target = checks[i];
    if (!target) return;
    (ctx.ui.valgrindSelected ??= {})[p.id] = target.at;
    ctx.rerender();
  };

  const left = h('div.pipeline-col.vg-side', control(ctx, p, state, running), checkList(ctx, checks, index, running, select));
  const failed = state.run?.status === 'error' ? failure(ctx, state.run) : null;
  const body = running ? live(ctx, state.run!)
    : index < 0 ? (failed ? null : h('div.empty', icon('debug-alt'), h('p', h('strong', ctx.t('valgrind.none'))), h('p.small', ctx.t('valgrind.noneHint'))))
    : report(ctx, p, checks, reports, index, select, state.landedAt);
  const right = h('div.report-col.vg-main', failed,
    enterPart(h('div.vg-body', body), `valgrind-${p.id}`, running ? 'running' : String(checks[index]?.at ?? 0)));
  // The selected check's recap leads, across both columns; the rest of its report follows on the right.
  const top = index >= 0 ? recap(ctx, p, checks, reports, index, select, state.command) : null;
  return h('div.valgrind', top, h('div.loop', left, right));
}

/** The command, the run button, the -g warning, and the run in flight. */
function control(ctx: Ctx, p: ProjectVM, state: State, running: boolean): HTMLElement {
  const { t } = ctx;
  const drafts = ctx.ui.valgrindDrafts ??= {};
  const id = `valgrind-command-${p.id}`;
  const saving = state.saving === true, building = state.building === true;
  const dirty = drafts[p.id] !== undefined && drafts[p.id] !== state.command;
  const input = h('input.mono', { id, type: 'text', value: drafts[p.id] ?? state.command, placeholder: './my_program arg1 arg2', spellcheck: false,
    disabled: running || saving, dataset: { keep: id }, oninput: (e: Event) => { drafts[p.id] = (e.target as HTMLInputElement).value; ctx.rerender(); } });
  const save = (e: Event): void => {
    e.preventDefault();
    if (!dirty) return;
    ctx.valgrind?.set(p.id, { ...state, saving: true });
    ctx.post({ type: 'setValgrindCommand', projectId: p.id, command: input.value });
    delete drafts[p.id];
    ctx.rerender();
  };
  // Valgrind builds and runs the code of the folder open in this window: only that project can run it.
  const here = ctx.state.currentProjectId === p.id;
  return h('div.panel.vg-control', { class: running ? 'running' : '' },
    h('span.sb-sweep', { 'aria-hidden': 'true' }),
    h('div.section-head', h('h2', t('valgrind.title'))),
    h('label.small', { htmlFor: id }, t('valgrind.command')),
    h('form.command-form', { onsubmit: save }, input, dirty && h('button.btn.small', { type: 'submit' }, icon('check'), t('command.save'))),
    h('button.btn.primary.block.vg-run-btn', { type: 'button', 'aria-busy': running ? 'true' : undefined, disabled: running || saving || dirty || building || !state.command.trim() || !here, title: !here ? t('app.project.valgrindOpenFirst') : dirty ? t('valgrind.saveFirst') : undefined,
      onclick: () => {
        // Running from the click: the host confirms (or reports why not) a moment later.
        const run: ValgrindVM = { status: 'running', command: state.command, leaks: [], lost: '', bytes: 0, heap: null, durationMs: 0, history: [], omitted: 0, unlocated: 0,
          signal: null, exitCode: null, error: null, detail: null, at: Date.now() };
        ctx.valgrind?.set(p.id, { ...state, run });
        ctx.post({ type: 'runValgrind', projectId: p.id });
        ctx.rerender();
      } },
    running ? icon('loading', 'spin') : icon('debug-alt'), running ? t('valgrind.executing') : t('valgrind.run'),
    running && h('span.vg-btn-clock', liveElapsed(new Date(state.run!.at).toISOString()))),
    !here && !running && h('p.small.muted', { role: 'note' }, icon('info'), ' ', t('app.project.valgrindOpenFirst')),
    running && h('div.vg-live', { role: 'status' },
      h('span', t('valgrind.underValgrind')),
      h('button.btn.small', { type: 'button', onclick: () => ctx.post({ type: 'cancelValgrind', projectId: p.id }) }, icon('debug-stop'), t('valgrind.stop'))),
    // Only when the Makefile has no -g: findings would have no line to open.
    (state.debug === false || building) && h('div.vg-debug', { role: 'status' },
      icon(building ? 'loading' : 'warning', building ? 'spin' : ''),
      h('span', building ? t('valgrind.debugBuilding') : t('valgrind.noDebug')),
      h('button.btn.small', { type: 'button', disabled: building || running, onclick: () => ctx.post({ type: 'addDebugFlag', projectId: p.id }) },
        icon('tools'), t('valgrind.addDebug'))),
    state.debug !== false && !building && !running && h('p.tiny.muted', t('valgrind.hint')));
}

function checkTone(c: ValgrindCheck): Tone {
  if (c.run?.signal || (c.errors ?? 0) > 0) return 'fail';
  return c.bytes > 0 ? 'major' : 'pass';
}

const VISIBLE_CHECKS = 4;

/** The project's checks, newest first; picking one shows it on the right. */
function checkList(ctx: Ctx, checks: ValgrindCheck[], index: number, running: boolean, select: (i: number) => void): HTMLElement | null {
  const { t, lang } = ctx;
  if (!checks.length && !running) return null;
  // The few latest, and the one shown if it is older; the rest one click away.
  const all = ctx.ui.valgrindAllChecks?.has(checks[0]?.at ?? 0) ?? false;
  const shown = (i: number) => all || i >= checks.length - VISIBLE_CHECKS || i === index;
  const rows = checks.map((c, i) => ({ c, i })).reverse().filter(({ i }) => shown(i));
  const hidden = checks.length - rows.length;
  const toggle = (): void => {
    const set = ctx.ui.valgrindAllChecks ??= new Set();
    if (all) set.delete(checks[0]!.at); else set.add(checks[0]!.at);
    ctx.rerender();
  };
  return h('section.panel.vg-checks', { 'aria-label': t('valgrind.checksTitle') },
    h('div.section-head', h('h2', t('valgrind.checksTitle')), h('span.counter', String(checks.length)),
      (hidden > 0 || all) && h('button.btn.ghost.small.vg-more', { type: 'button', 'aria-expanded': String(all), onclick: toggle },
        all ? t('valgrind.fewerChecks') : t('valgrind.moreChecks', { n: hidden }))),
    h('div.g-list',
      running && h('div.g-row.vg-check.is-running', gut(null, 'running'), h('span.g-main', h('span', t('valgrind.executing'))), h('span.g-side', '…')),
      rows.map(({ c, i }) => {
        const errors = c.errors;
        const clean = c.bytes === 0 && !errors && !c.run?.signal;
        return h('button.g-row.vg-check', {
          type: 'button', 'aria-current': i === index && !running ? 'true' : undefined, class: i === index && !running ? 'is-focus' : '',
          title: dateTime(new Date(c.at).toISOString(), lang), onclick: () => select(i),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            select(e.key === 'ArrowDown' ? i - 1 : i + 1);
            requestAnimationFrame(() => document.querySelector<HTMLElement>('.vg-check.is-focus')?.focus());
          },
        },
        gut(i + 1, checkTone(c)),
        h('span.g-main', h('span.vg-check-when', relative(new Date(c.at).toISOString(), lang)), c.run?.signal && chip('fail', c.run.signal)),
        h('span.g-side', clean ? h('span.ok', t('valgrind.cleanShort'))
          : [c.bytes > 0 && h('span.vg-lost', c.lost), errors ? h('span.vg-err', t('valgrind.errorsShort', { n: errors })) : null]));
      })));
}

/** Why the last attempt gave no report: valgrind missing, no command, the program not starting, a stop. */
function failure(ctx: Ctx, run: ValgrindVM): HTMLElement | null {
  const { t } = ctx;
  if (run.error === 'not_installed') return notice('error', 'error', h('strong', t('valgrind.notInstalled')), ' ', h('code', 'sudo apt install valgrind'));
  if (run.error === 'no_command') return notice('warn', 'warning', t('valgrind.noCommand'));
  if (run.error === 'not_started') return notice('error', 'error', h('strong', t('valgrind.notStarted')), run.detail && h('span.mono', ' ', run.detail));
  if (run.error === 'cancelled') return notice('', 'debug-stop', t('valgrind.cancelled'));
  return null;
}

/** The run in flight: the program's last output lines, as they come. */
function live(ctx: Ctx, run: ValgrindVM): HTMLElement {
  const { t } = ctx;
  const lines = run.tail ?? [];
  return h('section.section.vg-output', { 'aria-live': 'polite' },
    h('div.report-head', icon('loading', 'spin'), h('h2', t('valgrind.output')), h('span.when', run.command)),
    h('pre.vg-tail', lines.length
      ? lines.map((line, i) => h('span', { class: i === lines.length - 1 ? 'last' : '' }, line))
      : h('span.muted.last', t('valgrind.waiting'))));
}

const errorKey = (e: ValgrindErrorVM): string => `e:${e.kind}:${e.file}:${e.line}`;
const leakKey = (l: ValgrindLeakVM): string => `l:${l.file}:${l.line}`;

const errorTotal = (check: ValgrindCheck, run: ValgrindVM | undefined): number =>
  run?.errors ? run.errors.reduce((n, e) => n + e.count, 0) : check.errors ?? 0;

/** The selected check at a glance: how it went, when, the navigator, its five numbers. */
function recap(ctx: Ctx, p: ProjectVM, checks: ValgrindCheck[], reports: Array<ValgrindVM | undefined>, index: number, select: (i: number) => void, current: string): HTMLElement {
  const { t, lang } = ctx;
  const check = checks[index]!, run = reports[index];
  const errorCount = errorTotal(check, run);
  const clean = check.bytes === 0 && errorCount === 0 && !run?.signal;
  const broken = errorCount > 0 || !!run?.signal;
  return h('section.vg-recap', { 'aria-label': t('valgrind.checkTitle', { n: index + 1 }) },
    h('div.report-head',
      // Errors and crashes are failures; leaks alone are the lens's Major.
      clean ? icon('pass-filled', 'ic-success') : broken ? icon('error', 'ic-danger') : icon('warning', 'vg-ic-major'),
      h('h2', t('valgrind.checkTitle', { n: index + 1 })),
      h('span.when', dateTime(new Date(check.at).toISOString(), lang)),
      run?.command && run.command !== current && h('code.vg-cmd', { title: ctx.t('valgrind.ranCommand') }, run.command),
      h('div.run-selector',
        h('select', { 'aria-label': t('valgrind.selectCheck'), onchange: (e: Event) => select(Number((e.target as HTMLSelectElement).value)) },
          checks.map((c, i) => ({ c, i })).reverse().map(({ c, i }) => h('option', { value: String(i), selected: i === index },
            `${t('valgrind.checkTitle', { n: i + 1 })} · ${relative(new Date(c.at).toISOString(), lang)} · ${c.lost}${c.errors ? ` · ${t('valgrind.errorsShort', { n: c.errors })}` : ''}`))),
        h('button.icon-btn', { disabled: index <= 0, title: t('valgrind.olderCheck'), 'aria-label': t('valgrind.olderCheck'), onclick: () => select(index - 1) }, icon('chevron-left')),
        h('button.icon-btn', { disabled: index >= checks.length - 1, title: t('valgrind.newerCheck'), 'aria-label': t('valgrind.newerCheck'), onclick: () => select(index + 1) }, icon('chevron-right')))),
    enterPart(stats(ctx, check, run, errorCount), `vg-recap-${p.id}`, String(check.at)));
}

/** The rest of the selected check: the heap ledger, the seismograph, then its errors and leaks. */
function report(ctx: Ctx, p: ProjectVM, checks: ValgrindCheck[], reports: Array<ValgrindVM | undefined>, index: number, select: (i: number) => void, landedAt?: number): HTMLElement {
  const { t } = ctx;
  const check = checks[index]!, run = reports[index];
  const errors = run?.errors ?? [];
  const errorCount = errorTotal(check, run);
  const clean = check.bytes === 0 && errorCount === 0 && !run?.signal;
  const root = h('section.report.vg-report');
  const part = <E extends HTMLElement>(el: E) => enterPart(el, `vg-report-${p.id}`, String(check.at));
  if (run?.heap) root.append(part(ledger(ctx, run)));
  const seismo = seismograph(ctx, checks, index, select, landedAt);
  if (seismo) root.append(seismo);
  if (!run) {
    root.append(h('p.muted.small', t('valgrind.noReport')));
    return root;
  }
  const notes = [
    run.signal && notice('error', 'error', t('valgrind.crashed', { signal: run.signal })),
    run.unlocated > 0 && notice('warn', 'warning', t('valgrind.unlocated', { n: run.unlocated })),
  ].filter(Boolean) as HTMLElement[];
  if (notes.length) root.append(h('div.vg-notes', notes));

  // Against the check before, when its report is still here: new, still there, fixed.
  const before = index > 0 ? reports[index - 1] : undefined;
  const beforeKeys = new Set(before ? [...(before.errors ?? []).map(errorKey), ...before.leaks.map(leakKey)] : []);
  const delta = (key: string): Delta | undefined => before ? (beforeKeys.has(key) ? 'still' : 'new') : undefined;
  const findings: Finding[] = [
    ...errors.map(error => ({ type: 'error' as const, error, key: errorKey(error), delta: delta(errorKey(error)) })),
    ...run.leaks.map(leak => ({ type: 'leak' as const, leak, key: leakKey(leak), delta: delta(leakKey(leak)) })),
  ];
  const keys = new Set(findings.map(f => f.key));
  const fixed: Finding[] = before ? [
    ...(before.errors ?? []).filter(e => !keys.has(errorKey(e))).map(error => ({ type: 'error' as const, error, key: errorKey(error) })),
    ...before.leaks.filter(l => !keys.has(leakKey(l))).map(leak => ({ type: 'leak' as const, leak, key: leakKey(leak) })),
  ] : [];
  if (before && (findings.length || fixed.length)) {
    const fresh = findings.filter(f => f.delta === 'new').length, still = findings.length - fresh;
    root.append(part(h('div.compare-line', icon('git-compare'), t('valgrind.vsPrevious'),
      fixed.length > 0 && chip('pass', t('valgrind.fixedN', { n: fixed.length })),
      fresh > 0 && chip('fail', t('valgrind.newN', { n: fresh })),
      still > 0 && chip('warn', t('valgrind.stillN', { n: still })))));
  }

  if (clean) root.append(part(cleanRow(ctx, checks, index, run)));
  const errorFindings = findings.filter(f => f.type === 'error'), leakFindings = findings.filter(f => f.type === 'leak');
  let n = 0;
  if (errorFindings.length) root.append(findingList(ctx, p, check.at, t('valgrind.errorsTitle'), String(errorCount), errorFindings, n));
  n += errorFindings.length;
  if (leakFindings.length) root.append(findingList(ctx, p, check.at, t('valgrind.leaksTitle'), run.lost, leakFindings, n));
  if (fixed.length) {
    const open = ctx.ui.openTasks.has(`vg:${check.at}:fixed`);
    root.append(h('details.passed-group.vg-fixed', { open, ontoggle: (e: Event) => {
      if ((e.target as HTMLDetailsElement).open) ctx.ui.openTasks.add(`vg:${check.at}:fixed`); else ctx.ui.openTasks.delete(`vg:${check.at}:fixed`);
    } }, h('summary', gut(null, 'pass'), icon('chevron-right', 'chev'), h('span.muted.small', t('valgrind.fixedSince', { n: fixed.length }))),
    h('div.g-list', fixed.map(f => h('div.g-row.vg-fixed-row', gut(null, 'muted'),
      h('span.g-main', icon('check', 'ic-success'), h('span.name', f.type === 'error' ? f.error.what : t('valgrind.leakAt')), h('span.mono.vg-path', location(f))),
      h('span.g-side', f.type === 'leak' ? f.leak.lost : f.error.count > 1 ? `×${f.error.count}` : ''))))));
  }
  const left = [run.omitted > 0 && t('valgrind.omitted', { n: run.omitted }), (run.errorsOmitted ?? 0) > 0 && t('valgrind.errorsOmitted', { n: run.errorsOmitted! })].filter(Boolean);
  if (left.length) root.append(h('p.tiny.muted.vg-omitted', icon('library'), ' ', left.join(' ')));
  return root;
}

function location(f: Finding): string {
  return f.type === 'error' ? `${f.error.file}:${f.error.line}` : `${f.leak.file}:${f.leak.line}`;
}

function stat(label: string, value: Node | string, tone = '', sub?: string): HTMLElement {
  return h('div.vg-stat', { class: tone }, h('span.l', label), h('span.v', value), sub ? h('span.s', sub) : null);
}

/** The check in five numbers: lost, errors, blocks freed, how it ended, how long it took. */
function stats(ctx: Ctx, check: ValgrindCheck, run: ValgrindVM | undefined, errorCount: number): HTMLElement {
  const { t, lang } = ctx;
  const heap = run?.heap;
  return h('div.vg-stats',
    stat(t('valgrind.row.lost'), check.lost, check.bytes > 0 ? 'major' : 'ok', run && run.leaks.length + run.unlocated > 0 ? t('valgrind.leaksN', { n: run.leaks.length }) : undefined),
    stat(t('valgrind.errorsTitle'), String(errorCount), errorCount > 0 ? 'bad' : 'ok', errorCount > 0 && run?.errors ? t('valgrind.sitesN', { n: run.errors.length }) : undefined),
    heap && stat(t('valgrind.row.freed'), h('span', num(heap.frees, lang), h('small', `/${num(heap.allocs, lang)}`)), heap.frees >= heap.allocs ? 'ok' : 'warn', t('valgrind.blocks')),
    run && stat(t('valgrind.row.exit'), run.signal ?? String(run.exitCode ?? '—'), run.signal ? 'bad' : run.exitCode === 0 ? '' : 'warn'),
    run && run.durationMs > 0 && stat(t('valgrind.row.duration'), duration(run.durationMs, lang)));
}

/** Where the heap went, in bytes: freed, still reachable at exit, lost (one segment per leak, biggest first). */
function ledger(ctx: Ctx, run: ValgrindVM): HTMLElement {
  const { t } = ctx;
  const heap = run.heap!;
  const total = Math.max(1, heap.bytes);
  const inUse = heap.inUse ?? run.bytes;
  const freed = Math.max(0, heap.bytes - inUse), reachable = Math.max(0, inUse - run.bytes);
  const located = run.leaks.reduce((n, l) => n + l.bytes, 0);
  const seg = (cls: string, bytes: number, title: string, extra: Record<string, unknown> = {}) =>
    bytes > 0 && h('span', { class: `vg-seg ${cls}`, style: { flexGrow: String(bytes / total) }, title, ...extra });
  const bar = h('div.vg-ledger-bar', { role: 'img', 'aria-label': t('valgrind.ledgerAria', { freed: heap.freed ?? '', reachable: heap.reachable ?? '', lost: run.lost, allocated: heap.allocated }) },
    seg('freed', freed, `${t('valgrind.ledger.freed')} · ${heap.freed ?? ''}`),
    seg('reachable', reachable, `${t('valgrind.ledger.reachable')} · ${heap.reachable ?? ''}`),
    run.leaks.map((l, j) => {
      // Pointing at a leak's share lights its row below.
      const light = (on: boolean) => () => document.querySelectorAll(`[data-finding="${CSS.escape(leakKey(l))}"]`).forEach(row => row.classList.toggle('lit', on));
      return seg('lost', l.bytes, `${l.file}:${l.line} · ${l.lost}`, { style: { flexGrow: String(l.bytes / total), '--j': String(j) }, onmouseenter: light(true), onmouseleave: light(false) });
    }),
    seg('lost other', run.bytes - located, `${t('valgrind.ledger.lostElsewhere')}`));
  return h('div.vg-ledger',
    h('div.vg-ledger-head', h('h3', t('valgrind.ledgerTitle')), h('span.vg-ledger-total', t('valgrind.allocatedTotal', { bytes: heap.allocated }))),
    bar,
    h('div.vg-ledger-key',
      h('span', h('i.k.freed'), t('valgrind.ledger.freed'), h('b', heap.freed ?? '—')),
      reachable > 0 && h('span', h('i.k.reachable'), t('valgrind.ledger.reachable'), h('b', heap.reachable ?? '')),
      h('span', { class: run.bytes > 0 ? 'bad' : '' }, h('i.k.lost'), t('valgrind.ledger.lost'), h('b', run.lost))));
}

/**
 * The checks over time around a zero line: bytes lost rise above it, memory errors drop below it, a clean check is a
 * mark on the line. The selected check is lit; a column picks its check.
 */
function seismograph(ctx: Ctx, checks: ValgrindCheck[], index: number, select: (i: number) => void, landedAt?: number): HTMLElement | null {
  const { t, lang } = ctx;
  if (checks.length < 2) return null;
  const slot = 24, bar = 12, up = 46, down = 26, mid = up + 1;
  const width = checks.length * slot, height = up + down + 2;
  const maxBytes = Math.max(1, ...checks.map(c => c.bytes)), maxErrors = Math.max(1, ...checks.map(c => c.errors ?? 0));
  // A few checks stay narrow columns instead of stretching across the panel.
  const fresh = landedAt !== undefined && Date.now() - landedAt < 1600 ? Date.now() - landedAt : null;
  const chart = svg('svg', { class: 'vg-seismo', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img',
    'aria-label': t('valgrind.seismoAria', { n: checks.length }) });
  checks.forEach((c, i) => {
    const x = i * slot, cx = x + (slot - bar) / 2;
    const landed = fresh !== null && i === checks.length - 1;
    const g = svg('g', { class: `vg-col${i === index ? ' selected' : ''}${landed ? ' fresh' : ''}`, ...(landed ? { style: `--fresh: ${fresh}ms` } : {}) });
    g.append(svg('title', {}, `${t('valgrind.checkTitle', { n: i + 1 })} · ${dateTime(new Date(c.at).toISOString(), lang)} · ${c.lost}${c.errors ? ` · ${t('valgrind.errorsShort', { n: c.errors })}` : ''}`));
    g.append(svg('rect', { class: 'vg-band', x, y: 0, width: slot, height }));
    if (c.bytes > 0) {
      const hgt = Math.max(3, Math.sqrt(c.bytes / maxBytes) * up);
      g.append(svg('rect', { class: 'vg-up', x: cx, y: mid - hgt, width: bar, height: hgt, rx: 1.5 }));
    }
    if ((c.errors ?? 0) > 0) {
      const hgt = Math.max(3, Math.sqrt(c.errors! / maxErrors) * down);
      g.append(svg('rect', { class: 'vg-down', x: cx, y: mid + 1, width: bar, height: hgt, rx: 1.5 }));
    }
    if (!c.bytes && !c.errors) g.append(svg('rect', { class: 'vg-zero', x: cx, y: mid - 1.5, width: bar, height: 3, rx: 1.5 }));
    g.addEventListener('click', () => select(i));
    chart.append(g);
  });
  chart.append(svg('line', { class: 'vg-axis', x1: 0, x2: width, y1: mid, y2: mid }));
  return h('div.vg-seismograph',
    h('div.vg-seismo-head', h('h3', t('valgrind.seismoTitle')),
      h('span.vg-keys', h('span.vg-key', h('i.k.lost'), t('valgrind.seismoUp')), h('span.vg-key', h('i.k.err'), t('valgrind.seismoDown')))),
    // A few checks stay narrow columns, their first and last labels under them, instead of stretching across the panel.
    h('div.vg-seismo-frame', { style: { width: `min(100%, ${checks.length * 44 + 2}px)` } },
      h('div.vg-seismo-plot', chart),
      h('div.vg-seismo-foot', h('span', t('valgrind.checkTitle', { n: 1 })), h('span', t('valgrind.checkTitle', { n: checks.length })))));
}

/** A clean check says so on a gutter row, with its streak, instead of an empty list. */
function cleanRow(ctx: Ctx, checks: ValgrindCheck[], index: number, run: ValgrindVM): HTMLElement {
  const { t, lang } = ctx;
  let streak = 0;
  for (let i = index; i >= 0 && checks[i]!.bytes === 0 && !checks[i]!.errors; i--) streak++;
  return h('div.g-list.vg-clean', { role: 'status' },
    h('div.g-row', gut(null, 'pass'),
      h('span.g-main', icon('pass-filled', 'ic-success'), h('strong', t('valgrind.cleanTitle'))),
      h('span.g-side', streak > 1 ? chip('pass', t('valgrind.cleanStreak', { n: streak })) : chip('pass', t('valgrind.cleanOnce')))),
    run.heap && h('div.g-row', gut(null, null), h('span.g-main.muted', t('valgrind.cleanAll', { n: num(run.heap.frees, lang) })), h('span.g-side', '')));
}

/** Errors or leaks as the Grader's tasks: one gutter row each, unfolding on the source peek and the stack. */
function findingList(ctx: Ctx, p: ProjectVM, at: number, title: string, meta: string, findings: Finding[], offset: number): HTMLElement {
  return h('section.vg-findings',
    h('div.tasks-head', h('h3', title, h('span.counter', meta))),
    h('div.g-list', findings.map((f, i) => findingRow(ctx, p, at, f, offset + i + 1, offset + i === 0))));
}

const KIND_ICON: Record<ValgrindErrorVM['kind'], string> = { read: 'eye', write: 'edit', free: 'trash', uninit: 'question', overlap: 'files', other: 'warning' };

function findingRow(ctx: Ctx, p: ProjectVM, at: number, f: Finding, n: number, first: boolean): HTMLElement {
  if (f.type === 'leak') return leakRow(ctx, p, f, n);
  const { t } = ctx;
  const key = `vg:${at}:${f.key}`;
  const open = first !== ctx.ui.openTasks.has(key);
  const toggle = (): void => {
    if (ctx.ui.openTasks.has(key)) ctx.ui.openTasks.delete(key); else ctx.ui.openTasks.add(key);
    ctx.rerender();
  };
  // An error is memcheck's words, then its line.
  const row = h('div.task.vg-finding.is-error', { class: `failed ${open ? 'open' : ''}`, dataset: { finding: f.key } },
    h('button.g-row.task-head', { type: 'button', 'aria-expanded': String(open), onclick: toggle },
      gut(n, 'fail'),
      h('span.g-main', icon('chevron-right', 'chev'), icon(KIND_ICON[f.error.kind], 'vg-kind'),
        h('span.name', f.error.what),
        h('span.vg-meta', h('span.mono.vg-path', location(f)),
          f.delta === 'new' && chip('fail', t('valgrind.new')),
          f.delta === 'still' && chip('warn', t('valgrind.still')))),
      h('span.g-side', f.error.count > 1 ? `×${f.error.count}` : '')));
  if (!open) return row;
  const openAt = (file: string, line: number, column = 1) => ctx.post({ type: 'openFile', projectId: p.id, file, line, column });
  const body = h('div.task-body');
  const e = f.error;
  body.append(peek(ctx, e.file, e.line, e.column, e.code, e.via, `■ [Major] VALGRIND: ${e.what}${e.via ? ` in ${e.via}` : ''}`, 'fail', () => openAt(e.file, e.line, e.column)));
  if (e.detail) body.append(h('p.vg-detail', icon('info'), h('span', blockText(ctx, e.detail)),
    e.origin && h('span.vg-origin', ', ', t(/free'd/.test(e.detail) ? 'valgrind.freedAt' : 'valgrind.allocatedAt'),
      h('button.btn-tag.vg-frame', { type: 'button', onclick: () => openAt(e.origin!.file, e.origin!.line) }, `${e.origin.fn} · ${e.origin.file}:${e.origin.line}`))));
  if (e.stack.length > 1) body.append(h('div.vg-stack',
    h('span.vg-stack-label', t('valgrind.stack')),
    h('ol', e.stack.map((fr, j) => h('li', h('button.btn-tag.vg-frame', { type: 'button', onclick: () => openAt(fr.file, fr.line) },
      h('span.vg-fn', fr.fn), h('span', `${fr.file}:${fr.line}`)), j === 0 && e.via && h('span.muted', ` → ${e.via}`))))));
  row.append(body);
  return row;
}

/**
 * A leak needs no unfolding: its line, its bytes, and right under it the allocation as the editor shows it, with the
 * lens it carries there. Either opens the allocating call.
 */
function leakRow(ctx: Ctx, p: ProjectVM, f: Finding & { type: 'leak' }, n: number): HTMLElement {
  const { t } = ctx;
  const l = f.leak;
  const open = (): void => ctx.post({ type: 'openFile', projectId: p.id, file: l.file, line: l.line, column: l.column });
  return h('div.vg-finding.is-leak', { dataset: { finding: f.key } },
    h('button.g-row.vg-leak-head', { type: 'button', title: t('valgrind.openLine'), onclick: open },
      gut(n, 'major'),
      h('span.g-main', h('span.name.mono', location(f)), h('span.vg-meta', h('span.vg-alloc', t('valgrind.allocatedBy', { fn: l.allocator ?? 'malloc' })),
        f.delta === 'new' && chip('fail', t('valgrind.new')), f.delta === 'still' && chip('warn', t('valgrind.still')))),
      h('span.g-side.vg-bytes', l.lost)),
    peek(ctx, l.file, l.line, l.column, l.code, l.allocator, `■ [Major] VALGRIND: ${l.lost} never freed`, 'major', open, true));
}

/** `0 bytes after a block of size 40 alloc'd`, said plainly. */
function blockText(ctx: Ctx, detail: string): string {
  const m = /^(\d+) bytes (after|before|inside) a block of size (\d+) (alloc'd|free'd)/.exec(detail);
  if (!m) return detail;
  return ctx.t(`valgrind.block.${m[2]}${m[4] === "free'd" ? 'Freed' : ''}`, { n: m[1]!, size: m[3]! });
}

/** The line as the editor shows it: number, code with the call underlined, the lens; a click opens it. */
function peek(ctx: Ctx, file: string, line: number, column: number, code: string | undefined, call: string | undefined, lens: string, tone: 'fail' | 'major', open: () => void, bare = false): HTMLElement {
  const src = code ?? '';
  const indent = src.length - src.trimStart().length;
  const text = src.trimEnd().slice(indent);
  const at = column - 1 - indent;
  const underlined = call && at >= 0 && text.slice(at, at + call.length) === call;
  // `bare`: the row above already names the file, the line alone follows it.
  return h('button.vg-peek', { type: 'button', class: `t-${tone}${bare ? ' bare' : ''}`, title: ctx.t('valgrind.openLine'), onclick: open, tabIndex: bare ? -1 : 0 },
    !bare && h('span.vg-peek-top', icon('go-to-file'), h('span.mono.vg-path', `${file}:${line}`), h('span.vg-open', ctx.t('valgrind.open'))),
    text ? h('span.vg-code',
      h('span.vg-ln', String(line)),
      h('span.vg-src', underlined ? [text.slice(0, at), h('u', call), text.slice(at + call.length)] : text, h('span.vg-lens', lens)))
      : h('span.vg-code', h('span.vg-ln', String(line)), h('span.vg-src', h('span.muted', ctx.t('valgrind.noSource')), h('span.vg-lens', lens))));
}

function duration(ms: number, lang: string): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString(lang, { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Grouped digits with a regular no-break space: the display face has no narrow one (`1 284`, not `1284`). */
function num(n: number, lang: string): string {
  return n.toLocaleString(lang).replace(/ /g, ' ');
}
