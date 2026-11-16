import * as vscode from 'vscode';
import type { DeliveryStep, GuidedVM } from '../shared/deliveryTypes';

const STEPS: DeliveryStep[] = [
  'save',
  'check',
  'review',
  'commit',
  'push',
  'grader',
];

export interface GuidedActions {
  /** False pauses the flow without advancing to the next step. */
  execute(step: DeliveryStep, id: number): Promise<boolean>;
  valid(): boolean;
}

/**
 * Resume always revalidates saved files and checks; no cached green badge can
 * bypass them.
 */
export class GuidedDelivery implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;
  private readonly states = new Map<number, GuidedVM>();
  private readonly running = new Set<number>();
  private generation = 0;

  get(id: number) {
    return this.states.get(id);
  }

  clear() {
    this.generation++;
    this.states.clear();
    this.running.clear();
  }

  pause(id: number) {
    const vm = this.states.get(id);
    if (vm?.status === 'running') {
      this.states.set(id, { ...vm, status: 'paused' });
      this.emitter.fire(id);
    }
  }

  async start(id: number, actions: GuidedActions): Promise<void> {
    if (this.running.has(id)) return;
    const generation = this.generation;
    this.running.add(id);
    const vm: GuidedVM = {
      projectId: id,
      status: 'running',
      step: 'save',
      completed: [],
      message: null,
    };
    const active = () => generation === this.generation
      && actions.valid()
      && this.states.get(id)?.status !== 'paused';
    const publish = () => {
      if (generation === this.generation) {
        this.states.set(id, { ...vm, completed: [...vm.completed] });
        this.emitter.fire(id);
      }
    };

    publish();
    try {
      for (const step of STEPS) {
        if (!active()) {
          vm.status = 'paused';
          break;
        }
        vm.step = step;
        publish();
        if (!(await actions.execute(step, id)) || !active()) {
          vm.status = 'paused';
          break;
        }
        vm.completed.push(step);
      }
      if (vm.completed.length === STEPS.length) vm.status = 'done';
      publish();
    } catch (e) {
      vm.status = 'paused';
      vm.message = e instanceof Error ? e.message : String(e);
      publish();
    } finally {
      if (generation === this.generation) this.running.delete(id);
    }
  }

  dispose() {
    this.clear();
    this.emitter.dispose();
  }
}
