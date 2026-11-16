import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shellSplit } from '../codingStyle/shell';
import { CONFIG_FILE, loadDeliveryConfig, saveDeliveryConfig } from './config';
import { commandLabel } from './process';
import type { DeliveryConfig } from '../shared/deliveryTypes';

export type Translate = (
  key: string,
  params?: Record<string, number | string>,
) => string;

const empty = (): DeliveryConfig => ({
  version: 1,
  requiredFiles: [],
  forbiddenFunctions: [],
  recipes: Object.create(null),
});

const validate = (v: string): string | undefined => {
  if (!v.trim()) return undefined;

  const args = shellSplit(v);
  return args.some((a) => ['&&', '|', '||', ';', '>', '<', '>>'].includes(a))
    ? 'Use a command with arguments, without pipes or redirections.'
    : undefined;
};

async function openConfigFile(root: string) {
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.file(join(root, CONFIG_FILE)),
    ),
  );
}

export async function configureChecks(
  root: string,
  t: Translate,
  advanced = false,
): Promise<boolean> {
  if (!vscode.workspace.isTrusted) throw new Error(t('delivery.trust'));

  if (advanced && existsSync(join(root, CONFIG_FILE))) {
    await openConfigFile(root);
    return false;
  }

  let config: DeliveryConfig | null;
  try {
    config = await loadDeliveryConfig(root);
  } catch {
    await openConfigFile(root);
    return false;
  }

  if (!config && !advanced) {
    const makefile = ['Makefile', 'makefile', 'GNUmakefile'].find((f) =>
      existsSync(join(root, f)),
    );
    const make = makefile ? await readFile(join(root, makefile), 'utf8') : '';
    const build = await vscode.window.showInputBox({
      title: t('delivery.setupBuild'),
      prompt: t('delivery.commandPrompt'),
      value: makefile
        ? /^re\s*:/m.test(make)
          ? 'make re'
          : 'make'
        : '',
      placeHolder: 'make re',
      validateInput: validate,
    });
    if (build === undefined) return false;

    const tests = await vscode.window.showInputBox({
      title: t('delivery.setupTests'),
      prompt: t('delivery.commandPrompt'),
      value: /^tests_run\s*:/m.test(make) ? 'make tests_run' : '',
      placeHolder: 'make tests_run',
      validateInput: validate,
    });
    if (tests === undefined) return false;

    config = empty();
    if (build.trim()) {
      config.build = { command: shellSplit(build), timeoutSeconds: 60 };
    }
    if (tests.trim()) {
      config.tests = { command: shellSplit(tests), timeoutSeconds: 60 };
    }
    await saveDeliveryConfig(root, config);
    return true;
  }

  if (!config) {
    config = empty();
    await saveDeliveryConfig(root, config);
  }
  await openConfigFile(root);
  return false;
}

export async function configureRecipe(
  root: string,
  task: string,
  t: Translate,
): Promise<boolean> {
  if (!vscode.workspace.isTrusted) throw new Error(t('delivery.trust'));

  const config = (await loadDeliveryConfig(root)) ?? empty();
  const existing = config.recipes[task];
  const input = await vscode.window.showInputBox({
    title: t('reproduce.setup', { name: task }),
    prompt: t('reproduce.commandPrompt'),
    value: existing ? commandLabel(existing.command) : '',
    placeHolder: './my_program argument',
    validateInput: (v) =>
      !v.trim() ? t('reproduce.commandRequired') : validate(v),
  });
  if (input === undefined) return false;

  config.recipes[task] = {
    ...existing,
    command: shellSplit(input),
    timeoutSeconds: existing?.timeoutSeconds ?? 30,
  };
  await saveDeliveryConfig(root, config);
  return true;
}
