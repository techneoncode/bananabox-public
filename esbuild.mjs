// @ts-check
import esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

if (tests) {
  rmSync('dist-test', { recursive: true, force: true });
  const files = readdirSync('src/test').filter((f) => f.endsWith('.test.ts')).map((f) => join('src/test', f));
  await esbuild.build({
    entryPoints: files,
    outdir: 'dist-test',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['bufferutil', 'utf-8-validate'],
    alias: { vscode: './src/test/vscode.mock.ts' },
    logLevel: 'info',
  });
  await esbuild.build({
    entryPoints: readdirSync('src/codingStyle').filter(f => f.endsWith('.ts')).map(f => join('src/codingStyle', f)),
    outdir: 'dist-test/codingStyle',
    bundle: false,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'info',
  });
  // The lens reuses the allowed-functions scanner of the domain layer.
  await esbuild.build({
    entryPoints: ['src/domain/allowedFunctions.ts', 'src/domain/forbiddenFunctions.ts'],
    outdir: 'dist-test/domain',
    bundle: false,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'info',
  });
  process.exit(0);
}

/** Static assets copied next to the bundles so the webview can load them. */
function copyAssets() {
  mkdirSync('dist/webview', { recursive: true });
  // The sidebar app's stylesheets (src/webview/app/*.css) ship appended to the main one, in name order.
  const appCss = readdirSync('src/webview/app').filter(f => f.endsWith('.css')).sort().map(f => readFileSync(`src/webview/app/${f}`, 'utf8'));
  writeFileSync('dist/webview/styles.css', [readFileSync('src/webview/styles.css', 'utf8'), ...appCss].join('\n'));
  cpSync('node_modules/@vscode/codicons/dist/codicon.css', 'dist/webview/codicon.css');
  cpSync('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/webview/codicon.ttf');
  cpSync('media/fonts/archivo.woff2', 'dist/webview/archivo.woff2');
  cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/webview/pdf.worker.min.mjs');
}

/** @type {import('esbuild').BuildOptions} */
const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info', legalComments: 'none' };

const extension = { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', target: 'node20', external: ['vscode', 'bufferutil', 'utf-8-validate'] };
const reminder = { ...common, entryPoints: ['src/webview/reminder.ts'], outfile: 'dist/webview/reminder.js', platform: 'browser', format: 'iife', target: 'es2022' };
const admin = { ...common, entryPoints: ['src/webview/admin.ts'], outfile: 'dist/webview/admin.js', platform: 'browser', format: 'iife', target: 'es2022' };
const pdfviewer = { ...common, entryPoints: ['src/webview/pdf.ts'], outfile: 'dist/webview/pdfviewer.js', platform: 'browser', format: 'iife', target: 'es2022' };
// pdf.js for the extension host (reading a subject's allowed functions), loaded on demand from dist/pdftext.js.
const pdftext = { ...common, entryPoints: ['src/pdfText/entry.ts'], outfile: 'dist/pdftext.js', platform: 'node', format: 'cjs', target: 'node20', minify: true, sourcemap: false, logLevel: 'warning' };
const webview = { ...common, entryPoints: ['src/webview/main.ts'], outfile: 'dist/webview/main.js', platform: 'browser', format: 'iife', target: 'es2022' };

copyAssets();
if (watch) {
  const a = await esbuild.context(extension);
  const b = await esbuild.context(webview);
  const c = await esbuild.context(pdfviewer);
  const d = await esbuild.context(reminder);
  const e = await esbuild.context(admin);
  await esbuild.build(pdftext);
  await Promise.all([a.watch(), b.watch(), c.watch(), d.watch(), e.watch()]);
  console.log('[bananabox] watching…');
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview), esbuild.build(pdfviewer), esbuild.build(reminder), esbuild.build(admin), esbuild.build(pdftext)]);
}
