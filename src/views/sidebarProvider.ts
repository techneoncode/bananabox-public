import * as vscode from 'vscode';
import type { Controller } from '../controller';
import { buildHtml } from './webviewHtml';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'epibox.sidebar';
  static readonly calendarViewType = 'epibox.calendar';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
    private readonly calendar = false,
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
      undefined,
      false,
      this.calendar,
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
