import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { RequestGuard } from './api/requestGuard';
import { PALETTE_KEY, sanitizePalette, type Palette } from './shared/palette';
import type { Milestone } from './domain/milestones';
import { EpitechClient } from './api/client';
import { AuthManager } from './auth/authManager';
import type { AuthRequest } from './auth/microsoft';
import type { ProjectRules } from './codingStyle/api';
import { CommitExplorer } from './git/commitExplorer';
import { GraderService } from './services/graderService';
import { ProjectService } from './services/projectService';
import { SubjectService } from './services/subjectService';
import { acceptTerms, termsAccepted } from './services/termsConsent';
import type {
  HostMessage,
  PanelTab,
  StateSnapshot,
  WebviewMessage,
} from './shared/protocol';
import type { ProjectVM, StyleScanVM, ValgrindVM } from './shared/types';
import { config } from './util/config';
import { log } from './util/log';
import type { ProjectPanels } from './views/projectPanel';
import type { HomePanel } from './views/homePanel';
import { ActivityService } from './services/activityService';
import { DeadlineService } from './services/deadlineService';
import { AvatarService } from './services/avatarService';
import { DefenseReminderService } from './services/defenseReminderService';
import { StyleService } from './services/styleService';
import { createT } from './shared/i18n';
import { ReadinessService } from './services/readinessService';
import { FunctionRules } from './services/functionRules';
import { CalendarService } from './services/calendarService';
import { SubjectFunctions } from './services/subjectFunctions';
import { extractPdfText } from './services/pdfText';
import { ReproductionService } from './services/reproductionService';
import { GuidedDelivery } from './services/guidedDelivery';
import { GraderCommand } from './services/graderCommand';
import { remoteFeatures } from './services/remoteFeatures';
import {
  abortBrowser,
  authChanged,
  browserProfile,
  cancelSignIn,
  failSignIn,
  signIn,
  signInMicrosoft,
  signInWithBrowser,
  signInWithPaste,
  signOut,
  silentBrowserLogin,
  submitRedirect,
} from './handlers/auth';
import {
  checkReadiness,
  clearDelivery,
  compareCommits,
  customFunctions,
  functionScope,
  guidedDelivery,
  invalidateDelivery,
  loadComparisonFiles,
  projectRules,
  pushDelivery,
  reproduce,
  showChanges,
  watchLocal,
} from './handlers/delivery';
import { loadResult, refreshRemoteCommit, runGrader } from './handlers/grader';
import { handleMessage, loadAvatars } from './handlers/messages';
import {
  afterClone,
  cloneProject,
  loadSubject,
  localGitState,
  localRoot,
  onProjectsChanged,
  openCurrentProject,
  openFolder,
  openOnIntranet,
  openProject,
  openSubjectCommand,
  pickSubject,
  refresh,
  refreshCommitStates,
  rememberCurrentFolder,
} from './handlers/projects';
import {
  checkDeadlines,
  notifyDeadline,
  pushActivities,
  refreshActivities,
  updateDefenseReminders,
  updateStatusBar,
} from './handlers/status';
import {
  locateStyle,
  maybeLocateStyle,
  onValgrind,
  openFileAt,
  openProjectFile,
  preflight,
  pushStyle,
  pushValgrind,
  revealFirstIssue,
} from './handlers/style';

export interface Surface {
  webview: vscode.Webview;
  kind: 'sidebar' | 'panel';
  projectId?: number;
  initialTab?: PanelTab;
  /** Project shown in detail; its delivery state is kept fresh. */
  focus?: number | null;
}

/**
 * Central hub: owns the services, talks to every webview and implements
 * all user-facing commands.
 */
