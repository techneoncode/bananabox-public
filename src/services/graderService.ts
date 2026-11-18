import * as vscode from 'vscode';
import { graderGroupRestriction } from '../domain/projects';
import { createT } from '../shared/i18n';
import { ApiError, EpitechClient, GraderRef } from '../api/client';
import {
  isActiveState,
  normalizeDelivery,
  normalizeDetail,
  normalizeQuota,
  normalizeRun,
  normalizeSummary,
} from '../domain/grader';
import type {
  GraderVM,
  ProjectVM,
  Quota,
  TestResultDetail,
  TestResultSummary,
} from '../shared/types';
import { fresh, inBackground, wantsFresh } from '../api/requestGuard';
import { config } from '../util/config';
import { log } from '../util/log';
import type { ProjectService } from './projectService';
import { tr } from '../util/text';

const MAX_POLL_MS = 10 * 60_000;
const CACHE_KEY = 'epibox.graderCache.v1';
const RESULTS_MAX_AGE = 30 * 60_000;
const MAX_CACHED_PROJECTS = 80;

/**
 * What survives a restart: enough to draw a project's attempts without asking
 * MyEpitech again.
 */
interface CachedGrader {
  at: number;
  quota: Quota | null;
  history: TestResultSummary[];
  final?: boolean;
}
interface GraderCache {
  login: string;
  projects: Record<string, CachedGrader>;
}

