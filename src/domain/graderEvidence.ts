import type {
  TestResultDetail,
  TestResultSummary,
  TestTask,
} from '../shared/types';
import { analyzeGraderTrace, type TaskAnalysis } from './graderTrace';

/**
 * Normalised reports sometimes expose task traces without the original section
 * banners.
 */
export function resultTrace(
  result: Pick<TestResultDetail, 'tasks' | 'rawTrace'>,
): string {
  if (!result.tasks.length) return result.rawTrace ?? '';
  return result.tasks.map(task => {
    const name = task.name.replace(/[\r\n]/g, ' ');
    const verdict = task.status === 'passed'
      ? 'SUCCESS'
      : task.status === 'failed'
        ? 'FAILURE'
        : null;
    return `====================\n${name}\n====================\n${task.trace}\n${verdict ? `${name}: ${verdict}` : ''}`;
  }).join('\n');
}

const cache = new WeakMap<TestResultDetail, TaskAnalysis[]>();
export function resultEvidence(result: TestResultDetail): TaskAnalysis[] {
  let tasks = cache.get(result);
  if (!tasks) {
    tasks = analyzeGraderTrace(resultTrace(result)).tasks;
    cache.set(result, tasks);
  }
  return tasks;
}

const key = (name: string) => name.trim()
  .replace(/^\d+\s*[-.:]\s*/, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

export function taskEvidence(
  result: TestResultDetail,
  task: TestTask,
): TaskAnalysis | undefined {
  const tasks = resultEvidence(result);
  return tasks.find(t => t.name === task.name) ?? (
    tasks.filter(t => key(t.name) === key(task.name)).length === 1
      ? tasks.find(t => key(t.name) === key(task.name))
      : undefined
  );
}
