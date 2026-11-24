import * as vscode from 'vscode';
import { inBackground } from '../api/requestGuard';
import { EpitechClient } from '../api/client';
import { findSubjectUrl } from '../domain/resources';
import {
  matchProjectToRemotes,
  normalizeProject,
  sortProjects,
} from '../domain/projects';
import { workspaceRemotes } from '../git/repoDetector';
import type { ProjectStatus, ProjectVM } from '../shared/types';
import { config } from '../util/config';
import { log } from '../util/log';

interface RepoInfo {
  repoLink: string;
  projectCode: string | null;
}

const REPO_CACHE_KEY = 'bananabox.repoInfo.v1';
const LOCAL_PATHS_KEY = 'bananabox.localPaths.v1';
/** Last project list per account: a reloaded window (Open folder) draws it at once, then refreshes. */
const PROJECTS_CACHE_KEY = 'bananabox.projects.v1';

interface ProjectsCache { login: string; at: number; projects: ProjectVM[] }

export class ProjectService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  projects: ProjectVM[] | null = null;
  loading = false;
  error: string | null = null;
  partialErrors: string[] = [];
  lastUpdated: number | null = null;
  currentProjectId: number | null = null;

  private repoInfo: Record<string, RepoInfo>;
  private localPaths: Record<string, string>;
  private noResultsUntil = new Map<number, number>();
  private generation = 0;
  private readonly resourceRequests = new Map<
    number,
    Promise<ProjectVM | undefined>
  >();

  constructor(
    private readonly client: EpitechClient,
    private readonly memento: vscode.Memento,
    private readonly login: () => string | null = () => null,
  ) {
    this.repoInfo = memento.get<Record<string, RepoInfo>>(REPO_CACHE_KEY, {});
    this.localPaths = memento.get<Record<string, string>>(LOCAL_PATHS_KEY, {});
  }

  get(id: number): ProjectVM | undefined {
    return this.projects?.find((p) => p.id === id);
  }

  get current(): ProjectVM | undefined {
    return this.currentProjectId === null
      ? undefined
      : this.get(this.currentProjectId);
  }

  reset(): void {
    this.generation++;
    this.resourceRequests.clear();
    this.noResultsUntil.clear();
    this.repoInfo = {};
    void this.memento.update(REPO_CACHE_KEY, undefined);
    void this.memento.update(PROJECTS_CACHE_KEY, undefined);
    void vscode.commands.executeCommand(
      'setContext',
      'bananabox.hasCurrentProject',
      false,
    );
    this.projects = null;
    this.error = null;
    this.partialErrors = [];
    this.currentProjectId = null;
    this.lastUpdated = null;
    this.loading = false;
    this.emitter.fire();
  }

  async refresh(): Promise<void> {
    const gen = ++this.generation;
    this.resourceRequests.clear();
    this.loading = true;
    this.error = null;
    if (!this.projects && (await this.seedFromCache()) && gen !== this.generation) return;
    this.emitter.fire();

    const base = config.apiBaseUrl();
    const jobs: Array<[ProjectStatus, boolean]> = [
      ['ongoing', true],
      ['past', true],
      ['upcoming', false],
    ];
    const settled = await Promise.allSettled(
      jobs.map(([status, registeredOnly]) =>
        this.client.listProjects(status, registeredOnly),
      ),
    );
    if (gen !== this.generation) return;

    const byId = new Map<number, ProjectVM>();
    const partial: string[] = [];
    settled.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        res.value.forEach((raw) => {
          const vm = normalizeProject(raw, base, Date.now(), this.login());
          const prev = byId.get(vm.id);
          if (!prev || (!prev.registered && vm.registered)) {
            byId.set(vm.id, vm);
          }
        });
      } else {
        partial.push(`${jobs[i][0]}: ${(res.reason as Error).message}`);
        log().warn(`Loading ${jobs[i][0]} projects failed`, res.reason);
      }
    });

    if (byId.size === 0 && partial.length === jobs.length) {
      this.error = partial[0].replace(/^\w+: /, '');
      this.loading = false;
      this.emitter.fire();
      return;
    }

    this.projects = sortProjects(
      [...byId.values()].map((p) => this.withCachedRepo(p)),
    );
    this.partialErrors = partial;
    this.lastUpdated = Date.now();
    this.loading = false;
    await this.detectCurrent();
    this.emitter.fire();
    const login = this.login();
    if (login && partial.length === 0) {
      void this.memento.update(PROJECTS_CACHE_KEY, { login, at: this.lastUpdated, projects: this.projects } satisfies ProjectsCache);
    }
    void this.enrichRepoLinks(gen);
  }

  /** Shows the account's last project list while the fresh one loads. True when it seeded something. */
  private async seedFromCache(): Promise<boolean> {
    const login = this.login();
    const cached = login ? this.memento.get<ProjectsCache>(PROJECTS_CACHE_KEY) : undefined;
    if (!cached || cached.login !== login || !Array.isArray(cached.projects)) return false;
    this.projects = sortProjects(cached.projects.map((p) => this.withCachedRepo(p)));
    this.lastUpdated = cached.at;
    await this.detectCurrent();
    return true;
  }

  /** Re-evaluates which project (if any) matches the folders opened in VS Code. */
  async detectCurrent(): Promise<void> {
    const before = this.currentProjectId;
    const gen = this.generation;
    const remotes = await workspaceRemotes();
    if (gen !== this.generation) return;

    this.currentProjectId = this.projects && remotes.length
      ? (matchProjectToRemotes(this.projects, remotes)?.id ?? null)
      : null;
    await vscode.commands.executeCommand(
      'setContext',
      'bananabox.hasCurrentProject',
      this.currentProjectId !== null,
    );

    if (before !== this.currentProjectId) {
      this.emitter.fire();
    }
  }

  private withCachedRepo(p: ProjectVM): ProjectVM {
    const info = this.repoInfo[String(p.id)];
    return info && !p.repoLink
      ? {
          ...p,
          repoLink: info.repoLink,
          projectCode: info.projectCode ?? p.projectCode,
        }
      : p;
  }

  /** Resolve direct project metadata before falling back to historical grader responses. */
  resolveResources(projectId: number): Promise<ProjectVM | undefined> {
    const pending = this.resourceRequests.get(projectId);
    if (pending) return pending;
    const request = this.fetchResources(projectId).finally(() => {
      if (this.resourceRequests.get(projectId) === request) {
        this.resourceRequests.delete(projectId);
      }
    });
    this.resourceRequests.set(projectId, request);
    return request;
  }

  private async fetchResources(
    projectId: number,
  ): Promise<ProjectVM | undefined> {
    const gen = this.generation;
    const project = this.get(projectId);
    if (!project) return undefined;

    try {
      const detail = await this.client.projectDetail(projectId, project);
      if (gen !== this.generation) return undefined;
      const group = normalizeProject(
        detail,
        config.apiBaseUrl(),
        Date.now(),
        this.login(),
      );
      if (Array.isArray(detail.registrations) && this.projects) {
        this.projects = this.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                registrationId: group.registrationId,
                registered: group.registered,
                groupName: group.groupName,
                groupMemberCount: group.groupMemberCount,
                isGroupLeader: group.isGroupLeader,
              }
            : p,
        );
        this.emitter.fire();
      }

      const repoLink = group.repoLink;
      const subjectUrl = findSubjectUrl(detail);
      if (repoLink) {
        this.learnRepo(projectId, repoLink, project.projectCode, true);
      }
      if (subjectUrl && this.projects) {
        this.projects = this.projects.map((p) =>
          p.id === projectId ? { ...p, subjectUrl } : p,
        );
        this.emitter.fire();
      }
    } catch (e) {
      log().debug(`Project resources unavailable for ${projectId}`, e);
    }
    return gen === this.generation ? this.get(projectId) : undefined;
  }

  /** Historical results are a fallback, never a prerequisite for cloning. */
  private async enrichRepoLinks(gen: number): Promise<void> {
    const todo = (this.projects ?? []).filter((p) =>
      p.registered
        && p.repoEnabled
        && !p.repoLink
        && (this.noResultsUntil.get(p.id) ?? 0) < Date.now(),
    );
    let changed = false;
    const queue = [...todo];

    const worker = async () => {
      for (
        let p = queue.shift();
        p && gen === this.generation;
        p = queue.shift()
      ) {
        try {
          const results = await inBackground(() =>
            this.client.testResults(p.id),
          );
          if (gen !== this.generation) return;
          this.onResults?.(p, results);
          const withLink = results.find((r) => typeof r.repoLink === 'string');
          if (withLink) {
            if (!this.get(p.id)?.repoLink) {
              this.applyRepoInfo(
                p.id,
                withLink.repoLink,
                withLink.context?.projectCode ?? null,
              );
            }
            changed = true;
          } else {
            this.noResultsUntil.set(
              p.id,
              Date.now() + (p.status === 'past' ? 24 * 60 : 30) * 60_000,
            );
          }
        } catch (e) {
          log().debug(`repo enrichment failed for project ${p.id}`, e);
        }
      }
    };

    await Promise.all([worker(), worker(), worker(), worker()]);
    if (changed && gen === this.generation) {
      await this.memento.update(REPO_CACHE_KEY, this.repoInfo);
      await this.detectCurrent();
      this.emitter.fire();
    }
  }

  /** Called by the grader service when it sees a repo link for a project. */
  learnRepo(
    projectId: number,
    repoLink: string,
    projectCode: string | null,
    authoritative = false,
  ): void {
    if (!authoritative && this.get(projectId)?.repoLink) return;
    if (this.repoInfo[String(projectId)]?.repoLink === repoLink) return;
    this.applyRepoInfo(projectId, repoLink, projectCode);
    void this.memento.update(REPO_CACHE_KEY, this.repoInfo);
    void this.detectCurrent();
    this.emitter.fire();
  }

  private applyRepoInfo(
    projectId: number,
    repoLink: string,
    projectCode: string | null,
  ): void {
    this.repoInfo[String(projectId)] = { repoLink, projectCode };
    if (this.projects) {
      this.projects = this.projects.map((p) =>
        p.id === projectId
          ? { ...p, repoLink, projectCode: projectCode ?? p.projectCode }
          : p,
      );
    }
  }

  /** Results lists read while looking for repository links; the grader adopts them instead of asking again. */
  onResults?: (project: ProjectVM, results: Array<Record<string, any>>) => void;

  localPath(projectId: number): string | undefined {
    return this.localPaths[String(projectId)];
  }

  /** Ids of every project with a remembered local folder. */
  localProjectIds(): number[] {
    return Object.keys(this.localPaths)
      .map(Number)
      .filter(Number.isSafeInteger);
  }

  async rememberLocalPath(projectId: number, path: string): Promise<void> {
    this.localPaths[String(projectId)] = path;
    await this.memento.update(LOCAL_PATHS_KEY, this.localPaths);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
