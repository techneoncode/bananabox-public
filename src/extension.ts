import * as vscode from 'vscode';
import { activate as activateCodingStyle } from './codingStyle/extension';
import { Controller } from './controller';
import { ProjectPanels } from './views/projectPanel';
import { HomePanel } from './views/homePanel';
import { SidebarProvider } from './views/sidebarProvider';
import { AdminView } from './views/adminView';
import { AdminService } from './services/adminService';
import {
  RemoteControl,
  type RemoteControlDependencies,
} from './services/remoteControl';
import { InstallStats } from './services/installStats';
import { remoteFeatures } from './services/remoteFeatures';
import { registerAvailabilityActions } from './services/availabilityActions';
import { migrateLegacyPrefix } from './services/legacyMigration';
import { tr } from './util/text';

export async function activate(
  context: vscode.ExtensionContext,
  remoteDependencies?: RemoteControlDependencies,
): Promise<void> {
  await migrateLegacyPrefix(context);
  const remote = new RemoteControl(context, remoteDependencies);
  context.subscriptions.push(remote);
  await remote.start();
  let stats: InstallStats | undefined;
  // Only the first name and the initial of the last name leave the machine, never the full name.
  let profile: { firstName: string | null; lastInitial: string | null } = { firstName: null, lastInitial: null };
  const reporter = () => ({ ...remote.identity, ...profile });
  // Skipped when offline or refused: no statistics from an account the policy blocks.
  if (
    !remoteFeatures.status.offline
    && !remoteFeatures.status.connectionRefused
  ) {
    stats = new InstallStats(
      context,
      context.extension.packageJSON.version,
      remoteDependencies?.fetch,
      reporter,
    );
    void stats.report();
  }

  const controller = new Controller(context);
  remote.busy = () => controller.grader.busy;
  controller.onTermsAccepted = () => void stats?.report();
  // The name, promotion and campus come with the sign-in: bans on them apply at once and are reported with the statistics.
  let reportedIdentity = JSON.stringify(reporter());
  const syncIdentity = (auth: typeof controller.auth.snapshot) => {
    if (auth.status !== 'signedIn') return;
    remote.setIdentity({ promotion: auth.promotion, cursus: auth.cursus, campus: auth.campus });
    profile = { firstName: auth.firstname, lastInitial: auth.lastname?.trim().charAt(0).toUpperCase() || null };
    const identity = JSON.stringify(reporter());
    if (identity === reportedIdentity) return;
    reportedIdentity = identity;
    if (!remoteFeatures.status.connectionRefused) void stats?.report();
  };
  context.subscriptions.push(controller.auth.onDidChange(syncIdentity));
  syncIdentity(controller.auth.snapshot);
  controller.panels = new ProjectPanels(context.extensionUri, controller);
  controller.home = new HomePanel(context.extensionUri, controller);
  registerAvailabilityActions(context, remote);

  // The dashboard is offered to the accounts listed as admins; the API still demands a login.
  const adminView = new AdminView(context.extensionUri, new AdminService(context.secrets, remoteDependencies?.fetch));
  let wasAdmin: boolean | undefined;
  const syncAdmin = () => {
    const admin = remoteFeatures.status.admin === true;
    if (admin === wasAdmin) return;
    const lostAccess = wasAdmin === true && !admin;
    wasAdmin = admin;
    void vscode.commands.executeCommand('setContext', 'bananabox.isAdmin', admin);
    if (lostAccess) void adminView.revoke();
  };
  syncAdmin();
  context.subscriptions.push(remoteFeatures.onDidChange(syncAdmin));

  await vscode.commands.executeCommand('setContext', 'bananabox.signedIn', false);
  await vscode.commands.executeCommand(
    'setContext',
    'bananabox.hasCurrentProject',
    false,
  );

  const cmd = (
    id: string,
    fn: (...args: any[]) => unknown,
  ) => vscode.commands.registerCommand(id, (...args: any[]) => {
    if (
      id !== 'bananabox.refresh'
      && id !== 'bananabox.signOut'
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
      AdminView.viewType,
      adminView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    cmd('bananabox.signInMicrosoft', () => controller.signInMicrosoft()),
    cmd('bananabox.signIn', () => controller.signIn()),
    cmd('bananabox.signOut', () => controller.signOut()),
    cmd('bananabox.refresh', async () => {
      await remote.refresh();
      await controller.refresh();
    }),
    cmd('bananabox.openProject', async () => {
      const pick = await vscode.window.showQuickPick(
        (controller.projects.projects ?? []).map((p) => ({
          label: p.name,
          description: p.unitName,
          detail: p.status,
          id: p.id,
        })),
        { title: tr('Open project details'), placeHolder: tr('Search a project') },
      );
      if (pick) controller.openProject(pick.id);
    }),
    cmd('bananabox.openCurrentProject', () => controller.openCurrentProject()),
    cmd('bananabox.openHome', () => controller.home?.show()),
    cmd('bananabox.runGrader', () => controller.runGrader()),
    cmd('bananabox.checkReadiness', () => controller.checkReadiness()),
    cmd('bananabox.guidedDelivery', () => controller.guidedDelivery()),
    cmd('bananabox.cloneProject', () => controller.cloneProject()),
    cmd('bananabox.openSubject', () => controller.openSubjectCommand()),
    cmd('bananabox.openOnIntranet', () => controller.openOnIntranet()),
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
