import type { TestResultDetail, TestTask, TraceStep } from '../shared/types';
import { parseSteps } from './grader';

export type DiagnosticKind =
  | 'build'
  | 'linker'
  | 'crash'
  | 'memory'
  | 'timeout'
  | 'assertion'
  | 'output'
  | 'style'
  | 'forbidden'
  | 'delivery'
  | 'test';

export interface LogDiagnostic {
  key: string;
  kind: DiagnosticKind;
  message: string;
  evidence: string;
  traceLine: number;
  file?: string;
  line?: number;
  column?: number;
  tasks?: string[];
  source?: 'report';
}

export interface NamedTest {
  name: string;
  status: 'passed' | 'failed' | 'crashed' | 'timeout';
  evidence: string;
}

export interface TraceInsights {
  diagnostics: LogDiagnostic[];
  tests: NamedTest[];
  steps: TraceStep[];
  truncated: boolean;
}

export interface InsightDelta {
  before: TraceInsights;
  after: TraceInsights;
  introduced: LogDiagnostic[];
  persisting: LogDiagnostic[];
  noLongerObserved: LogDiagnostic[];
  tests: Array<{
    name: string;
    before: NamedTest['status'];
    after: NamedTest['status'];
  }>;
}

const MAX_CHARS = 1_000_000;
const MAX_LINES = 20_000;
const MAX_DIAGNOSTICS = 100;
const clean = (s: string) => s
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/\r/g, '');
const signature = (s: string) => s.toLowerCase()
  .replace(/0x[\da-f]+/g, '<address>')
  .replace(/\bpid[ =:]\d+/g, 'pid=<id>')
  .replace(/(\.(?:c|h|cpp|cc|hpp|py|js|ts)):\d+(?::\d+)?/g, '$1:<line>')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Extract explicit test identities only. Summary counts and bare # OK / # KO
 * are not test IDs.
 */
