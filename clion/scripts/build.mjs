import esbuild from 'esbuild';
import { mkdir, cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
process.chdir(root);
const out = 'clion/build/plugin/bananabox';
const host = `${out}/host`;
await mkdir(`${host}/dist/webview`, { recursive: true });
const common = { bundle: true, minify: true, legalComments: 'none', logLevel: 'info', define: { __BANANABOX_IDE__: JSON.stringify('CLion') } };
const nodeCommon = { ...common, platform: 'node', target: 'node20', alias: { vscode: './clion/host/vscode.ts' }, external: ['bufferutil', 'utf-8-validate'] };
const webCommon = { ...common, platform: 'browser', format: 'iife', target: 'es2022', loader: { '.svg': 'dataurl' } };
await Promise.all([
  esbuild.build({ ...nodeCommon, entryPoints: ['clion/host/main.ts'], outfile: `${host}/main.cjs`, format: 'cjs' }),
  // pdf.js for the host, loaded on demand next to main.cjs (see src/services/pdfText.ts).
  esbuild.build({ ...nodeCommon, entryPoints: ['src/pdfText/entry.ts'], outfile: `${host}/pdftext.js`, format: 'cjs', minify: true, logLevel: 'warning' }),
  esbuild.build({ ...webCommon, entryPoints: ['src/webview/main.ts'], outfile: `${host}/dist/webview/main.js` }),
  esbuild.build({ ...webCommon, entryPoints: ['src/webview/pdf.ts'], outfile: `${host}/dist/webview/pdfviewer.js` }),
  esbuild.build({ ...webCommon, entryPoints: ['src/webview/reminder.ts'], outfile: `${host}/dist/webview/reminder.js` }),
  esbuild.build({ ...webCommon, entryPoints: ['src/webview/admin.ts'], outfile: `${host}/dist/webview/admin.js` }),
]);

// Same static assets as esbuild.mjs: the sidebar app stylesheets ship appended to the main one, in name order.
const appCss = (await readdir('src/webview/app')).filter(f => f.endsWith('.css')).sort();
const styles = [await readFile('src/webview/styles.css', 'utf8'), ...await Promise.all(appCss.map(f => readFile(`src/webview/app/${f}`, 'utf8')))];
await writeFile(`${host}/dist/webview/styles.css`, styles.join('\n'));
for (const [from, to] of [
  ['node_modules/@vscode/codicons/dist/codicon.css', 'dist/webview/codicon.css'],
  ['node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/webview/codicon.ttf'],
  ['media/fonts/archivo.woff2', 'dist/webview/archivo.woff2'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/webview/pdf.worker.min.mjs'],
  ['images', 'images'], ['package.json', 'package.json'], ['LICENSE', 'LICENSE'], ['licenses', 'licenses'],
]) await cp(from, `${host}/${to}`, { recursive: true });
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const actions = manifest.contributes.commands.map(command => `<action id="${command.command}" class="eu.bananabox.clion.CommandAction" text="${escape(command.title)}"/>`).join('\n');
await mkdir('clion/build/resources/META-INF', { recursive: true });
const xml = (await readFile('clion/src/main/resources/META-INF/plugin.xml', 'utf8')).replace('@VERSION@', manifest.version).replace('<!-- COMMANDS -->', actions);
await writeFile('clion/build/resources/META-INF/plugin.xml', xml);
await cp('clion/src/main/resources/META-INF/bananabox-github.xml', 'clion/build/resources/META-INF/bananabox-github.xml');
await cp('media/activity.svg', 'clion/build/resources/bananabox.svg');
if (!process.argv.includes('--host-only')) {
  const result = spawnSync('python3', ['clion/scripts/package.py', ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
