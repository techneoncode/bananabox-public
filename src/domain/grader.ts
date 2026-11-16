import type {
  GraderRun,
  GraderVM,
  Quota,
  SkillBreakdown,
  StyleCounts,
  TestResultDetail,
  TestResultSummary,
  TestTask,
  TraceStep,
} from '../shared/types';

type Json = Record<string, any>;

const num = (v: unknown, d = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/**
 * The Grader owns commit selection; never infer it from a GitHub branch or past
 * result.
 */
export function normalizeDelivery(
  raw: Json | null | undefined,
): NonNullable<GraderVM['remoteCommit']> {
  const sha = str(raw?.commit);
  const ready = sha !== null
    && /^[a-f0-9]{40}$/i.test(sha)
    && !/^0+$/.test(sha);
  const url = str(raw?.commitUrl);

  return {
    status: ready ? 'ready' : 'unavailable',
    sha: ready ? sha : null,
    branch: ready ? str(raw?.branch) : null,
    commitUrl: ready
      && url
      && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[a-f0-9]{40}$/i.test(url)
      && url.endsWith(`/commit/${sha}`)
      ? url
      : null,
    pushedAt: ready ? str(raw?.pushedAt) : null,
    checkedAt: Date.now(),
    error: null,
  };
}

export function normalizeQuota(raw: Json | undefined | null): Quota | null {
  if (!raw) {
    return null;
  }
  const total = num(raw.total);
  const consumed = num(raw.consumed);
  return {
    total,
    consumed,
    remaining: num(raw.remaining, Math.max(0, total - consumed)),
    override: typeof raw.override === 'number'
      && Number.isFinite(raw.override)
      ? raw.override
      : null,
  };
}

export function normalizeRun(raw: Json): GraderRun {
  return {
    id: num(raw.id),
    state: String(raw.state ?? 'unknown'),
    resultId: raw.testRunId !== null && raw.testRunId !== undefined
      ? String(raw.testRunId)
      : null,
    requestedAt: str(raw.requestedAt),
    startedAt: str(raw.startedAt),
    finishedAt: str(raw.finishedAt),
  };
}

export const isActiveState = (state: string): boolean =>
  state === 'submitted'
  || state === 'started'
  || state === 'queued'
  || state === 'pending';

/**
 * Skills come either as `skillBreakdowns` (map, list endpoint) or `skills`
 * (array of wrappers, detail endpoint).
 */
export function extractSkills(raw: Json): SkillBreakdown[] {
  const out: SkillBreakdown[] = [];
  const push = (name: string, b: Json) =>
    out.push({
      name,
      count: num(b?.count),
      passed: num(b?.passed),
      crashed: num(b?.crashed),
      mandatoryFailed: num(b?.mandatoryFailed),
    });
  if (raw.skillBreakdowns && typeof raw.skillBreakdowns === 'object') {
    for (const [name, b] of Object.entries(raw.skillBreakdowns as Json)) {
      push(name, b as Json);
    }
  }
  if (Array.isArray(raw.skills)) {
    for (const entry of raw.skills as Json[]) {
      const report = entry?.BreakdownSkillReport
        ?? entry?.FullSkillReport
        ?? entry;
      if (report?.name && report.breakdown) {
        push(String(report.name), report.breakdown);
      } else if (report?.name && Array.isArray(report.tests)) {
        push(String(report.name), {
          count: report.tests.length,
          passed: report.tests.filter((t: Json) => t?.passed === true).length,
          crashed: report.tests
            .filter((t: Json) => t?.crashed === true)
            .length,
          mandatoryFailed: report.tests
            .filter((t: Json) => t?.mandatory === true && t.passed !== true)
            .length,
        });
      }
    }
  }
  return [...new Map(out.map(skill => [skill.name, skill])).values()];
}

function style(raw: Json): StyleCounts {
  const v = raw.codingStyle?.value ?? {};
  return {
    fatal: num(v.fatal),
    major: num(v.major),
    minor: num(v.minor),
    info: num(v.info),
  };
}

export function normalizeSummary(
  raw: Json,
  fallbackId?: number,
): TestResultSummary {
  const skills = extractSkills(raw);
  const total = skills.reduce((n, s) => n + s.count, 0);
  const passed = skills.reduce((n, s) => n + s.passed, 0);

  return {
    id: num(raw.id, fallbackId ?? 0),
    date: String(raw.properties?.date ?? ''),
    commit: str(raw.properties?.commit),
    score: total > 0 ? Math.round((passed / total) * 1000) / 10 : null,
    passed,
    total,
    flags: Array.isArray(raw.failureFlags) ? raw.failureFlags.map(String) : [],
    style: style(raw),
    prerequisitesMark: typeof raw.prerequisitesMark === 'number'
      && Number.isFinite(raw.prerequisitesMark)
      ? raw.prerequisitesMark
      : null,
    skills,
  };
}

const HEADER = /^={5,}\s*\n[ \t]*(.+?)[ \t]*\n={5,}[ \t]*$/gm;

export interface TraceSection {
  name: string;
  body: string;
}

/** Splits a pool trace into one section per task (`==== task01 ====`). */
export function splitTrace(trace: string): TraceSection[] {
  const matches = [...trace.matchAll(HEADER)];
  return matches.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length
      ? (matches[i + 1].index ?? trace.length)
      : trace.length;
    return { name: m[1].trim(), body: trace.slice(start, end).trim() };
  });
}

