import * as vscode from 'vscode';
import type { Controller } from '../controller';
import { buildHtml } from './webviewHtml';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'bananabox.sidebar';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const { webview } = view;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'images'),
      ],
    };
    webview.html = buildHtml(
      webview,
      this.extensionUri,
      'sidebar',
    );
    const detach = this.controller.attach(webview, 'sidebar');
    view.onDidDispose(detach);
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.controller.pushState();
      }
    });
  }
}
