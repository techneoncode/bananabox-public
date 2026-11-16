import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
  acknowledgedDefenseKeys,
  dueDefenseAlert,
  type DefenseAlert,
  type DefenseEvent,
} from '../domain/defenseReminders';
import { buildReminderHtml } from '../views/webviewHtml';
import { createT } from '../shared/i18n';

/**
 * Persistent, focused editor reminder. VS Code does not expose a workbench-wide
 * input lock.
 */
export class DefenseReminderService implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private active: DefenseAlert | undefined;
  private preview: DefenseAlert | undefined;
  private events: DefenseEvent[] = [];
  private login: string | null = null;
  private acknowledged = new Set<string>();
  private nonce = '';
  private disposed = false;
  private focusTimer: NodeJS.Timeout | undefined;
  private readonly timer: NodeJS.Timeout;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly language: () => 'en' | 'fr',
  ) {
    this.timer = setInterval(() => this.check(), 10_000);
    const refocus = () => this.refocus();
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(refocus),
      vscode.window.onDidChangeActiveTerminal?.(refocus) ?? { dispose() {} },
      vscode.window.onDidChangeWindowState(e => {
        if (e.focused) {
          this.check();
          this.refocus();
        }
      }),
      vscode.commands.registerCommand(
        'epibox.acknowledgeDefense',
        () => this.acknowledge(),
      ),
    );
  }

  update(login: string | null, events: DefenseEvent[]): void {
    if (login !== this.login) {
      this.close();
      this.login = login;
      this.acknowledged = new Set(
        login
          ? this.context.globalState.get<string[]>(this.storageKey(), [])
          : [],
      );
    }
    this.events = login ? events : [];
    this.check();
  }

  /**
   * Exercises the real countdown and acknowledgement without creating a booking
   * or saving acknowledgements.
   */
  testPopup(projectId: number, projectName: string): void {
    if (this.disposed || !this.login) return;
    if (this.active && !this.active.test) {
      this.refocus();
      return;
    }

    const now = Date.now();
    this.preview = {
      key: `preview:${randomUUID()}`,
      projectId,
      projectName,
      activityName: createT(this.language())('defense.testActivity'),
      startDate: new Date(now + 15 * 60_000).toISOString(),
      endDate: new Date(now + 30 * 60_000).toISOString(),
      location: null,
      minutes: 15,
      test: true,
    };
    this.check();
  }

  private storageKey(): string {
    return `epibox.defenseReminders.v1:${this.login?.toLowerCase()}`;
  }

  private check(): void {
    if (this.disposed) return;
    const due = this.events
      .map(e => dueDefenseAlert(e, this.acknowledged))
      .filter((e): e is DefenseAlert => !!e)
      .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0]
      ?? this.preview;
    if (!due) {
      this.close();
      return;
    }
    if (this.active?.key === due.key
      && this.active.minutes === due.minutes
      && this.panel) {
      return;
    }

    this.active = due;
    this.nonce = randomUUID();
    void vscode.commands.executeCommand(
      'setContext',
      'epibox.defenseAlertActive',
      true,
    );
    this.show();
    this.send();
  }

  private show(): void {
    if (this.disposed || !this.active) return;
    if (this.panel) {
      this.refocus();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'epibox.defenseReminder',
      createT(this.language())('defense.title'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.context.extensionUri, 'images'),
        ],
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'images',
      'icon_nobg.png',
    );
    panel.webview.html = buildReminderHtml(
      panel.webview,
      this.context.extensionUri,
    );
    const messages = panel.webview.onDidReceiveMessage(m => {
      if (m?.type === 'ready') this.send();
      if (m?.type === 'acknowledge' && m.nonce === this.nonce) {
        this.acknowledge();
      }
    });
    const visibility = panel.onDidChangeViewState?.(e => {
      if (!e.webviewPanel.active) this.refocus();
    });
    panel.onDidDispose(() => {
      messages.dispose();
      visibility?.dispose();
      if (this.panel === panel) this.panel = undefined;
      if (this.active && !this.disposed) this.refocus();
    });
  }

  private send(): void {
    void this.panel?.webview.postMessage({
      type: 'defenseAlert',
      alert: this.active,
      nonce: this.nonce,
      lang: this.language(),
    });
  }

  private refocus(): void {
    if (!this.active || this.disposed || this.focusTimer) return;
    this.focusTimer = setTimeout(() => {
      this.focusTimer = undefined;
      if (!this.active || this.disposed) return;
      if (this.panel) {
        this.panel.reveal(
          this.panel.viewColumn ?? vscode.ViewColumn.Active,
          false,
        );
      } else {
        this.show();
      }
    }, 100);
  }

  private acknowledge(): void {
    if (!this.active || !this.login) return;
    if (this.active.test) {
      this.close();
      this.check();
      return;
    }

    const current = dueDefenseAlert(this.active, this.acknowledged);
    if (current && current.minutes !== this.active.minutes) {
      this.active = current;
      this.nonce = randomUUID();
      this.send();
      return;
    }
    for (const key of acknowledgedDefenseKeys(current ?? this.active)) {
      this.acknowledged.add(key);
    }
    this.acknowledged = new Set([...this.acknowledged].slice(-2000));
    void this.context.globalState.update(
      this.storageKey(),
      [...this.acknowledged],
    );
    this.close();
    this.check();
  }

  private close(): void {
    clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
    this.active = undefined;
    this.preview = undefined;
    this.nonce = '';
    const panel = this.panel;
    this.panel = undefined;
    panel?.dispose();
    void vscode.commands.executeCommand(
      'setContext',
      'epibox.defenseAlertActive',
      false,
    );
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.close();
    this.subscriptions.forEach(s => s.dispose());
  }
}
