import { compareVersions, parseSemver } from './remotePolicy';

/** One released version of CHANGELOG.md; `body` is the markdown under its heading. */
export interface ChangelogEntry {
  version: string;
  date: string;
  body: string;
}

const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;

function isVersion(value: string): boolean {
  try {
    parseSemver(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the `## [<version>] - <date>` sections of a Keep a Changelog file. Sections that are not
 * a semver version (such as `[Unreleased]`) are skipped, and so is anything inside a code fence.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; date: string; lines: string[] } | undefined;
  let fenced = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith('## ')) {
      if (current) entries.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() });
      const match = HEADING.exec(line);
      current = match && isVersion(match[1]) ? { version: match[1], date: match[2] ?? '', lines: [] } : undefined;
    } else {
      current?.lines.push(line);
    }
  }
  if (current) entries.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() });
  return entries;
}

/** The entries newer than `installed` and not newer than `target`, newest first. */
export function selectChangelog(entries: ChangelogEntry[], installed: string, target: string): ChangelogEntry[] {
  return entries
    .filter((entry) => compareVersions(entry.version, installed) > 0 && compareVersions(entry.version, target) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}
