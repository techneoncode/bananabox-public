import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sameRuntimeContract } from './domain/hotSwap';

/**
 * The extension's entry point (`main`). It loads dist/extension.js and can later swap it for the
 * same file of a newer installed version, without restarting the extension host: only Bananabox
 * restarts. VS Code keeps running the version it loaded until its next window reload, so this
 * file must stay small and stable.
 */

const API_KEY = Symbol.for('techneoncode.bananabox.vscode');
const LOADER_KEY = Symbol.for('techneoncode.bananabox.loader');

interface Bundle {
  activate(context: vscode.ExtensionContext): unknown;
  deactivate?(): unknown;
}

/** What one loaded version owns: disposed when the next one takes over. */
interface Generation {
  subscriptions: vscode.Disposable[];
  listeners: vscode.Disposable[];
  bundle?: Bundle;
}

/** The hot swap entry points the bundle reads from `globalThis`. */
export interface BananaboxLoader {
  /** Folder of the installed `version`, if it can replace the running code in place. */
  swappable(version: string): string | undefined;
  swap(root: string): Promise<void>;
}

interface ViewSlot {
  provider?: vscode.WebviewViewProvider;
  view?: vscode.WebviewView;
}

let base: vscode.ExtensionContext;
let running: { root: string; manifest: Record<string, unknown> };
let current: Generation | undefined;
const views = new Map<string, ViewSlot>();

// Methods are bound to their object; classes (vscode.Uri, vscode.Range...) keep their statics and identity.
const bound = (target: object, key: PropertyKey) => {
  const value = Reflect.get(target, key, target);
  return typeof value === 'function' && !Object.prototype.hasOwnProperty.call(value, 'prototype') ? value.bind(target) : value;
};

/**
 * A plain object that reads every property of `target` (own and inherited) through to it, except
 * `overrides`. VS Code freezes objects such as the extension context, and a Proxy may not report
 * another value for a frozen property, so a copy with getters is the only safe wrapper.
 */
function delegate<T extends object>(target: T, overrides: Record<PropertyKey, unknown> = {}): T {
  const out: Record<PropertyKey, unknown> = {};
  const keys = new Set<PropertyKey>(Reflect.ownKeys(overrides));
  for (let o: object | null = target; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    Reflect.ownKeys(o).forEach(k => { if (k !== 'constructor') keys.add(k); });
  }
  for (const k of keys) {
    Object.defineProperty(out, k, {
      enumerable: true,
      get: () => k in overrides ? overrides[k] : bound(target, k),
      set: (v: unknown) => { Reflect.set(target, k, v, target); },
    });
  }
  return out as T;
}

/** Event registrations of one generation on a shared webview view, so they end with it. */
function track(gen: Generation, view: vscode.WebviewView): vscode.WebviewView {
  const wrap = <T>(event: vscode.Event<T>): vscode.Event<T> => (listener, thisArgs, disposables) => {
    const d = event(listener, thisArgs);
    gen.listeners.push(d);
    disposables?.push(d);
    return d;
  };
  const webview = delegate(view.webview, { onDidReceiveMessage: wrap(view.webview.onDidReceiveMessage) });
  return delegate(view, {
    webview,
    onDidDispose: wrap(view.onDidDispose),
    onDidChangeVisibility: wrap(view.onDidChangeVisibility),
  });
}

/**
 * VS Code does not resolve an already shown view again for a new provider, so the loader registers
 * each view once and hands the live view to every version that registers it.
 */
function registerView(gen: Generation, viewType: string, provider: vscode.WebviewViewProvider,
  options?: Parameters<typeof vscode.window.registerWebviewViewProvider>[2]): vscode.Disposable {
  let slot = views.get(viewType);
  if (!slot) {
    const created: ViewSlot = {};
    slot = created;
    views.set(viewType, created);
    base.subscriptions.push(vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view, context, token) {
        created.view = view;
        view.onDidDispose(() => { if (created.view === view) created.view = undefined; });
        return current && created.provider?.resolveWebviewView(track(current, view), context, token);
      },
    }, options));
  }
  slot.provider = provider;
  if (slot.view) void provider.resolveWebviewView(track(gen, slot.view), { state: undefined }, new vscode.CancellationTokenSource().token);
  const own = slot;
  return new vscode.Disposable(() => { if (own.provider === provider) own.provider = undefined; });
}

function apiFor(gen: Generation): typeof vscode {
  const window = delegate(vscode.window, {
    registerWebviewViewProvider: (viewType: string, provider: vscode.WebviewViewProvider, options?: { webviewOptions?: { retainContextWhenHidden?: boolean } }) =>
      registerView(gen, viewType, provider, options),
  });
  return delegate(vscode, { window });
}

/** The extension context as the version in `root` should see it: its own folder, manifest and subscriptions. */
function contextFor(gen: Generation, root: string, manifest: Record<string, unknown>): vscode.ExtensionContext {
  const uri = vscode.Uri.file(root);
  const extension = delegate(base.extension, { packageJSON: manifest, extensionUri: uri, extensionPath: root });
  return delegate(base, {
    subscriptions: gen.subscriptions,
    extensionUri: uri,
    extensionPath: root,
    asAbsolutePath: (relative: string) => path.join(root, relative),
    extension,
  });
}

const readManifest = (root: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

async function start(root: string, manifest: Record<string, unknown>): Promise<void> {
  const gen: Generation = { subscriptions: [], listeners: [] };
  (globalThis as Record<symbol, unknown>)[API_KEY] = apiFor(gen);
  // A runtime path: the bundle of another installed version is not part of this build.
  const bundle = require(path.join(root, 'dist', 'extension.js')) as Bundle;
  gen.bundle = bundle;
  current = gen;
  running = { root, manifest };
  await bundle.activate(contextFor(gen, root, manifest));
}

async function stop(gen: Generation | undefined): Promise<void> {
  if (!gen) return;
  try {
    await gen.bundle?.deactivate?.();
  } catch (error) {
    console.error('[Bananabox] deactivate failed', error);
  }
  for (const d of [...gen.subscriptions.splice(0).reverse(), ...gen.listeners.splice(0)]) {
    try { d.dispose(); } catch (error) { console.error('[Bananabox] dispose failed', error); }
  }
}

const loader: BananaboxLoader = {
  swappable(version) {
    const parent = path.dirname(running.root);
    const id = `${running.manifest.publisher}.${running.manifest.name}`.toLowerCase();
    let names: string[];
    try { names = fs.readdirSync(parent); } catch { return undefined; }
    for (const name of names) {
      if (!name.toLowerCase().startsWith(`${id}-`)) continue;
      const root = path.join(parent, name);
      try {
        const manifest = readManifest(root);
        if (manifest.version === version && fs.existsSync(path.join(root, 'dist', 'extension.js'))
          && sameRuntimeContract(running.manifest, manifest)) return root;
      } catch { /* not a readable install: ignore it */ }
    }
    return undefined;
  },
  async swap(root) {
    const manifest = readManifest(root);
    await stop(current);
    current = undefined;
    await start(root, manifest);
  },
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  base = context;
  (globalThis as Record<symbol, unknown>)[LOADER_KEY] = loader;
  await start(context.extensionPath, context.extension.packageJSON as Record<string, unknown>);
}

export async function deactivate(): Promise<void> {
  await stop(current);
  current = undefined;
}
