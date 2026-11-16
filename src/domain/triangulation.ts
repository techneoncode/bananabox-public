import {
  analyzeGraderTrace,
  PHASE_RANK,
  type Cause,
  type CodeIssue,
  type GraderCommand,
  type TaskAnalysis,
} from './graderTrace';
import { diffLines, firstDifference, type FirstDifference } from './textDiff';

export type Transition =
  | 'fixed'
  | 'regressed'
  | 'progress'
  | 'stillFailing'
  | 'different'
  | 'unchanged'
  | 'new'
  | 'gone';
export type SuspectReason =
  | 'error_location'
  | 'linker_symbol'
  | 'changed_since'
  | 'task_directory'
  | 'local_style';
export type Confidence = 'high' | 'medium' | 'low';

export interface Suspect {
  file: string;
  line?: number;
  score: number;
  reasons: SuspectReason[];
}

export interface OutputMismatch {
  expected: string;
  got: string;
  first: FirstDifference | null;
  /** Number of differing lines (removed + added). */
  distance: number;
}

export interface TaskTriangulation {
  task: string;
  transition: Transition;
  before: Cause | null;
  after: Cause | null;
  /**
   * Did the run get further down the pipeline (build → forbidden → tests →
   * pass)?
   */
  direction: 'forward' | 'backward' | 'same';
  suspects: Suspect[];
  confidence: Confidence;
  mismatch: OutputMismatch | null;
  /**
   * The same mismatch in the earlier run: lets the UI say "now off by 1 line
   * instead of 3".
   */
  previousMismatch: OutputMismatch | null;
  commands: GraderCommand[];
}

export interface SharedCause {
  signature: string;
  kind: string;
  params: Cause['params'];
  tasks: string[];
}

export interface StyleDelta {
  introduced: CodeIssue[];
  resolved: CodeIssue[];
  persisting: number;
}

export interface Triangulation {
  tasks: TaskTriangulation[];
  shared: SharedCause[];
  style: StyleDelta;
  changedFiles: string[] | null;
  /**
   * Changed source files that no failing task points at (useful context: "also
   * modified").
   */
  otherChanges: string[];
  counts: {
    fixed: number;
    regressed: number;
    progress: number;
    stillFailing: number;
  };
}

export interface TriangulationContext {
  /**
   * Repository-relative files modified between the two evaluated commits; null
   * when the history is unavailable.
   */
  changedFiles?: readonly string[] | null;
  /** Local style findings (BananaLens) used as corroboration. */
  localStyle?: ReadonlyArray<{ file: string; line: number; rule?: string }>;
}

