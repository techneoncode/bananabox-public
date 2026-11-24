// Dev-only: builds a fixtures page for every webview screen into dist/preview (ignored by git).
import esbuild from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = path.resolve('dist/preview');
await mkdir(out, { recursive: true });
await esbuild.build({ entryPoints: ['scripts/preview/fixtures.ts'], outfile: `${out}/fixtures.js`, bundle: true, platform: 'browser', target: 'es2022', logLevel: 'warning' });
const webview = pathToFileURL(path.resolve('dist/webview')).href;
const logo = pathToFileURL(path.resolve('images/icon_nobg.png')).href;
const themes = {
  dark: ':root{--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-widget-border:#454545;--vscode-panel-border:#2b2b2b;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-textLink-foreground:#4daafc;--vscode-focusBorder:#0078d4;--vscode-list-hoverBackground:#2a2d2e;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-button-secondaryHoverBackground:#3c3c3c;--vscode-input-background:#313131;--vscode-input-border:#3c3c3c;--vscode-input-foreground:#cccccc;--vscode-testing-iconPassed:#73c991;--vscode-errorForeground:#f85149;--vscode-editorWarning-foreground:#cca700;--vscode-font-family:system-ui,-apple-system,"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:"DejaVu Sans Mono",monospace;--vscode-textCodeBlock-background:#2b2b2b;--vscode-menu-background:#1f1f1f;--vscode-menu-border:#454545}',
  light: ':root{--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-widget-border:#e5e5e5;--vscode-panel-border:#e5e5e5;--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;--vscode-textLink-foreground:#005fb8;--vscode-focusBorder:#005fb8;--vscode-list-hoverBackground:#f2f2f2;--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#0258a8;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#cccccc;--vscode-input-background:#ffffff;--vscode-input-border:#cecece;--vscode-input-foreground:#3b3b3b;--vscode-testing-iconPassed:#388a34;--vscode-errorForeground:#a1260d;--vscode-editorWarning-foreground:#bf8803;--vscode-font-family:system-ui,-apple-system,"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:"DejaVu Sans Mono",monospace;--vscode-textCodeBlock-background:#f4f4f4}',
  hc: ':root{--vscode-foreground:#ffffff;--vscode-descriptionForeground:#ffffff;--vscode-widget-border:#6fc3df;--vscode-panel-border:#6fc3df;--vscode-contrastBorder:#6fc3df;--vscode-contrastActiveBorder:#f38518;--vscode-editor-background:#000000;--vscode-sideBar-background:#000000;--vscode-textLink-foreground:#21a6ff;--vscode-focusBorder:#f38518;--vscode-button-background:#000000;--vscode-button-foreground:#ffffff;--vscode-button-border:#6fc3df;--vscode-button-secondaryBackground:#000000;--vscode-input-background:#000000;--vscode-input-border:#6fc3df;--vscode-testing-iconPassed:#73c991;--vscode-errorForeground:#f48771;--vscode-editorWarning-foreground:#ffd370;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:monospace}',
  clion: ':root{--vscode-foreground:#dfe1e5;--vscode-descriptionForeground:#a6a6a6;--vscode-widget-border:#44474e;--vscode-panel-border:#44474e;--vscode-editor-background:#2b2d30;--vscode-sideBar-background:#2b2d30;--vscode-textLink-foreground:#548af7;--vscode-focusBorder:#548af7;--vscode-list-hoverBackground:#393b40;--vscode-button-background:#548af7;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#6598ff;--vscode-button-secondaryBackground:#393b40;--vscode-input-background:#2b2d30;--vscode-input-border:#44474e;--vscode-errorForeground:#f28b82;--vscode-testing-iconPassed:#89d185;--vscode-editorWarning-foreground:#e5c07b;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-bananalens-inline-fatalForeground:#f28b82;--vscode-bananalens-inline-majorForeground:#e5c07b;--vscode-bananalens-inline-minorForeground:#80c7d9;--vscode-bananalens-inline-infoForeground:#b5a2e0}',
};
for (const [name, vars] of Object.entries(themes)) {
  const cls = name === 'light' ? 'vscode-light' : name === 'hc' ? 'vscode-high-contrast' : 'vscode-dark';
  await writeFile(`${out}/${name}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bananabox preview · ${name}</title>
<link rel="stylesheet" href="${webview}/codicon.css"><link rel="stylesheet" href="${webview}/styles.css"><style>${vars} html,body,#app,.shell{height:auto!important;overflow:visible!important}.scroll{overflow:visible!important}html.fixed,html.fixed body,html.fixed #app,html.fixed .shell{height:100%!important;overflow:hidden!important}html.fixed .scroll{overflow-y:auto!important}html.still *,html.still *::before,html.still *::after{animation:none!important;transition:none!important}</style>
<body class="${cls}" data-logo="${logo}"><div id="app"></div><script>
const s=new URLSearchParams(location.search).get('surface')||'panel';document.body.dataset.surface=s;
// Captures show the end state of every entrance; the live page keeps its motion.
if(new URLSearchParams(location.search).has('still'))document.documentElement.classList.add('still');
</script><script src="fixtures.js"></script></body></html>`);
}
console.log(pathToFileURL(`${out}/dark.html`).href + '?screen=grader');
// Sidebar board: every sidebar screen side by side at the activity bar's width, dark then light.
const sidebarScreens = [['list', 'Overview'], ['summary', 'Project summary'], ['running', 'Run in flight'], ['grader', 'Grader page (pushed)'], ['activities', 'Activities page'], ['summary-other', 'Another project']];
// Round 5: colours page, open folder, loading, pause, a custom palette.
const round5 = [['dark', 'list-loading', '', 'Loading (cold cache)'], ['dark', 'summary-loading', '', 'Summary loading'], ['light', 'summary-loading', '', 'Summary loading · light'], ['dark', 'paused', '', 'Paused after a 429'], ['dark', 'summary-local', '', 'Local project: Open + overview'], ['dark', 'appearance', '', 'Colours page'], ['dark', 'list', 'ocean', 'Overview · Ocean palette'], ['light', 'summary', 'grape', 'Summary · Grape, light'], ['light', 'appearance', 'coral', 'Colours · light']];
await writeFile(`${out}/round5.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bananabox round 5</title>
<style>body{margin:0;padding:20px;background:#0b0b0b;font:12px system-ui;color:#999}.row{display:flex;gap:16px}figure{margin:0}figcaption{margin:0 0 6px 2px}iframe{border:0;box-shadow:0 0 0 1px #333}</style>
<div class="row">${round5.map(([theme, screen, palette, label]) => `<figure><figcaption>${label}</figcaption><iframe src="${theme}.html?surface=sidebar&screen=${screen}&lang=fr&still${palette ? `&palette=${palette}` : ''}" width="300" height="1180"></iframe></figure>`).join('')}</div></html>`);
await writeFile(`${out}/home-colors.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><style>body{margin:0;background:#0b0b0b}iframe{border:0}</style><iframe src="dark.html?surface=panel&screen=appearance&lang=fr&palette=mint" width="900" height="1100"></iframe></html>`);
const frames = (theme) => sidebarScreens.map(([screen, label]) => `<figure><figcaption>${label}</figcaption><iframe src="${theme}.html?surface=sidebar&screen=${screen}&lang=fr" width="300" height="1180"></iframe></figure>`).join('');
await writeFile(`${out}/sidebar.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bananabox sidebar board</title>
<style>body{margin:0;padding:20px;background:#0b0b0b;font:12px system-ui;color:#999}.row{display:flex;gap:20px;margin-bottom:24px}.row.light{background:#d6d6d6;padding:16px;margin:0 -20px}figure{margin:0}figcaption{margin:0 0 6px 2px}iframe{border:0;border-radius:6px;box-shadow:0 0 0 1px #333;background:#181818}.light iframe{background:#f8f8f8;box-shadow:0 0 0 1px #bbb}</style>
<div class="row">${frames('dark')}</div><div class="row light">${frames('light')}</div></html>`);
// Edge board: high contrast at full width, then the narrowest sidebar (260px) in dark and in CLion's theme.
const edge = (theme, width, screens) => screens.map(s => `<figure><figcaption>${theme} · ${width}px · ${s}</figcaption><iframe src="${theme}.html?surface=sidebar&screen=${s}&lang=fr" width="${width}" height="1180"></iframe></figure>`).join('');
await writeFile(`${out}/sidebar-edge.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bananabox sidebar edges</title>
<style>body{margin:0;padding:20px;background:#0b0b0b;font:12px system-ui;color:#999}.row{display:flex;gap:20px;margin-bottom:24px}figure{margin:0}figcaption{margin:0 0 6px 2px}iframe{border:0;box-shadow:0 0 0 1px #333}</style>
<div class="row">${edge('hc', 300, ['list', 'summary', 'grader'])}${edge('dark', 260, ['list', 'summary'])}${edge('clion', 260, ['running'])}</div></html>`);
// The defense reminder is its own bundle; stub the VS Code API and send it one alert.
for (const urgent of [false, true]) {
  const alert = { activityName: 'Follow-up review', projectName: 'hashtable', startDate: new Date(Date.now() + (urgent ? 14 : 58) * 60_000).toISOString(), minutes: urgent ? 15 : 60, location: 'Paris · Room 3.04', test: !urgent };
  await writeFile(`${out}/reminder${urgent ? '-urgent' : ''}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="${webview}/codicon.css"><link rel="stylesheet" href="${webview}/styles.css"><style>${themes.dark}</style>
<body class="vscode-dark" data-surface="panel" data-logo="${logo}"><div id="app"></div><script>window.acquireVsCodeApi=()=>({postMessage(){}});</script><script src="${webview}/reminder.js"></script>
<script>postMessage({ type: 'defenseAlert', nonce: 'x', lang: 'en', alert: ${JSON.stringify(alert)} }, '*');</script></body></html>`);
}
