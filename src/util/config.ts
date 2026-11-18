import * as vscode from 'vscode';

const cfg = () => vscode.workspace.getConfiguration('epibox');

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
  disableStatistics: (): Thenable<void> =>
    cfg().update('anonymousStatistics', false, vscode.ConfigurationTarget.Global),
  language: (): 'en' | 'fr' => {
    const v = cfg().get<string>('language') ?? 'auto';
    if (v === 'en' || v === 'fr') {
      return v;
    }
    return vscode.env.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  },
};
