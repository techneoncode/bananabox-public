export const COUNTDOWN_MS = 10_000;
export const POSTPONE_MS = 5 * 60_000;
export const MAX_POSTPONES = 3;
/** No typing for this long counts as a pause. */
export const QUIET_TYPING_MS = 20_000;
/** Once every postpone is spent, the restart waits at most this long for a quiet moment. */
export const FORCE_AFTER_MS = 2 * 60_000;
const POLL_MS = 2_000;

export interface RestartCountdown {
  at: number;
  version: string;
  postponesLeft: number;
}

export interface RestartDeps {
  /** A Bananabox run (grader, check) is in progress. */
  busy(): boolean;
  debugging(): boolean;
  /** Time of the last edit in any document. */
  lastEdit(): number;
  /** Shows the countdown, or hides it with `undefined`. */
  show(countdown: RestartCountdown | undefined): void;
  restart(): Promise<void>;
  now?(): number;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

/** Restarts Bananabox into an installed update at a quiet moment, after a countdown the student can push back a few times. */
export class UpdateRestart {
  private postponesLeft = MAX_POSTPONES;
  private onPostpone: (() => void) | undefined;
  private readonly lifetime = new AbortController();

  constructor(private readonly deps: RestartDeps) {}

  private get now() { return (this.deps.now ?? Date.now)(); }

  private sleep(ms: number): Promise<boolean> {
    return (this.deps.sleep ?? defaultSleep)(ms, this.lifetime.signal).then(() => true, () => false);
  }

  private quiet(): boolean {
    return !this.deps.busy() && !this.deps.debugging() && this.now - this.deps.lastEdit() >= QUIET_TYPING_MS;
  }

  async run(version: string): Promise<void> {
    while (!this.lifetime.signal.aborted) {
      const since = this.now;
      const limit = this.postponesLeft === 0 ? FORCE_AFTER_MS : Infinity;
      while (!this.quiet() && this.now - since < limit) {
        if (!await this.sleep(POLL_MS)) return;
      }
      this.deps.show({ at: this.now + COUNTDOWN_MS, version, postponesLeft: this.postponesLeft });
      const postponed = await new Promise<boolean>(resolve => {
        this.onPostpone = () => resolve(true);
        void this.sleep(COUNTDOWN_MS).then(done => resolve(!done));
      });
      this.onPostpone = undefined;
      this.deps.show(undefined);
      if (this.lifetime.signal.aborted) return;
      if (!postponed) return this.deps.restart();
      if (!await this.sleep(POSTPONE_MS)) return;
    }
  }

  /** Pushes the restart back; false once every postpone is spent or when no countdown runs. */
  postpone(): boolean {
    if (!this.onPostpone || this.postponesLeft === 0) return false;
    this.postponesLeft--;
    this.onPostpone();
    return true;
  }

  dispose(): void {
    this.lifetime.abort();
  }
}
