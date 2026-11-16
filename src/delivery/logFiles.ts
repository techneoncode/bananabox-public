import { isAbsolute, relative } from 'node:path';
import { projectFiles, safeProjectPath } from './git';
import { discoverMakefiles, matchTask } from './discovery';

/** Resolve grader/container paths by their unique local suffix, preferably inside the named task. */
export async function resolveLogFile(
  root: string,
  file: string,
  task?: string,
): Promise<string | null> {
  if (!file || file.length > 4096 || file.includes('\0')) return null;

  const normal = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normal.split('/').includes('..')) return null;

  const files = await projectFiles(root);
  let candidates = files;
  if (task) {
    const local = matchTask(task, await discoverMakefiles(root, files));
    if (local) {
      candidates = files.filter((f) => f.startsWith(`${local.directory}/`));
    }
  } else if (isAbsolute(file)) {
    const inside = relative(root, file).split('\\').join('/');
    try {
      await safeProjectPath(root, inside);
      return inside;
    } catch {}
  }

  if (!task && files.includes(normal)) {
    try {
      await safeProjectPath(root, normal);
      return normal;
    } catch {
      return null;
    }
  }

  const parts = normal.split('/').filter(Boolean);
  let best = 0;
  let matches: string[] = [];
  for (const candidate of candidates) {
    const path = candidate.split('/');
    let count = 0;
    while (
      count < Math.min(parts.length, path.length)
      && parts[parts.length - 1 - count] === path[path.length - 1 - count]
    ) {
      count++;
    }
    if (!count) continue;
    if (count > best) {
      best = count;
      matches = [candidate];
    } else if (count === best) {
      matches.push(candidate);
    }
  }

  if (matches.length !== 1) return null;
  try {
    await safeProjectPath(root, matches[0]);
    return matches[0];
  } catch {
    return null;
  }
}