export class GraderService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<number>();
  /** Fires with the project id whose grader state changed. */
  readonly onDidChange = this.emitter.event;

  private readonly states = new Map<number, GraderVM>();
  private readonly details = new Map<number, TestResultDetail>();
  private readonly pollers = new Map<number, NodeJS.Timeout>();
  private disposed = false;
  private generation = 0;
  private readonly submitting = new Set<number>();
  private readonly loads = new Map<number, Promise<void>>();
  private readonly loadedAt = new Map<number, number>();
  private readonly resultsAt = new Map<number, number>();
  private cache: GraderCache | null = null;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: EpitechClient,
    private readonly projects: ProjectService,
    private readonly memento?: vscode.Memento,
    private readonly login: () => string | undefined = () => undefined,
  ) {}

  get(projectId: number): GraderVM | undefined {
    return this.states.get(projectId) ?? this.fromCache(projectId);
  }

  /**
   * The last known attempts of a project, from this session or a previous one,
   * without any request.
   */
  private fromCache(projectId: number): GraderVM | undefined {
    const entry = this.cached()?.projects[String(projectId)];
    const project = this.projects.get?.(projectId);
    if (!entry || !project) return undefined;
    const { ok, reason } = this.canRun(project);
    const vm: GraderVM = {
      projectId,
      loading: false,
      error: null,
      quota: entry.quota,
      runs: [],
      history: entry.history,
      running: false,
      canRun: ok,
      reason,
    };
    this.states.set(projectId, vm);
    this.resultsAt.set(projectId, entry.at);
    return vm;
  }

  private cached(): GraderCache | null {
    const login = this.login();
    if (!login || !this.memento) return null;
    if (this.cache?.login !== login) {
      const stored = this.memento.get<GraderCache>(CACHE_KEY);
      this.cache = stored?.login === login && stored.projects
        ? stored
        : { login, projects: {} };
    }
    return this.cache;
  }

  private remember(projectId: number, final = false): void {
    const cache = this.cached();
    const state = this.states.get(projectId);
    if (!cache || !state || (!state.history.length && !state.quota)) return;

    cache.projects[String(projectId)] = {
      at: Date.now(),
      quota: state.quota,
      history: state.history.map(h => ({
        ...h,
        skills: h.skills.slice(0, 12),
      })),
      final: final || cache.projects[String(projectId)]?.final,
    };
    const ids = Object.keys(cache.projects)
      .sort((a, b) => cache.projects[b].at - cache.projects[a].at);
    for (const id of ids.slice(MAX_CACHED_PROJECTS)) delete cache.projects[id];

    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.memento && this.cache) {
        void this.memento.update(CACHE_KEY, this.cache);
      }
    }, 1500);
  }

  /**
   * Results seen elsewhere (the repository lookup reads the same list): adopted
   * as the project's history so the same list is never asked for twice.
   */
  adoptResults(project: ProjectVM, raw: Array<Record<string, any>>): void {
    if (this.loads.has(project.id)) return;
    const history = raw
      .map((r) => normalizeSummary(r))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    this.resultsAt.set(project.id, Date.now());
    this.patch(project, { history });
    this.remember(project.id, project.status === 'past');
  }

  /**
   * Makes sure the project's grader state is at most `maxAge` old; loads it
   * (runs, quota, and results only when something changed) otherwise.
   * Background work waits behind the student's own requests.
   */
  ensure(
    project: ProjectVM,
    maxAge: number,
    background = false,
  ): Promise<void> {
    const at = this.loadedAt.get(project.id);
    if (this.loads.has(project.id)) return this.loads.get(project.id)!;
    if (at !== undefined && Date.now() - at < maxAge && !wantsFresh()) {
      return Promise.resolve();
    }
    return background
      ? inBackground(() => this.load(project))
      : this.load(project);
  }

  /**
   * A glance for overview lists: ongoing projects refresh every few minutes in
   * the background; a finished project is read once and then lives from the
   * cache forever; upcoming ones cannot have results yet.
   */
  peek(project: ProjectVM): Promise<void> {
    if (project.status === 'upcoming' || !project.registered) {
      return Promise.resolve();
    }
    if (project.status === 'past') {
      const entry = this.cached()?.projects[String(project.id)];
      if (entry?.final
        || this.resultsAt.has(project.id)
        || this.loads.has(project.id)) {
        this.get(project.id);
        return Promise.resolve();
      }
      const task = inBackground(() => this.loadResultsOnly(project))
        .finally(() => {
          if (this.loads.get(project.id) === task) {
            this.loads.delete(project.id);
          }
        });
      this.loads.set(project.id, task);
      return task;
    }
    this.get(project.id);
    return this.ensure(project, 5 * 60_000, true);
  }

  private async loadResultsOnly(project: ProjectVM): Promise<void> {
    const gen = this.generation;
    try {
      const raw = (await this.client.testResults(project.id)) as Array<
        Record<string, any>
      >;
      if (gen !== this.generation || this.disposed) return;
      this.resultsAt.set(project.id, Date.now());
      this.patch(project, {
        history: raw
          .map((r) => normalizeSummary(r))
          .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
      });
      this.remember(project.id, true);
    } catch (e) {
      log().debug(`results unavailable for finished project ${project.id}`, e);
    }
  }

  cachedDetail(resultId: number): TestResultDetail | undefined {
    return this.details.get(resultId);
  }

  clear(): void {
    this.generation++;
    this.submitting.clear();
    this.loads.clear();
    this.pollers.forEach(clearTimeout);
    this.pollers.clear();
    this.states.clear();
    this.details.clear();
    this.loadedAt.clear();
    this.resultsAt.clear();
    this.cache = null;
  }

  private ref(p: ProjectVM): GraderRef | null {
    if (p.registrationId === null) return null;
    return {
      year: p.schoolYear,
      unitCode: p.unitCode,
      instanceCode: p.instanceCode,
      projectId: p.id,
      registrationId: p.registrationId,
    };
  }

  private canRun(p: ProjectVM): { ok: boolean; reason: string | null } {
    if (!p.registered || p.registrationId === null) {
      return { ok: false, reason: 'not_registered' };
    }
    if (!p.repoEnabled) return { ok: false, reason: 'repo_disabled' };
    const reason = graderGroupRestriction(p);
    return { ok: reason === null, reason };
  }

  private patch(p: ProjectVM, change: Partial<GraderVM>): GraderVM {
    const { ok, reason } = this.canRun(this.projects.get?.(p.id) ?? p);
    const prev: GraderVM = this.states.get(p.id) ?? {
      projectId: p.id,
      loading: false,
      error: null,
      quota: null,
      runs: [],
      history: [],
      running: false,
      canRun: ok,
      reason,
    };
    const next: GraderVM = { ...prev, canRun: ok, reason, ...change };
    next.running = this.submitting.has(p.id)
      || next.runs.some((r) => isActiveState(r.state));
    this.states.set(p.id, next);
    this.emitter.fire(p.id);
    return next;
  }

  /** Loads quota, runs and the full results history for a project. */
  load(project: ProjectVM): Promise<void> {
    const existing = this.loads.get(project.id);
    if (existing) return existing;
    const task = this.loadState(project).finally(() => {
      if (this.loads.get(project.id) === task) this.loads.delete(project.id);
    });
    this.loads.set(project.id, task);
    return task;
  }

  private async loadState(project: ProjectVM): Promise<void> {
    const gen = this.generation;
    const prev = this.states.get(project.id) ?? this.fromCache(project.id);
    const force = wantsFresh();
    this.patch(project, {
      loading: true,
      error: null,
      remoteCommit: {
        ...normalizeDelivery(null),
        status: 'loading',
        checkedAt: null,
      },
    });
    const ref = this.ref(project);
    const change: Partial<GraderVM> = {
      loading: false,
      remoteCommit: normalizeDelivery(null),
    };
    let runsFinishedAt = 0;
    if (ref) {
      try {
        const res = await this.client.graderRuns(ref);
        change.runs = (res?.runs ?? []).map(normalizeRun);
        change.quota = normalizeQuota(res?.quota);
        change.remoteCommit = normalizeDelivery(res?.lastDelivery);
        runsFinishedAt = Math.max(
          0,
          ...change.runs.map(r => Date.parse(r.finishedAt ?? '') || 0),
        );
      } catch (e) {
        change.error = describe(e);
        change.remoteCommit = {
          ...normalizeDelivery(null),
          status: 'error',
          error: change.error,
        };
        log().warn('grader runs failed', e);
      }
    }
    if (gen !== this.generation || this.disposed) return;

    const readAt = this.resultsAt.get(project.id);
    const tokensMoved = !!prev?.quota
      && !!change.quota
      && change.quota.consumed !== prev.quota.consumed;
    const needResults = project.registered
      && (force
        || readAt === undefined
        || !prev?.history
        || tokensMoved
        || runsFinishedAt > readAt - 60_000
        || Date.now() - readAt > RESULTS_MAX_AGE);
    if (needResults) {
      try {
        const raw = (await this.client.testResults(project.id)) as Array<
          Record<string, any>
        >;
        if (gen !== this.generation || this.disposed) return;
        change.history = raw
          .map((r) => normalizeSummary(r))
          .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        this.resultsAt.set(project.id, Date.now());
        const withLink = raw.find((r) => typeof r.repoLink === 'string');
        if (withLink) {
          this.projects.learnRepo(
            project.id,
            withLink.repoLink,
            withLink.context?.projectCode ?? null,
          );
        }
      } catch (e) {
        if (!change.error) change.error = describe(e);
      }
    }
    if (gen !== this.generation || this.disposed) return;
    this.loadedAt.set(project.id, Date.now());
    const state = this.patch(project, change);
    this.remember(project.id, project.status === 'past');
    if (state.running) this.startPolling(project);
  }

  /** Requests a new grader run and follows it until it finishes. */
  async run(project: ProjectVM): Promise<void> {
    project = this.projects.get?.(project.id) ?? project;
    const ref = this.ref(project);
    const gate = this.canRun(project);
    if (!ref || !gate.ok) {
      throw new Error(createT(config.language())(
        `grader.reason.${gate.reason ?? 'not_registered'}`,
      ));
    }
    const quota = this.states.get(project.id)?.quota;
    if (quota && quota.remaining <= 0) {
      throw new Error(tr('You have no grader tokens left for this project.'));
    }
    if (this.states.get(project.id)?.running) {
      throw new Error(tr('A grader run is already in progress.'));
    }

    const gen = this.generation;
    this.submitting.add(project.id);
    this.patch(project, { error: null });
    try {
      const submitted = normalizeRun(await this.client.startGrader(ref));
      if (gen !== this.generation || this.disposed) return;
      this.submitting.delete(project.id);
      this.patch(project, {
        runs: [
          submitted,
          ...(this.states.get(project.id)?.runs ?? [])
            .filter((r) => r.id !== submitted.id),
        ],
      });
      this.startPolling(project);
    } catch (e) {
      if (gen === this.generation && !this.disposed) {
        this.submitting.delete(project.id);
        this.patch(project, { error: describe(e) });
      }
      throw e;
    }
  }

  private async refreshRuns(project: ProjectVM): Promise<GraderVM | undefined> {
    const gen = this.generation;
    const ref = this.ref(project);
    if (!ref) return undefined;
    try {
      const res = await this.client.graderRuns(ref);
      if (gen !== this.generation || this.disposed) return undefined;
      return this.patch(project, {
        runs: (res.runs ?? []).map(normalizeRun),
        quota: normalizeQuota(res.quota)
          ?? this.states.get(project.id)?.quota
          ?? null,
        remoteCommit: normalizeDelivery(res.lastDelivery),
        error: null,
      });
    } catch (e) {
      if (gen === this.generation && !this.disposed) {
        this.patch(project, {
          error: describe(e),
          remoteCommit: {
            ...normalizeDelivery(null),
            status: 'error',
            error: describe(e),
          },
        });
      }
      return undefined;
    }
  }

  private startPolling(project: ProjectVM): void {
    if (this.pollers.has(project.id)) return;
    const startedAt = Date.now();
    const gen = this.generation;
    const tick = async () => {
      if (this.disposed || gen !== this.generation) return;
      const state = await this.refreshRuns(project);
      if (this.disposed || gen !== this.generation) return;
      if ((!state || state.running) && Date.now() - startedAt < MAX_POLL_MS) {
        this.pollers.set(project.id, setTimeout(
          tick,
          pollDelay(Date.now() - startedAt),
        ));
        return;
      }

      this.pollers.delete(project.id);
      if (!state || state.running) {
        this.patch(project, {
          error: tr('Live updates paused after 10 minutes. Refresh to resume.'),
        });
      }
      if (state && !state.running) {
        await fresh(() => this.load(project));
      }
    };
    this.pollers.set(project.id, setTimeout(tick, pollDelay(0)));
  }

  async detail(resultId: number): Promise<TestResultDetail> {
    const cached = this.details.get(resultId);
    if (cached) return cached;

    const gen = this.generation;
    const detail = normalizeDetail(
      await this.client.testResult(resultId),
      resultId,
    );
    if (gen !== this.generation || this.disposed) {
      throw new Error(tr('Session ended.'));
    }
    this.details.set(resultId, detail);
    return detail;
  }

  dispose(): void {
    clearTimeout(this.saveTimer);
    if (this.memento && this.cache) {
      void this.memento.update(CACHE_KEY, this.cache);
    }
    this.disposed = true;
    this.clear();
    this.emitter.dispose();
  }
}

/**
 * Following a run: the student's setting for the first minute (never under
 * 5 s), then every 10 s, then every 20 s. A run takes minutes; asking every few
 * seconds for ten minutes would be hundreds of requests for one result.
 */
export function pollDelay(elapsed: number): number {
  const base = Math.max(5_000, config.pollIntervalMs());
  if (elapsed < 60_000) return base;
  if (elapsed < 180_000) return Math.max(base, 10_000);
  return Math.max(base, 20_000);
}

export function describe(e: unknown): string {
  if (e instanceof ApiError) {
    return e.status === 404 ? tr('Not available for this project.') : e.message;
  }
  return (e as Error)?.message ?? String(e);
}
