import * as vscode from 'vscode';
import { readFile, stat } from 'node:fs/promises';
import { discoverPlan } from '../delivery/discovery';
import {
  deliveryGitState,
  projectFiles,
  safeProjectPath,
  snapshot,
} from '../delivery/git';
import {
  executeLocal,
  commandLabel,
  commandSucceeded,
} from '../delivery/process';
import { findForbiddenFunctions } from '../domain/forbiddenFunctions';
import { findDisallowedCalls, isTestPath } from '../domain/allowedFunctions';
import { gitReadinessDetail } from '../domain/readiness';
import type { DeliveryCheck, ReadinessVM } from '../shared/deliveryTypes';
import type {
  StyleScanVM,
  TestResultDetail,
  ValgrindVM,
} from '../shared/types';

export class ReadinessService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;
  private readonly states = new Map<number, ReadinessVM>();
  private readonly running = new Map<number, AbortController>();
  private generation = 0;

  constructor(
    private readonly style: (
      id: number,
      root: string,
      signal: AbortSignal,
    ) => Promise<StyleScanVM | null>,
    private readonly t: (
      key: string,
      params?: Record<string, number | string>,
    ) => string,
    /** Runs the saved valgrind command; null when there is nothing to run. */
    private readonly valgrind: (
      root: string,
    ) => Promise<ValgrindVM | null> = async () => null,
  ) {}

  get(id: number) {
    return this.states.get(id);
  }

  private set(vm: ReadinessVM) {
    this.states.set(vm.projectId, vm);
    this.emitter.fire(vm.projectId);
    return vm;
  }

  invalidate(id: number) {
    const vm = this.states.get(id);
    if (vm && !vm.stale) this.set({ ...vm, stale: true });
  }

  cancel(id: number) {
    this.running.get(id)?.abort();
  }

  invalidateFunctions(id: number) {
    const vm = this.states.get(id);
    if (vm) {
      this.set({
        ...vm,
        stale: true,
        checks: vm.checks.map((c) =>
          c.id === 'functions'
            ? {
                ...c,
                status: 'unknown',
                detail: this.t('delivery.notChecked'),
                files: [],
              }
            : c,
        ),
      });
    }
  }

  clear() {
    this.generation++;
    this.running.forEach((a) => a.abort());
    this.running.clear();
    this.states.clear();
  }

  /**
   * `allowedFunctions` is the student's list and the subject's together; it may still be read from the subject
   * while the other checks run, so it is awaited only when the functions are checked. `null`: the student turned the check off.
   */
  async check(
    id: number,
    root: string,
    signal?: AbortSignal,
    report?: TestResultDetail,
    allowedFunctions: string[] | Promise<string[]> | null = [],
    graderCommand = '',
  ): Promise<ReadinessVM | null> {
    if (this.running.has(id)) return null;

    const generation = this.generation;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    this.running.set(id, abort);
    let vm: ReadinessVM = {
      projectId: id,
      status: 'running',
      configured: false,
      stale: false,
      checkedAt: null,
      checks: [],
      error: null,
      commit: null,
    };
    const publish = () => {
      if (generation === this.generation) {
        this.set({ ...vm, checks: [...vm.checks] });
      }
    };
    const add = (check: DeliveryCheck) => {
      vm.checks = [...vm.checks.filter((c) => c.id !== check.id), check];
      publish();
    };

    publish();
    try {
      if (!vscode.workspace.isTrusted) {
        throw new Error(this.t('delivery.trust'));
      }

      const plan = await discoverPlan(root, report, graderCommand);
      const config = plan.config;
      const before = await snapshot(root, plan.generated);
      vm.commandSource = plan.commandSource;
      vm.unreproducedCommands = plan.unreproducedCommands;
      vm.inheritedForbiddenFunctions = [...config.forbiddenFunctions];
      vm.configured = plan.manual;
      vm.commit = before.commit;
      vm.detected = plan.detected;
      vm.commands = [...plan.builds, ...plan.tests].map((c) => `${c.cwd && c.cwd !== '.' ? `${c.cwd}> ` : ''}${commandLabel(c.command)}`);
      vm.taskCount = plan.makefiles.filter((m) => m.directory !== '.').length;
      vm.generatedOutputs = plan.generated;

      add({ id: 'style', status: 'running', detail: '' });
      const style = await this.style(id, root, abort.signal);
      if (abort.signal.aborted || !style) {
        throw new Error(this.t('delivery.cancelled'));
      }
      add({
        id: 'style',
        status: style.status === 'done' && style.files > 0
          ? style.summary.fatal + style.summary.major > 0
            ? 'fail'
            : 'pass'
          : 'unknown',
        detail: style.status === 'done'
          ? this.t('style.counts', style.summary)
          : style.error ?? this.t('delivery.notChecked'),
        files: style.issues
          .filter((i) => i.bucket === 'major' || i.bucket === 'fatal')
          .map((i) => ({
            file: i.file,
            line: i.line,
            column: i.column,
            message: i.message,
          })),
      });

      for (const key of ['build', 'tests'] as const) {
        if (abort.signal.aborted) break;

        const commands = key === 'build' ? plan.builds : plan.tests;
        if (!commands.length) {
          add({
            id: key,
            status: 'unknown',
            detail: this.t('delivery.noDetectedCommand'),
          });
          continue;
        }

        let output = '';
        let failed = false;
        let done = 0;
        for (const command of commands) {
          if (abort.signal.aborted) break;
          add({
            id: key,
            status: 'running',
            detail: `${done + 1}/${commands.length} · ${commandLabel(command.command)}`,
          });
          const result = await executeLocal(root, command, abort.signal);
          failed ||= !commandSucceeded(result);
          done++;
          output += `${commandLabel(command.command)}\n${this.t('delivery.exit', { code: result.code ?? '—' })}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}\n\n`;
          if (result.timedOut) output += this.t('delivery.timeout');
          if (result.truncated) output += this.t('delivery.truncated');
          output = output.slice(0, 1024 * 1024);
          if (!commandSucceeded(result)) break;
        }
        add({
          id: key,
          status: abort.signal.aborted ? 'unknown' : failed ? 'fail' : 'pass',
          detail: this.t('delivery.commandsDone', {
            n: done,
            total: commands.length,
          }),
          output,
        });
      }
      if (abort.signal.aborted) {
        throw new Error(this.t('delivery.cancelled'));
      }

      const missing: string[] = [];
      for (const file of config?.requiredFiles ?? []) {
        try {
          if (!(await stat(await safeProjectPath(root, file))).isFile()) {
            missing.push(file);
          }
        } catch {
          missing.push(file);
        }
      }
      add({
        id: 'files',
        status: config?.requiredFiles.length
          ? missing.length
            ? 'fail'
            : 'pass'
          : 'unknown',
        detail: missing.length
          ? missing.join(', ')
          : this.t(
              config.requiredFiles.length
                ? plan.manual
                  ? 'delivery.filesOk'
                  : 'delivery.detectedFiles'
                : 'delivery.noFiles',
            ),
      });

      add({ id: 'functions', status: 'running', detail: '' });
      const allowed = new Set(
        await Promise.resolve(allowedFunctions ?? []).catch(
          () => [] as string[],
        ),
      );
      if (abort.signal.aborted) {
        throw new Error(this.t('delivery.cancelled'));
      }

      const forbidden = new Set(config.forbiddenFunctions);
      const sources: Array<{ file: string; text: string }> = [];
      if (allowed.size || forbidden.size) {
        for (const file of await projectFiles(root)) {
          if (!/\.(?:c|h|cc|cpp|hpp)$/i.test(file) || isTestPath(file)) {
            continue;
          }
          try {
            sources.push({
              file,
              text: await readFile(await safeProjectPath(root, file), 'utf8'),
            });
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          }
        }
      }

      const violations: NonNullable<DeliveryCheck['files']> = allowed.size
        ? findDisallowedCalls(sources, allowed, forbidden)
        : sources.flatMap(({ file, text }) =>
            findForbiddenFunctions(text, [...forbidden]).map((v) => ({
              ...v,
              file,
            })),
          );
      const names = [...new Set(violations.map((v) => v.message))];
      vm.disallowed = names;
      vm.allowedCount = allowed.size;
      add({
        id: 'functions',
        status: allowed.size || forbidden.size
          ? violations.length
            ? 'fail'
            : 'pass'
          : 'unknown',
        detail: allowed.size
          ? violations.length
            ? this.t('delivery.outsideAllowed', {
                n: names.length,
                names: names.slice(0, 4).join(', ')
                  + (names.length > 4 ? '…' : ''),
              })
            : this.t('delivery.onlyAllowed', { n: allowed.size })
          : forbidden.size
            ? this.t('delivery.functionsFound', { n: violations.length })
            : this.t(
                allowedFunctions === null
                  ? 'functions.checkOff'
                  : 'delivery.noAllowedList',
              ),
        files: violations,
      });

      add({ id: 'valgrind', status: 'running', detail: '' });
      const memory = await this.valgrind(root).catch(() => null);
      if (abort.signal.aborted) {
        throw new Error(this.t('delivery.cancelled'));
      }
      if (!memory || memory.status !== 'done' || memory.error) {
        vm.checks = vm.checks.filter((c) => c.id !== 'valgrind');
        publish();
      } else {
        const memoryErrors = memory.errors?.length ?? 0;
        const found = memory.leaks.length || memoryErrors;
        add({
          id: 'valgrind',
          status: found || memory.signal ? 'fail' : 'pass',
          detail: found
            ? this.t('delivery.valgrindFound', {
                leaks: memory.leaks.length,
                errors: memoryErrors,
              })
            : memory.signal ?? this.t('delivery.valgrindClean'),
        });
      }

      const git = await deliveryGitState(root, plan.generated);
      add({
        id: 'git',
        status: !git
          ? 'unknown'
          : git.dirty || git.ahead || !git.hasUpstream
            ? 'fail'
            : 'pass',
        detail: git
          ? gitReadinessDetail(git, this.t)
          : this.t('delivery.noGit'),
      });

      const after = await snapshot(root, plan.generated);
      vm.stale = vm.stale
        || before.fingerprint !== after.fingerprint
        || before.commit !== after.commit
        || vscode.workspace.textDocuments.some((d) =>
          d.isDirty
            && d.uri.scheme === 'file'
            && (d.uri.fsPath.startsWith(`${root}/`)
              || d.uri.fsPath.startsWith(`${root}\\`)),
        );
      vm.stale ||= this.states.get(id)?.stale === true;
      vm.status = 'done';
      vm.checkedAt = Date.now();
      publish();
      return generation === this.generation ? this.states.get(id)! : null;
    } catch (e) {
      vm.status = abort.signal.aborted ? 'cancelled' : 'error';
      vm.error = e instanceof Error ? e.message : String(e);
      publish();
      return generation === this.generation ? this.states.get(id)! : null;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (this.running.get(id) === abort) this.running.delete(id);
    }
  }

  dispose() {
    this.clear();
    this.emitter.dispose();
  }
}
