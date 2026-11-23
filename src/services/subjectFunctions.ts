import type { Memento } from 'vscode';
import { parseAuthorizedFunctions } from '../domain/allowedFunctions';
import { validateFunctionNames } from '../domain/functionRules';
import {
  parseSubjectMakefile,
  type SubjectMakefile,
} from '../domain/subjectMakefile';
import type { SubjectFunctionsVM } from '../shared/deliveryTypes';
import type { ProjectVM } from '../shared/types';
import { log } from '../util/log';

const RETRY_MS = 10 * 60_000;

interface Stored {
  names: string[];
  doc?: string;
  at: number;
  makefile?: SubjectMakefile;
}

function validMakefile(raw: unknown): SubjectMakefile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const { rules, binary } = raw as SubjectMakefile;
  const names = validateFunctionNames(rules);
  if (!names) return undefined;
  return {
    rules: names,
    ...(typeof binary === 'string' && /^[\w.\-/]{1,128}$/.test(binary)
      ? { binary }
      : {}),
  };
}

/**
 * The allowed functions a project's subject lists. Read once (one subject download), then kept in VS Code
 * storage; read again only when the student asks. The PDF never touches the disk.
 */
export class SubjectFunctions {
  private readonly reading = new Map<string, Promise<SubjectFunctionsVM>>();
  private readonly failed = new Map<string, { at: number; error: string }>();

  constructor(
    private readonly storage: Pick<Memento, 'get' | 'update'>,
    private readonly fetchDocument: (
      project: ProjectVM,
    ) => Promise<{ name: string; bytes: Uint8Array } | null>,
    private readonly extract: (bytes: Uint8Array) => Promise<string>,
    private readonly changed: (projectId: number) => void,
    private readonly now: () => number = Date.now,
  ) {}

  private key(scope: string, projectId: number) {
    // v2: lists read before 1.7.1 missed most subject wordings, so every subject is read once more.
    return `bananabox.subjectFunctions.v2:${encodeURIComponent(scope)}:${projectId}`;
  }

  private stored(scope: string, projectId: number): Stored | null {
    const raw = this.storage.get<Stored>(this.key(scope, projectId));
    if (!raw || typeof raw.at !== 'number') return null;

    return {
      names: validateFunctionNames(raw.names) ?? [],
      doc: typeof raw.doc === 'string' ? raw.doc : undefined,
      at: raw.at,
      makefile: validMakefile(raw.makefile),
    };
  }

  get(scope: string, projectId: number): SubjectFunctionsVM {
    const k = this.key(scope, projectId);
    if (this.reading.has(k)) {
      return {
        status: 'reading',
        names: this.stored(scope, projectId)?.names ?? [],
      };
    }

    const s = this.stored(scope, projectId);
    if (s) {
      return {
        status: s.names.length ? 'found' : 'none',
        names: s.names,
        doc: s.doc,
        at: s.at,
        makefile: s.makefile,
      };
    }

    const f = this.failed.get(k);
    return f
      ? { status: 'error', names: [], error: f.error, at: f.at }
      : { status: 'idle', names: [] };
  }

  /** The list, reading the subject first if it never was (or `force`); a read already running is shared. */
  async ensure(
    scope: string,
    project: ProjectVM,
    force = false,
  ): Promise<SubjectFunctionsVM> {
    const k = this.key(scope, project.id);
    const current = this.get(scope, project.id);
    const pending = this.reading.get(k);
    if (pending) return pending;

    if (
      !force
      && (current.status === 'found' || current.status === 'none')
      && current.makefile
    ) {
      return current;
    }
    const failure = this.failed.get(k);
    if (!force && failure && this.now() - failure.at < RETRY_MS) return current;

    const run = this.read(scope, project, k).finally(() => {
      this.reading.delete(k);
      this.changed(project.id);
    });
    this.reading.set(k, run);
    this.changed(project.id);
    return run;
  }

  private async read(
    scope: string,
    project: ProjectVM,
    k: string,
  ): Promise<SubjectFunctionsVM> {
    try {
      const doc = await this.fetchDocument(project);
      if (!doc) throw new Error('no_subject');

      const text = await this.extract(doc.bytes);
      const names = parseAuthorizedFunctions(text) ?? [];
      const makefile = parseSubjectMakefile(text);
      const stored: Stored = { names, doc: doc.name, at: this.now(), makefile };
      await this.storage.update(this.key(scope, project.id), stored);
      this.failed.delete(k);
      return {
        status: names.length ? 'found' : 'none',
        names,
        doc: doc.name,
        at: stored.at,
        makefile,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log().warn(
        `could not read the allowed functions from the subject of project ${project.id}`,
        e,
      );
      this.failed.set(k, { at: this.now(), error });
      return { status: 'error', names: [], error, at: this.now() };
    }
  }

  /** Sign-out or account change: forget reads in memory (stored lists are per account already). */
  clear(): void {
    this.failed.clear();
  }
}
