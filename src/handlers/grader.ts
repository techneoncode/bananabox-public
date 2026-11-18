import * as vscode from 'vscode';
import { fresh } from '../api/requestGuard';
import { deliveryGitState, snapshot } from '../delivery/git';
import { gitPush } from '../git/repoDetector';
import { describe } from '../services/graderService';
import { createT } from '../shared/i18n';
import * as prompts from '../ui/prompts';
import { config } from '../util/config';
import type { Controller, Surface } from '../controller';
import { tr } from '../util/text';

/**
 * Runs the grader on a project, after pre-flight checks and confirmation.
 * Resolves `true` when the run was requested.
 */
export async function runGrader(
  c: Controller,
  projectId?: number,
  checked?: { root: string; fingerprint: string; generated: string[] },
): Promise<boolean> {
  let project = projectId !== undefined
    ? c.projects.get(projectId)
    : c.projects.current;
  if (!project) {
    const candidates = (c.projects.projects ?? []).filter(
      (p) => p.registered && p.repoEnabled && p.status === 'ongoing',
    );
    const pick = await vscode.window.showQuickPick(
      candidates.map((p) => ({
        label: p.name,
        description: p.unitName,
        project: p,
      })),
      { title: tr('Run the grader on…'), placeHolder: tr('Choose a project') },
    );
    project = pick?.project;
  }
  if (!project) return false;
  if (c.preparingGrader.has(project.id)) return false;
  c.preparingGrader.add(project.id);

  const sessionToken = c.auth.accessToken;
  try {
    project = await c.projects.resolveResources(project.id) ?? project;
    if (!c.auth.isSignedIn || c.auth.accessToken !== sessionToken) return false;

    const target = project;
    await fresh(() => c.grader.load(target));
    if (!c.grader.get(project.id)?.canRun) {
      c.toast(
        'warn',
        createT(config.language())(`grader.reason.${c.grader.get(project.id)?.reason}`),
      );
      return false;
    }
    if (!c.auth.isSignedIn || c.auth.accessToken !== sessionToken) return false;
    if (
      c.grader.get(project.id)?.running ||
      (c.grader.get(project.id)?.quota?.remaining ?? 1) <= 0
    ) {
      return false;
    }
    if (!checked && !(await c.preflight(project))) return false;
    if (!c.auth.isSignedIn || c.auth.accessToken !== sessionToken) return false;

    const quota = c.grader.get(project.id)?.quota;
    let decision: 'run' | 'runAlways' | 'push' | undefined = checked
      ? 'run'
      : await prompts.confirmGraderRun({
        name: project.name,
        remaining: quota?.remaining,
        total: quota?.total,
        git: await c.localGitState(project),
      });
    while (decision === 'push') {
      if (!c.auth.isSignedIn || c.auth.accessToken !== sessionToken) {
        return false;
      }
      const root = await c.localRoot(project);
      if (!root) return false;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: createT(config.language())('run.pushing'),
        },
        () => gitPush(root),
      );
      decision = await prompts.confirmGraderRun({
        name: project.name,
        remaining: quota?.remaining,
        total: quota?.total,
        git: await c.localGitState(project),
      });
    }
    if (!decision) return false;
    if (decision === 'runAlways') void config.disableGraderConfirmation();
    if (!c.auth.isSignedIn || c.auth.accessToken !== sessionToken) return false;

    if (checked) {
      const git = await deliveryGitState(checked.root, checked.generated);
      if (
        checked.fingerprint !==
          (await snapshot(checked.root, checked.generated)).fingerprint ||
        !git?.hasUpstream ||
        git.dirty ||
        git.ahead
      ) {
        c.readiness.invalidate(project.id);
        c.toast('warn', createT(config.language())('delivery.changed'));
        return false;
      }
    }

    await c.refreshRemoteCommit(project.id, true);
    if (!c.auth.isSignedIn || c.auth.accessToken !== sessionToken) return false;
    await c.grader.run(project);
    c.toast('info', createT(config.language())('delivery.requested'));
    return true;
  } catch (e) {
    const msg = describe(e);
    c.toast('error', msg);
    void vscode.window.showErrorMessage(`Bananabox: ${msg}`);
    return false;
  } finally {
    c.preparingGrader.delete(project.id);
  }
}

export async function loadResult(
  c: Controller,
  surface: Surface,
  projectId: number,
  resultId: number,
) {
  try {
    if (
      !c.grader.get(projectId)?.history.some((r) => r.id === resultId)
    ) {
      return;
    }
    const detail = await c.grader.detail(resultId);
    c.post(
      { type: 'result', projectId, resultId, detail, error: null },
      surface,
    );
  } catch (e) {
    c.post(
      { type: 'result', projectId, resultId, detail: null, error: describe(e) },
      surface,
    );
  }
}

export async function refreshRemoteCommit(
  c: Controller,
  id: number,
  force = false,
) {
  const project = c.projects.get(id);
  if (!project) return;

  const previous = c.grader.get(id)?.remoteCommit;
  if (
    !force &&
    previous?.checkedAt &&
    Date.now() - previous.checkedAt < 90_000
  ) {
    return;
  }
  await (force
    ? fresh(() => c.grader.load(project))
    : c.grader.ensure(project, 90_000));
}
