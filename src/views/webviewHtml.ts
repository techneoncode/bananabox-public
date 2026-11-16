import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function buildHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  surface: 'sidebar' | 'panel',
  projectId?: number,
  home = false,
  calendar = false,
): string {
  const asset = (file: string) =>
    webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file),
    );
  const logo = `data:image/png;base64,${readFileSync(
    join(extensionUri.fsPath, 'images', 'icon_nobg.png'),
  ).toString('base64')}`;
  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data: blob:`,
    `script-src 'nonce-${n}'`,
    `worker-src blob:`,
    `connect-src ${webview.cspSource} blob:`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en" data-surface="${surface}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${asset('codicon.css')}" rel="stylesheet" id="vscode-codicon-stylesheet" />
  <link href="${asset('styles.css')}" rel="stylesheet" />
  <title>Bananabox</title>
</head>
<body data-surface="${surface}" ${projectId !== undefined ? `data-project-id="${projectId}"` : ''} ${home ? 'data-home="1"' : ''} ${calendar ? 'data-calendar="1"' : ''} data-logo="${logo}" data-pdf-worker="${asset('pdf.worker.min.mjs')}" data-pdf-viewer="${asset('pdfviewer.js')}">
  <div id="app" role="application" aria-label="Bananabox"></div>
  <script nonce="${n}" src="${asset('main.js')}"></script>
</body>
</html>`;
}

/** Uses the same theme, fonts, logo and CSP as project views. */
export function buildReminderHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  return buildHtml(webview, extensionUri, 'panel')
    .replace('main.js', 'reminder.js')
    .replace(
      'aria-label="Bananabox"',
      'aria-label="Bananabox defense reminder"',
    );
}
