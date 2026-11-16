import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { gitBytes, validCommit } from '../git/commitData';
import { resolveInside } from '../domain/styleScan';
import { readGitState } from '../git/repoDetector';

export async function projectFiles(root: string): Promise<string[]> {
  const out = (
    await gitBytes(root, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ])
  ).toString('utf8');
  return [...new Set(out.split('\0').filter(Boolean))].sort();
}

export async function safeProjectPath(
  root: string,
  file: string,
): Promise<string> {
  const target = resolveInside(root, file);
  if (!target) throw new Error(`Invalid project path: ${file}`);

  const base = await realpath(root);
  const actual = await realpath(target);
  const rel = relative(base, actual);
  if (
    rel === '..'
    || rel.startsWith('../')
    || rel.startsWith('..\\')
    || isAbsolute(rel)
  ) {
    throw new Error(`File is outside the project: ${file}`);
  }
  return actual;
}

export async function snapshot(
  root: string,
  generated: readonly string[] = [],
): Promise<{ fingerprint: string; commit: string | null }> {
  let commit: string | null = null;
  try {
    const head = (await gitBytes(root, ['rev-parse', '--verify', 'HEAD']))
      .toString()
      .trim();
    if (validCommit(head)) commit = head;
  } catch {}

  const hash = createHash('sha256');
  const tracked = new Set(
    (await gitBytes(root, ['ls-files', '--cached', '-z']))
      .toString()
      .split('\0'),
  );
  for (const file of await projectFiles(root)) {
    if (!tracked.has(file) && generated.includes(file)) continue;
    try {
      const data = await readFile(await safeProjectPath(root, file));
      hash
        .update(file)
        .update('\0')
        .update(createHash('sha256').update(data).digest());
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return { fingerprint: hash.digest('hex'), commit };
}

export async function changes(
  root: string,
  generated: readonly string[] = [],
): Promise<string[]> {
  const modified = (await gitBytes(root, ['diff', '--name-only', '-z']))
    .toString()
    .split('\0');
  const staged = (
    await gitBytes(root, ['diff', '--cached', '--name-only', '-z'])
  )
    .toString()
    .split('\0');
  const untracked = (
    await gitBytes(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  )
    .toString()
    .split('\0')
    .filter((f) => !generated.includes(f));
  return [
    ...new Set([...modified, ...staged, ...untracked].filter(Boolean)),
  ].sort();
}

/** Known untracked build products do not become accidental submission files. Tracked products remain visible. */
export async function deliveryGitState(
  root: string,
  generated: readonly string[] = [],
) {
  const git = await readGitState(root);
  if (!git) return undefined;
  return { ...git, dirty: (await changes(root, generated)).length };
}

export async function diffText(
  root: string,
  before?: string,
  after?: string,
): Promise<string> {
  if (before && after) {
    if (!validCommit(before) || !validCommit(after)) {
      throw new Error('Invalid commit.');
    }
    return (
      await gitBytes(root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        before,
        after,
        '--',
      ])
    ).toString('utf8');
  }

  const unstaged = (
    await gitBytes(root, ['diff', '--no-ext-diff', '--no-textconv', '--'])
  ).toString('utf8');
  const staged = (
    await gitBytes(root, [
      'diff',
      '--cached',
      '--no-ext-diff',
      '--no-textconv',
      '--',
    ])
  ).toString('utf8');
  return [staged, unstaged].filter(Boolean).join('\n');
}
