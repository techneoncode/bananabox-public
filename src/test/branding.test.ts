import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { buildHtml } from '../views/webviewHtml';

// Exercise the resource boundary with an installed extension URI rather than a web URL.
Object.assign(vscode.Uri, { joinPath: (base: vscode.Uri, ...parts: string[]) => vscode.Uri.file(join(base.fsPath, ...parts)) });

test('sidebar and editor HTML embed the installed logo with a CSP that permits it', () => {
  const expected = readFileSync('images/icon_nobg.png');
  const webview = { cspSource: 'https://webview.example.invalid', asWebviewUri: (uri: vscode.Uri) => `https://webview.example.invalid${uri.fsPath}` } as unknown as vscode.Webview;
  for (const surface of ['sidebar', 'panel'] as const) {
    const html = buildHtml(webview, vscode.Uri.file(process.cwd()), surface);
    const encoded = /data-logo="data:image\/png;base64,([^"]+)"/.exec(html);
    assert.ok(encoded);
    assert.deepEqual(Buffer.from(encoded[1], 'base64'), expected);
    assert.match(html, /img-src https:\/\/webview.example.invalid data: blob:/);
    assert.ok(!html.includes('https://github.com/'), 'the logo must load without a network request');
  }
});

test('Bananabox navigation uses a local SVG box and the commit icon keeps its alpha channel', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const icons = [
    manifest.contributes.viewsContainers.activitybar[0].icon,
    manifest.contributes.views.bananabox[0].icon,
    manifest.contributes.views.explorer.find((view: { id: string }) => view.id === 'bananabox.commits').icon,
  ];
  assert.equal(icons[0], 'media/activity.svg');
  assert.equal(icons[1], 'media/activity.svg');
  assert.equal(icons[2], 'images/gitdiff_nobg.png');
  const svg = readFileSync(icons[0], 'utf8');
  assert.match(svg, /<svg\b/);
  assert.match(svg, /fill="none"/);
  assert.ok(!svg.includes('<image'), 'the activity icon must remain a vector asset');
  const png = readFileSync(icons[2]);
  assert.equal(png.subarray(12, 16).toString(), 'IHDR');
  assert.equal(png[25], 6, 'the commit icon must have an RGBA alpha channel');
});

test('extension overview uses direct HTTPS image URLs accepted by the VS Code sanitiser', () => {
  const source = readFileSync('README.md', 'utf8');
  const images = [...source.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(images.length, 10);
  const hosts = ['i.imgur.com', 'raw.githubusercontent.com'];
  images.forEach(image => {
    const uri = new URL(image);
    assert.equal(uri.protocol, 'https:');
    // shields.io is a badge provider vsce trusts, so its SVGs are allowed.
    if (uri.hostname === 'img.shields.io') return;
    assert.ok(hosts.includes(uri.hostname), `${uri.hostname} is not an image CDN`);
    assert.match(uri.pathname, /\.png$/);
  });
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(!manifest.scripts.package.includes('--no-rewrite-relative-links'), 'vsce must validate HTTPS README images');
  assert.ok(!manifest.scripts.package.includes('--readmePath'), 'package the source README rather than the obsolete base64 document');
});
