import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { Controller } from '../controller';
import { GuidedDelivery } from '../services/guidedDelivery';
import { ReadinessService } from '../services/readinessService';
import { gitBytes } from '../git/commitData';
import { saveDeliveryConfig } from '../delivery/config';
import { createT } from '../shared/i18n';
import type { ProjectVM, StyleScanVM } from '../shared/types';

Object.assign(vscode.workspace, { isTrusted: true, textDocuments: [], saveAll: async () => true });
const style = (id: number): StyleScanVM => ({ projectId: id, status: 'done', source: 'preflight', files: 1, summary: { fatal: 0, major: 0, minor: 0, info: 0 }, issues: [], truncated: false, scannedAt: Date.now(), durationMs: 1, error: null });

async function fixture(automatic = false) {
  const base = await mkdtemp(join(tmpdir(), 'bb-guided-')), root = join(base, 'work'), remote = join(base, 'remote.git');
  await gitBytes(base, ['init', '--bare', remote]);
  await gitBytes(base, ['init', '-b', 'main', root]);
  await gitBytes(root, ['config', 'user.name', 'Bananabox tests']); await gitBytes(root, ['config', 'user.email', 'tests@example.invalid']);
  await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }\n');
  if (automatic) await writeFile(join(root, 'Makefile'), 'NAME = my_program\nSRC = main.c\nall: $(NAME)\n$(NAME): $(SRC)\n\tcc main.c -o $(NAME)\n');
  else await saveDeliveryConfig(root, { version: 1, build: { command: [process.execPath, '-e', 'process.exit(0)'] }, tests: { command: [process.execPath, '-e', 'process.exit(0)'] }, requiredFiles: ['main.c'], forbiddenFunctions: ['system'], recipes: {} });
  await gitBytes(root, ['add', '.']); await gitBytes(root, ['commit', '-m', 'initial']); await gitBytes(root, ['remote', 'add', 'origin', remote]); await gitBytes(root, ['push', '-u', 'origin', 'main']);
  return { base, root, remote };
}

for (const mode of ['submit', 'auto-submit', 'dismiss-final', 'edit-final', 'failed-check', 'subset-commit'] as const) {
  test(`guided submission: ${mode}`, async () => {
    const { base, root, remote } = await fixture(mode === 'auto-submit');
    let submissions = 0, finalPrompts = 0;
    const project = { id: 4, name: 'project', registered: true, repoEnabled: true } as ProjectVM;
    const guided = new GuidedDelivery(), readiness = new ReadinessService(async id => style(id), createT('en'));
    Object.assign(vscode.window, {
      showQuickPick: async (items: any[], options: any) => options?.canPickMany ? mode === 'subset-commit' ? items.filter(f => f.label === 'main.c') : items : items[0],
      showInputBox: async () => 'Complete project',
      showInformationMessage: async (_message: string, ...options: any[]) => options.at(-1),
      showWarningMessage: async (message: string, _options: unknown, ...actions: string[]) => {
        if (message === createT('en')('delivery.finalTitle')) {
          finalPrompts++;
          if (mode === 'dismiss-final') return undefined;
          if (mode === 'edit-final') await writeFile(join(root, 'main.c'), 'edited during final confirmation');
        }
        return actions.at(-1);
      },
      showErrorMessage: async () => undefined,
    });
    const controller: any = Object.create(Controller.prototype);
    Object.assign(controller, {
      auth: { isSignedIn: true, accessToken: 'session' }, projects: { get: () => project, resolveResources: async () => project },
      guided, readiness, style: { get: () => style(4) }, preparingGrader: new Set(),
      grader: { load: async () => {}, get: () => ({ canRun: true, quota: { remaining: 2, total: 2 } }), run: async () => { submissions++; } },
      localRoot: async () => root, watchLocal: async () => {}, refreshCommitStates: async () => {}, toast() {},
      customFunctions: () => [], functionRules: { disabled: () => false }, subjectFunctions: { ensure: async () => ({ status: 'none', names: [] }), get: () => ({ status: 'none', names: [] }) },
      graderCommand: { get: () => '' }, functionScope: () => 'tests', refreshRemoteCommit: async () => {},
    });
    try {
      await writeFile(join(root, 'main.c'), 'int main(void) { return 1; }\n');
      if (mode === 'failed-check') await writeFile(join(root, 'main.c'), 'int f(void) { system("forbidden"); }\n');
      if (mode === 'subset-commit') await writeFile(join(root, 'extra.c'), 'int extra(void) { return 0; }\n');
      await controller.guidedDelivery(4);
      assert.equal(submissions, ['submit', 'auto-submit'].includes(mode) ? 1 : 0);
      assert.equal(guided.get(4)?.status, ['submit', 'auto-submit'].includes(mode) ? 'done' : 'paused');
      assert.equal(finalPrompts, ['submit', 'auto-submit', 'dismiss-final', 'edit-final'].includes(mode) ? 1 : 0, 'one final prompt and no second grader confirmation');
      if (['submit', 'auto-submit'].includes(mode)) {
        const pushed = (await gitBytes(remote, ['show', 'main:main.c'])).toString();
        assert.match(pushed, /return 1/);
        if (mode === 'auto-submit') {
          await assert.rejects(gitBytes(remote, ['cat-file', '-e', 'main:my_program']));
          await assert.rejects(readFile(join(root, '.bananabox.json')));
        }
      }
      if (mode === 'subset-commit') {
        assert.ok(await readFile(join(root, 'extra.c')));
        await assert.rejects(gitBytes(root, ['cat-file', '-e', 'HEAD:extra.c']));
      }
    } finally { guided.dispose(); readiness.dispose(); await rm(base, { recursive: true, force: true }); }
  });
}
