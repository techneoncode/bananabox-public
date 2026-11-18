import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { parseGitStatus, type GitWorktreeState } from '../domain/git';
import { tr } from '../util/text';

function run(
  cmd: string,
  args: string[],
  cwd?: string,
  timeout = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** All remote URLs configured for the git repository at `folder` (empty when it is not a repo). */
export async function readRemotes(folder: string): Promise<string[]> {
  try {
    const out = await run('git', [
      '-C',
      folder,
      'config',
      '--get-regexp',
      '^remote\\..*\\.url$',
    ]);
    return out
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    try {
      const text = await readFile(join(folder, '.git', 'config'), 'utf8');
      return [...text.matchAll(/^\s*url\s*=\s*(.+)$/gm)]
        .map((m) => m[1].trim());
    } catch {
      return [];
    }
  }
}

export async function workspaceRemotes(): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const all = await Promise.all(
    folders
      .filter((f) => f.uri.scheme === 'file')
      .map((f) => readRemotes(f.uri.fsPath)),
  );
  return [...new Set(all.flat())];
}

export async function gitClone(
  url: string,
  target: string,
  onProgress?: (line: string) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'git',
      ['clone', '--progress', '--', url, target],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      const last = text.split(/[\r\n]+/).filter(Boolean).pop();
      if (last && onProgress) {
        onProgress(last.trim());
      }
    });
    child.on('error', (e) =>
      reject(new Error(tr('Could not start git: {p0}', { p0: e.message }))),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(friendlyGitError(stderr))),
    );
  });
}

function friendlyGitError(stderr: string): string {
  if (/permission denied \(publickey\)|could not read from remote repository/i.test(stderr)) {
    return 'Git could not authenticate. Make sure your SSH key is added to your GitHub account (or switch "epibox.cloneProtocol" to https).';
  }
  if (/already exists and is not an empty directory/i.test(stderr)) {
    return tr('The destination folder already exists and is not empty.');
  }
  if (/repository not found|not found/i.test(stderr)) {
    return tr('Repository not found. It may not be created yet, or you may not have access to it.');
  }
  return stderr.trim().split('\n').slice(-3).join('\n') || 'git clone failed.';
}

/** Worktree summary (unpushed commits, uncommitted files) or `undefined` when `folder` is not a usable repository. */
export async function readGitState(
  folder: string,
): Promise<GitWorktreeState | undefined> {
  try {
    return parseGitStatus(
      await run('git', ['-C', folder, 'status', '--porcelain=v1', '-b']),
    );
  } catch {
    return undefined;
  }
}

/** Push the current branch to its configured upstream without forcing. */
export async function gitPush(folder: string): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    throw new Error(tr('Git push requires a trusted workspace.'));
  }
  await run('git', ['-C', folder, 'push'], undefined, 120_000);
}
