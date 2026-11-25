import * as vscode from 'vscode';
import type { DisabledChecks } from '../domain/milestones';

const cfg = () => vscode.workspace.getConfiguration('bananabox');

export const config = {
  apiBaseUrl: (): string =>
    (cfg().get<string>('apiBaseUrl') || 'https://my.epitech.eu')
      .replace(/\/+$/, ''),
  browserPath: (): string => cfg().get<string>('browserPath') || '',
  cloneProtocol: (): 'ssh' | 'https' =>
    cfg().get<string>('cloneProtocol') === 'https' ? 'https' : 'ssh',
  defaultCloneDirectory: (): string =>
    cfg().get<string>('defaultCloneDirectory') || '',
  afterClone: (): 'ask' | 'current' | 'window' | 'workspace' | 'ignore' => {
    const v = cfg().get<string>('afterClone');
    return v === 'current'
      || v === 'window'
      || v === 'workspace'
      || v === 'ignore'
      ? v
      : 'ask';
  },
  confirmGraderRun: (): boolean =>
    cfg().get<boolean>('confirmGraderRun') ?? true,
  preflightStyle: (): boolean =>
    cfg().get<boolean>('preflightCodingStyle') ?? true,
  autoLocateStyle: (): boolean =>
    cfg().get<boolean>('autoLocateCodingStyle') ?? true,
  deadlineNotifications: (): boolean =>
    cfg().get<boolean>('deadlineNotifications') ?? true,
  disableGraderConfirmation: (): Thenable<void> =>
    cfg().update('confirmGraderRun', false, vscode.ConfigurationTarget.Global),
  disabledChecks: (): DisabledChecks => {
    const v = cfg().get<unknown>('disabledChecks');
    return v && typeof v === 'object' ? v as DisabledChecks : {};
  },
  setDisabledChecks: (value: DisabledChecks): Thenable<void> =>
    cfg().update('disabledChecks', value, vscode.ConfigurationTarget.Global),
  autoOpenInEditor: (): boolean =>
    cfg().get<boolean>('autoOpenProjectInEditor') ?? false,
  pollIntervalMs: (): number =>
    Math.min(
      30,
      Math.max(2, cfg().get<number>('graderPollIntervalSeconds') ?? 3),
    ) * 1000,
  showStatusBar: (): boolean =>
    cfg().get<boolean>('showStatusBarItem') ?? true,
  statistics: (): boolean => cfg().get<boolean>('anonymousStatistics') ?? true,
  /** Bananabox's own accent on buttons instead of the theme's. */
  bananaTheme: (): boolean => cfg().get<boolean>('bananaTheme') === true,
  /** Off unless the student turns it on: a new setting, so earlier installs start off too. */
  defenseReminders: (): boolean => cfg().get<boolean>('defenseReminders') === true,
  language: (): 'en' | 'fr' => {
    const v = cfg().get<string>('language') ?? 'auto';
    if (v === 'en' || v === 'fr') {
      return v;
    }
    return vscode.env.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  },
};
