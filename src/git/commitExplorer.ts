import * as vscode from 'vscode';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseRemote, sameRepo, toCloneUrl } from '../domain/git';
import { readRemotes } from './repoDetector';
import {
  commitUrl,
  fetchCommit,
  gitBytes,
  localState,
  parseTree,
  validCommit,
  type CommitEntry,
} from './commitData';
import { createT } from '../shared/i18n';
import { config } from '../util/config';
import type { ProjectVM } from '../shared/types';
import { remoteFeatures } from '../services/remoteFeatures';

interface Snapshot {
  id: string;
  label: string;
  root: string;
  folder?: string;
  localFolder?: string;
  repo?: string;
}

interface Node {
  snapshot: Snapshot;
  entry: CommitEntry;
  path: string;
}

/** A separate Explorer tree: browsing never checks out or writes into the working repository. */
export class CommitExplorer
  implements
    vscode.TreeDataProvider<Node>,
    vscode.TextDocumentContentProvider,
    vscode.Disposable
{
  private emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private active?: Snapshot;
  private nodes = new Map<string, Node>();
  private trees = new Map<string, CommitEntry[]>();
  private caches = new Set<string>();
  private disposables: vscode.Disposable[];

  constructor() {
    this.disposables = [
      this.emitter,
      remoteFeatures.onDidChange(() => {
        if (remoteFeatures.status.myApiActive) return;
        this.active = undefined;
        this.nodes.clear();
        this.trees.clear();
        this.emitter.fire(undefined);
      }),
      vscode.window.createTreeView('epibox.commits', {
        treeDataProvider: this,
        showCollapseAll: true,
      }),
      vscode.workspace.registerTextDocumentContentProvider(
        'epibox-commit',
        this,
      ),
      vscode.commands.registerCommand(
        'epibox.compareCommitFile',
        (uri: vscode.Uri) =>
          this.compareFile(uri).catch((error) => {
            void vscode.window.showErrorMessage(`Bananabox: ${error.message}`);
          }),
      ),
    ];
  }

  async folder(
    project: ProjectVM,
    remembered?: string,
  ): Promise<string | undefined> {
    const ref = project.repoLink && parseRemote(project.repoLink);
    if (!ref) return;

    const workspace = (vscode.workspace.workspaceFolders ?? [])
      .filter((f) => f.uri.scheme === 'file')
      .map((f) => f.uri.fsPath);
    const paths = [
      ...new Set([...workspace, ...(remembered ? [remembered] : [])]),
    ];
    for (const path of paths) {
      if (
        (await readRemotes(path)).some((url) => {
          const r = parseRemote(url);
          return r && sameRepo(ref, r);
        })
      ) {
        return path;
      }
    }
  }

  async state(project: ProjectVM, remembered?: string) {
    const folder = await this.folder(project, remembered);
    return folder ? localState(folder) : undefined;
  }

  private async session(interactive: boolean) {
    if (!remoteFeatures.status.myApiActive) return undefined;
    return interactive
      ? vscode.authentication.getSession('github', ['repo'], {
          createIfNone: true,
        })
      : vscode.authentication.getSession('github', ['repo'], { silent: true });
  }

  private async api(repo: string, resource: string): Promise<any> {
    if (!remoteFeatures.status.myApiActive) {
      throw new Error('Bananabox is disabled.');
    }
    const session = await this.session(false);
    if (!session) {
      throw new Error(createT(config.language())('commit.authRequired'));
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/git/${resource}`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(20000),
        remoteFeatures.apiSignal,
      ]),
      redirect: 'error',
    });
    if (!response.ok) {
      const t = createT(config.language());
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      const reason = response.headers.get('x-ratelimit-remaining') === '0'
        ? 'commit.apiRateLimit'
        : /required/i.test(response.headers.get('x-github-sso') ?? '')
            || /saml|single sign.on/i.test(body.message ?? '')
          ? 'commit.apiSso'
          : response.status === 403
            ? 'commit.apiForbidden'
            : 'commit.apiError';
      throw new Error(`GitHub (${response.status}): ${t(reason)}`);
    }
    return response.json();
  }

  async open(
    project: ProjectVM,
    sha: string,
    remembered?: string,
  ): Promise<void> {
    if (!remoteFeatures.status.myApiActive) return;
    if (!validCommit(sha)) {
      throw new Error(createT(config.language())('commit.invalid'));
    }

    const t = createT(config.language());
    const session = await this.session(false).catch(() => undefined);
    const pick = await vscode.window.showQuickPick(
      [
        { label: t('commit.web'), id: 'web' },
        {
          label: t('commit.explore'),
          id: 'explore',
          description: session?.account.label,
        },
        { label: t('commit.copy'), id: 'copy' },
      ],
      {
        title: `${project.name} · ${sha.slice(0, 7)}`,
        placeHolder: t('commit.actions'),
      },
    );
    if (!pick) return;
    if (pick.id === 'copy') {
      await vscode.env.clipboard.writeText(sha);
      return;
    }

    const url = project.repoLink && commitUrl(project.repoLink, sha);
    if (pick.id === 'web') {
      if (!url) throw new Error(t('commit.noRepo'));
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }

    const localFolder = await this.folder(project, remembered);
    let folder = localFolder;
    if (folder) {
      try {
        await gitBytes(folder, ['cat-file', '-e', `${sha}^{commit}`]);
      } catch {
        folder = undefined;
      }
    }

    const ref = project.repoLink && parseRemote(project.repoLink);
    if (!folder && vscode.workspace.isTrusted && ref && project.repoLink) {
      let cache: string | undefined;
      try {
        if (localFolder) {
          const remote = (await readRemotes(localFolder)).find((url) => {
            const candidate = parseRemote(url);
            return candidate && sameRepo(ref, candidate);
          });
          if (remote) {
            await fetchCommit(localFolder, remote, sha);
            folder = localFolder;
          }
        } else if (config.cloneProtocol() === 'ssh') {
          cache = await mkdtemp(join(tmpdir(), 'bananabox-commit-'));
          await gitBytes(cache, ['init', '--bare']);
          await fetchCommit(
            cache,
            toCloneUrl(project.repoLink, 'ssh'),
            sha,
            true,
          );
          folder = cache;
          this.caches.add(cache);
        }
      } catch {
        if (cache) {
          await rm(cache, { recursive: true, force: true }).catch(() => {});
        }
      }
    }

    if (!folder && (!ref || ref.host !== 'github.com')) {
      throw new Error(t('commit.noRepo'));
    }
    if (!folder) await this.session(true);

    const snapshot: Snapshot = {
      id: randomUUID(),
      label: `${project.name} @ ${sha.slice(0, 7)}`,
      root: sha,
      folder,
      localFolder,
      repo: ref
        ? `${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
        : undefined,
    };
    await this.tree(snapshot, sha);
    this.active = snapshot;
    this.emitter.fire(undefined);
    await vscode.commands.executeCommand('epibox.commits.focus');
  }

  private async tree(snapshot: Snapshot, sha: string): Promise<CommitEntry[]> {
    const key = `${snapshot.id}:${sha}`;
    const cached = this.trees.get(key);
    if (cached) return cached;

    let entries: CommitEntry[];
    if (snapshot.folder) {
      entries = parseTree(
        await gitBytes(snapshot.folder, ['ls-tree', '-z', '-l', sha]),
      );
    } else {
      const data = await this.api(snapshot.repo!, `trees/${sha}`);
      if (data.truncated) {
        throw new Error(createT(config.language())('commit.truncated'));
      }
      entries = data.tree;
    }
    this.trees.set(key, entries);
    return entries;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!remoteFeatures.status.myApiActive) return [];
    if (!node) {
      if (!this.active) return [];
      return [
        {
          snapshot: this.active,
          entry: {
            path: this.active.label,
            sha: this.active.root,
            type: 'tree',
          },
          path: '',
        },
      ];
    }
    if (node.entry.type !== 'tree') return [];

    const entries = await this.tree(node.snapshot, node.entry.sha);
    return entries
      .sort((a, b) =>
        Number(b.type === 'tree') - Number(a.type === 'tree')
          || a.path.localeCompare(b.path),
      )
      .map((entry) => ({
        snapshot: node.snapshot,
        entry,
        path: node.path ? `${node.path}/${entry.path}` : entry.path,
      }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const collapsible = node.entry.type === 'tree'
      ? (node.path
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded)
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.entry.path, collapsible);
    item.tooltip = `${node.snapshot.label}\n${node.path}`;
    if (node.entry.type === 'blob') {
      const uri = vscode.Uri.from({
        scheme: 'epibox-commit',
        authority: node.snapshot.id,
        path: `/${node.path}`,
        query: node.entry.sha,
      });
      this.nodes.set(uri.toString(), node);
      item.resourceUri = uri;
      item.command = {
        command: 'epibox.compareCommitFile',
        title: createT(config.language())('commit.diff'),
        arguments: [uri],
      };
    } else {
      item.iconPath = new vscode.ThemeIcon(
        node.entry.type === 'tree' ? 'folder' : 'repo',
      );
    }
    if (node.entry.type === 'commit') item.description = 'submodule';
    return item;
  }

  async compareFile(uri: vscode.Uri): Promise<void> {
    if (!remoteFeatures.status.myApiActive) return;
    const node = this.nodes.get(uri.toString());
    if (!node) throw vscode.FileSystemError.FileNotFound(uri);

    const t = createT(config.language());
    if (!node.snapshot.localFolder) {
      void vscode.window.showInformationMessage(t('commit.noLocalDiff'));
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }

    const target = resolve(node.snapshot.localFolder, node.path);
    const rel = relative(node.snapshot.localFolder, target);
    if (
      isAbsolute(rel)
      || rel === '..'
      || rel.startsWith('../')
      || rel.startsWith('..\\')
    ) {
      throw new Error(t('commit.invalid'));
    }

    let current = vscode.Uri.file(target);
    let missing = false;
    const open = vscode.workspace.textDocuments.some((doc) =>
      doc.uri.toString() === current.toString(),
    );
    if (!open) {
      try {
        const stat = await vscode.workspace.fs.stat(current);
        if (stat.type & vscode.FileType.Directory) {
          throw new Error(t('commit.notFile'));
        }
      } catch (error) {
        if ((error as { code?: string }).code !== 'FileNotFound') throw error;
        missing = true;
        current = vscode.Uri.from({
          scheme: 'epibox-commit',
          authority: node.snapshot.id,
          path: `/${node.path}`,
          query: 'empty',
        });
        this.nodes.set(current.toString(), node);
      }
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      current,
      uri,
      `${node.path} · ${t(missing ? 'commit.absent' : 'commit.working')} ↔ ${node.snapshot.root.slice(0, 7)}`,
      { preview: true },
    );
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!remoteFeatures.status.myApiActive) return '';
    const node = this.nodes.get(uri.toString());
    if (!node) throw vscode.FileSystemError.FileNotFound(uri);
    if (uri.query === 'empty') return '';

    const { snapshot, entry } = node;
    if ((entry.size ?? 0) > 10 * 1024 * 1024) {
      throw new Error(createT(config.language())('commit.tooLarge'));
    }

    let bytes: Buffer;
    if (snapshot.folder) {
      bytes = await gitBytes(snapshot.folder, ['cat-file', 'blob', entry.sha]);
    } else {
      const data = await this.api(snapshot.repo!, `blobs/${entry.sha}`);
      if (data.encoding !== 'base64') {
        throw new Error('Unsupported GitHub blob encoding');
      }
      bytes = Buffer.from(data.content, 'base64');
    }
    if (bytes.includes(0)) {
      throw new Error(createT(config.language())('commit.binary'));
    }
    return bytes.toString('utf8');
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.nodes.clear();
    this.trees.clear();
    for (const folder of this.caches) {
      void rm(folder, { recursive: true, force: true }).catch(() => {});
    }
    this.caches.clear();
  }
}
