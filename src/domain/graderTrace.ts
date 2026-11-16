const joinPath = (cwd: string, file: string): string => {
  const parts: string[] = [];
  for (const part of `${cwd}/${file}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/') || '.';
};

export type Phase = 'delivery' | 'build' | 'forbidden' | 'run';
export type FailureKind =
  | 'invalid_output'
  | 'invalid_exit_status'
  | 'coverage'
  | 'crash'
  | 'timeout'
  | 'assertion'
  | 'task_missing'
  | 'other';

export interface GraderCommand {
  /** Directory relative to the repository (`.` for the root). */
  cwd: string;
  text: string;
  /**
   * Sequential argv chain split on `&&`/`;`, or null when it uses shell syntax
   * we never execute (pipes, redirects…).
   */
  chain: string[][] | null;
  /** 1-based trace line. */
  line: number;
}

export interface CodeIssue {
  /** Repository-relative path (`/usr/local/bugs/run/` stripped). */
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
  origin: 'compiler' | 'banana';
  /** Epitech rule, e.g. C-L3. */
  rule?: string;
  bucket?: 'fatal' | 'major' | 'minor' | 'info';
  /**
   * True for files the grader ships itself (test_files/…): they are not in
   * the student's repository.
   */
  external: boolean;
  traceLine: number;
}

export interface LinkerIssue {
  kind: 'undefined' | 'multiple';
  symbol: string;
  files: string[];
  traceLine: number;
}

export interface TestFailure {
  kind: FailureKind;
  message: string;
  got?: string;
  expected?: string;
  exitCode?: number;
  /** `file:line` of a failed criterion assertion, when printed. */
  file?: string;
  line?: number;
  traceLine: number;
}

export interface Cause {
  phase: Phase;
  /**
   * Stable machine id used for translation and for matching causes across runs.
   */
  kind: string;
  params: Record<string, string | number>;
  /** Key that is equal when two runs fail for "the same reason". */
  signature: string;
  file?: string;
  line?: number;
  traceLine: number;
}

export interface TaskAnalysis {
  name: string;
  status: 'success' | 'failure' | 'unknown';
  /** 1-based trace line of the section banner. */
  line: number;
  commands: GraderCommand[];
  build: {
    ok: boolean | null;
    errors: CodeIssue[];
    warnings: CodeIssue[];
    style: CodeIssue[];
    linker: LinkerIssue[];
  };
  forbidden: { allowed: string[]; ok: boolean | null; violations: string[] };
  run: {
    ok: boolean | null;
    failures: TestFailure[];
    criterion: {
      tested: number;
      passing: number;
      failing: number;
      crashing: number;
    } | null;
  };
  cause: Cause | null;
}

export interface TraceAnalysis {
  tasks: TaskAnalysis[];
  truncated: boolean;
}

const MAX_CHARS = 2_000_000;
const MAX_ISSUES_PER_TASK = 400;
const ROOT = '/usr/local/bugs/run/';

const SOURCE = /\.(?:c|h|cc|cpp|hpp)$/i;

const stripAnsi = (s: string): string => s
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/\r\n?/g, '\n');

/**
 * Grader paths are absolute inside its sandbox; map them to repository-relative
 * ones.
 */
export function repoRelative(file: string): string {
  let f = file.replace(/\\/g, '/');
  if (f.startsWith(ROOT)) f = f.slice(ROOT.length);
  f = f.replace(/^\.\//, '');
  return f;
}

const isExternal = (rel: string): boolean =>
  /^(?:test_files|\.\.)(?:\/|$)/.test(rel);

/**
 * Splits an Epitech banner-delimited trace into named sections (a banner-less
 * trace is one unnamed section).
 */
function sections(text: string): Array<{
  name: string;
  line: number;
  body: string[];
  bodyStart: number;
}> {
  const lines = text.split('\n');
  const out: Array<{
    name: string;
    line: number;
    body: string[];
    bodyStart: number;
  }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^={10,}\s*$/.test(lines[i]!)
      && lines[i + 2] !== undefined
      && /^={10,}\s*$/.test(lines[i + 2]!)
      && lines[i + 1]!.trim()) {
      if (out.length) {
        out[out.length - 1]!.body = lines.slice(
          out[out.length - 1]!.bodyStart,
          i,
        );
      }
      out.push({
        name: lines[i + 1]!.trim(),
        line: i + 2,
        body: [],
        bodyStart: i + 3,
      });
      i += 2;
    }
  }
  if (out.length) {
    out[out.length - 1]!.body = lines.slice(out[out.length - 1]!.bodyStart);
  } else {
    out.push({ name: '', line: 1, body: lines, bodyStart: 0 });
  }
  return out;
}

const COMPILER =
  /^(\/?[^\s:][^:\n]*?\.(?:c|h|cc|cpp|hpp)):(\d+):(\d+):\s*(warning|error|fatal error|note):\s*(.*)$/;
const BANANA =
  /^\[Banana\]\s*\[(Fatal|Major|Minor|Info)\]\s*(.*?)(?:\s*\((C-[A-Z]\d+)\))?\s*$/i;

/**
 * Splits `a && b; c` into argv arrays; returns null for pipes, redirections,
 * substitutions or globs-with-risk.
 */
export function splitChain(command: string): string[][] | null {
  if (command.includes('\0')) return null;
  const parts: string[] = [];
  let start = 0, quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/[|<>`]/.test(char)
      || char === '$'
      || (char === '&' && command[i + 1] !== '&')) {
      return null;
    }
    if (char === ';' || char === '&') {
      const part = command.slice(start, i);
      if (!part.trim()) return null;
      parts.push(part);
      if (char === '&') i++;
      start = i + 1;
    }
  }
  if (quote || !command.slice(start).trim()) return null;
  parts.push(command.slice(start));
  const chain: string[][] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const argv = tokenize(part);
    if (!argv) return null;
    chain.push(argv);
  }
  return chain.length ? chain : null;
}

