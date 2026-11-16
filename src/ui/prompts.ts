import * as vscode from 'vscode';
import type { GitWorktreeState } from '../domain/git';
import { createT } from '../shared/i18n';
import { config } from '../util/config';
import { describeIssue } from '../domain/styleScan';
import type { StyleScanVM } from '../shared/types';

/**
 * Native modal dialogs for actions whose outcome is ambiguous, risky or irreversible.
 * They are centred, block until answered, and work from the command palette as well as from webviews.
 */
const tr = () => createT(config.language());

interface Choice<V extends string> extends vscode.MessageItem {
  value: V;
}

const choice = <V extends string>(
  title: string,
  value: V,
): Choice<V> => ({ title, value });

async function ask<V extends string>(
  message: string,
  detail: string,
  choices: Choice<V>[],
  level: 'info' | 'warning' = 'info',
  ignore?: string,
): Promise<V | undefined> {
  const items: vscode.MessageItem[] = ignore
    ? [...choices, { title: ignore, isCloseAffordance: true }]
    : choices;
  const show = level === 'warning'
    ? vscode.window.showWarningMessage
    : vscode.window.showInformationMessage;
  const picked = (await show(
    message,
    { modal: true, detail },
    ...items,
  )) as Choice<V> | undefined;
  return picked && 'value' in picked ? picked.value : undefined;
}

export type AfterClone = 'current' | 'window' | 'workspace' | 'ignore';

/** Where do you want to open it? Shown after a successful clone. Esc or Ignore leaves everything as is. */
export async function afterClone(
  name: string,
  folder: string,
  hasOpenFolders: boolean,
): Promise<AfterClone> {
  const t = tr();
  const choices = [
    choice(t('clone.openHere'), 'current'),
    choice(t('clone.openNew'), 'window'),
    ...(hasOpenFolders
      ? [choice(t('clone.addWorkspace'), 'workspace')]
      : []),
  ];
  const detail = [
    t('clone.detail', { path: folder }),
    hasOpenFolders ? t('clone.replaceNote') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const picked = await ask(
    t('clone.title', { name }),
    detail,
    choices,
    'info',
    t('clone.ignore'),
  );
  return picked ?? 'ignore';
}

/** The project already has a local copy: open it instead of cloning a second time? */
export async function alreadyCloned(
  name: string,
  folder: string,
): Promise<'open' | 'again' | undefined> {
  const t = tr();
  return ask(
    t('exists.title', { name }),
    t('exists.detail', { path: folder }),
    [
      choice(t('exists.open'), 'open'),
      choice(t('exists.again'), 'again'),
    ],
  );
}

/** The chosen destination folder already exists. */
export async function targetExists(
  folderName: string,
  path: string,
  holdsSameRepo: boolean,
): Promise<'open' | 'rename' | undefined> {
  const t = tr();
  const choices = [
    ...(holdsSameRepo ? [choice(t('target.open'), 'open')] : []),
    choice(t('target.rename'), 'rename'),
  ];
  return ask(
    t('target.title', { folder: folderName }),
    `${path}\n\n${holdsSameRepo ? t('target.same') : t('target.other')}`,
    choices,
    'warning',
  );
}

export interface GraderGate {
  name: string;
  remaining?: number;
  total?: number;
  git?: GitWorktreeState;
}

export async function styleGate(
  gate: Pick<StyleScanVM, 'summary' | 'files' | 'issues'> & { name: string },
): Promise<'fix' | 'ignore' | undefined> {
  const t = tr();
  const detail = [
    t('style.gate.detail', {
      fatal: gate.summary.fatal,
      major: gate.summary.major,
      files: gate.files,
    }),
    ...gate.issues
      .filter((i) => i.bucket === 'fatal' || i.bucket === 'major')
      .slice(0, 8)
      .map((i) => describeIssue(i)),
    t('style.gate.risk'),
  ].join('\n\n');
  return ask(t('style.gate.title', { name: gate.name }), detail, [
    choice(t('style.gate.fix'), 'fix'),
    choice(t('style.gate.ignore'), 'ignore'),
  ], 'warning');
}

export async function styleUnavailable(reason: string): Promise<boolean> {
  const t = tr();
  const answer = await ask(
    t('style.unchecked'),
    reason,
    [choice(t('style.gate.ignore'), 'ignore')],
    'warning',
  );
  return answer === 'ignore';
}

/** Warnings that make a grader run likely to waste a token. */
export function graderWarnings(
  git: GitWorktreeState | undefined,
  t = tr(),
): string[] {
  if (!git) return [];

  const out: string[] = [];
  if (!git.hasUpstream) {
    out.push(t('run.noUpstream'));
  } else if (git.ahead > 0) {
    out.push(t('run.unpushed', { n: git.ahead }));
  }
  if (git.dirty > 0) out.push(t('run.dirty', { n: git.dirty }));
  return out;
}

/**
 * Confirms a token-consuming grader run. Always shown when local work is not on the remote (the grader would
 * test stale code); otherwise it follows `epibox.confirmGraderRun`. Resolves to `undefined` when cancelled.
 */
export async function confirmGraderRun(
  gate: GraderGate,
): Promise<'run' | 'runAlways' | 'push' | undefined> {
  const t = tr();
  const warnings = graderWarnings(gate.git, t);
  if (warnings.length === 0 && !config.confirmGraderRun()) return 'run';

  const tokens = gate.remaining !== undefined && gate.total !== undefined
    ? t('run.tokens', { left: gate.remaining, total: gate.total })
    : t('run.tokensUnknown');
  const lines = [
    ...warnings.map((w) => `⚠ ${w}`),
    warnings.length ? t('run.remoteNote') : '',
    tokens,
    gate.remaining === 1 ? t('run.lastToken') : '',
  ].filter(Boolean);
  const choices = [
    ...(vscode.workspace.isTrusted
      && gate.git?.hasUpstream
      && gate.git.ahead > 0
      ? [choice(t('run.push'), 'push')]
      : []),
    choice(warnings.length ? t('run.goAnyway') : t('run.go'), 'run'),
    ...(warnings.length === 0 ? [choice(t('run.goAlways'), 'runAlways')] : []),
  ];
  return ask(
    t('run.title', { name: gate.name }),
    lines.join('\n\n'),
    choices,
    warnings.length ? 'warning' : 'info',
  );
}