export class Controller implements vscode.Disposable {
  readonly client: EpitechClient;
  readonly auth: AuthManager;
  readonly projects: ProjectService;
  readonly grader: GraderService;
  readonly subject: SubjectService;
  readonly activities: ActivityService;
  readonly avatars: AvatarService;
  readonly style = new StyleService();
  readonly readiness = new ReadinessService(
    (id, root, signal) => this.style.scan(id, root, 'preflight', { signal }),
    (key, params) => createT(config.language())(key, params),
    async root => {
      const api = this.style.api;
      return api?.runValgrind && api.valgrindCommand?.(root)
        ? api.runValgrind(root)
        : null;
    },
  );
  readonly functionRules: FunctionRules;
  readonly calendar: CalendarService;
  readonly subjectFunctions: SubjectFunctions;
  readonly graderCommand: GraderCommand;
  readonly reproduction = new ReproductionService(
    key => createT(config.language())(key),
  );
  readonly guided = new GuidedDelivery();
  readonly localWatchers = new Map<number, vscode.Disposable>();
  readonly deliveryRoots = new Map<number, string>();
  readonly deadlines: DeadlineService;
  readonly defenseReminders: DefenseReminderService;
  readonly activityMutations = new Set<number>();
  readonly activityRefreshes = new Map<number, number>();
  refreshingActivities = false;
  readonly latestSeen = new Map<number, number>();
  readonly preparingGrader = new Set<number>();
  readonly valgrindRuns = new Map<number, ValgrindVM>();
  readonly valgrindRoots = new Map<number, string>();
  readonly debugBuilds = new Set<number>();
  panels!: ProjectPanels;
  home?: HomePanel;
  openHomeAfterSignIn = false;
  readonly commits = new CommitExplorer();
  commitStates: NonNullable<StateSnapshot['commitStates']> = {};
  commitProjects = new Set<number>();
  checkingCommits = false;
  commitTimer = setInterval(() => void this.refreshCommitStates(), 10000);
  /**
   * Once a minute: refresh the status-bar countdown and fire due deadline
   * reminders.
   */
  deadlineTimer = setInterval(() => {
    updateStatusBar(this);
    checkDeadlines(this);
    void refreshActivities(this);
    updateDefenseReminders(this);
  }, 60_000);
  readonly surfaces = new Set<Surface>();
  readonly disposables: vscode.Disposable[] = [];
  readonly statusItem: vscode.StatusBarItem;
  pushTimer: NodeJS.Timeout | undefined;
  autoOpened = new Set<number>();
  sessionToken: string | undefined;
  activityLogin: string | undefined;
  pendingAuth: AuthRequest | undefined;
  browserAbort: AbortController | undefined;