function tokenize(s: string): string[] | null {
  const out: string[] = [];
  let cur = '', quote: string | null = null, has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '&') {
      return null;
    } else {
      cur += c;
    }
  }
  if (quote) return null;
  if (cur || has) out.push(cur);
  return out.length ? out : null;
}

function parseSection(sec: {
  name: string;
  line: number;
  body: string[];
  bodyStart: number;
}): TaskAnalysis {
  const task: TaskAnalysis = {
    name: sec.name,
    status: 'unknown',
    line: sec.line,
    commands: [],
    build: { ok: null, errors: [], warnings: [], style: [], linker: [] },
    forbidden: { allowed: [], ok: null, violations: [] },
    run: { ok: null, failures: [], criterion: null },
    cause: null,
  };
  let phase: Phase | 'none' = 'none';
  let buildFailed = false, missing = false, issues = 0, cwd = '.';
  const abs = (i: number): number => sec.bodyStart + i + 1;
  const body = sec.body;

  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    const trimmed = line.trim();

    if (/^#\s*Building\b/i.test(trimmed)) {
      phase = 'build';
      continue;
    }
    if (/^#\s*Checking for forbidden functions/i.test(trimmed)) {
      phase = 'forbidden';
      continue;
    }
    if (/^#\s*Executing all tests/i.test(trimmed)) {
      phase = 'run';
      continue;
    }
    if (/^#\s*Task directory not found/i.test(trimmed)) {
      missing = true;
      continue;
    }
    const allowed =
      /^#\s*(?:Allowed|Authorized|Authorised)\s+functions:\s*(.*)$/i.exec(trimmed);
    if (allowed) {
      task.forbidden.allowed = allowed[1]!.split(/[,\s]+/).filter(Boolean);
      continue;
    }
    const final = /^(.*?):\s+(SUCCESS|FAILURE)\s*$/.exec(trimmed);
    if (final
      && trimmed === `${final[1]}: ${final[2]}`
      && (!sec.name || final[1]!.trim() === sec.name)) {
      task.status = final[2] === 'SUCCESS' ? 'success' : 'failure';
      continue;
    }

    if (/^#\s*OK\b/.test(trimmed)) {
      if (phase === 'build') task.build.ok = true;
      else if (phase === 'forbidden') task.forbidden.ok = true;
      else if (phase === 'run') task.run.ok = true;
      continue;
    }
    if (/^#\s*Build failed/i.test(trimmed)) {
      buildFailed = true;
      task.build.ok = false;
      continue;
    }
    const ko = /^#\s*KO\b:?\s*(.*)$/.exec(trimmed);
    if (ko && phase === 'forbidden') {
      task.forbidden.ok = false;
      if (ko[1]) task.forbidden.violations.push(ko[1]);
      continue;
    }
    if (ko && phase === 'build') {
      task.build.ok = false;
      continue;
    }

    const forbidden =
      /^#\s*(?:Forbidden|Unauthori[sz]ed|Banned)\s+(?:function|call)s?:?\s*(.+)$/i.exec(trimmed);
    if (forbidden) {
      task.forbidden.ok = false;
      task.forbidden.violations.push(
        ...forbidden[1]!.split(/[,\s]+/).filter(Boolean),
      );
      continue;
    }

    const prompt = /^(~(?:\/[^>\n]*)?)>\s+(.+)$/.exec(line);
    if (prompt) {
      const text = prompt[2]!.trim();
      cwd = prompt[1]!.replace(/^~\/?/, '').replace(/\/+$/, '') || '.';
      task.commands.push({ cwd, text, chain: splitChain(text), line: abs(i) });
      continue;
    }

    if (trimmed === '# Got:') {
      const got: string[] = [];
      let j = i + 1;
      while (j < body.length
        && body[j]!.trim() !== '# But expected:'
        && !/^# Test failed/.test(body[j]!.trim())
        && !/^.*: (?:SUCCESS|FAILURE)$/.test(body[j]!.trim())) {
        got.push(body[j++]!);
      }
      const expected: string[] = [];
      if (body[j]?.trim() === '# But expected:') {
        j++;
        while (j < body.length
          && !/^# Test failed/.test(body[j]!.trim())
          && !/^.*: (?:SUCCESS|FAILURE)$/.test(body[j]!.trim())) {
          expected.push(body[j++]!);
        }
      }
      const gotText = got.join('\n');
      const expectedText = expected.join('\n');
      const coverage = /^KO:\s*(.*coverage.*)$/im.exec(gotText);
      task.run.ok = false;
      task.run.failures.push(coverage
        ? {
          kind: 'coverage',
          message: coverage[1]!.trim(),
          got: gotText,
          expected: expectedText,
          traceLine: abs(i),
        }
        : {
          kind: 'invalid_output',
          message: 'invalid output',
          got: gotText,
          expected: expectedText,
          traceLine: abs(i),
        });
      i = j - 1;
      continue;
    }
    const failed = /^#\s*Test failed:\s*(.*)$/i.exec(trimmed);
    if (failed) {
      const msg = failed[1]!.trim();
      const code = /invalid exit status\.?\s*(?:Got\s+)?(-?\d+)?/i.exec(msg);
      const last = task.run.failures.at(-1);
      if (/invalid output/i.test(msg)
        && last
        && last.kind !== 'invalid_exit_status'
        && last.traceLine <= abs(i)) {
        continue;
      }
      task.run.ok = false;
      if (code) {
        task.run.failures.push({
          kind: 'invalid_exit_status',
          message: msg,
          exitCode: code[1] === undefined ? undefined : Number(code[1]),
          traceLine: abs(i),
        });
      } else if (/time ?out|timed out/i.test(msg)) {
        task.run.failures.push({
          kind: 'timeout',
          message: msg,
          traceLine: abs(i),
        });
      } else if (/crash|segfault|signal/i.test(msg)) {
        task.run.failures.push({
          kind: 'crash',
          message: msg,
          traceLine: abs(i),
        });
      } else {
        task.run.failures.push({
          kind: 'other',
          message: msg,
          traceLine: abs(i),
        });
      }
      continue;
    }

    const synth =
      /^\[====\]\s*Synthesis:\s*Tested:\s*(\d+)\s*\|\s*Passing:\s*(\d+)\s*\|\s*Failing:\s*(\d+)\s*\|\s*Crashing:\s*(\d+)/.exec(trimmed);
    if (synth) {
      task.run.criterion = {
        tested: +synth[1]!,
        passing: +synth[2]!,
        failing: +synth[3]!,
        crashing: +synth[4]!,
      };
      continue;
    }
    const assertion =
      /^\[----\]\s*(\S+?\.(?:c|h|cc|cpp)):(\d+):\s*(.*)$/.exec(trimmed);
    if (assertion) {
      task.run.failures.push({
        kind: /assert/i.test(assertion[3]!) ? 'assertion' : 'other',
        message: assertion[3]!.trim(),
        file: repoRelative(assertion[1]!),
        line: +assertion[2]!,
        traceLine: abs(i),
      });
      continue;
    }
    if (/\b(?:segmentation fault|SIGSEGV|core dumped)\b/i.test(trimmed)
      && phase !== 'build') {
      task.run.failures.push({
        kind: 'crash',
        message: trimmed.slice(0, 200),
        traceLine: abs(i),
      });
      continue;
    }

    const cc = COMPILER.exec(line);
    if (cc) {
      if (issues >= MAX_ISSUES_PER_TASK) continue;
      issues++;
      const rel = repoRelative(cc[1]!);
      const banana = BANANA.exec(cc[5]!);
      const issue: CodeIssue = banana
        ? {
          file: rel,
          line: +cc[2]!,
          column: +cc[3]!,
          severity: 'warning',
          message: banana[2]!.trim(),
          origin: 'banana',
          rule: banana[3],
          bucket: banana[1]!.toLowerCase() as CodeIssue['bucket'],
          external: isExternal(rel),
          traceLine: abs(i),
        }
        : {
          file: rel,
          line: +cc[2]!,
          column: +cc[3]!,
          severity: cc[4] === 'warning'
            ? 'warning'
            : cc[4] === 'note'
              ? 'note'
              : 'error',
          message: cc[5]!.trim(),
          origin: 'compiler',
          external: isExternal(rel),
          traceLine: abs(i),
        };
      if (issue.origin === 'banana') task.build.style.push(issue);
      else if (issue.severity === 'error') task.build.errors.push(issue);
      else if (issue.severity === 'warning') task.build.warnings.push(issue);
      continue;
    }

    const undef =
      /(\S+?)(?::\(\.text[^)]*\))?:\s*(?:in function [^:]+:\s*)?undefined reference to [`'‘]([^'’`]+)['’]/.exec(trimmed);
    if (undef) {
      addLinker(
        task,
        'undefined',
        undef[2]!,
        [undef[1]!.replace(/:.*$/, '')],
        abs(i),
        cwd,
      );
      continue;
    }
    const multi = /(\S+?):\(\.[a-z]+[^)]*\):\s*multiple definition of [`'‘]([^'’`]+)['’];\s*(\S+?):\S*?(\S+?\.[a-z]+):?\(?\S*\)?:?\s*first defined here/.exec(trimmed)
      ?? /(\S+?):\(\.[a-z]+[^)]*\):\s*multiple definition of [`'‘]([^'’`]+)['’]/.exec(trimmed);
    if (multi) {
      const first = /;\s*(\S+?):(\S+?\.[a-z]+):/.exec(trimmed);
      addLinker(
        task,
        'multiple',
        multi[2]!,
        [multi[1]!.replace(/\.o$/, '.c'), ...(first ? [first[2]!] : [])],
        abs(i),
        cwd,
      );
      continue;
    }
    if (/\blinker command failed\b/i.test(trimmed)
      || /^make(?:\[\d+\])?:\s*\*\*\*/.test(trimmed)) {
      task.build.ok ??= false;
    }
  }

  task.build.errors = dedupe(task.build.errors);
  if (buildFailed || task.build.errors.length || task.build.linker.length) {
    task.build.ok = false;
  }
  task.cause = decideCause(task, buildFailed, missing);
  if (task.status === 'unknown' && task.cause) task.status = 'failure';
  return task;
}

