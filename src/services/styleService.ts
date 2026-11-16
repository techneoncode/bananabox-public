import * as vscode from 'vscode';
import type { StyleApi } from '../codingStyle/api';
import { buildScanVM, emptyScan } from '../domain/styleScan';
import type { StyleScanVM } from '../shared/types';
import { log } from '../util/log';

/** Runs BananaLens over a whole project and keeps the latest result per project for the UI. */
export class StyleService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;

  /** Set once the coding style engine is activated. */
  api: StyleApi | undefined;

  private readonly scans = new Map<number, StyleScanVM>();
  private readonly running = new Map<number, Promise<StyleScanVM | null>>();
  private readonly controllers = new Set<AbortController>();
  private generation = 0;

  get(projectId: number): StyleScanVM | undefined {
    return this.scans.get(projectId);
  }

  isAvailable(): boolean {
    return this.api?.isEnabled() === true;
  }

  clear(): void {
    this.generation++;
    this.controllers.forEach((c) => c.abort());
    this.controllers.clear();
    this.scans.clear();
    this.running.clear();
  }

  private set(vm: StyleScanVM): StyleScanVM {
    this.scans.set(vm.projectId, vm);
    this.emitter.fire(vm.projectId);
    return vm;
  }

  /** Marks a project as not checkable (no local copy, engine disabled…). */
  setUnavailable(
    projectId: number,
    reason: 'no_local_copy' | 'disabled',
  ): StyleScanVM {
    return this.set(emptyScan(projectId, 'manual', 'unavailable', reason));
  }

  /** Resolves to `null` when the run was cancelled. A second request for the same project joins the running one. */
  scan(
    projectId: number,
    root: string,
    source: StyleScanVM['source'],
    options: {
      signal?: AbortSignal;
      onProgress?: (done: number, total: number) => void;
    } = {},
  ): Promise<StyleScanVM | null> {
    const existing = this.running.get(projectId);
    if (existing) {
      const signal = options.signal;
      if (!signal) return existing;
      if (signal.aborted) return Promise.resolve(null);
      return new Promise((resolve) => {
        const cancel = () => resolve(null);
        signal.addEventListener('abort', cancel, { once: true });
        void existing
          .then((result) => resolve(signal.aborted ? null : result))
          .finally(() => signal.removeEventListener('abort', cancel));
      });
    }

    const api = this.api;
    if (!api || !api.isEnabled()) {
      return Promise.resolve(this.setUnavailable(projectId, 'disabled'));
    }

    const previous = this.scans.get(projectId);
    const generation = this.generation;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    this.controllers.add(abort);
    this.set(emptyScan(projectId, source, 'running'));
    const run = api
      .scanProject(root, {
        signal: abort.signal,
        onProgress: options.onProgress,
        manual: source === 'manual',
      })
      .then((result): StyleScanVM | null => {
        if (generation !== this.generation) return null;
        if (result.cancelled || abort.signal.aborted) {
          if (previous) {
            this.set(previous);
          } else {
            this.scans.delete(projectId);
            this.emitter.fire(projectId);
          }
          return null;
        }
        return this.set(buildScanVM(projectId, source, result));
      })
      .catch((e): StyleScanVM | null => {
        if (generation !== this.generation) return null;
        log().warn('style scan failed', e);
        return this.set(
          emptyScan(
            projectId,
            source,
            'error',
            e instanceof Error ? e.message : String(e),
          ),
        );
      })
      .finally(() => {
        options.signal?.removeEventListener('abort', cancel);
        this.controllers.delete(abort);
        if (this.running.get(projectId) === run) {
          this.running.delete(projectId);
        }
      });
    this.running.set(projectId, run);
    return run;
  }

  dispose(): void {
    this.clear();
    this.emitter.dispose();
  }
}
