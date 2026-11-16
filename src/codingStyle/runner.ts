import * as cp from 'node:child_process';

export interface RunResult {
    stdout: string;
    stderr: string;
    code: number;
    aborted: boolean;
    timedOut: boolean;
    durationMs: number;
    truncated?: boolean;
}

const MAX_OUTPUT_LENGTH = 10 * 1024 * 1024;

export function runProcess(
    exe: string,
    args: readonly string[],
    options: {
        cwd: string;
        env?: Record<string, string>;
        timeoutMs: number;
        signal?: AbortSignal;
    },
): Promise<RunResult> {
    if (options.signal?.aborted) {
        return Promise.resolve({
            stdout: '', stderr: '', code: -1,
            aborted: true, timedOut: false, durationMs: 0,
        });
    }

    return new Promise(resolve => {
        const started = Date.now();
        let stdout = '';
        let stderr = '';
        let aborted = false;
        let timedOut = false;
        let settled = false;
        let truncated = false;

        const child = cp.spawn(exe, args as string[], {
            cwd: options.cwd,
            env: { ...process.env, ...options.env, LC_ALL: 'C.UTF-8' },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32',
        });

        const signalTree = (signal: NodeJS.Signals): void => {
            try {
                if (process.platform !== 'win32' && child.pid) {
                    process.kill(-child.pid, signal);
                } else {
                    child.kill(signal);
                }
            } catch {}
        };
        let killTimer: NodeJS.Timeout | undefined;
        const terminate = (): void => {
            if (killTimer) return;
            signalTree('SIGTERM');
            killTimer = setTimeout(() => signalTree('SIGKILL'), 500);
            killTimer.unref();
        };
        const timer = setTimeout(() => {
            timedOut = true;
            terminate();
        }, options.timeoutMs);
        const onAbort = (): void => {
            aborted = true;
            terminate();
        };
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });

        const finish = (code: number, extraErr = ''): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            options.signal?.removeEventListener('abort', onAbort);
            resolve({
                stdout,
                stderr: stderr + extraErr,
                code,
                aborted,
                timedOut,
                truncated,
                durationMs: Date.now() - started,
            });
        };

        const appendOutput = (output: string, chunk: string): string => {
            if (output.length + chunk.length > MAX_OUTPUT_LENGTH) {
                truncated = true;
            }
            if (output.length >= MAX_OUTPUT_LENGTH) return output;
            return output + chunk.slice(0, MAX_OUTPUT_LENGTH - output.length);
        };

        child.stdout!.setEncoding('utf8');
        child.stderr!.setEncoding('utf8');
        child.stdout!.on('data', (chunk: string) => {
            stdout = appendOutput(stdout, chunk);
        });
        child.stderr!.on('data', (chunk: string) => {
            stderr = appendOutput(stderr, chunk);
        });
        child.on('error', e => finish(-1, String(e)));
        child.on('close', code => finish(code ?? -1));
    });
}
