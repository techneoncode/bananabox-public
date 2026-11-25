import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { activate } from '../../src/extension';
import { configure } from './vscode';
import { handle, listen } from './rpc';

let context: any;
let server: ReturnType<typeof createServer>;
let baseUrl = '';
const pages = new Map<string, string>();
handle('webview.content', params => {
  if (!/^[a-zA-Z0-9-]+$/.test(params.id) || typeof params.html !== 'string') throw new Error('Invalid webview page');
  pages.set(params.id, params.html);
  return baseUrl + 'view/' + params.id;
});
handle('webview.removeContent', params => { pages.delete(params.id); });
handle('initialize', async init => {
  if (context) throw new Error('Host already initialized');
  const root = await realpath(init.extensionRoot);
  const token = randomBytes(32).toString('hex');
  server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${(server.address() as any).port}`) { res.writeHead(403).end(); return; }
      const url = new URL(req.url!, 'http://localhost');
      if (!url.pathname.startsWith(`/${token}/`)) { res.writeHead(404).end(); return; }
      const relative = decodeURIComponent(url.pathname.slice(token.length + 2));
      if (relative.startsWith('view/')) {
        const html = pages.get(relative.slice(5));
        if (html === undefined) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        res.end(html); return;
      }
      if (!relative.startsWith('dist/webview/') && !relative.startsWith('images/')) { res.writeHead(404).end(); return; }
      const file = await realpath(path.join(root, relative));
      if (![path.join(root, 'dist', 'webview') + path.sep, path.join(root, 'images') + path.sep].some(allowed => file.startsWith(allowed))) { res.writeHead(403).end(); return; }
      const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}/${token}/`;
  context = configure(init, baseUrl);
  await activate(context);
  return { ready: true };
});
function shutdown(): void {
  for (const disposable of [...context?.subscriptions ?? []].reverse()) { try { disposable.dispose(); } catch {} }
  server?.close(); setTimeout(() => process.exit(0), 100).unref();
}
handle('shutdown', shutdown);
// stdout belongs exclusively to the protocol, including logs from bundled libraries.
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Bananabox requires Node.js 20 or later.');
listen(shutdown);
