import { readFile } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import * as vscode from 'vscode';
import { fresh } from '../api/requestGuard';
import type { ProjectRules } from '../codingStyle/api';
import { configureRecipe } from '../delivery/configure';
import { discoverPlan, inferRecipe } from '../delivery/discovery';
import {
  changes,
  deliveryGitState,
  diffText,
  safeProjectPath,
  snapshot,
} from '../delivery/git';
import { effectiveFunctions } from '../domain/functionRules';
import { parseRemote } from '../domain/git';
import { gitBytes, validCommit } from '../git/commitData';
import { remoteChangedFiles } from '../git/github';
import { gitPush } from '../git/repoDetector';
import type { DeliveryStep } from '../shared/deliveryTypes';
import { milestoneChecks, type Milestone } from '../domain/milestones';
import { createT } from '../shared/i18n';
import type { ProjectVM } from '../shared/types';
import * as prompts from '../ui/prompts';
import { config } from '../util/config';
import type { Controller, Surface } from '../controller';

export function clearDelivery(c: Controller): void {
  c.readiness.clear();
  c.reproduction.clear();
  c.guided.clear();
  c.subjectFunctions.clear();
  c.localWatchers.forEach(w => w.dispose());
  c.localWatchers.clear();
  c.deliveryRoots.clear();
}

export function pushDelivery(c: Controller, id: number, only?: Surface): void {
  c.post(
    {
      type: 'graderCommand',
      projectId: id,
      command: c.graderCommand.get(c.functionScope(), id),
    },
    only,
  );
  c.post(
    {
      type: 'functionRules',
      projectId: id,
      names: c.customFunctions(id),
      subject: c.subjectFunctions.get(c.functionScope(), id),
      disabled: c.functionRules.disabled(c.functionScope(), id),
    },
    only,
  );
  c.post(
    {
      type: 'readiness',
      projectId: id,
      readiness: c.readiness.get(id) ?? null,
    },
    only,
  );
  c.post(
    {
      type: 'reproduction',
      projectId: id,
      reproduction: c.reproduction.get(id) ?? null,
    },
    only,
  );
  c.post(
    { type: 'guided', projectId: id, guided: c.guided.get(id) ?? null },
    only,
  );
}

export function invalidateDelivery(c: Controller, uri: vscode.Uri): void {
  for (const id of c.localWatchers.keys()) {
    const root = c.deliveryRoots.get(id);
    if (
      root &&
      (uri.fsPath === root ||
        uri.fsPath.startsWith(`${root}/`) ||
        uri.fsPath.startsWith(`${root}\\`))
    ) {
      c.readiness.invalidate(id);
    }
  }
}

export function functionScope(c: Controller) {
  return `${config.apiBaseUrl()}|${c.auth.snapshot.login ?? ''}`;
}

export function customFunctions(c: Controller, id: number) {
  return c.functionRules.get(c.functionScope(), id);
}

/**
 * The subject's requirements for the project whose local copy holds `file`
 * (allowed functions, Makefile rules), for the coding style lens. Reading the
 * subject starts here when it never was.
 */
export function projectRules(
  c: Controller,
  file: string,
): ProjectRules | undefined {
  if (!c.auth.isSignedIn) return undefined;

  let best: { id: number; root: string } | undefined;
  for (const id of c.projects.localProjectIds()) {
    const root = c.projects.localPath(id);
    if (!root) continue;
    const rel = relative(root, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    if (!best || root.length > best.root.length) best = { id, root };
  }

  const project = best && c.projects.get(best.id);
  if (!best || !project) return undefined;

  const scope = c.functionScope();
  const subject = c.subjectFunctions.get(scope, best.id);
  if (subject.status !== 'reading' && (!subject.makefile || !subject.forbidden)) {
    void c.subjectFunctions.ensure(scope, project).catch(() => undefined);
  }
  const allowedFunctions = (subject.names.length || subject.forbidden?.length)
    && !c.functionRules.disabled(scope, best.id)
    ? effectiveFunctions(subject, customFunctions(c, best.id))
    : undefined;
  return {
    root: best.root,
    allowedFunctions,
    makefile: subject.makefile,
    source: subject.doc,
  };
}

export async function watchLocal(c: Controller, project: ProjectVM) {
  if (c.localWatchers.has(project.id)) return;

  const session = c.auth.accessToken;
  const root = await c.localRoot(project);
  if (
    !root ||
    session !== c.auth.accessToken ||
    c.localWatchers.has(project.id)
  ) {
    return;
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, '**/*'),
  );
  c.deliveryRoots.set(project.id, root);
  const changed = async (uri: vscode.Uri) => {
    if (
      uri.fsPath.includes('/.git/') ||
      uri.fsPath.includes('\\.git\\')
    ) {
      return;
    }
    if (
      c.readiness.get(project.id)?.generatedOutputs?.includes(
        relative(root, uri.fsPath).split('\\').join('/'),
      )
    ) {
      return;
    }
    if (c.readiness.get(project.id)?.status === 'running') return;

    try {
      await gitBytes(root, ['check-ignore', '--', uri.fsPath]);
      return;
    } catch {}
    if (c.readiness.get(project.id)?.status !== 'running') {
      c.readiness.invalidate(project.id);
    }
  };
  const subscriptions = [
    watcher,
    watcher.onDidChange(changed),
    watcher.onDidCreate(changed),
    watcher.onDidDelete(changed),
  ];
  c.localWatchers.set(project.id, {
    dispose: () => subscriptions.forEach(s => s.dispose()),
  });
}

