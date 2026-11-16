import * as vscode from 'vscode';
import { remoteFeatures } from './remoteFeatures';
import { createT } from '../shared/i18n';
import { config } from '../util/config';

export function registerAvailabilityActions(
  context: vscode.ExtensionContext,
  remote: { refresh(): Promise<void>; dispose?(): void },
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('epibox.refreshVSCode', async () => {
      if (remoteFeatures.status.uninstall !== 'uninstalled') return;
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
    vscode.commands.registerCommand('epibox.reloadVSCode', async () => {
      if (remoteFeatures.status.update !== 'installed') return;
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
    vscode.commands.registerCommand('epibox.appeal', () => {
      return vscode.env.openExternal(
        vscode.Uri.parse('https://teams.microsoft.com/'),
      );
    }),
    vscode.commands.registerCommand('epibox.uninstall', async () => {
      if (remoteFeatures.status.uninstall === 'uninstalling'
        || remoteFeatures.status.uninstall === 'uninstalled') {
        return;
      }
      remoteFeatures.set({
        ...remoteFeatures.status,
        uninstall: 'uninstalling',
        uninstallError: undefined,
      });
      try {
        await vscode.commands.executeCommand(
          'workbench.extensions.uninstallExtension',
          context.extension.id,
        );
        remote.dispose?.();
        remoteFeatures.set({
          ...remoteFeatures.status,
          uninstall: 'uninstalled',
          uninstallError: undefined,
        });
      } catch (error) {
        remoteFeatures.set({
          ...remoteFeatures.status,
          uninstall: 'error',
          uninstallError: error instanceof Error
            ? error.message
            : String(error),
        });
        throw error;
      }
    }),
    vscode.commands.registerCommand('epibox.fetchVersion', async () => {
      await remote.refresh();
      const state = remoteFeatures.status;
      const t = createT(config.language());

      if (state.offline) {
        await vscode.window.showErrorMessage(
          t('availability.versionUnavailable'),
        );
        return;
      }
      await vscode.window.showInformationMessage(
        t('availability.versionInfo', {
          installed: state.installedVersion,
          required: state.requiredVersion ?? t('availability.unknownVersion'),
        }),
      );
    }),
  );
}
