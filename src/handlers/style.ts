import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as vscode from 'vscode';
import { blockingCount, resolveInside } from '../domain/styleScan';
import { createT } from '../shared/i18n';
import type { ProjectVM, StyleScanVM, ValgrindVM } from '../shared/types';
import * as prompts from '../ui/prompts';
import { config } from '../util/config';
import { resolveLogFile } from '../delivery/logFiles';
import type { Controller, Surface } from '../controller';

export function onValgrind(c: Controller, root: string, run: ValgrindVM): void {
  const ids = new Set(
    [...c.projects.localProjectIds()].filter(id => {
      const path = c.projects.localPath(id);
      return path && resolve(path) === resolve(root);
    }),
  );
  for (const [id, known] of c.valgrindRoots) {
    if (known === resolve(root)) ids.add(id);
  }
  for (const id of ids) {
    c.valgrindRuns.set(id, run);
    c.post({
      type: 'valgrind',
      projectId: id,
      command: run.command,
      run,
      history: run.history,
    });
  }
}

export async function pushValgrind(
  c: Controller,
  projectId: number,
  only?: Surface,
) {
  const project = c.projects.get(projectId);
  const root = project && await c.localRoot(project);
  if (root) c.valgrindRoots.set(projectId, resolve(root));

  const command = root ? c.style.api?.valgrindCommand?.(root) ?? '' : '';
  const history = root ? c.style.api?.valgrindHistory?.(root) ?? [] : [];
  const run = c.valgrindRuns.get(projectId)
    ?? (root ? c.style.api?.valgrindLast?.(root) : undefined)
    ?? null;
  const debug = root ? c.style.api?.valgrindDebug?.(root) ?? null : null;
  c.post(
    {
      type: 'valgrind',
      projectId,
      command,
      run,
      history,
      debug,
      building: c.debugBuilds.has(projectId),
    },
    only,
  );
}

export function pushStyle(
  c: Controller,
  projectId: number,
  only?: Surface,
): void {
  const scan = c.style.get(projectId);
  c.post({ type: 'styleScan', projectId, scan: scan ?? null }, only);
}

/**
 * Runs BananaLens on the whole local copy of a project and publishes the
 * result.
 */
export async function locateStyle(
  c: Controller,
  project: ProjectVM,
  source: 'manual' | 'grader',
): Promise<StyleScanVM | null | undefined> {
  const t = createT(config.language());
  const root = await c.localRoot(project);
  if (!root) {
    c.style.setUnavailable(project.id, 'no_local_copy');
    if (source === 'manual') c.toast('warn', t('style.noLocalCopy'));
    return undefined;
  }

  const scan = await c.style.scan(project.id, root, source);
  if (source === 'grader' && scan?.status === 'done') {
    const blocking = blockingCount(scan.summary);
    c.toast(
      blocking > 0 ? 'info' : 'warn',
      blocking > 0
        ? t('style.located', { n: blocking })
        : t('style.locatedNone'),
    );
  }
  return scan;
}

/**
 * After a grader run that failed on coding style, find out where it comes
 * from.
 */
export function maybeLocateStyle(c: Controller, projectId: number): void {
  const g = c.grader.get(projectId);
  if (!g || g.loading) return;

  const latest = g.history[g.history.length - 1];
  if (!c.latestSeen.has(projectId)) {
    c.latestSeen.set(projectId, latest?.id ?? -1);
    return;
  }
  if (!latest || latest.id === c.latestSeen.get(projectId)) return;
  c.latestSeen.set(projectId, latest.id);

  const styleFailed = latest.flags.includes('coding-style-fail')
    || blockingCount(latest.style) > 0;
  const project = c.projects.get(projectId);
  if (
    !styleFailed ||
    !project ||
    !config.autoLocateStyle() ||
    !c.style.isAvailable()
  ) {
    return;
  }
  c.toast('info', createT(config.language())('style.locating'));
  void c.locateStyle(project, 'grader');
}

/**
 * Pre-flight before a grader run: check the whole project and stop if fatal
 * or major issues remain. Resolves to `true` when the run may continue.
 */
export async function preflight(
  c: Controller,
  project: ProjectVM,
): Promise<boolean> {
  if (!config.preflightStyle()) return true;

  const root = await c.localRoot(project);
  const t = createT(config.language());
  if (!root || !c.style.isAvailable()) {
    return prompts.styleUnavailable(
      t(!root ? 'style.noLocalCopy' : 'style.disabled'),
    );
  }

  const holder: { scan?: StyleScanVM | null } = {};
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('style.preflight.running', { name: project.name }),
      cancellable: true,
    },
    async (progress, token) => {
      const abort = new AbortController();
      const cancellation = token.onCancellationRequested(() => abort.abort());
      try {
        holder.scan = await c.style.scan(project.id, root, 'preflight', {
          signal: abort.signal,
          onProgress: (done, total) =>
            progress.report({
              increment: 100 / Math.max(total, 1),
              message: `${done}/${total}`,
            }),
        });
      } finally {
        cancellation.dispose();
      }
    },
  );

  const scan = holder.scan;
  if (!scan) {
    c.toast('info', t('style.preflight.cancelled'));
    return false;
  }
  if (scan.status !== 'done') {
    return prompts.styleUnavailable(scan.error ?? t('style.disabled'));
  }
  if (blockingCount(scan.summary) === 0) {
    if (scan.files > 0) c.toast('info', t('style.preflight.clean'));
    return true;
  }

  const decision = await prompts.styleGate({
    name: project.name,
    summary: scan.summary,
    files: scan.files,
    issues: scan.issues,
  });
  if (decision === 'ignore') return true;
  if (decision === 'fix') await c.revealFirstIssue(root, scan);
  return false;
}

/**
 * Opens the Problems panel and the worst issue so the user can start fixing
 * right away.
 */
export async function revealFirstIssue(
  c: Controller,
  root: string,
  scan: StyleScanVM,
) {
  void vscode.commands.executeCommand('workbench.actions.view.problems');
  const first = scan.issues.find(
    (i) => i.bucket === 'fatal' || i.bucket === 'major',
  );
  if (first) await c.openFileAt(root, first.file, first.line, first.column);
}

export async function openProjectFile(
  c: Controller,
  projectId: number,
  file: unknown,
  line: unknown,
  column: unknown,
  task?: string,
) {
  const project = c.projects.get(projectId);
  const root = project ? await c.localRoot(project) : undefined;
  if (!root || typeof file !== 'string') return;

  const target = await resolveLogFile(root, file, task);
  if (!target) {
    c.toast('warn', createT(config.language())('insights.fileUnavailable'));
    return;
  }
  await c.openFileAt(root, target, Number(line), Number(column));
}

export async function openFileAt(
  root: string,
  file: string,
  line: number,
  column: number,
) {
  const target = resolveInside(root, file);
  if (!target || !existsSync(target)) return;

  const l = Number.isSafeInteger(line)
    ? Math.min(Math.max(line, 1), 1_000_000)
    : 1;
  const c = Number.isSafeInteger(column)
    ? Math.min(Math.max(column, 1), 10_000)
    : 1;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
  const at = new vscode.Position(l - 1, c - 1);
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(at, at),
  });
}