export async function checkReadiness(c: Controller, projectId?: number) {
  const project = projectId === undefined
    ? c.projects.current
    : c.projects.get(projectId);
  if (!project) return null;

  const root = await c.localRoot(project);
  if (!root) {
    c.toast('warn', createT(config.language())('style.noLocalCopy'));
    return null;
  }
  await c.watchLocal(project);
  if (!(await vscode.workspace.saveAll(false))) return null;

  const latest = c.grader.get(project.id)?.history?.at(-1);
  const report = latest
    ? await c.grader.detail(latest.id).catch(() => undefined)
    : undefined;
  const scope = c.functionScope();
  const custom = c.customFunctions(project.id);
  const allowed = c.functionRules.disabled(scope, project.id)
    ? null
    : c.subjectFunctions.ensure(scope, project).then(
      s => effectiveFunctions(s, custom),
      () => custom,
    );
  return c.readiness.check(
    project.id,
    root,
    undefined,
    report,
    allowed,
    c.graderCommand.get(scope, project.id),
  );
}

export async function loadComparisonFiles(
  c: Controller,
  surface: Surface,
  id: number,
  before: number,
  after: number,
) {
  const history = c.grader.get(id)?.history;
  const a = history?.find(r => r.id === before);
  const b = history?.find(r => r.id === after);
  if (!a || !b) return;

  const session = c.auth.accessToken;
  let files: string[] | null = null;
  const project = c.projects.get(id);
  const root = project && await c.localRoot(project);
  if (validCommit(a.commit) && validCommit(b.commit)) {
    if (root) {
      try {
        const diff = await gitBytes(root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--name-only',
          '-z',
          a.commit,
          b.commit,
          '--',
        ]);
        files = diff.toString().split('\0').filter(Boolean);
      } catch {}
    }
    if (files === null && project?.repoLink) {
      files = await remoteChangedFiles(project.repoLink, a.commit, b.commit)
        .catch(() => null);
    }
  }
  if (session === c.auth.accessToken && c.auth.isSignedIn) {
    c.post(
      { type: 'comparisonFiles', projectId: id, before, after, files },
      surface,
    );
  }
}

export async function reproduce(
  c: Controller,
  projectId: number,
  resultId: number,
  task: string,
  edit: boolean,
) {
  if (
    typeof task !== 'string' ||
    !Number.isSafeInteger(resultId) ||
    !c.grader.get(projectId)?.history.some(r => r.id === resultId)
  ) {
    return;
  }
  const session = c.auth.accessToken;
  const detail = await c.grader.detail(resultId);
  if (!detail.tasks.some(t => t.name === task)) return;

  const project = c.projects.get(projectId);
  const root = project && await c.localRoot(project);
  const t = createT(config.language());
  if (!root) {
    c.toast('warn', t('style.noLocalCopy'));
    return;
  }

  let plan = await discoverPlan(root, detail);
  let inferred = await inferRecipe(
    root,
    detail.tasks.find(t => t.name === task)!,
    plan,
  );
  if (edit || !inferred) {
    if (!(await configureRecipe(root, task, t))) return;
    if (edit) return;

    plan = await discoverPlan(root, detail);
    inferred = await inferRecipe(
      root,
      detail.tasks.find(t => t.name === task)!,
      plan,
    );
  }
  if (
    !inferred ||
    !c.auth.isSignedIn ||
    session !== c.auth.accessToken ||
    !(await vscode.workspace.saveAll(false))
  ) {
    return;
  }

  await c.reproduction.run(
    projectId,
    root,
    resultId,
    task,
    inferred.recipe,
    inferred.mode === 'build' ? undefined : plan.config.build,
    inferred.mode,
    inferred.detected,
  );
  const location =
    /(?:^|\s)((?:[\w.-]+\/)*[\w.-]+\.(?:c|h|cpp)):(\d+)(?::(\d+))?/.exec(
      detail.tasks.find(t => t.name === task)?.trace ?? '',
    );
  if (location) {
    await c.openFileAt(
      root,
      location[1],
      Number(location[2]),
      Number(location[3] ?? 1),
    );
  }
}

