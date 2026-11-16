import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { DefenseReminderService } from '../services/defenseReminderService';
import type { DefenseEvent } from '../domain/defenseReminders';

Object.assign(vscode.Uri, { joinPath: (base: vscode.Uri, ...parts: string[]) => vscode.Uri.file(join(base.fsPath, ...parts)) });

function harness() {
  const editor = new vscode.EventEmitter<void>(), terminal = new vscode.EventEmitter<void>(), focus = new vscode.EventEmitter<{ focused: boolean }>();
  const panels: any[] = [], commands = new Map<string, () => void>(), store = new Map<string, unknown>();
  Object.assign(vscode.window, { onDidChangeActiveTextEditor: editor.event, onDidChangeActiveTerminal: terminal.event, onDidChangeWindowState: focus.event,
    createWebviewPanel: () => {
      const received = new vscode.EventEmitter<any>(), visibility = new vscode.EventEmitter<any>(), disposed = new vscode.EventEmitter<void>();
      const panel: any = { active: true, reveals: 0, disposed: false, viewColumn: 1,
        messages: [] as any[], receive: received.fire.bind(received),
        webview: { html: '', cspSource: 'https://test.invalid', asWebviewUri: (u: vscode.Uri) => `https://test.invalid${u.fsPath}`,
          onDidReceiveMessage: received.event, postMessage: async (m: unknown) => panel.messages.push(m) },
        onDidChangeViewState: visibility.event, onDidDispose: disposed.event,
        reveal() { this.reveals++; this.active = true; },
        hide() { this.active = false; visibility.fire({ webviewPanel: this }); },
        dispose() { if (!this.disposed) { this.disposed = true; disposed.fire(); } },
      };
      panels.push(panel); return panel;
    } });
  Object.assign(vscode.commands, { registerCommand: (id: string, fn: () => void) => { commands.set(id, fn); return { dispose: () => commands.delete(id) }; } });
  const context = { extensionUri: vscode.Uri.file(process.cwd()), globalState: {
    get: (k: string, fallback: unknown) => store.get(k) ?? fallback,
    update: async (k: string, v: unknown) => { store.set(k, v); },
  } } as unknown as vscode.ExtensionContext;
  return { context, panels, store, commands, editor, terminal, focus };
}

test('reminder takes focus, returns after closing, requires the current nonce, and remembers acknowledgement across restarts', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.parse('2026-12-10T09:00:00Z') });
  const h = harness();
  const event: DefenseEvent = { key: 'event', projectId: 1, projectName: 'Project', activityName: 'Midterm defense', startDate: '2026-12-10T10:00:00Z', endDate: '2026-12-10T10:15:00Z', location: null };
  let service = new DefenseReminderService(h.context, () => 'en');
  try {
    service.update('student@example.test', [event]);
    assert.equal(h.panels.length, 1);
    let panel = h.panels.at(-1);
    assert.match(panel.webview.html, /reminder.js/);
    panel.receive({ type: 'ready' });
    assert.equal(panel.messages.at(-1).alert.minutes, 60);
    const firstNonce = panel.messages.at(-1).nonce;
    panel.receive({ type: 'acknowledge', nonce: 'wrong' });
    assert.equal(panel.disposed, false);
    panel.hide(); t.mock.timers.tick(100); assert.ok(panel.reveals > 0);
    panel.dispose(); t.mock.timers.tick(100);
    assert.equal(h.panels.length, 2, 'closing is not acknowledgement');
    panel = h.panels.at(-1); panel.receive({ type: 'ready' });
    panel.receive({ type: 'acknowledge', nonce: firstNonce });
    assert.equal(panel.disposed, true); assert.equal(h.store.size, 1);
    service.dispose();
    service = new DefenseReminderService(h.context, () => 'en');
    service.update('student@example.test', [event]);
    assert.equal(h.panels.length, 2, 'restart does not repeat the acknowledged threshold');
    t.mock.timers.tick(30 * 60_000);
    assert.equal(h.panels.at(-1).messages.at(-1).alert.minutes, 30);
    t.mock.timers.tick(15 * 60_000);
    assert.equal(h.panels.at(-1).messages.at(-1).alert.minutes, 15);
    service.update('student@example.test', []);
    assert.equal(h.panels.at(-1).disposed, true, 'cancelling the booking closes the reminder');
    service.update('another@example.test', [event]);
    assert.equal(h.panels.at(-1).messages.at(-1).alert.minutes, 15, 'another user has independent acknowledgements');
    service.update(null, []);
    assert.equal(h.panels.at(-1).disposed, true);
  } finally { service.dispose(); }
});

test('Test popup uses the real urgent alert and key acknowledgement without changing real reminder history', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.parse('2026-12-10T09:00:00Z') });
  const h = harness(), service = new DefenseReminderService(h.context, () => 'fr');
  try {
    service.update('student@example.test', []);
    service.testPopup(7, 'my_ls');
    const panel = h.panels.at(-1);
    assert.equal(panel.messages.at(-1).alert.test, true);
    assert.equal(panel.messages.at(-1).alert.minutes, 15);
    assert.equal(panel.messages.at(-1).alert.projectName, 'my_ls');
    service.update('student@example.test', []);
    t.mock.timers.tick(10_000);
    assert.equal(panel.disposed, false, 'background updates must not dismiss the preview');
    h.commands.get('epibox.acknowledgeDefense')!();
    assert.equal(panel.disposed, true);
    assert.equal(h.store.size, 0, 'test acknowledgement must never consume a real reminder');
    t.mock.timers.tick(20_000);
    assert.equal(h.panels.length, 1);
    service.update('student@example.test', [{ key: 'real', projectId: 7, projectName: 'my_ls', activityName: 'Defense',
      startDate: '2026-12-10T09:15:00Z', endDate: '2026-12-10T09:30:00Z', location: null }]);
    assert.equal(h.panels.length, 2);
    assert.equal(h.panels.at(-1).messages.at(-1).alert.test, undefined);
    service.testPopup(7, 'my_ls');
    assert.equal(h.panels.at(-1).messages.at(-1).alert.key, 'real', 'a real reminder always takes priority');
  } finally { service.dispose(); }
});
