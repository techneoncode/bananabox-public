import type { Memento } from 'vscode';
import { splitChain } from '../domain/graderTrace';
import { tr } from '../util/text';

export function parseGraderCommand(text: string): string[][] | null {
  if (text.length > 4096 || /[\r\n\0]/.test(text)) return null;
  const trimmed = text.trim();
  return trimmed ? splitChain(trimmed) : [];
}

export class GraderCommand {
  constructor(private readonly storage: Pick<Memento, 'get' | 'update'>) {}

  private key(scope: string, id: number) {
    return `bananabox.graderCommand.v1:${encodeURIComponent(scope)}:${id}`;
  }

  get(scope: string, id: number): string {
    return this.storage.get(this.key(scope, id), '');
  }

  async set(scope: string, id: number, command: string): Promise<void> {
    if (typeof command !== 'string' || parseGraderCommand(command) === null) {
      throw new Error(tr('Invalid grader command'));
    }
    await this.storage.update(this.key(scope, id), command.trim());
  }
}