function namedTest(line: string): NamedTest | null {
  let name = '', status = '';
  let m = /^\s*(?:#\s*)?\[\s*(FAIL(?:ED)?|PASS(?:ED)?|OK|KO|CRASH(?:ED)?|TIMEOUT)\s*\]\s+(.+?)\s*$/i.exec(line);
  if (m) {
    status = m[1];
    name = m[2];
  } else if ((m = /^\s*(FAILED|PASSED)\s+(\S+::\S+)(?:\s+-.*)?$/i.exec(line))) {
    status = m[1];
    name = m[2];
  } else if ((m = /^\s*(\S+::\S+)\s+(PASSED|FAILED|ERROR)(?:\s+\[.*\])?\s*$/i.exec(line))) {
    name = m[1];
    status = m[2];
  } else if ((m = /^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/i.exec(line))) {
    if (/\s+#\s*(?:SKIP|TODO)\b/i.test(m[2])) return null;
    status = m[1] === 'ok' ? 'passed' : 'failed';
    name = m[2];
  } else {
    return null;
  }
  name = name
    .replace(/:\s*\([\d.]+s?\)\s*$/, '')
    .replace(/\s+\([\d.]+s\)\s*$/, '')
    .trim();
  if (!name || name.length > 240
    || /^(?:\d+\s+)?(?:tests?|assertions?|passing|failing)(?:\s|$)/i.test(name)
    || /^(?:all tests|compilation|building|make\b)/i.test(name)) {
    return null;
  }
  return {
    name,
    status: /^(?:PASS|OK)/i.test(status) ? 'passed'
      : /^CRASH/i.test(status) ? 'crashed'
        : /^TIMEOUT/i.test(status) ? 'timeout'
          : 'failed',
    evidence: line.trim().slice(0, 500),
  };
}

function diagnosticKind(line: string): DiagnosticKind | null {
  line = line.replace(/^\s*\[(?:[-=]+|INFO|DEBUG)\]\s*/i, '');
  if (/^\s*(?:expected|actual|got|stdout|stderr)\s*[:=]/i.test(line)) return null;
  if (/^\s*(?:#\s*(?:Building|Checking|Executing|Running|Compiling|Testing)\b|\[\s*(?:RUN|INFO|DEBUG)\s*\])/i.test(line)) return null;
  if (/^\s*\+/.test(line)) return null;
  if (/^\s*\d+\s*\|/.test(line)) return null;
  if (/(?:(?:AddressSanitizer|LeakSanitizer|UndefinedBehaviorSanitizer):|heap-buffer-overflow|stack-buffer-overflow|use-after-free|double.free|Invalid (?:read|write)|(?:malloc|munmap|free)\(\): (?:invalid|corrupt)|definitely lost: [1-9]|runtime error:)/i.test(line)) return 'memory';
  if (/(?:segmentation fault|segfault|SIGSEGV|SIGABRT|SIGBUS|core dumped|stack smashing detected|floating point exception|signal (?:6|8|11)\b|(?:program|process|test)\s+(?:has\s+)?crashed)/i.test(line)) return 'crash';
  if (/(?:\btimed out\b|\btimeout\b|\btime limit exceeded\b|\bexecution time exceeded\b)/i.test(line)) return 'timeout';
  if (/(?:undefined reference to|multiple definition of|ld:.*(?:error|cannot find)|linker command failed)/i.test(line)) return 'linker';
  if (/(?:\b(?:fatal )?error:|\bfatal error\b|make(?:\[\d+\])?:\s*\*\*\*|compilation (?:failed|failure)|build (?:failed|failure))/i.test(line)) return 'build';
  if (/(?:\bAssertionError\b|assertion .*failed|assertion failed|\bassert\([^\n]+\).*failed|\b(?:cr_assert|assert_equal)\b.*(?:fail|error))/i.test(line)) return 'assertion';
  if (/(?:coding.?style.*(?:error|fail|fatal|major)|\b(?:fatal|major)\s*:\s*.*(?:style|C-[A-Z])|\bC-(?:F|H|L|O|V|G|A)-\d+\b)/i.test(line)) return 'style';
  if (/(?:forbidden|banned|unauthori[sz]ed|not allowed) (?:function|call)|(?:function|call).*(?:is forbidden|is banned|not allowed)/i.test(line)) return 'forbidden';
  if (/(?:output (?:mismatch|differs)|wrong (?:output|answer)|expected .+ (?:but got|got|received)|(?:stdout|stderr).*(?:mismatch|differs))/i.test(line)) return 'output';
  if (/^\s*(?:#\s*)?(?:\[\s*(?:FAIL(?:ED)?|KO|CRASH(?:ED)?)\s*\]|not ok\s+\d+\s+-|FAILED\s+\S+::|#?\s*(?:KO|FAIL(?:ED)?)\b)/i.test(line)) return 'test';
  return null;
}

function location(
  text: string,
): Pick<LogDiagnostic, 'file' | 'line' | 'column'> {
  const m =
    /(?:^|\s|\()((?:\/|[A-Za-z]:[\\/])?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.(?:c|h|cpp|cc|hpp|py|js|ts)):(\d+)(?::(\d+))?/.exec(text);
  return m ? { file: m[1], line: Number(m[2]), column: Number(m[3] ?? 1) } : {};
}

/**
 * Bounded, deterministic analysis of local log text: no service, token, or
 * command execution.
 */
export function analyzeTrace(
  trace: string,
  steps?: TraceStep[],
): TraceInsights {
  const cleaned = clean(trace.slice(0, MAX_CHARS));
  const allLines = cleaned.split('\n');
  const lines = allLines.slice(0, MAX_LINES);
  const diagnostics = new Map<string, LogDiagnostic>();
  const tests = new Map<string, NamedTest>();
  let capped = false;
  lines.forEach((line, index) => {
    const test = namedTest(line);
    if (test) {
      const previous = tests.get(test.name);
      if (tests.size < 500 || previous) {
        tests.set(test.name, previous && previous.status !== 'passed'
          && test.status === 'passed'
          ? previous
          : test);
      } else {
        capped = true;
      }
    }
    let kind = test?.status === 'passed' ? null : diagnosticKind(line);
    if (test?.status === 'crashed') kind = 'crash';
    if (test?.status === 'timeout') kind = 'timeout';
    if (!kind) return;
    const message = line.trim().slice(0, 500);
    const loc = location(line);
    const key = `${kind}:${signature(message)}`;
    if (diagnostics.has(key)) return;
    if (diagnostics.size >= MAX_DIAGNOSTICS) {
      capped = true;
      return;
    }
    const context = lines
      .slice(Math.max(0, index - 1), Math.min(lines.length, index + 5))
      .join('\n')
      .slice(0, 1500);
    diagnostics.set(key, {
      key,
      kind,
      message,
      evidence: context,
      traceLine: index + 1,
      ...loc,
    });
  });
  return {
    diagnostics: [...diagnostics.values()],
    tests: [...tests.values()],
    steps: steps ?? parseSteps(cleaned),
    truncated: trace.length > MAX_CHARS
      || allLines.length > MAX_LINES
      || capped,
  };
}

export function compareInsights(
  before: TraceInsights,
  after: TraceInsights,
): InsightDelta {
  const left = new Set(before.diagnostics.map(d => d.key));
  const right = new Set(after.diagnostics.map(d => d.key));
  const previousTests = new Map(before.tests.map(t => [t.name, t]));
  return {
    before,
    after,
    introduced: after.diagnostics.filter(d => !left.has(d.key)),
    persisting: after.diagnostics.filter(d => left.has(d.key)),
    noLongerObserved: before.diagnostics.filter(d => !right.has(d.key)),
    tests: after.tests.flatMap(t => {
      const old = previousTests.get(t.name);
      return old && old.status !== t.status
        ? [{ name: t.name, before: old.status, after: t.status }]
        : [];
    }),
  };
}

const taskCache = new WeakMap<TestTask, TraceInsights>();
const reportCache = new WeakMap<TestResultDetail, TraceInsights>();
export function taskInsights(task: TestTask | null): TraceInsights {
  if (!task) return analyzeTrace('');
  let analysis = taskCache.get(task);
  if (!analysis) {
    analysis = analyzeTrace(
      task.trace,
      task.steps.length ? task.steps : undefined,
    );
    taskCache.set(task, analysis);
  }
  return analysis;
}

/**
 * Report-level failures matter even when the grader could not produce task/test
 * counts.
 */
export function reportInsights(result: TestResultDetail): TraceInsights {
  const cached = reportCache.get(result);
  if (cached) return cached;
  const sections: Array<[DiagnosticKind, string | null]> = [
    ['build', result.makeError],
    ['delivery', result.deliveryError],
    [
      'forbidden',
      result.bannedFunctions?.length
        ? result.bannedFunctions.join(', ')
        : null,
    ],
  ];
  const text = [result.staticTrace ?? '', result.rawTrace ?? '']
    .filter(Boolean)
    .join('\n');
  const insight = analyzeTrace(text);
  const diagnostics = new Map(insight.diagnostics.map(d => [d.key, d]));
  const named: NamedTest[] = [];
  const taskSteps: TraceStep[] = [];
  for (const task of result.tasks) {
    const local = taskInsights(task);
    insight.truncated ||= local.truncated;
    for (const d of local.diagnostics) {
      const existing = diagnostics.get(d.key);
      if (existing) {
        existing.tasks = [...new Set([...(existing.tasks ?? []), task.name])];
      } else if (diagnostics.size < MAX_DIAGNOSTICS) {
        diagnostics.set(d.key, { ...d, tasks: [task.name] });
      } else {
        insight.truncated = true;
      }
    }
    named.push(...local.tests.map(test => ({
      ...test,
      name: `${task.name} / ${test.name}`,
    })));
    taskSteps.push(...local.steps.map(step => ({
      ...step,
      label: `${task.name} · ${step.label}`,
    })));
  }
  insight.diagnostics = [...diagnostics.values()];
  if (named.length) insight.tests = named.slice(0, 500);
  if (taskSteps.length) insight.steps = taskSteps;
  insight.truncated ||= named.length > 500;
  for (const [kind, text] of sections) {
    if (!text) continue;
    const message = clean(text).slice(0, 500);
    const key = `${kind}:${signature(message)}`;
    if (!insight.diagnostics.some(d => d.key === key)) {
      insight.diagnostics.unshift({
        kind,
        key,
        message,
        evidence: clean(text).slice(0, 1500),
        traceLine: 1,
        source: 'report',
        ...location(text),
      });
    }
  }
  if (result.style.fatal || result.style.major) {
    const message = `Coding style: fatal=${result.style.fatal}, major=${result.style.major}`;
    insight.diagnostics.unshift({
      kind: 'style',
      key: `style:${message}`,
      message,
      evidence: message,
      traceLine: 1,
      source: 'report',
    });
  }
  reportCache.set(result, insight);

  return insight;
}
