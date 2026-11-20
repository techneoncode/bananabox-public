import * as vscode from 'vscode';
import type { Controller } from '../controller';
import { buildHtml } from './webviewHtml';
import type { PanelTab } from '../shared/protocol';

/** One editor tab per project; re-opening a project reveals its existing tab. */
export class ProjectPanels {
  private readonly panels = new Map<number, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
  ) {}

  show(projectId: number, title: string, tab?: PanelTab): void {
    const existing = this.panels.get(projectId);
    if (existing) {
      existing.title = title;
      existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active);
      if (tab) void existing.webview.postMessage({ type: 'selectTab', tab });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'bananabox.project',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'images'),
        ],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'images',
      'icon_nobg.png',
    );
    panel.webview.html = buildHtml(
      panel.webview,
      this.extensionUri,
      'panel',
      projectId,
    );
    const detach = this.controller.attach(
      panel.webview,
      'panel',
      projectId,
      tab,
    );
    this.panels.set(projectId, panel);
    panel.onDidDispose(() => {
      detach();
      this.panels.delete(projectId);
    });
  }

  closeAll(): void {
    [...this.panels.values()].forEach((p) => p.dispose());
  }
}
