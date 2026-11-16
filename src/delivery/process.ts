import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { LocalCommand, ReproductionRecipe } from '../shared/deliveryTypes';
import { safeProjectPath } from './git';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  cancelled: boolean;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

const LIMIT = 512 * 1024;

/** Execute the configured argument array, never interpolate it into a shell. */
export async function executeLocal(
  root: string,
  recipe: LocalCommand | ReproductionRecipe,
  signal?: AbortSignal,
): Promise<CommandResult> {
  if (signal?.aborted) {
    return {
      stdout: '',
      stderr: '',
      code: null,
      cancelled: true,
      timedOut: false,
      truncated: false,
      durationMs: 0,
    };
  }

  const cwd = recipe.cwd && recipe.cwd !== '.'
    ? await safeProjectPath(root, recipe.cwd)
    : resolve(root);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(recipe.command[0], recipe.command.slice(1), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    let cancelled = false;
    let timedOut = false;
    let truncated = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const kill = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, sig);
        } else {
          child.kill(sig);
        }
      } catch {}
    };
    const stop = () => {
      if (killTimer) return;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
      killTimer.unref();
    };
    const cancel = () => {
      cancelled = true;
      stop();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, (recipe.timeoutSeconds ?? 60) * 1000);

    const append = (old: string, value: string) => {
      if (old.length + value.length > LIMIT) truncated = true;
      return (old + value).slice(0, LIMIT);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s) => {
      stdout = append(stdout, s);
    });
    child.stderr.on('data', (s) => {
      stderr = append(stderr, s);
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      resolve({
        stdout,
        stderr,
        code,
        cancelled,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (e) => {
      stderr = append(stderr, e.message);
      finish(null);
    });
    child.on('close', finish);

    child.stdin.on('error', () => {});
    child.stdin.end('stdin' in recipe ? recipe.stdin ?? '' : '');
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

export const commandLabel = (command: string[]): string =>
  command
    .map((a) => (/^[\w./=-]+$/.test(a) ? a : JSON.stringify(a)))
    .join(' ');

export const commandSucceeded = (r: CommandResult): boolean =>
  r.code === 0 && !r.cancelled && !r.timedOut && !r.truncated;