/**
 * Linker messages print paths relative to the directory `make` ran in: anchor
 * them to the repository.
 */
function addLinker(
  task: TaskAnalysis,
  kind: LinkerIssue['kind'],
  symbol: string,
  files: string[],
  traceLine: number,
  cwd: string,
): void {
  const existing = task.build.linker
    .find(l => l.kind === kind && l.symbol === symbol);
  const rel = files.map(repoRelative)
    .filter(f => SOURCE.test(f) || /\.o$/.test(f))
    .map(f => (cwd === '.' || f.startsWith('/') ? f : joinPath(cwd, f)));
  if (existing) {
    existing.files = [...new Set([...existing.files, ...rel])];
  } else {
    task.build.linker.push({
      kind,
      symbol,
      files: [...new Set(rel)],
      traceLine,
    });
  }
}

function dedupe(issues: CodeIssue[]): CodeIssue[] {
  const seen = new Set<string>();
  return issues.filter(i => {
    const k = `${i.file}:${i.line}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Picks the single most upstream reason a task failed: the first thing that
 * went wrong in the pipeline.
 */
function decideCause(
  task: TaskAnalysis,
  buildFailed: boolean,
  missing: boolean,
): Cause | null {
  if (missing) {
    return {
      phase: 'delivery',
      kind: 'task_missing',
      params: { task: task.name },
      signature: 'delivery:task_missing',
      traceLine: task.line,
    };
  }
  const link = task.build.linker[0];
  if (link && (buildFailed || task.build.ok === false)) {
    return link.kind === 'multiple'
      ? {
        phase: 'build',
        kind: 'multiple_definition',
        params: { symbol: link.symbol, files: link.files.join(', ') },
        signature: `build:multiple:${link.symbol}`,
        file: link.files[0],
        traceLine: link.traceLine,
      }
      : {
        phase: 'build',
        kind: 'undefined_reference',
        params: { symbol: link.symbol, files: link.files.join(', ') },
        signature: `build:undefined:${link.symbol}`,
        file: link.files[0],
        traceLine: link.traceLine,
      };
  }
  const err = task.build.errors[0];
  if (err) {
    return {
      phase: 'build',
      kind: 'compile_error',
      params: { message: err.message, location: `${err.file}:${err.line}` },
      signature: `build:compile:${err.file}:${normalize(err.message)}`,
      file: err.file,
      line: err.line,
      traceLine: err.traceLine,
    };
  }
  if (buildFailed || task.build.ok === false) {
    return {
      phase: 'build',
      kind: 'build_failed',
      params: {},
      signature: 'build:failed',
      traceLine: task.line,
    };
  }
  if (task.forbidden.ok === false) {
    const fns = task.forbidden.violations.join(', ');
    return {
      phase: 'forbidden',
      kind: 'forbidden_function',
      params: { functions: fns },
      signature: `forbidden:${fns}`,
      traceLine: task.line,
    };
  }
  const f = task.run.failures[0];
  if (f) {
    const order: FailureKind[] = [
      'crash',
      'timeout',
      'invalid_exit_status',
      'assertion',
      'invalid_output',
      'coverage',
      'other',
    ];
    const top = [...task.run.failures]
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0]!;
    return {
      phase: 'run',
      kind: top.kind,
      params: {
        ...(top.exitCode !== undefined ? { code: top.exitCode } : {}),
        message: top.message,
      },
      signature: `run:${top.kind}${top.exitCode !== undefined ? `:${top.exitCode}` : ''}${top.file ? `:${top.file}` : ''}`,
      file: top.file,
      line: top.line,
      traceLine: top.traceLine,
    };
  }
  return null;
}

const normalize = (s: string): string => s.toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

export function analyzeGraderTrace(
  trace: string | null | undefined,
): TraceAnalysis {
  const text = stripAnsi((trace ?? '').slice(0, MAX_CHARS));
  const tasks = sections(text)
    .filter(s => s.name || s.body.some(l => l.trim()))
    .map(parseSection);
  return {
    tasks,
    truncated: (trace ?? '').length > MAX_CHARS
      || /\[TRUNCATED\]/.test(text),
  };
}

/**
 * Pipeline order used to tell progress ("now fails at test time instead of at
 * build time") from regression.
 */
export const PHASE_RANK: Record<Phase | 'pass', number> = {
  delivery: 0,
  build: 1,
  forbidden: 2,
  run: 3,
  pass: 4,
};
