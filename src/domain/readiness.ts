import type { DeliveryCheck, ReadinessVM } from '../shared/deliveryTypes';
import type { GraderVM, ProjectVM } from '../shared/types';
import type { GitWorktreeState } from './git';

export function gitReadinessDetail(
  git: { dirty: number; ahead: number; hasUpstream: boolean },
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return [
    t('delivery.gitSummary', { dirty: git.dirty, ahead: git.ahead }),
    git.dirty
      ? t('delivery.gitCommitNeeded')
      : git.ahead
        ? t('delivery.gitPushNeeded')
        : !git.hasUpstream
          ? t('run.noUpstream')
          : t('delivery.gitReady'),
  ].join('\n');
}

export function readinessChecks(
  project: ProjectVM,
  vm: ReadinessVM | undefined,
  grader: GraderVM | undefined,
  git: GitWorktreeState | undefined,
  now = Date.now(),
): DeliveryCheck[] {
  const checks: DeliveryCheck[] = [
    'style', 'build', 'tests', 'files', 'functions', 'valgrind',
  ].map(id => vm?.checks.find(c => c.id === id)
    ?? { id: id as DeliveryCheck['id'], status: 'unknown', detail: '' });

  checks.push({
    id: 'git',
    status: git
      ? git.dirty || git.ahead || !git.hasUpstream
        ? 'fail'
        : 'pass'
      : 'unknown',
    detail: '',
  });

  const remaining = Date.parse(project.endDate) - now;
  checks.push({
    id: 'deadline',
    status: Number.isFinite(remaining)
      ? remaining > 0
        ? 'pass'
        : 'fail'
      : 'unknown',
    detail: project.endDate,
  });

  checks.push({
    id: 'grader',
    status: !grader || grader.loading || grader.error || !grader.quota
      ? 'unknown'
      : !grader.canRun || grader.running || grader.quota.remaining <= 0
        ? 'fail'
        : 'pass',
    detail: '',
  });
  return checks;
}

export function readinessVerdict(
  vm: ReadinessVM | undefined,
  checks: DeliveryCheck[],
): 'ready' | 'blocked' | 'unchecked' | 'stale' | 'running' {
  if (vm?.status === 'running') return 'running';
  if (vm?.stale) return 'stale';
  if (checks.some(c => c.status === 'fail')) return 'blocked';
  if (!vm || vm.status !== 'done' || checks.some(c => c.status !== 'pass' && c.id !== 'valgrind')) {
    return 'unchecked';
  }
  return 'ready';
}
