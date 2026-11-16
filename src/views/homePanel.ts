import * as vscode from 'vscode';
import type { Controller } from '../controller';
import { buildHtml } from './webviewHtml';

/** The wide Home dashboard: one editor tab, revealed when it already exists. */
export class HomePanel {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'epibox.home',
      'Bananabox',
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
      undefined,
      true,
    );
    const detach = this.controller.attach(panel.webview, 'panel');
    this.panel = panel;
    panel.onDidDispose(() => {
      detach();
      this.panel = null;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
