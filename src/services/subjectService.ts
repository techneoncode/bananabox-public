import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { EpitechClient } from '../api/client';
import type { ProjectVM, SubjectState } from '../shared/types';
import { config } from '../util/config';
import { log } from '../util/log';
import { createT } from '../shared/i18n';
import {
  findSubjectUrl,
  listSubjectDocuments,
  parseResourceLink,
  pickSubjectDocument,
  resourceRoute,
  type SubjectDocument,
} from '../domain/resources';
import { pickSubjectForFunctions } from '../domain/allowedFunctions';
import { tr } from '../util/text';

export { findSubjectUrl } from '../domain/resources';

const MAX_BYTES = 40 * 1024 * 1024;

/** Download failure carrying the HTTP status, so expired signed links can be retried with a fresh one. */
class DownloadError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

const documentVM = (d: SubjectDocument) => ({
  id: d.id,
  name: d.name,
  folder: d.folder,
  size: d.size,
});

export class SubjectService {
  private readonly cache = new Map<number, SubjectState>();
  private readonly docs = new Map<number, SubjectDocument[]>();
  private readonly binaries = new Map<number, SubjectDocument[]>();
  private generation = 0;
  private readonly sources = new Map<
    number,
    { url?: string; local?: vscode.Uri; docId?: string }
  >();

  constructor(
    private readonly client: EpitechClient,
    private readonly t: (
      key: string,
      params?: Record<string, string | number>,
    ) => string = createT('en'),
  ) {}

  clear(): void {
    this.generation++;
    this.cache.clear();
    this.docs.clear();
    this.binaries.clear();
    this.sources.clear();
  }

  /**
   * Finds and downloads the project subject. Order of attempts:
   *  1. the project's attached files (`related-resources/files`) → signed URL → PDF (what the website does);
   *  2. a subject URL already present in the project payload / project detail (legacy shapes).
   * `docId` selects another attached PDF (bootstrap, appendix…); by default the best subject candidate is used.
   */
  async load(project: ProjectVM, docId?: string): Promise<SubjectState> {
    const gen = this.generation;
    const cached = this.cache.get(project.id);
    if (cached?.status === 'ready' && (!docId || cached.docId === docId)) {
      return cached;
    }

    let docs = this.docs.get(project.id) ?? [];
    let listingError: unknown;
    if (docs.length === 0) {
      try {
        docs = await this.list(project.id, gen);
      } catch (e) {
        listingError = e;
        log().warn(`attached files lookup failed for project ${project.id}`, e);
      }
    }

    try {
      let bytes: Buffer;
      let name: string;
      let chosen: SubjectDocument | undefined;

      if (docs.length > 0) {
        chosen = pickSubjectDocument(docs, docId)!;
        bytes = await this.fetchResource(project.id, chosen, gen);
        name = chosen.name;
      } else {
        const url = await this.legacyUrl(project);
        if (gen !== this.generation) {
          return { status: 'unavailable', reason: 'session_ended' };
        }
        if (!url) {
          return listingFailedTransiently(listingError)
            ? {
                status: 'error',
                message: tr('Unable to reach the intranet. Check your connection and try again.'),
              }
            : { status: 'unavailable', reason: 'no_link' };
        }
        const resolved = new URL(url, config.apiBaseUrl()).href;
        this.sources.set(project.id, { url: resolved });
        bytes = await this.fetchPdf(resolved);
        name = `${project.name}.pdf`;
      }

      if (gen !== this.generation) {
        return { status: 'unavailable', reason: 'session_ended' };
      }
      const state: SubjectState = {
        status: 'ready',
        name,
        base64: bytes.toString('base64'),
        docId: chosen?.id ?? '',
        documents: docs.map(documentVM),
        binaries: this.binaries.get(project.id)?.length ?? 0,
      };
      this.cache.set(project.id, state);
      return state;
    } catch (e) {
      log().warn(`subject download failed for project ${project.id}`, e);
      return {
        status: 'error',
        message: tr('Unable to download the PDF. Open it in your browser or try again.'),
      };
    }
  }

  /**
   * The subject's bytes for reading its allowed functions: the real subject, never the bootstrap when both exist.
   * Kept in memory only; what the Subject tab shows is left as it is.
   */
  async functionsDocument(
    project: ProjectVM,
  ): Promise<{ name: string; bytes: Buffer } | null> {
    const gen = this.generation;
    let docs = this.docs.get(project.id) ?? [];
    if (!docs.length) {
      docs = await this.list(project.id, gen);
    }

    const doc = pickSubjectForFunctions(docs);
    if (doc) {
      const cached = this.cache.get(project.id);
      if (cached?.status === 'ready' && cached.docId === doc.id) {
        return {
          name: doc.name,
          bytes: Buffer.from(cached.base64, 'base64'),
        };
      }
      return {
        name: doc.name,
        bytes: await this.fetchResource(project.id, doc, gen),
      };
    }

    const url = await this.legacyUrl(project);
    if (!url) return null;
    return {
      name: `${project.name}.pdf`,
      bytes: await this.fetchPdf(new URL(url, config.apiBaseUrl()).href),
    };
  }

  private async legacyUrl(project: ProjectVM): Promise<string | null> {
    if (project.subjectUrl) return project.subjectUrl;
    try {
      return findSubjectUrl(await this.client.projectDetail(project.id));
    } catch {
      return null;
    }
  }

  private async list(
    projectId: number,
    gen: number,
  ): Promise<SubjectDocument[]> {
    const tree = await this.client.projectResources(projectId);
    const docs = listSubjectDocuments(tree);
    if (gen === this.generation) {
      this.docs.set(projectId, docs);
      this.binaries.set(projectId, listSubjectDocuments(tree, false));
    }
    return docs;
  }

