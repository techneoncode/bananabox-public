import * as path from 'node:path';
import type { StyleBucket, StyleIssueVM, StyleScanVM } from '../shared/types';
import type { StyleScanResult } from '../codingStyle/api';

/**
 * The Epitech grader scores 0 on a coding style failure; fatal and major issues
 * are the ones that trigger it.
 */
export const blockingCount = (
  s: { fatal: number; major: number },
): number =>
  s.fatal + s.major;

export const MAX_ISSUES = 300;

const ORDER: Record<StyleBucket, number> = {
  fatal: 0,
  major: 1,
  minor: 2,
  info: 3,
};

export function emptyScan(
  projectId: number,
  source: StyleScanVM['source'],
  status: StyleScanVM['status'],
  error: string | null = null,
): StyleScanVM {
  return {
    projectId,
    status,
    source,
    summary: { fatal: 0, major: 0, minor: 0, info: 0 },
    issues: [],
    truncated: false,
    files: 0,
    scannedAt: null,
    durationMs: 0,
    error,
  };
}

/**
 * Converts an engine result into the serialisable view-model: relative paths,
 * worst first, capped.
 */
export function buildScanVM(
  projectId: number,
  source: StyleScanVM['source'],
  result: StyleScanResult,
  now = Date.now(),
): StyleScanVM {
  if (result.error) {
    return {
      ...emptyScan(projectId, source, 'error', result.error.message),
      files: result.files,
      durationMs: result.durationMs,
    };
  }
  const issues: StyleIssueVM[] = [];
  for (const issue of result.issues) {
    const rel = path.relative(result.root, issue.file)
      .split(path.sep)
      .join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    issues.push({
      file: rel,
      line: Math.max(1, issue.line),
      column: Math.max(1, issue.column),
      bucket: issue.bucket,
      rule: issue.ruleId ?? null,
      message: issue.message,
    });
  }
  issues.sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket]
    || a.file.localeCompare(b.file)
    || a.line - b.line
    || a.column - b.column);
  const { fatal, major, minor, info } = result.summary;

  return {
    projectId,
    status: 'done',
    source,
    summary: { fatal, major, minor, info },
    issues: issues.slice(0, MAX_ISSUES),
    truncated: issues.length > MAX_ISSUES,
    files: result.files,
    scannedAt: now,
    durationMs: result.durationMs,
    error: null,
  };
}

/** One-line description used in modal dialogs. */
export function describeIssue(issue: StyleIssueVM, max = 110): string {
  const text = `${issue.file}:${issue.line}  [${issue.rule ?? issue.bucket}] ${issue.message}`
    .replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Resolves `relative` below `root`; returns `null` when it would escape the
 * folder.
 */
export function resolveInside(root: string, relative: string): string | null {
  if (typeof relative !== 'string' || relative.length === 0
    || relative.includes('\0') || path.isAbsolute(relative)) {
    return null;
  }
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
    ? target
    : null;
}
