import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { CommitExplorer } from '../git/commitExplorer';
import { gitBytes, localState } from '../git/commitData';
import { normalizeProject } from '../domain/projects';

test('missing local revision is fetched with configured Git credentials without OAuth, checkout or ref updates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bananabox-fetch-test-'));
  const source = join(root, 'source'), local = join(root, 'local');
  const url = 'git@github.com:school/project.git';
  const git = async (folder: string, ...args: string[]) => (await gitBytes(folder, args)).toString().trim();
  let interactive = 0;
  Object.assign(vscode.window, { createTreeView: () => ({ dispose() {} }), showQuickPick: async () => ({ id: 'explore' }) });
  Object.assign(vscode.commands, { registerCommand: () => ({ dispose() {} }) });
  Object.assign(vscode.workspace, { isTrusted: true, workspaceFolders: [{ uri: vscode.Uri.file(local) }], registerTextDocumentContentProvider: () => ({ dispose() {} }) });
  Object.assign(vscode.authentication, { getSession: async (_provider: unknown, _scopes: unknown, options: any) => {
    if (options.createIfNone) interactive++;
    return undefined;
  } });
  Object.assign(vscode.Uri, { from: (parts: any) => ({ ...parts, toString: () => `${parts.scheme}://${parts.authority}${parts.path}?${parts.query}` }) });
  const explorer = new CommitExplorer();
  try {
    await git(root, 'init', source);
    await git(source, 'config', 'user.name', 'Test');
    await git(source, 'config', 'user.email', 'test@example.invalid');
    await git(source, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(source, 'main.c'), 'old\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-m', 'old');
    await git(root, 'clone', source, local);
    await git(local, 'remote', 'set-url', 'origin', url);
    // Route this exact SSH remote to a local fixture: no GitHub or external SSH calls in the test.
    await git(local, 'config', `url.file://${source}.insteadOf`, url);
    await writeFile(join(source, 'main.c'), 'evaluated revision\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-m', 'evaluated');
    const sha = await git(source, 'rev-parse', 'HEAD');
    await assert.rejects(git(local, 'cat-file', '-e', `${sha}^{commit}`));
    await writeFile(join(local, 'main.c'), 'unsaved working content\n');
    const before = await localState(local), refs = await git(local, 'show-ref');
    await writeFile(join(local, '.git', 'FETCH_HEAD'), 'preserve this\n');
    await explorer.open(normalizeProject({ id: 1, repoLink: url }, ''), sha);
    assert.equal(interactive, 0, 'GitHub OAuth is not requested when Git can fetch the revision');
    const [snapshot] = await explorer.getChildren();
    const [file] = await explorer.getChildren(snapshot);
    assert.equal(await explorer.provideTextDocumentContent(explorer.getTreeItem(file).resourceUri!), 'evaluated revision\n');
    assert.deepEqual(await localState(local), before);
    assert.equal(await git(local, 'show-ref'), refs);
    assert.equal(await readFile(join(local, '.git', 'FETCH_HEAD'), 'utf8'), 'preserve this\n');
    assert.equal(await readFile(join(local, 'main.c'), 'utf8'), 'unsaved working content\n');
    // The same access also works without an open clone, using a disposable bare cache.
    Object.assign(vscode.workspace, { workspaceFolders: [] });
    const rewrite = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${source}.insteadOf`, GIT_CONFIG_VALUE_0: url };
    const previous = Object.fromEntries(Object.keys(rewrite).map(key => [key, process.env[key]]));
    Object.assign(process.env, rewrite);
    try {
      await explorer.open(normalizeProject({ id: 1, repoLink: url }, ''), sha);
      const [cached] = await explorer.getChildren();
      assert.notEqual(cached.snapshot.folder, local);
      assert.equal(cached.snapshot.localFolder, undefined);
      const [cachedFile] = await explorer.getChildren(cached);
      assert.equal(await explorer.provideTextDocumentContent(explorer.getTreeItem(cachedFile).resourceUri!), 'evaluated revision\n');
      assert.equal(interactive, 0);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }

  } finally { explorer.dispose(); await rm(root, { recursive: true, force: true }); }
});
