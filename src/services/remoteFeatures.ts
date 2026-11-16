import { type RemoteStatus } from '../domain/remotePolicy';

/** Shared runtime gate; never writes over the user's persistent settings. */
class RemoteFeatures {
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  status: RemoteStatus = {
    installedVersion: '',
    versionMismatch: false,
    offline: false,
    connectionRefused: false,
    restrictedFeatures: [],
    lensActive: true,
    myApiActive: true,
    update: 'idle',
  };

  get apiSignal(): AbortSignal {
    return this.controller.signal;
  }

  readonly onDidChange = (listener: () => void) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  set(status: RemoteStatus): void {
    const changed = JSON.stringify(this.status) !== JSON.stringify(status);
    if (this.status.myApiActive && !status.myApiActive) this.controller.abort();
    if (!this.status.myApiActive && status.myApiActive) {
      this.controller = new AbortController();
    }

    this.status = status;
    if (changed) {
      for (const listener of this.listeners) listener();
    }
  }
}

export const remoteFeatures = new RemoteFeatures();