/** Groups `# Building…` / `# OK` style lines into labelled steps. */
export function parseSteps(body: string): TraceStep[] {
  const steps: TraceStep[] = [];
  let current: TraceStep | null = null;
  for (const line of body.split('\n')) {
    const header =
      /^#\s+((?:Building|Checking|Executing|Running|Compiling|Testing)[^\n]*?)\.{0,3}\s*$/i.exec(line);
    if (header) {
      current = { label: header[1].replace(/:$/, ''), ok: null, lines: [] };
      steps.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(line);
    if (/^#\s*OK\b/i.test(line)) {
      current.ok = current.ok !== false;
    } else if (/^#\s*(KO|FAIL|FAILED|CRASH|TIMEOUT|ERROR)\b/i.test(line)) {
      current.ok = false;
    }
  }
  return steps.map((s) => ({
    ...s,
    lines: s.lines.filter((l, i, a) => l.trim() !== ''
      || (i > 0 && a[i - 1].trim() !== '')),
  }));
}

function verdict(body: string): 'passed' | 'failed' | 'unknown' {
  const m = [...body.matchAll(/^.+?:\s+([A-Z_]+)[ \t]*$/gm)].pop();
  if (m) {
    return m[1] === 'SUCCESS' || m[1] === 'PASSED' || m[1] === 'OK'
      ? 'passed'
      : 'failed';
  }
  return /^#\s*(KO|FAIL|CRASH|TIMEOUT|ERROR)/im.test(body)
    ? 'failed'
    : 'unknown';
}

export function buildTasks(
  skills: SkillBreakdown[],
  sections: TraceSection[],
): TestTask[] {
  const bySection = new Map(sections.map((s) => [s.name.toLowerCase(), s]));
  const used = new Set<string>();
  const unnumbered = (name: string) => name.toLowerCase()
    .replace(/^\d+\s*[-.:]\s*/, '')
    .trim();
  const tasks: TestTask[] = skills.map((skill) => {
    const name = unnumbered(skill.name);
    const exact = [...bySection.keys()].find(k => unnumbered(k) === name);
    const candidates = [...bySection.keys()].filter(k => {
      const section = unnumbered(k);
      return section.startsWith(`${name} - `)
        || name.startsWith(`${section} - `);
    });
    const key = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    const section = key ? bySection.get(key) : undefined;
    if (key) {
      used.add(key);
    }
    const fromCounts = skill.count > 0
      ? (skill.passed >= skill.count ? 'passed' : 'failed')
      : 'unknown';
    return {
      name: skill.name,
      status: section
        ? verdict(section.body) === 'unknown'
          ? fromCounts
          : verdict(section.body)
        : fromCounts,
      count: skill.count,
      passed: skill.passed,
      crashed: skill.crashed,
      mandatoryFailed: skill.mandatoryFailed,
      steps: section ? parseSteps(section.body) : [],
      trace: section?.body ?? '',
    };
  });
  for (const section of sections) {
    if (!used.has(section.name.toLowerCase())) {
      tasks.push({
        name: section.name,
        status: verdict(section.body),
        count: 0,
        passed: 0,
        crashed: 0,
        mandatoryFailed: 0,
        steps: parseSteps(section.body),
        trace: section.body,
      });
    }
  }
  return tasks;
}

function pair(covered: unknown, total: unknown): [number, number] | null {
  return typeof covered === 'number' && typeof total === 'number' && total > 0
    ? [covered, total]
    : null;
}

export function normalizeDetail(
  raw: Json,
  fallbackId?: number,
): TestResultDetail {
  const summary = normalizeSummary(raw, fallbackId);
  const trace = str(raw.poolTrace);
  const cov: Json = raw.coverage?.Default
    ?? Object.values(raw.coverage ?? {})[0]
    ?? {};

  return {
    ...summary,
    tasks: buildTasks(summary.skills, trace ? splitTrace(trace) : []),
    rawTrace: trace,
    staticTrace: str(raw.staticTrace),
    coverage: {
      lines: pair(cov.coveredLines, cov.totalLines),
      branches: pair(cov.coveredBranches, cov.totalBranches),
      log: str(cov.log),
    },
    makeError: str(raw.makeError),
    deliveryError: str(raw.deliveryError),
    bannedFunctions: Array.isArray(raw.bannedFunctions)
      ? raw.bannedFunctions.map(String)
      : null,
  };
}