  /** Saves every non-PDF file attached to the project (SettingUp-style binaries) into a folder the user picks. */
  async downloadBinaries(project: ProjectVM): Promise<void> {
    const gen = this.generation;
    if (!this.binaries.has(project.id)) await this.list(project.id, gen);
    const files = this.binaries.get(project.id) ?? [];
    if (!files.length) return;
    const folder = (await vscode.window.showOpenDialog({
      title: this.t('subject.binaries.title'),
      openLabel: this.t('subject.binaries.save'),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(homedir()),
    }))?.[0];
    if (!folder || gen !== this.generation) return;
    for (const doc of files) {
      const bytes = await this.fetchResource(project.id, doc, gen, true);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folder, basename(doc.name)),
        bytes,
      );
    }
    void vscode.window.showInformationMessage(
      this.t('subject.binaries.done', { 0: files.length, 1: folder.fsPath }),
    );
  }

  /** Resolves a fresh signed link for an attached file and downloads it; one retry if the link was rejected. */
  private async fetchResource(
    projectId: number,
    doc: SubjectDocument,
    gen: number,
    raw = false,
  ): Promise<Buffer> {
    const attempt = async (): Promise<Buffer> => {
      const link = parseResourceLink(
        await this.client.resourceLink(resourceRoute(projectId, doc)),
      );
      if (!link) {
        throw new DownloadError(tr('The intranet did not return a download link.'));
      }
      if (gen === this.generation) {
        this.sources.set(projectId, { url: link, docId: doc.id });
      }
      return this.fetchPdf(link, raw);
    };

    try {
      return await attempt();
    } catch (e) {
      if (
        e instanceof DownloadError
        && [400, 401, 403, 404].includes(e.status)
      ) {
        return attempt();
      }
      throw e;
    }
  }

  private async fetchPdf(url: string, raw = false): Promise<Buffer> {
    const base = new URL(config.apiBaseUrl());
    const target = new URL(url, base);
    let bytes: Buffer;
    if (target.origin === base.origin) {
      bytes = await this.client.download(target.pathname + target.search);
    } else {
      if (target.protocol !== 'https:') {
        throw new DownloadError(tr('The subject URL must use HTTPS.'));
      }
      const res = await fetch(target, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        throw new DownloadError(`${res.status} ${res.statusText}`, res.status);
      }
      bytes = Buffer.from(await res.arrayBuffer());
    }
    if (raw) return bytes;
    if (bytes.length > MAX_BYTES) {
      throw new DownloadError(tr('The PDF is too large to display.'));
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new DownloadError(tr('The downloaded file is not a PDF.'));
    }
    return bytes;
  }

  /** Lets the user open any local PDF as the subject (useful until a subject link is available). */
  async pickLocal(project: ProjectVM): Promise<SubjectState | undefined> {
    const gen = this.generation;
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { PDF: ['pdf'] },
      openLabel: tr('Open subject'),
    });
    if (!picked?.[0]) return undefined;

    const bytes = await readFile(picked[0].fsPath);
    if (
      bytes.length > MAX_BYTES
      || bytes.subarray(0, 5).toString('latin1') !== '%PDF-'
    ) {
      return {
        status: 'error',
        message: tr('That file is not a valid PDF (or is too large).'),
      };
    }
    const state: SubjectState = {
      status: 'ready',
      name: basename(picked[0].fsPath),
      base64: bytes.toString('base64'),
      docId: '',
      documents: [],
    };
    if (gen === this.generation) {
      this.cache.set(project.id, state);
      this.sources.set(project.id, { local: picked[0] });
    }
    return state;
  }

  async openInBrowser(project: ProjectVM): Promise<void> {
    let url = this.sources.get(project.id)?.url
      ?? project.subjectUrl
      ?? project.intranetUrl;
    const selected = this.cache.get(project.id);
    const doc = this.docs.get(project.id)?.find((d) =>
      selected?.status === 'ready' && d.id === selected.docId,
    );
    if (doc) {
      try {
        url = parseResourceLink(
          await this.client.resourceLink(resourceRoute(project.id, doc)),
        ) ?? url;
      } catch (e) {
        log().warn('could not refresh the subject link', e);
        url = project.intranetUrl;
      }
    }

    const uri = vscode.Uri.parse(new URL(url, config.apiBaseUrl()).href);
    if (uri.scheme === 'https' || uri.scheme === 'http') {
      await vscode.env.openExternal(uri);
    }
  }

  async openOnComputer(project: ProjectVM): Promise<void> {
    const gen = this.generation;
    const local = this.sources.get(project.id)?.local;
    if (local) {
      await vscode.env.openExternal(local);
      return;
    }

    const state = await this.load(project);
    if (gen !== this.generation) return;
    if (state.status !== 'ready') {
      throw new Error(
        tr('Open or load a PDF first. You can find the subject using “Open online”.'),
      );
    }
    const filename = state.name.replace(/[\\/:*?"<>|]/g, '_');
    const target = await vscode.window.showSaveDialog({
      title: tr('Bananabox · Save and open the subject'),
      saveLabel: tr('Save and open'),
      defaultUri: vscode.Uri.file(join(homedir(), filename)),
      filters: { PDF: ['pdf'] },
    });
    if (!target || gen !== this.generation) return;

    await vscode.workspace.fs.writeFile(
      target,
      Buffer.from(state.base64, 'base64'),
    );
    await vscode.env.openExternal(target);
  }
}

function listingFailedTransiently(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  return error !== undefined
    && (status === 0 || status === undefined || status >= 500);
}
