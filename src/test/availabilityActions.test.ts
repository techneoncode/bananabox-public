import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { registerAvailabilityActions } from '../services/availabilityActions';
import { remoteFeatures } from '../services/remoteFeatures';
import { remoteStatus } from '../domain/remotePolicy';
import { Controller } from '../controller';

test('blocked users can appeal in Teams, uninstall only Bananabox and fetch version without authenticating', async () => {
  const registry = new Map<string, (...args: any[]) => unknown>();
  const executed: unknown[][] = [], opened: string[] = [], notices: string[] = [], errors: string[] = [];
  let refreshes = 0, blocked = 0, disposed = 0;
  let failUninstall = false;
  const previousCommands = { ...vscode.commands }, previousEnv = { ...vscode.env }, previousWindow = { ...vscode.window };
  Object.assign(vscode.commands, {
    registerCommand: (name: string, handler: (...args: any[]) => unknown) => {
      registry.set(name, handler); return { dispose: () => registry.delete(name) };
    },
    executeCommand: async (name: string, ...args: unknown[]) => {
      executed.push([name, ...args]);
      if (name === 'workbench.extensions.uninstallExtension' && failUninstall) throw new Error('Uninstall failed');
      return registry.get(name)?.(...args);
    },
  });
  Object.assign(vscode.env, { openExternal: async (url: vscode.Uri) => { opened.push(url.toString()); return true; } });
  Object.assign(vscode.window, {
    showInformationMessage: async (text: string) => { notices.push(text); },
    showErrorMessage: async (text: string) => { errors.push(text); },
  });
  const context = { extension: { id: 'techneoncode.bananabox' }, subscriptions: [] } as unknown as vscode.ExtensionContext;
  const controller = Object.assign(Object.create(Controller.prototype), { auth: { isSignedIn: false }, pushState: () => blocked++ });
  try {
    remoteFeatures.set(remoteStatus({ lens_active: true, my_api_active: false, version: '0.5.3', latest: '', authorizedUsers: [] }, '0.5.3', 'guest'));
    registerAvailabilityActions(context, { refresh: async () => { refreshes++; }, dispose: () => { disposed++; } });
    for (const update of ['idle', 'downloading', 'verifying', 'installing', 'error'] as const) {
      remoteFeatures.set({ ...remoteFeatures.status, update });
      await controller.handle({}, { type: 'reloadVSCode' });
      assert.ok(!executed.some(args => args[0] === 'workbench.action.reloadWindow'));
    }
    remoteFeatures.set({ ...remoteFeatures.status, update: 'installed' });
    await controller.handle({}, { type: 'reloadVSCode' });
    assert.equal(executed.filter(args => args[0] === 'workbench.action.reloadWindow').length, 1);
    for (const uninstall of [undefined, 'uninstalling', 'error'] as const) {
      remoteFeatures.set({ ...remoteFeatures.status, uninstall });
      await controller.handle({}, { type: 'refreshVSCode' });
      assert.equal(executed.filter(args => args[0] === 'workbench.action.reloadWindow').length, 1);
    }
    await controller.handle({}, { type: 'appeal' });
    assert.deepEqual(opened, ['https://teams.microsoft.com/']);
    failUninstall = true;
    await assert.rejects(controller.handle({}, { type: 'uninstall' }), /Uninstall failed/);
    assert.equal(remoteFeatures.status.uninstall, 'error');
    await controller.handle({}, { type: 'refreshVSCode' });
    assert.equal(executed.filter(args => args[0] === 'workbench.action.reloadWindow').length, 1);
    failUninstall = false;
    await controller.handle({}, { type: 'uninstall', extensionId: 'another.extension' });
    assert.ok(executed.some(args => args[0] === 'workbench.extensions.uninstallExtension' && args[1] === 'techneoncode.bananabox'));
    assert.ok(!executed.some(args => args.includes('another.extension')));
    assert.equal(disposed, 1);
    assert.equal(remoteFeatures.status.uninstall, 'uninstalled');
    await controller.handle({}, { type: 'refreshVSCode' });
    assert.equal(executed.filter(args => args[0] === 'workbench.action.reloadWindow').length, 2);
    await controller.handle({}, { type: 'fetchVersion' });
    assert.equal(refreshes, 1);
    assert.match(notices.at(-1)!, /0\.5\.3/);
    remoteFeatures.set(remoteStatus(undefined, '0.5.3', 'guest', true));
    await controller.handle({}, { type: 'fetchVersion' });
    assert.equal(refreshes, 2);
    assert.match(errors.at(-1)!, /Unable to fetch/);
    await controller.handle({}, { type: 'runGrader' });
    assert.equal(blocked, 1);
  } finally {
    context.subscriptions.forEach(disposable => disposable.dispose());
    Object.assign(vscode.commands, previousCommands); Object.assign(vscode.env, previousEnv); Object.assign(vscode.window, previousWindow);
    remoteFeatures.set(remoteStatus(undefined, '0.5.3', 'guest'));
  }
});
