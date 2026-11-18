import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { fresh, inBackground } from '../api/requestGuard';
import { deliveryGitState } from '../delivery/git';
import { repoFolderName } from '../domain/projects';
import {
  parseRemote,
  sameRepo,
  toCloneUrl,
  type GitWorktreeState,
} from '../domain/git';
import { gitClone, readGitState, readRemotes } from '../git/repoDetector';
import type { PanelTab } from '../shared/protocol';
import type { ProjectVM } from '../shared/types';
import * as prompts from '../ui/prompts';
import { config } from '../util/config';
import { remoteFeatures } from '../services/remoteFeatures';
import type { Controller, Surface } from '../controller';
import { tr } from '../util/text';

export async function localRoot(
  c: Controller,
  project: ProjectVM,
): Promise<string | undefined> {
  const remembered = c.projects.localPath(project.id);
  if (remembered && existsSync(remembered)) return remembered;

  const remote = project.repoLink ? parseRemote(project.repoLink) : null;
  if (!remote) return undefined;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    const remotes = await readRemotes(folder.uri.fsPath);
    const matches = remotes.some((r) => {
      const ref = parseRemote(r);
      return ref !== null && sameRepo(ref, remote);
    });
    if (matches) return folder.uri.fsPath;
  }
  return undefined;
}

export async function localGitState(
  c: Controller,
  project: ProjectVM,
): Promise<GitWorktreeState | undefined> {
  const root = await c.localRoot(project);
  return root ? readGitState(root) : undefined;
}

export async function cloneProject(c: Controller, projectId?: number) {
  let project: ProjectVM | undefined = projectId !== undefined
    ? c.projects.get(projectId)
    : c.projects.current;
  if (!project) {
    const pick = await vscode.window.showQuickPick(
      (c.projects.projects ?? [])
        .filter((p) => p.repoEnabled || p.repoLink)
        .map((p) => ({ label: p.name, description: p.unitName, project: p })),
      { title: tr('Clone the repository of…') },
    );
    project = pick?.project;
  }
  if (!project) return;
  if (!project.repoLink) {
    project = await c.projects.resolveResources(project.id);
    if (!project) return;
  }
  if (!project.repoLink) {
    const choice = await vscode.window.showWarningMessage(
      tr('Bananabox: the repository URL of “{name}” is not known yet. The project data did not provide a repository URL. Open the project page to find it.', { name: project.name }),
      tr('Open on my.epitech.eu'),
    );
    if (choice) {
      await vscode.env.openExternal(vscode.Uri.parse(project.intranetUrl));
    }
    return;
  }

  const existing = c.projects.localPath(project.id);
  if (existing && existsSync(existing)) {
    const answer = await prompts.alreadyCloned(project.name, existing);
    if (answer === 'open') return c.afterClone(project.name, existing);
    if (answer !== 'again') return;
  }

  const startDir = config.defaultCloneDirectory() || homedir();
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(startDir),
    openLabel: tr('Clone here'),
    title: tr('Choose the folder to clone “{name}” into', { name: project.name }),
  });
  if (!parent?.[0]) return;

  const remote = parseRemote(project.repoLink);
  let target = '';
  for (;;) {
    const folderName = await vscode.window.showInputBox({
      title: tr('Bananabox · Folder name'),
      value: repoFolderName(project.repoLink),
      prompt: tr('The repository will be cloned into {path}', { path: parent[0].fsPath }),
      validateInput: (v) =>
        !v.trim() || /^\.{1,2}$/.test(v.trim()) || /[\\/:*?"<>|]/.test(v)
          ? tr('Invalid folder name.')
          : undefined,
    });
    if (!folderName) return;

    target = join(parent[0].fsPath, folderName.trim());
    if (
      !existsSync(target) ||
      (statSync(target).isDirectory() && readdirSync(target).length === 0)
    ) {
      break;
    }
    const holdsSameRepo = Boolean(remote) && (await readRemotes(target)).some(
      (r) => {
        const ref = parseRemote(r);
        return ref !== null && remote !== null && sameRepo(ref, remote);
      },
    );
    const answer = await prompts.targetExists(
      folderName.trim(),
      target,
      holdsSameRepo,
    );
    if (answer === 'open') {
      await c.projects.rememberLocalPath(project.id, target);
      return c.afterClone(project.name, target);
    }
    if (answer !== 'rename') return;
  }

  const url = toCloneUrl(project.repoLink, config.cloneProtocol());
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: tr('Cloning {p0}', { p0: project.name }),
        cancellable: false,
      },
      async (progress) => {
        await gitClone(url, target, (line) =>
          progress.report({ message: line }),
        );
      },
    );
  } catch (e) {
    void vscode.window.showErrorMessage(`Bananabox: ${(e as Error).message}`);
    return;
  }
  await c.projects.rememberLocalPath(project.id, target);
  await c.afterClone(project.name, target);
}

/**
 * Opens a cloned (or already present) folder according to `epibox.afterClone`,
 * asking in a modal by default.
 */