  constructor(readonly context: vscode.ExtensionContext) {
    this.functionRules = new FunctionRules(context.globalState);
    this.graderCommand = new GraderCommand(context.globalState);
    this.auth = new AuthManager(context.secrets, {
      silentLogin: () => silentBrowserLogin(this),
      isEnabled: () => remoteFeatures.status.myApiActive,
    });
    this.client = new EpitechClient({
      baseUrl: () => config.apiBaseUrl(),
      token: () => this.auth.accessToken,
      onUnauthorized: () => this.auth.markExpired(),
      userAgent: `bananabox-vscode/${context.extension.packageJSON.version}`,
      isEnabled: () => remoteFeatures.status.myApiActive,
      signal: () => remoteFeatures.apiSignal,
      onActivityChange: () => this.schedulePush(),
      guard: new RequestGuard({ onChange: () => this.schedulePush() }),
    });
    this.auth.client = this.client;

    this.projects = new ProjectService(
      this.client,
      context.globalState,
      () => this.auth.snapshot.login,
    );
    this.grader = new GraderService(
      this.client,
      this.projects,
      context.globalState,
      () => this.auth.snapshot.login ?? undefined,
    );
    this.projects.onResults = (project, raw) =>
      this.grader.adoptResults(project, raw);
    this.subject = new SubjectService(this.client, (key, params) => createT(config.language())(key, params));
    this.subjectFunctions = new SubjectFunctions(
      context.globalState,
      project => this.subject.functionsDocument(project),
      extractPdfText,
      id => {
        pushDelivery(this, id);
        this.style.api?.refreshProjectRules?.();
      },
    );
    this.activities = new ActivityService(
      this.client,
      id => ({
        login: this.auth.snapshot.login,
        registrationId: this.projects.get(id)?.registrationId ?? null,
      }),
      (key, params) => createT(config.language())(key, params),
      a => this.calendar.activityWindows(a.id, a.startDate, a.endDate),
    );
    this.calendar = new CalendarService(
      this.client,
      context.globalState,
      () => functionScope(this),
      () => ({
        login: this.auth.snapshot.login,
        promotion: this.auth.snapshot.promotion,
        cursus: this.auth.snapshot.cursus,
        projects: this.projects.projects ?? [],
      }),
    );
    this.defenseReminders = new DefenseReminderService(
      context,
      () => config.language(),
    );
    this.avatars = new AvatarService(
      join(context.globalStorageUri.fsPath, 'avatars'),
      login => this.client.avatar(login),
    );
    this.deadlines = new DeadlineService(
      context.globalState,
      (project, hours) => notifyDeadline(this, project, hours),
    );
    this.statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusItem.command = 'bananabox.openCurrentProject';

    const gitConfigWatcher = vscode.workspace.createFileSystemWatcher(
      '**/.git/config',
    );
    let myApiActive = remoteFeatures.status.myApiActive;
    this.disposables.push(
      remoteFeatures.onDidChange(() => {
        const changed = myApiActive !== remoteFeatures.status.myApiActive;
        myApiActive = remoteFeatures.status.myApiActive;
        if (changed && !myApiActive) {
          this.pendingAuth = undefined;
          abortBrowser(this);
          this.auth.suspend();
          this.defenseReminders.update(null, []);
        } else if (changed && myApiActive && !this.auth.isSignedIn) {
          void this.auth.restore();
        }
        if (!remoteFeatures.status.lensActive) this.style.clear();
        this.schedulePush();
      }),
      this.commits,
      vscode.window.onDidChangeWindowState(e => {
        if (e.focused) void this.refreshCommitStates();
      }),
      gitConfigWatcher,
      gitConfigWatcher.onDidChange(() => void this.projects.detectCurrent()),
      gitConfigWatcher.onDidCreate(() => void this.projects.detectCurrent()),
      gitConfigWatcher.onDidDelete(() => void this.projects.detectCurrent()),
      this.auth,
      this.projects,
      this.grader,
      this.activities,
      this.defenseReminders,
      this.style,
      this.style.api?.onDidValgrind?.(({ root, run }) =>
        onValgrind(this, root, run),
      ) ?? { dispose() {} },
      this.readiness,
      this.reproduction,
      this.guided,
      this.statusItem,
      this.auth.onDidChange((a) => authChanged(this, a)),
      this.projects.onDidChange(() => {
        this.schedulePush();
        onProjectsChanged(this);
      }),
      this.grader.onDidChange((id) => {
        this.pushGrader(id);
        updateStatusBar(this);
        maybeLocateStyle(this, id);
      }),
      this.activities.onDidChange((id) => {
        pushActivities(this, id);
        updateDefenseReminders(this);
      }),
      this.style.onDidChange((id) => pushStyle(this, id)),
      this.calendar,
      this.calendar.onDidChange(() =>
        this.post({ type: 'calendar', calendar: this.calendar.snapshot() }),
      ),
      this.readiness.onDidChange(id => pushDelivery(this, id)),
      this.reproduction.onDidChange(id => pushDelivery(this, id)),
      this.guided.onDidChange(id => pushDelivery(this, id)),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.contentChanges.length) invalidateDelivery(this, e.document.uri);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        void this.projects.detectCurrent(),
      ),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('bananabox')) {
          updateStatusBar(this);
          this.schedulePush();
        }
      }),
    );
  }

  async start() {
    await this.auth.restore();
  }

  attach(
    webview: vscode.Webview,
    kind: 'sidebar' | 'panel',
    projectId?: number,
    initialTab?: PanelTab,
  ): () => void {
    const surface: Surface = { webview, kind, projectId, initialTab };
    this.surfaces.add(surface);
    const sub = webview.onDidReceiveMessage((m: WebviewMessage) => {
      this.handle(surface, m).catch((e) => {
        log().error('message handler failed', e);
        this.toast('error', (e as Error).message);
      });
    });
    return () => {
      sub.dispose();
      this.surfaces.delete(surface);
    };
  }

  handle(surface: Surface, m: WebviewMessage): Promise<void> {
    return handleMessage(this, surface, m);
  }

  post(msg: HostMessage, only?: Surface): void {
    for (const s of only ? [only] : this.surfaces) {
      void s.webview.postMessage(msg);
    }
  }

  toast(level: 'info' | 'warn' | 'error', text: string): void {
    this.post({ type: 'toast', level, text });
  }

  snapshot(): StateSnapshot {
    return {
      availability: remoteFeatures.status,
      apiActivity: this.client.activity.snapshot(),
      auth: this.auth.snapshot,
      termsAccepted: this.termsAccepted,
      projects: this.projects.projects,
      loading: this.projects.loading,
      error: this.projects.error,
      currentProjectId: this.projects.currentProjectId,
      lastUpdated: this.projects.lastUpdated,
      lang: config.language(),
      partialErrors: this.projects.partialErrors,
      commitStates: this.commitStates,
      network: this.client.guard.snapshot(),
      localProjects: this.localProjects(),
      palette: this.palette(),
      bananaTheme: config.bananaTheme(),
      disabledChecks: config.disabledChecks(),
    };
  }

  pushState(only?: Surface): void {
    this.post({ type: 'state', state: this.snapshot() }, only);
  }

  schedulePush(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushState(), 30);
  }

  pushGrader(projectId: number, only?: Surface): void {
    const grader = this.grader.get(projectId);
    if (grader) {
      this.post({ type: 'grader', projectId, grader }, only);
    }
  }

  palette(): Palette {
    return sanitizePalette(this.context.globalState.get<unknown>(PALETTE_KEY));
  }

  async setPalette(value: unknown) {
    await this.context.globalState.update(PALETTE_KEY, sanitizePalette(value));
    this.pushState();
  }

  /**
   * Projects someone is looking at: the open repository, every project panel
   * and the sidebar's focused project.
   */
  watched(): Set<number> {
    const ids = new Set<number>();
    if (this.projects.currentProjectId !== null) {
      ids.add(this.projects.currentProjectId);
    }
    for (const s of this.surfaces) {
      if (s.projectId !== undefined) ids.add(s.projectId);
      if (typeof s.focus === 'number') ids.add(s.focus);
    }
    return ids;
  }

  /**
   * Projects whose local folder is known and still on disk; the open
   * repository is always one of them.
   */
  localProjects(): number[] {
    const ids = new Set(
      this.projects.localProjectIds().filter(id => {
        const path = this.projects.localPath(id);
        return !!path && existsSync(path);
      }),
    );
    if (this.projects.currentProjectId !== null) {
      ids.add(this.projects.currentProjectId);
    }
    return [...ids];
  }

  refreshCommitStates() {
    return refreshCommitStates(this);
  }

  refreshRemoteCommit(id: number, force = false) {
    return refreshRemoteCommit(this, id, force);
  }

  /** Called once the terms have just been accepted, to start the usage reports. */
  onTermsAccepted?: () => void;

  get termsAccepted(): boolean {
    return termsAccepted(this.context.globalState);
  }

  async acceptTerms(): Promise<void> {
    await acceptTerms(this.context.globalState);
    this.pushState();
    this.onTermsAccepted?.();
  }

  // Both sign-in entry points (page and commands) are closed until the terms are accepted.
  signIn() {
    if (!this.termsAccepted) return this.pushState();
    return signIn(this);
  }

  signInMicrosoft(opts: { paste?: boolean } = {}) {
    if (!this.termsAccepted) return this.pushState();
    return signInMicrosoft(this, opts);
  }

  submitRedirect(input: string) {
    return submitRedirect(this, input);
  }

  cancelSignIn() {
    cancelSignIn(this);
  }

  signOut() {
    return signOut(this);
  }

  refresh() {
    return refresh(this);
  }

  openProject(projectId: number, tab?: PanelTab) {
    openProject(this, projectId, tab);
  }

  openCurrentProject() {
    openCurrentProject(this);
  }

  runGrader(
    projectId?: number,
    checked?: { root: string; fingerprint: string; generated: string[] },
  ): Promise<boolean> {
    return runGrader(this, projectId, checked);
  }

  checkReadiness(projectId?: number) {
    return checkReadiness(this, projectId);
  }

  guidedDelivery(projectId?: number, milestone?: Milestone) {
    return guidedDelivery(this, projectId, milestone);
  }

  cloneProject(projectId?: number) {
    return cloneProject(this, projectId);
  }

  openFolder(projectId: number) {
    return openFolder(this, projectId);
  }

  openSubjectCommand() {
    return openSubjectCommand(this);
  }

  openOnIntranet() {
    return openOnIntranet(this);
  }

  projectRules(file: string): ProjectRules | undefined {
    return projectRules(this, file);
  }

  abortBrowser() {
    return abortBrowser(this);
  }

  silentBrowserLogin() {
    return silentBrowserLogin(this);
  }

  browserProfile(executable: string) {
    return browserProfile(this, executable);
  }

  signInWithBrowser(executable: string) {
    return signInWithBrowser(this, executable);
  }

  signInWithPaste() {
    return signInWithPaste(this);
  }

  failSignIn(message: string) {
    return failSignIn(this, message);
  }

  clearDelivery() {
    return clearDelivery(this);
  }

  pushDelivery(id: number, only?: Surface) {
    return pushDelivery(this, id, only);
  }

  invalidateDelivery(uri: vscode.Uri) {
    return invalidateDelivery(this, uri);
  }

  functionScope() {
    return functionScope(this);
  }

  customFunctions(id: number) {
    return customFunctions(this, id);
  }

  watchLocal(project: ProjectVM) {
    return watchLocal(this, project);
  }

  loadComparisonFiles(
    surface: Surface,
    id: number,
    before: number,
    after: number,
  ) {
    return loadComparisonFiles(this, surface, id, before, after);
  }

  reproduce(projectId: number, resultId: number, task: string, edit: boolean) {
    return reproduce(this, projectId, resultId, task, edit);
  }

  compareCommits(id: number, before: number, after: number) {
    return compareCommits(this, id, before, after);
  }

  showChanges(
    root: string,
    before?: string,
    after?: string,
    generated: string[] = [],
  ) {
    return showChanges(this, root, before, after, generated);
  }

  loadResult(surface: Surface, projectId: number, resultId: number) {
    return loadResult(this, surface, projectId, resultId);
  }

  loadAvatars(logins: unknown, surface: Surface) {
    return loadAvatars(this, logins, surface);
  }

  localRoot(project: ProjectVM) {
    return localRoot(this, project);
  }

  localGitState(project: ProjectVM) {
    return localGitState(this, project);
  }

  afterClone(name: string, folder: string) {
    return afterClone(this, name, folder);
  }

  loadSubject(surface: Surface, projectId: number, docId?: string) {
    return loadSubject(this, surface, projectId, docId);
  }

  pickSubject(surface: Surface, projectId: number) {
    return pickSubject(this, surface, projectId);
  }

  rememberCurrentFolder() {
    return rememberCurrentFolder(this);
  }

  onProjectsChanged() {
    return onProjectsChanged(this);
  }

  pushActivities(projectId: number, only?: Surface) {
    return pushActivities(this, projectId, only);
  }

  refreshActivities() {
    return refreshActivities(this);
  }

  updateDefenseReminders() {
    return updateDefenseReminders(this);
  }

  checkDeadlines() {
    return checkDeadlines(this);
  }

  notifyDeadline(project: ProjectVM, hours: number) {
    return notifyDeadline(this, project, hours);
  }

  updateStatusBar() {
    return updateStatusBar(this);
  }

  onValgrind(root: string, run: ValgrindVM) {
    return onValgrind(this, root, run);
  }

  pushValgrind(projectId: number, only?: Surface) {
    return pushValgrind(this, projectId, only);
  }

  pushStyle(projectId: number, only?: Surface) {
    return pushStyle(this, projectId, only);
  }

  locateStyle(project: ProjectVM, source: 'manual' | 'grader') {
    return locateStyle(this, project, source);
  }

  maybeLocateStyle(projectId: number) {
    return maybeLocateStyle(this, projectId);
  }

  preflight(project: ProjectVM) {
    return preflight(this, project);
  }

  revealFirstIssue(root: string, scan: StyleScanVM) {
    return revealFirstIssue(this, root, scan);
  }

  openProjectFile(
    projectId: number,
    file: unknown,
    line: unknown,
    column: unknown,
    task?: string,
  ) {
    return openProjectFile(this, projectId, file, line, column, task);
  }

  openFileAt(root: string, file: string, line: number, column: number) {
    return openFileAt(root, file, line, column);
  }

  dispose(): void {
    clearTimeout(this.pushTimer);
    clearInterval(this.commitTimer);
    clearInterval(this.deadlineTimer);
    clearDelivery(this);
    this.panels.closeAll();
    this.disposables.forEach((d) => d.dispose());
  }
}