const taskKey = (name: string): string => name.trim()
  .replace(/^\d+\s*[-.:]\s*/, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();
const isSource = (f: string): boolean => /\.(?:c|h|cc|cpp|hpp)$/i.test(f);
const dirOf = (f: string): string =>
  (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.');
const rank = (t: TaskAnalysis | undefined): number => (!t
  ? -1
  : t.cause
    ? PHASE_RANK[t.cause.phase]
    : t.status === 'failure'
      ? PHASE_RANK.run
      : t.status === 'success'
        ? PHASE_RANK.pass
        : -1);

function mismatchOf(task: TaskAnalysis | undefined): OutputMismatch | null {
  const f = task?.run.failures.find(x =>
    (x.kind === 'invalid_output' || x.kind === 'coverage')
    && x.expected !== undefined
    && x.got !== undefined);
  if (!f) return null;
  const distance = diffLines(f.expected!, f.got!)
    .filter(o => o.kind !== 'same')
    .length;
  return {
    expected: f.expected!,
    got: f.got!,
    first: firstDifference(f.expected!, f.got!, {
      ignoreTrailingNewline: true,
    }),
    distance,
  };
}

function transition(
  before: TaskAnalysis | undefined,
  after: TaskAnalysis | undefined,
): Transition {
  if (!before) return 'new';
  if (!after) return 'gone';
  if (before.status === 'unknown' && !before.cause
    || after.status === 'unknown' && !after.cause) {
    return 'different';
  }
  const failedBefore = before.status === 'failure' || !!before.cause;
  const failedAfter = after.status === 'failure' || !!after.cause;
  if (failedBefore && !failedAfter) return 'fixed';
  if (!failedBefore && failedAfter) return 'regressed';
  if (!failedBefore && !failedAfter) return 'unchanged';
  if (before.cause && after.cause
    && before.cause.signature === after.cause.signature) {
    const a = mismatchOf(before);
    const b = mismatchOf(after);
    return a && b && b.distance < a.distance ? 'progress' : 'stillFailing';
  }
  const r1 = rank(before);
  const r2 = rank(after);
  if (r2 > r1) return 'progress';
  if (r2 < r1) return 'regressed';
  return 'different';
}

function suspectsFor(
  after: TaskAnalysis | undefined,
  ctx: TriangulationContext,
): Suspect[] {
  if (!after?.cause) return [];
  const map = new Map<string, Suspect>();
  const add = (
    file: string,
    score: number,
    reason: SuspectReason,
    line?: number,
  ): void => {
    const s = map.get(file) ?? {
      file,
      score: 0,
      reasons: [],
      ...(line !== undefined ? { line } : {}),
    };
    s.score += score;
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    if (line !== undefined && s.line === undefined) s.line = line;
    map.set(file, s);
  };
  const cause = after.cause;
  const linkerFiles = String(cause.params.files ?? '')
    .split(',')
    .map(f => f.trim())
    .filter(Boolean);
  if (cause.kind === 'multiple_definition'
    || cause.kind === 'undefined_reference') {
    for (const f of linkerFiles) {
      add(f.replace(/\.o$/, '.c'), 3, 'linker_symbol');
    }
  } else if (cause.file) {
    add(cause.file, 3, 'error_location', cause.line);
  }
  const changed = ctx.changedFiles
    ? ctx.changedFiles.filter(isSource)
    : null;
  if (changed) {
    const dirs = new Set(after.commands.map(c => c.cwd));
    for (const f of changed) {
      if (map.has(f)) {
        add(f, 3, 'changed_since');
      } else if (dirs.has('.')
        ? cause.phase === 'run'
        : [...dirs].some(d => dirOf(f) === d || f.startsWith(`${d}/`))) {
        add(f, 1.5, 'task_directory');
      }
    }
  }
  for (const finding of ctx.localStyle ?? []) {
    if (map.has(finding.file)
      && finding.line === map.get(finding.file)!.line) {
      add(finding.file, 1, 'local_style');
    }
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, 5);
}

function confidenceOf(suspects: Suspect[], hasHistory: boolean): Confidence {
  const top = suspects[0];
  if (!top) return 'low';
  const strong = top.reasons.some(r =>
    r === 'error_location' || r === 'linker_symbol');
  if (strong && top.reasons.includes('changed_since')) return 'high';
  if (strong && !hasHistory) return 'medium';
  if (top.reasons.includes('changed_since') || strong) return 'medium';
  return 'low';
}

const issueKey = (i: CodeIssue): string => `${i.file}|${i.rule ?? i.message}`;

function styleDelta(before: TaskAnalysis[], after: TaskAnalysis[]): StyleDelta {
  const collect = (tasks: TaskAnalysis[]): Map<string, CodeIssue> => {
    const m = new Map<string, CodeIssue>();
    for (const t of tasks) {
      for (const i of t.build.style) {
        if (!i.external && i.bucket !== 'info'
          && !m.has(issueKey(i))) {
          m.set(issueKey(i), i);
        }
      }
    }
    return m;
  };
  const a = collect(before);
  const b = collect(after);
  return {
    introduced: [...b].filter(([k]) => !a.has(k)).map(([, v]) => v),
    resolved: [...a].filter(([k]) => !b.has(k)).map(([, v]) => v),
    persisting: [...b].filter(([k]) => a.has(k)).length,
  };
}

export function triangulate(
  beforeTrace: string | null | undefined,
  afterTrace: string | null | undefined,
  ctx: TriangulationContext = {},
): Triangulation {
  const before = analyzeGraderTrace(beforeTrace).tasks;
  const after = analyzeGraderTrace(afterTrace).tasks;
  const find = (
    list: TaskAnalysis[],
    t: TaskAnalysis,
  ): TaskAnalysis | undefined => {
    const same = list.filter(x => taskKey(x.name) === taskKey(t.name));
    return same.length === 1 ? same[0] : list.find(x => x.name === t.name);
  };
  const names = [...new Map([...after, ...before]
    .map(t => [taskKey(t.name), t.name])).values()];
  const hasHistory = !!ctx.changedFiles;
  const tasks: TaskTriangulation[] = names.map(name => {
    const probe = { name } as TaskAnalysis;
    const b = find(before, probe);
    const a = find(after, probe);
    const t = transition(b, a);
    const suspects = t === 'fixed' || t === 'unchanged' || t === 'gone'
      ? []
      : suspectsFor(a, ctx);
    const rb = rank(b);
    const ra = rank(a);
    return {
      task: a?.name ?? b?.name ?? name,
      transition: t,
      before: b?.cause ?? null,
      after: a?.cause ?? null,
      direction: b && a
        ? ra > rb
          ? 'forward'
          : ra < rb
            ? 'backward'
            : 'same'
        : 'same',
      suspects,
      confidence: confidenceOf(suspects, hasHistory),
      mismatch: mismatchOf(a),
      previousMismatch: mismatchOf(b),
      commands: a?.commands ?? b?.commands ?? [],
    };
  });
  const order: Record<Transition, number> = {
    regressed: 0,
    progress: 1,
    fixed: 2,
    different: 3,
    stillFailing: 4,
    new: 5,
    gone: 6,
    unchanged: 7,
  };
  tasks.sort((x, y) => order[x.transition] - order[y.transition]);

  const bySignature = new Map<string, SharedCause>();
  for (const t of tasks) {
    if (!t.after || t.transition === 'fixed') continue;
    const s = bySignature.get(t.after.signature) ?? {
      signature: t.after.signature,
      kind: t.after.kind,
      params: t.after.params,
      tasks: [],
    };
    s.tasks.push(t.task);
    bySignature.set(t.after.signature, s);
  }
  const pointed = new Set(tasks.flatMap(t => t.suspects.map(s => s.file)));
  const counts = { fixed: 0, regressed: 0, progress: 0, stillFailing: 0 };
  for (const t of tasks) {
    if (t.transition in counts) {
      counts[t.transition as keyof typeof counts]++;
    }
  }

  return {
    tasks,
    shared: [...bySignature.values()].filter(s => s.tasks.length > 1),
    style: styleDelta(before, after),
    changedFiles: ctx.changedFiles ? [...ctx.changedFiles] : null,
    otherChanges: (ctx.changedFiles ?? [])
      .filter(f => isSource(f) && !pointed.has(f)),
    counts,
  };
}