export async function afterClone(c: Controller, name: string, folder: string) {
  const hasFolders = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const setting = config.afterClone();
  const action = setting === 'ask'
    ? await prompts.afterClone(name, folder, hasFolders)
    : setting;
  const uri = vscode.Uri.file(folder);

  if (action === 'current' || (action === 'workspace' && !hasFolders)) {
    await vscode.commands.executeCommand('vscode.openFolder', uri, {
      forceNewWindow: false,
    });
  } else if (action === 'window') {
    await vscode.commands.executeCommand('vscode.openFolder', uri, {
      forceNewWindow: true,
    });
  } else if (action === 'workspace') {
    vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders?.length ?? 0,
      0,
      { uri },
    );
  }
}

export async function openFolder(c: Controller, projectId: number) {
  const path = c.projects.localPath(projectId);
  if (path && existsSync(path)) {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(path),
      { forceNewWindow: false },
    );
    return;
  }
  await c.cloneProject(projectId);
}

export async function openOnIntranet(c: Controller) {
  const p = c.projects.current;
  if (p) await vscode.env.openExternal(vscode.Uri.parse(p.intranetUrl));
}

export function openProject(
  c: Controller,
  projectId: number,
  tab?: PanelTab,
): void {
  const project = c.projects.get(projectId);
  if (!project) return;
  c.panels.show(projectId, project.name, tab);
}

export function openCurrentProject(c: Controller): void {
  const current = c.projects.current;
  if (!current) {
    void vscode.window.showInformationMessage(
      tr('Bananabox: the opened folder is not a known project repository.'),
    );
    return;
  }
  c.openProject(current.id);
}

export async function openSubjectCommand(c: Controller) {
  const p = c.projects.current;
  if (!p) return c.openCurrentProject();
  c.panels.show(p.id, p.name, 'subject');
}

export async function loadSubject(
  c: Controller,
  surface: Surface,
  projectId: number,
  docId?: string,
) {
  const project = c.projects.get(projectId);
  if (!project) return;

  c.post(
    { type: 'subject', projectId, subject: { status: 'loading' } },
    surface,
  );
  const token = c.auth.accessToken;
  const subject = await c.subject.load(project, docId);
  if (c.auth.isSignedIn && token === c.auth.accessToken) {
    c.post({ type: 'subject', projectId, subject }, surface);
  }
}

export async function pickSubject(
  c: Controller,
  surface: Surface,
  projectId: number,
) {
  const project = c.projects.get(projectId);
  if (!project) return;

  const token = c.auth.accessToken;
  const state = await c.subject.pickLocal(project);
  if (state && c.auth.isSignedIn && token === c.auth.accessToken) {
    c.post({ type: 'subject', projectId, subject: state });
  }
}

/**
 * A repository opened in VS Code becomes a known local folder, so "Open" can
 * reopen it later from anywhere.
 */
export async function rememberCurrentFolder(c: Controller) {
  const current = c.projects.current;
  if (!current) return;

  const known = c.projects.localPath(current.id);
  if (known && existsSync(known)) return;
  const root = await c.localRoot(current);
  if (root) {
    await c.projects.rememberLocalPath(current.id, root);
    c.schedulePush();
  }
}

export function onProjectsChanged(c: Controller): void {
  void c.rememberCurrentFolder();
  void c.refreshActivities();
  c.updateDefenseReminders();
  c.updateStatusBar();
  c.checkDeadlines();

  const current = c.projects.current;
  if (!current) return;
  void c.grader.ensure(current, 60_000);
  if (c.auth.isSignedIn) {
    void c.subjectFunctions
      .ensure(c.functionScope(), current)
      .catch(() => undefined);
  }
  if (config.autoOpenInEditor() && !c.autoOpened.has(current.id)) {
    c.autoOpened.add(current.id);
    c.openProject(current.id);
  }
}

export async function refresh(c: Controller) {
  if (!remoteFeatures.status.myApiActive) {
    c.pushState();
    return;
  }
  if (!c.auth.isSignedIn) return;

  await fresh(async () => {
    await c.projects.refresh();
    await c.refreshCommitStates();
    for (const id of c.watched()) {
      const p = c.projects.get(id);
      if (p) {
        void c.grader.load(p);
        void c.activities.load(p.id);
      }
    }
  });
}

export async function refreshCommitStates(c: Controller) {
  if (c.checkingCommits || !c.auth.isSignedIn) return;
  c.checkingCommits = true;
  try {
    for (const id of c.commitProjects) {
      const project = c.projects.get(id);
      if (project && c.watched().has(id)) {
        void inBackground(() => c.refreshRemoteCommit(id));
      }
      const local = project
        ? await c.commits
          .state(project, c.projects.localPath(id))
          .catch(() => undefined)
        : undefined;
      const root = project && await c.localRoot(project);
      const git = root
        ? await deliveryGitState(
          root,
          c.readiness.get(id)?.generatedOutputs ?? [],
        )
        : undefined;
      const state = local
        ? {
          ...local,
          dirty: git ? git.dirty > 0 : local.dirty,
          ahead: git?.ahead,
          hasUpstream: git?.hasUpstream,
          dirtyCount: git?.dirty,
        }
        : undefined;
      if (!c.auth.isSignedIn) return;
      if (
        JSON.stringify(c.commitStates[id]) !== JSON.stringify(state ?? null)
      ) {
        c.commitStates[id] = state ?? null;
        c.schedulePush();
      }
    }
  } finally {
    c.checkingCommits = false;
  }
}
