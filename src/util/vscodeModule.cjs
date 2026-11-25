// Stands in for `vscode` in dist/extension.js. The loader (dist/loader.js) gives each loaded
// Bananabox version its own view of the API, so a version loaded from a folder VS Code does not
// know yet still uses the running extension's API.
const injected = globalThis[Symbol.for('techneoncode.bananabox.vscode')];
// Direct eval keeps Node's require out of esbuild's reach: a plain require('vscode') would resolve to this file.
module.exports = injected || eval('require')('vscode');
