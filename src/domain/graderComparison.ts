import type {
  TestResultDetail,
  TestResultSummary,
  TestTask,
} from '../shared/types';

export type ChangeKind =
  | 'fixed'
  | 'regressed'
  | 'stillFailing'
  | 'unchanged'
  | 'added'
  | 'removed'
  | 'changed';

export interface TaskChange {
  name: string;
  kind: ChangeKind;
  before: TestTask | null;
  after: TestTask | null;
}

const taskKey = (name: string) => name.trim()
  .replace(/^\d+\s*[-.:]\s*/, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

function tasks(
  result: TestResultDetail,
  summary?: TestResultSummary,
): TestTask[] {
  const out = result.tasks.map(t => ({ ...t }));
  for (const skill of [...(result.skills ?? []), ...(summary?.skills ?? [])]) {
    const matches = out.filter(t => taskKey(t.name) === taskKey(skill.name));
    if (matches.length > 1) continue;
    const existing = matches[0];
    if (existing?.count) continue;
    const counts = {
      count: skill.count,
      passed: skill.passed,
      crashed: skill.crashed,
      mandatoryFailed: skill.mandatoryFailed,
    };
    if (existing) {
      Object.assign(existing, counts);
    } else {
      out.push({
        name: skill.name,
        ...counts,
        status: 'unknown',
        steps: [],
        trace: '',
      });
    }
  }
  return out.map(task => ({ ...task, status: status(task) }));
}

function status(task: TestTask): TestTask['status'] {
  return task.count > 0
    ? task.passed >= task.count && !task.crashed && !task.mandatoryFailed
      ? 'passed'
      : 'failed'
    : task.status;
}

/**
 * Counts are task/skill aggregates when the grader does not expose individual
 * test IDs.
 */
export function compareResults(
  before: TestResultDetail,
  after: TestResultDetail,
  beforeSummary?: TestResultSummary,
  afterSummary?: TestResultSummary,
): TaskChange[] {
  const aTasks = tasks(before, beforeSummary);
  const bTasks = tasks(after, afterSummary);
  const all = [...aTasks, ...bTasks];
  const key = (task: TestTask) => {
    const norm = taskKey(task.name);
    const dup = [aTasks, bTasks].some(list =>
      list.filter(t => taskKey(t.name) === norm).length > 1);
    return dup ? task.name : norm;
  };
  const left = new Map(aTasks.map(t => [key(t), t]));
  const right = new Map(bTasks.map(t => [key(t), t]));
  const order: Record<ChangeKind, number> = {
    regressed: 0,
    fixed: 1,
    stillFailing: 2,
    changed: 3,
    added: 4,
    removed: 5,
    unchanged: 6,
  };

  return [...new Set(all.map(key))].map(key => {
    const a = left.get(key) ?? null;
    const b = right.get(key) ?? null;
    let kind: ChangeKind;
    if (!a) kind = 'added';
    else if (!b) kind = 'removed';
    else if (status(a) === 'failed' && status(b) === 'passed') kind = 'fixed';
    else if (status(a) === 'passed' && status(b) === 'failed')
      kind = 'regressed';
    else if (a.count > 0 && b.count > 0
      && b.passed / b.count < a.passed / a.count) kind = 'regressed';
    else if (a.count > 0 && b.count > 0
      && b.passed / b.count > a.passed / a.count) kind = 'fixed';
    else if (a.count === b.count
      && (b.crashed > a.crashed
        || b.mandatoryFailed > a.mandatoryFailed)) kind = 'regressed';
    else if (a.count === b.count
      && (b.crashed < a.crashed
        || b.mandatoryFailed < a.mandatoryFailed)) kind = 'fixed';
    else if (a.count !== b.count || status(a) !== status(b)) kind = 'changed';
    else if (status(a) === 'failed' && status(b) === 'failed')
      kind = 'stillFailing';
    else kind = 'unchanged';
    return { name: b?.name ?? a!.name, kind, before: a, after: b };
  }).sort((a, b) => order[a.kind] - order[b.kind]
    || a.name.localeCompare(b.name));
}
