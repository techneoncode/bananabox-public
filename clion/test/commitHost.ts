/** Test-only IPC entry: exercises the real shared commit explorer and CLion adapter. */
import { configure } from '../host/vscode';
import { handle, listen } from '../host/rpc';
import { CommitExplorer } from '../../src/git/commitExplorer';
import { normalizeProject } from '../../src/domain/projects';
let explorer: CommitExplorer;
handle('initialize', init => {
  configure(init, '');
  explorer = new CommitExplorer();
});
handle('test.openCommit', params => explorer.open(normalizeProject({ id: 1, name: 'Commit test', repoLink: params.repo }, ''), params.sha));
handle('shutdown', () => { explorer?.dispose(); setTimeout(() => process.exit(0), 20); });
listen(() => process.exit(0));
