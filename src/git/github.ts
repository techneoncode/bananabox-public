import * as vscode from 'vscode';
import { parseRemote } from '../domain/git';
import { validCommit } from './commitData';

export async function githubJson(
  repoLink: string,
  resource: string,
): Promise<any> {
  const repo = parseRemote(repoLink);
  if (!repo || repo.host !== 'github.com') {
    throw new Error('GitHub repository unavailable');
  }

  const session = await Promise.resolve(
    vscode.authentication.getSession('github', ['repo'], { silent: true }),
  ).catch(() => undefined);
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${resource}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub (${response.status})`);
  return response.json();
}

/** GitHub caps a compare response at 300 changed files; incomplete context must remain unknown. */
export async function remoteChangedFiles(
  repoLink: string,
  before: string,
  after: string,
): Promise<string[] | null> {
  if (!validCommit(before) || !validCommit(after)) return null;

  const data = await githubJson(repoLink, `/compare/${before}...${after}`);
  if (
    !Array.isArray(data.files)
    || data.files.length >= 300
    || data.status === 'diverged'
    || data.status === 'behind'
  ) {
    return null;
  }
  const names = data.files.flatMap((f: any) =>
    typeof f.filename === 'string'
      ? [
          f.filename,
          ...(typeof f.previous_filename === 'string'
            ? [f.previous_filename]
            : []),
        ]
      : [],
  );
  return [...new Set<string>(names)];
}
