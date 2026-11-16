import type { Memento } from 'vscode';
import { validateFunctionNames } from '../domain/functionRules';

/**
 * The functions the student allows for a project (added to what the subject
 * allows), kept in VS Code storage scoped to the account/API and project,
 * never in the repository.
 */
export class FunctionRules {
  constructor(private readonly storage: Pick<Memento, 'get' | 'update'>) {}

  private key(scope: string, projectId: number) {
    return `bananabox.allowedFunctions.v1:${encodeURIComponent(scope)}:${projectId}`;
  }

  get(scope: string, projectId: number): string[] {
    return validateFunctionNames(
      this.storage.get(this.key(scope, projectId), []),
    ) ?? [];
  }

  async set(scope: string, projectId: number, names: unknown): Promise<void> {
    const valid = validateFunctionNames(names);
    if (!valid) throw new Error('Invalid function names');
    await this.storage.update(this.key(scope, projectId), valid);
  }

  /** The student turned the allowed-functions check off for this project. */
  disabled(scope: string, projectId: number): boolean {
    return this.storage.get(`${this.key(scope, projectId)}:off`) === true;
  }

  setDisabled(scope: string, projectId: number, off: boolean): Thenable<void> {
    return this.storage.update(
      `${this.key(scope, projectId)}:off`,
      off || undefined,
    );
  }
}
