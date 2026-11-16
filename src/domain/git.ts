export interface RemoteRef {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parses `https://host/owner/repo(.git)`, `git@host:owner/repo(.git)` and
 * `ssh://git@host/owner/repo(.git)`.
 */
export function parseRemote(url: string): RemoteRef | null {
  const trimmed = url.trim();
  const scp =
    /^[\w.-]+@([\w.-]+):(?:\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (scp) {
    return { host: scp[1].toLowerCase(), owner: scp[2], repo: scp[3] };
  }
  const std =
    /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([\w.-]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (std) {
    return { host: std[1].toLowerCase(), owner: std[2], repo: std[3] };
  }
  return null;
}

export function sameRepo(a: RemoteRef, b: RemoteRef): boolean {
  return a.host === b.host
    && a.owner.toLowerCase() === b.owner.toLowerCase()
    && a.repo.toLowerCase() === b.repo.toLowerCase();
}

export function toCloneUrl(
  repoLink: string,
  protocol: 'ssh' | 'https',
): string {
  const ref = parseRemote(repoLink);
  if (!ref) {
    throw new Error(
      'Unsupported repository URL. Expected an HTTPS or SSH repository URL.',
    );
  }
  return protocol === 'ssh'
    ? `git@${ref.host}:${ref.owner}/${ref.repo}.git`
    : `https://${ref.host}/${ref.owner}/${ref.repo}.git`;
}

export interface EpitechRepoName {
  unitCode: string;
  instance: string;
  projectCode: string;
  group: string;
}

/**
 * `G-CPE-100-STG-1-1-cpoolday04-15` → unit `G-CPE-100`, instance `STG-1-1`,
 * project `cpoolday04`.
 */
export function parseEpitechRepoName(repo: string): EpitechRepoName | null {
  const m =
    /^([A-Z]-[A-Z0-9]{3}-\d{3})-([A-Z]{3}-\d+-\d+)-(.+)-(\d+)$/i.exec(repo);
  if (!m) return null;
  return {
    unitCode: m[1].toUpperCase(),
    instance: m[2].toUpperCase(),
    projectCode: m[3].toLowerCase(),
    group: m[4],
  };
}

export interface GitWorktreeState {
  branch: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  /** Modified, staged or untracked entries. */
  dirty: number;
}

/** Parses `git status --porcelain=v1 -b`. */
export function parseGitStatus(output: string): GitWorktreeState {
  const lines = output.split(/\r?\n/).filter((l) => l.length > 0);
  const head = lines.find((l) => l.startsWith('## ')) ?? '';
  const dirty = lines.filter((l) => !l.startsWith('## ')).length;
  const m =
    /^## (?<branch>.+?)(?:\.\.\.(?<upstream>\S+))?(?: \[(?<track>[^\]]+)\])?$/.exec(head);
  const branch = m?.groups?.branch
    && !/^No commits yet|^HEAD \(no branch\)/.test(m.groups.branch)
    ? m.groups.branch
    : null;
  const track = m?.groups?.track ?? '';
  return {
    branch,
    hasUpstream: Boolean(m?.groups?.upstream) && !/gone/.test(track),
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    dirty,
  };
}
