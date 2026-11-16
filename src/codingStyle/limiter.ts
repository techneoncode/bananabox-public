interface QueuedTask {
    start: () => void;
    cancel?: () => void;
}

export class Limiter {
    private active = 0;
    private readonly queue: QueuedTask[] = [];

    constructor(private max: number) {
        this.setMax(max);
    }

    setMax(max: number): void {
        this.max = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1;
        this.drain();
    }

    run<T>(task: () => Promise<T>): Promise<T>;
    run<T>(
        task: () => Promise<T>,
        signal: AbortSignal,
        priority?: boolean,
    ): Promise<T | undefined>;
    run<T>(
        task: () => Promise<T>,
        signal?: AbortSignal,
        priority = false,
    ): Promise<T | undefined> {
        if (signal?.aborted) return Promise.resolve(undefined);

        return new Promise((resolve, reject) => {
            const pending: QueuedTask = {
                start: () => {
                    if (pending.cancel) {
                        signal?.removeEventListener('abort', pending.cancel);
                    }
                    this.active++;
                    Promise.resolve()
                        .then(task)
                        .then(resolve, reject)
                        .finally(() => {
                            this.active--;
                            this.drain();
                        });
                },
            };
            pending.cancel = () => {
                const index = this.queue.indexOf(pending);
                if (index !== -1) this.queue.splice(index, 1);
                resolve(undefined);
            };
            if (priority) {
                this.queue.unshift(pending);
            } else {
                this.queue.push(pending);
            }
            signal?.addEventListener('abort', pending.cancel, { once: true });
            this.drain();
        });
    }

    private drain(): void {
        while (this.active < this.max && this.queue.length > 0) {
            this.queue.shift()!.start();
        }
    }
}
