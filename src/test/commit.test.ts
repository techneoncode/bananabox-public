import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitUrl, gitBytes, localState, parseTree, validCommit } from '../git/commitData';

const sha = 'a'.repeat(40);
test('commit links accept GitHub remotes and reject malformed revisions and hosts', () => {
  for (const repo of ['git@github.com:school/project.git', 'https://github.com/school/project', 'ssh://git@github.com/school/project.git']) {
    assert.equal(commitUrl(repo, sha), `https://github.com/school/project/commit/${sha}`);
  }
  for (const value of ['HEAD', '--help', 'a'.repeat(7), '0'.repeat(40), `${sha};pwd`, null]) assert.equal(validCommit(value), false);
  assert.equal(commitUrl('https://github.com.evil.test/school/project', sha), undefined);
  assert.equal(commitUrl('https://github.com/school/project', '--help'), undefined);
});

test('historical trees and blobs preserve exact filenames and content without checkout', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'epibox-commit-'));
  try {
    await gitBytes(folder, ['init']);
    await gitBytes(folder, ['config', 'user.name', 'Test']);
    await gitBytes(folder, ['config', 'user.email', 'test@example.invalid']);
    await mkdir(join(folder, 'nested'));
    const name = 'space\tand\nnewline.txt';
    await writeFile(join(folder, 'nested', name), 'old content\n');
    await gitBytes(folder, ['add', '.']);
    await gitBytes(folder, ['commit', '-m', 'first']);
    const first = (await localState(folder))!;
    assert.equal(first.dirty, false);
    const roots = parseTree(await gitBytes(folder, ['ls-tree', '-z', '-l', first.head]));
    assert.equal(roots[0].type, 'tree');
    const entries = parseTree(await gitBytes(folder, ['ls-tree', '-z', '-l', roots[0].sha]));
    assert.equal(entries[0].path, name);
    assert.equal(entries[0].size, 12);
    await writeFile(join(folder, 'nested', name), 'new content\n');
    assert.equal((await localState(folder))?.dirty, true);
    await gitBytes(folder, ['add', '.']);
    await gitBytes(folder, ['commit', '-m', 'second']);
    const second = (await localState(folder))!;
    assert.notEqual(second.head, first.head);
    assert.equal((await gitBytes(folder, ['cat-file', 'blob', entries[0].sha])).toString(), 'old content\n');
    assert.deepEqual(await localState(folder), second);
    await writeFile(join(folder, 'untracked'), 'new');
    assert.equal((await localState(folder))?.dirty, true);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('missing local repository leaves comparison unavailable', async () => {
  assert.equal(await localState('/epibox/nonexistent-repository'), undefined);
});
