import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitBytes } from '../git/commitData';
import { resolveLogFile } from '../delivery/logFiles';

test('resolves grader paths inside the correct task; ambiguous paths are never guessed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'banana-log-files-'));
  try {
    await gitBytes(root, ['init', '--quiet']);
    for (const task of ['task01', 'task02']) {
      await mkdir(join(root, task, 'src'), { recursive: true });
      await writeFile(join(root, task, 'Makefile'), 'NAME = program\nSRC = src/main.c\nall:\n\ttrue\n');
      await writeFile(join(root, task, 'src/main.c'), 'int main(void) { return 0; }');
    }
    assert.equal(await resolveLogFile(root, 'main.c', '01 - task01'), 'task01/src/main.c');
    assert.equal(await resolveLogFile(root, '/grader/build/src/main.c', '02 - task02'), 'task02/src/main.c');
    assert.equal(await resolveLogFile(root, '/grader/build/task01/src/main.c'), 'task01/src/main.c');
    assert.equal(await resolveLogFile(root, 'main.c'), null);
    assert.equal(await resolveLogFile(root, '../../secret.c'), null);
    assert.equal(await resolveLogFile(root, join(root, 'task01/src/main.c')), 'task01/src/main.c');
    assert.equal(await resolveLogFile(root, 'task02/src/main.c'), 'task02/src/main.c');
    assert.equal(await resolveLogFile(root, 'absent.c'), null);
    await writeFile(join(root, '.bananabox.json'), '{invalid advanced config');
    assert.equal(await resolveLogFile(root, 'main.c', 'task01'), 'task01/src/main.c');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('never resolves a repository symlink to a file outside the project', async () => {
  const base = await mkdtemp(join(tmpdir(), 'banana-log-link-'));
  try {
    const root = join(base, 'repo'); await mkdir(root);
    await gitBytes(root, ['init', '--quiet']);
    await writeFile(join(base, 'external.c'), 'outside');
    await symlink(join(base, 'external.c'), join(root, 'external.c'));
    assert.equal(await resolveLogFile(root, 'external.c'), null);
  } finally { await rm(base, { recursive: true, force: true }); }
});