export async function compareCommits(
  c: Controller,
  id: number,
  before: number,
  after: number,
) {
  const history = c.grader.get(id)?.history;
  const a = history?.find(r => r.id === before);
  const b = history?.find(r => r.id === after);
  if (
    !a?.commit ||
    !b?.commit ||
    !validCommit(a.commit) ||
    !validCommit(b.commit)
  ) {
    return;
  }

  const p = c.projects.get(id);
  const root = p && await c.localRoot(p);
  if (root) {
    try {
      await c.showChanges(root, a.commit, b.commit);
      return;
    } catch {}
  }

  const remote = p?.repoLink ? parseRemote(p.repoLink) : null;
  if (remote?.host === 'github.com') {
    await vscode.env.openExternal(
      vscode.Uri.parse(
        `https://github.com/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}/compare/${a.commit}...${b.commit}`,
      ),
    );
  } else {
    c.toast('warn', createT(config.language())('compare.noDiff'));
  }
}

export async function showChanges(
  c: Controller,
  root: string,
  before?: string,
  after?: string,
  generated: string[] = [],
) {
  let text = await diffText(root, before, after);
  if (!before) {
    const listing = await gitBytes(root, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    const untracked = listing.toString().split('\0').filter(Boolean);
    for (const file of untracked) {
      if (generated.includes(file)) continue;
      const data = await readFile(await safeProjectPath(root, file));
      text += `\n+++ ${file}\n${data.includes(0) ? '[binary]' : data.toString('utf8').slice(0, 100_000).split('\n').map(l => `+${l}`).join('\n')}\n`;
    }
  }
  const doc = await vscode.workspace.openTextDocument({
    language: 'diff',
    content: text || createT(config.language())('delivery.noChanges'),
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function guidedDelivery(c: Controller, projectId?: number, milestone: Milestone = 'delivery') {
  const project = projectId === undefined
    ? c.projects.current
    : c.projects.get(projectId);
  if (!project) return;

  const t = createT(config.language());
  const session = c.auth.accessToken;
  if (!vscode.workspace.isTrusted) {
    c.toast('warn', t('delivery.trust'));
    return;
  }
  const root = await c.localRoot(project);
  if (!root) {
    c.toast('warn', t('style.noLocalCopy'));
    return;
  }

  let verified: string | undefined;
  let generated: string[] = [];
  const valid = () =>
    c.auth.isSignedIn &&
    session === c.auth.accessToken &&
    c.guided.get(project.id)?.status !== 'paused';
  await c.guided.start(project.id, {
    valid,
    execute: async (step: DeliveryStep) => {
      if (!valid()) return false;
      if (step === 'save') return vscode.workspace.saveAll(false);

      if (step === 'check') {
        const vm = await c.checkReadiness(project.id);
        if (!vm || vm.status !== 'done' || vm.stale) return false;

        const failures = milestoneChecks(milestone, vm.checks, vm, {
          c: vm.c ?? true,
          disabled: config.disabledChecks()[milestone],
        }, t).filter(ch => ch.status === 'fail' && ch.id !== 'git');
        const style = c.style.get(project.id);
        if (failures.some(ch => ch.id === 'style') && style) {
          const decision = await prompts.styleGate({
            name: project.name,
            ...style,
          });
          if (decision !== 'ignore') {
            if (decision === 'fix') await c.revealFirstIssue(root, style);
            return false;
          }
        }
        if (failures.some(ch => ch.id !== 'style')) {
          c.toast('warn', t('delivery.fixFirst'));
          return false;
        }

        generated = vm.generatedOutputs ?? [];
        verified = (await snapshot(root, generated)).fingerprint;
        return valid();
      }

      if (
        verified !== (await snapshot(root, generated)).fingerprint ||
        vscode.workspace.textDocuments.some(
          d => d.isDirty && d.uri.fsPath.startsWith(`${root}/`),
        )
      ) {
        c.readiness.invalidate(project.id);
        c.toast('warn', t('delivery.changed'));
        return false;
      }

      if (step === 'review') {
        const files = await changes(root, generated);
        if (!files.length) return true;

        const review = t('delivery.viewChanges');
        const next = t('delivery.continue');
        let choice = await vscode.window.showInformationMessage(
          t('delivery.reviewTitle'),
          review,
          next,
        );
        while (choice === review) {
          await c.showChanges(root, undefined, undefined, generated);
          choice = await vscode.window.showInformationMessage(
            t('delivery.reviewTitle'),
            next,
          );
        }
        return choice === next;
      }

      if (step === 'commit') {
        const files = await changes(root, generated);
        if (!files.length) return true;

        const selected = await vscode.window.showQuickPick(
          files.map(file => ({ label: file, picked: true })),
          {
            canPickMany: true,
            title: t('delivery.pickFiles'),
            placeHolder: t('delivery.pickFilesHint'),
          },
        );
        if (!selected?.length) return false;

        const message = await vscode.window.showInputBox({
          title: t('delivery.commitMessage'),
          prompt: t('delivery.commitPrompt', { n: selected.length }),
          value: t('delivery.defaultCommit', { name: project.name }),
          validateInput: v =>
            v.trim() ? undefined : t('delivery.messageRequired'),
        });
        if (message === undefined) return false;
        if (!valid()) return false;
        if (verified !== (await snapshot(root, generated)).fingerprint) {
          c.readiness.invalidate(project.id);
          return false;
        }

        await gitBytes(root, [
          '--literal-pathspecs',
          'add',
          '--',
          ...selected.map(f => f.label),
        ]);
        await gitBytes(root, [
          '--literal-pathspecs',
          'commit',
          '--only',
          '-m',
          message,
          '--',
          ...selected.map(f => f.label),
        ]);

        const git = await deliveryGitState(root, generated);
        if (git?.dirty) {
          c.toast('warn', t('delivery.remainingChanges'));
          return false;
        }
        return true;
      }

      if (step === 'push') {
        const git = await deliveryGitState(root, generated);
        if (!git || git.dirty) {
          c.toast('warn', t('delivery.remainingChanges'));
          return false;
        }
        if (git.hasUpstream && git.ahead === 0) return true;

        const push = t('delivery.push');
        let remote: string | undefined;
        if (!git.hasUpstream) {
          const names = (await gitBytes(root, ['remote']))
            .toString()
            .trim()
            .split('\n')
            .filter(Boolean);
          remote = await vscode.window.showQuickPick(names, {
            title: t('delivery.pickRemote'),
          });
          if (!remote || !git.branch) return false;
        }
        if (
          await vscode.window.showInformationMessage(
            t('delivery.pushTitle'),
            {
              modal: true,
              detail: `${project.name} · ${git.branch ?? ''}${remote ? ` → ${remote}` : ''}`,
            },
            push,
          ) !== push ||
          !valid()
        ) {
          return false;
        }

        if (remote) {
          await gitBytes(root, [
            'push',
            '--set-upstream',
            '--',
            remote,
            git.branch!,
          ]);
        } else {
          await gitPush(root);
        }
        return true;
      }

      const state = await deliveryGitState(root, generated);
      if (!state?.hasUpstream || state.dirty || state.ahead) return false;
      if (milestone !== 'delivery') return true;

      await fresh(() => c.grader.load(project));
      const grader = c.grader.get(project.id);
      if (
        !grader?.canRun ||
        grader.running ||
        (grader.quota?.remaining ?? 0) <= 0
      ) {
        c.toast('warn', t('delivery.graderUnavailable'));
        return false;
      }

      const run = t('grader.run');
      const unknown =
        c.readiness
          .get(project.id)
          ?.checks.filter(ch => ch.status === 'unknown') ?? [];
      const detail = [
        t('run.tokens', {
          left: grader.quota!.remaining,
          total: grader.quota!.total,
        }),
        unknown.length
          ? t('delivery.finalUnchecked', {
            checks: unknown.map(ch => t(`delivery.check.${ch.id}`)).join(', '),
          })
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const choice = await vscode.window.showWarningMessage(
        t('delivery.finalTitle'),
        { modal: true, detail },
        run,
      );
      if (
        choice !== run ||
        !valid() ||
        verified !== (await snapshot(root, generated)).fingerprint
      ) {
        return false;
      }
      return c.runGrader(project.id, {
        root,
        fingerprint: verified!,
        generated,
      });
    },
  });

  await c.refreshCommitStates();
}
