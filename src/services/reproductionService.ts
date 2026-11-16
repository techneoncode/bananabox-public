import * as vscode from 'vscode';
import { commandLabel, executeLocal } from '../delivery/process';
import type {
  LocalCommand,
  ReproductionRecipe,
  ReproductionVM,
} from '../shared/deliveryTypes';
import { firstDifference } from '../domain/textDiff';

export class ReproductionService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;
  private readonly states = new Map<number, ReproductionVM>();
  private readonly running = new Map<number, AbortController>();
  private generation = 0;

  constructor(private readonly t: (key: string) => string) {}

  get(id: number) {
    return this.states.get(id);
  }

  cancel(id: number) {
    this.running.get(id)?.abort();
  }

  clear() {
    this.generation++;
    this.running.forEach((a) => a.abort());
    this.running.clear();
    this.states.clear();
  }

  async run(
    id: number,
    root: string,
    resultId: number,
    task: string,
    recipe: ReproductionRecipe,
    build?: LocalCommand,
    mode: ReproductionVM['mode'] = 'recipe',
    detected = false,
  ): Promise<void> {
    if (this.running.has(id)) return;
    if (!vscode.workspace.isTrusted) throw new Error(this.t('delivery.trust'));

    const generation = this.generation;
    const abort = new AbortController();
    this.running.set(id, abort);
    let vm: ReproductionVM = {
      projectId: id,
      resultId,
      task,
      status: 'running',
      command: commandLabel(recipe.command),
      stdout: '',
      stderr: '',
      expectedStdout: recipe.expectedStdout ?? null,
      expectedFromLog: recipe.expectedFromLog,
      expectedExitCode: recipe.expectedExitCode ?? 0,
      exitCode: null,
      durationMs: 0,
      error: null,
      mode,
      detected,
    };
    const publish = () => {
      if (generation === this.generation) {
        this.states.set(id, { ...vm });
        this.emitter.fire(id);
      }
    };

    publish();
    try {
      build = recipe.build ?? build;
      if (build) {
        const compiled = await executeLocal(root, build, abort.signal);
        vm.durationMs += compiled.durationMs;
        if (
          compiled.cancelled
          || compiled.code !== 0
          || compiled.timedOut
          || compiled.truncated
        ) {
          vm.status = compiled.cancelled ? 'cancelled' : 'error';
          vm.error = this.t('reproduce.buildFailed');
          vm.stdout = compiled.stdout;
          vm.stderr = compiled.stderr;
          publish();
          return;
        }
      }

      const result = await executeLocal(root, recipe, abort.signal);
      vm.stdout = result.stdout;
      vm.stderr = result.stderr;
      vm.exitCode = result.code;
      vm.durationMs += result.durationMs;
      vm.status = result.cancelled
        ? 'cancelled'
        : result.timedOut || result.truncated || result.code === null
          ? 'error'
          : result.code === vm.expectedExitCode
            && (vm.expectedStdout === null || (recipe.expectedFromLog
              ? firstDifference(
                  vm.expectedStdout,
                  result.stdout,
                  { ignoreTrailingNewline: true },
                ) === null
              : result.stdout.replace(/\r\n/g, '\n')
                === vm.expectedStdout.replace(/\r\n/g, '\n')))
            ? 'passed'
            : 'failed';
      vm.error = result.timedOut
        ? this.t('delivery.timeout')
        : result.truncated
          ? this.t('delivery.truncated')
          : null;
      publish();
    } catch (e) {
      vm.status = abort.signal.aborted ? 'cancelled' : 'error';
      vm.error = e instanceof Error ? e.message : String(e);
      publish();
    } finally {
      if (this.running.get(id) === abort) this.running.delete(id);
    }
  }

  dispose() {
    this.clear();
    this.emitter.dispose();
  }
}
