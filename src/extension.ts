import * as vscode from 'vscode';
import { activate as activateCodingStyle } from './codingStyle/extension';
import { Controller } from './controller';
import { ProjectPanels } from './views/projectPanel';
import { HomePanel } from './views/homePanel';
import { SidebarProvider } from './views/sidebarProvider';
import {
  RemoteControl,
  type RemoteControlDependencies,
} from './services/remoteControl';
import { remoteFeatures } from './services/remoteFeatures';
import { registerAvailabilityActions } from './services/availabilityActions';

export async function activate(
  context: vscode.ExtensionContext,
  remoteDependencies?: RemoteControlDependencies,
): Promise<void> {
  const remote = new RemoteControl(context, remoteDependencies);
  context.subscriptions.push(remote);
  await remote.start();

  const controller = new Controller(context);
  controller.panels = new ProjectPanels(context.extensionUri, controller);
  controller.home = new HomePanel(context.extensionUri, controller);
  registerAvailabilityActions(context, remote);

  await vscode.commands.executeCommand('setContext', 'epibox.signedIn', false);
  await vscode.commands.executeCommand(
    'setContext',
    'epibox.hasCurrentProject',
    false,
  );

  const cmd = (
    id: string,
    fn: (...args: any[]) => unknown,
  ) => vscode.commands.registerCommand(id, (...args: any[]) => {
    if (
      id !== 'epibox.refresh'
      && id !== 'epibox.signOut'
      && !remoteFeatures.status.myApiActive
    ) {
      controller.pushState();
      return;
    }

    return fn(...args);
  });
  context.subscriptions.push(
    controller,
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      new SidebarProvider(context.extensionUri, controller),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.calendarViewType,
      new SidebarProvider(context.extensionUri, controller, true),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    cmd('epibox.signInMicrosoft', () => controller.signInMicrosoft()),
    cmd('epibox.signIn', () => controller.signIn()),
    cmd('epibox.signOut', () => controller.signOut()),
    cmd('epibox.refresh', async () => {
      await remote.refresh();
      await controller.refresh();
    }),
    cmd('epibox.openProject', async () => {
      const pick = await vscode.window.showQuickPick(
        (controller.projects.projects ?? []).map((p) => ({
          label: p.name,
          description: p.unitName,
          detail: p.status,
          id: p.id,
        })),
        { title: 'Open project details', placeHolder: 'Search a project' },
      );
      if (pick) controller.openProject(pick.id);
    }),
    cmd('epibox.openCurrentProject', () => controller.openCurrentProject()),
    cmd('epibox.openHome', () => controller.home?.show()),
    cmd('epibox.runGrader', () => controller.runGrader()),
    cmd('epibox.checkReadiness', () => controller.checkReadiness()),
    cmd('epibox.guidedDelivery', () => controller.guidedDelivery()),
    cmd('epibox.cloneProject', () => controller.cloneProject()),
    cmd('epibox.openSubject', () => controller.openSubjectCommand()),
    cmd('epibox.openOnIntranet', () => controller.openOnIntranet()),
  );

  controller.style.api = activateCodingStyle(context, {
    enabled: () => remoteFeatures.status.lensActive,
    onDidChange: remoteFeatures.onDidChange,
  });
  controller.style.api.useProjectRules?.(
    (file) => controller.projectRules(file),
  );
  await controller.start();
}

export function deactivate(): void {}
