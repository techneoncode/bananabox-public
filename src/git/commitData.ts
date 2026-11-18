import { execFile } from 'node:child_process';
import { parseRemote } from '../domain/git';
import { tr } from '../util/text';

export function validCommit(sha: unknown): sha is string {
  return typeof sha === 'string'
    && /^[a-f0-9]{40}$/i.test(sha)
    && !/^0+$/.test(sha);
}

export function commitUrl(repo: string, sha: string): string | undefined {
  const ref = parseRemote(repo);
  if (!ref || ref.host !== 'github.com' || !validCommit(sha)) return;
  return `https://github.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/commit/${sha}`;
}

export function gitBytes(
  folder: string,
  args: string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      ['-C', folder, ...args],
      {
        encoding: 'buffer',
        timeout: options.timeout ?? 10000,
        env: options.env,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (error, out) => (error ? reject(error) : resolve(out)),
    ),
  );
}

export interface CommitEntry {
  path: string;
  sha: string;
  type: 'tree' | 'blob' | 'commit';
  size?: number;
}

export function parseTree(data: Buffer): CommitEntry[] {
  return data
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [, type, sha, size] = line.slice(0, tab).trim().split(/\s+/);
      return {
        path: line.slice(tab + 1),
        sha,
        type: type as CommitEntry['type'],
        size: Number(size) || 0,
      };
    });
}

export async function localState(
  folder: string,
): Promise<{ head: string; dirty: boolean } | undefined> {
  try {
    const head = (await gitBytes(folder, ['rev-parse', '--verify', 'HEAD']))
      .toString()
      .trim();
    const dirty = (
      await gitBytes(folder, [
        'status',
        '--porcelain',
        '--untracked-files=normal',
      ])
    ).length > 0;
    return { head, dirty };
  } catch {
    return undefined;
  }
}

/** Import a missing revision using Git's existing credentials; never update a branch or FETCH_HEAD. */
export async function fetchCommit(
  folder: string,
  remote: string,
  sha: string,
  shallow = false,
): Promise<void> {
  if (!validCommit(sha)) throw new Error(tr('Invalid commit revision'));

  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH) {
    env.GIT_SSH_COMMAND = 'ssh -oBatchMode=yes -oConnectTimeout=10';
  }

  await gitBytes(
    folder,
    [
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--no-recurse-submodules',
      ...(shallow ? ['--depth=1'] : []),
      '--',
      remote,
      sha,
    ],
    { timeout: 60000, env },
  );
  await gitBytes(folder, ['cat-file', '-e', `${sha}^{commit}`]);
}
