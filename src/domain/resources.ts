import { parseRemote } from './git';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;

/**
 * Restrict discovery to project/registration containers, never cursus or unit
 * repositories.
 */
export function projectRepoLink(value: unknown, depth = 0): string | null {
  const node = object(value);
  if (!node || depth > 4) return null;
  for (const key of ['repoLink', 'repositoryUrl', 'repoUrl']) {
    const link = node[key];
    if (typeof link === 'string' && parseRemote(link)) return link.trim();
  }
  for (const key of [
    'registration',
    'registrations',
    'repository',
    'project',
    'data',
  ]) {
    const child = node[key];
    for (const item of Array.isArray(child) ? child : [child]) {
      const link = projectRepoLink(item, depth + 1);
      if (link) return link;
    }
  }
  return null;
}

/**
 * A subject descriptor may carry its type/name separately from a signed
 * download URL.
 */
export function findSubjectUrl(
  value: unknown,
  key = '',
  depth = 0,
): string | null {
  if (depth > 6) return null;
  if (typeof value === 'string') {
    return /^(https?:\/\/|\/)/i.test(value)
      && (/\.pdf(?:[?#]|$)/i.test(value) || /subject|sujet/i.test(key))
      ? value
      : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findSubjectUrl(item, key, depth + 1);
      if (url) return url;
    }
    return null;
  }
  const node = object(value);
  if (!node) return null;
  const isSubject = /subject|sujet/i.test(key)
    || node.mimeType === 'application/pdf'
    || /\.pdf$/i.test(String(node.name ?? node.filename ?? ''));
  if (isSubject) {
    for (const field of ['downloadUrl', 'url', 'href', 'path']) {
      const candidate = node[field];
      if (typeof candidate === 'string'
        && /^(https?:\/\/|\/)/i.test(candidate)) {
        return candidate;
      }
    }
  }
  const entries = Object.entries(node)
    .filter(([k]) => !['unitInstance', 'cursus', 'unit'].includes(k));
  entries.sort(([a], [b]) => Number(/subject|sujet/i.test(b))
    - Number(/subject|sujet/i.test(a)));
  for (const [field, child] of entries) {
    const url = findSubjectUrl(child, field, depth + 1);
    if (url) return url;
  }
  return null;
}

/**
 * A PDF attached to a project
 * (`GET /api/units/instances/projects/{id}/related-resources/files`).
 */
export interface SubjectDocument {
  /**
 * Stable id: the slash-joined path, e.g. `Project/mini_printf-project.pdf`.
 */
  id: string;
  name: string;
  /**
 * Folder names then the file name; each segment is URL-encoded to build the
 * download route.
 */
  path: string[];
  folder: string;
  size: number | null;
  rank: number;
}

const isPdf = (name: string, mime: unknown): boolean =>
  mime === 'application/pdf' || /\.pdf$/i.test(name);

/**
 * Flattens the folder tree returned by the intranet into its PDFs, best subject
 * candidate first.
 */
export function listSubjectDocuments(tree: unknown): SubjectDocument[] {
  const docs: SubjectDocument[] = [];
  const walk = (
    nodes: unknown,
    folders: string[],
    labelKey: string | null,
    depth: number,
  ): void => {
    if (!Array.isArray(nodes) || depth > 8) return;
    for (const raw of nodes) {
      const node = object(raw);
      if (!node || typeof node.name !== 'string') continue;
      if (node.kind === 'folder'
        || Array.isArray(node.childrens) && node.kind !== 'file') {
        walk(
          node.childrens,
          [...folders, node.name],
          depth === 0
            ? (typeof node.labelKey === 'string' ? node.labelKey : null)
            : labelKey,
          depth + 1,
        );
      } else if (node.kind === 'file' || node.blob) {
        const blob = object(node.blob);
        if (!isPdf(node.name, blob?.mimeType)) continue;
        const folder = folders.join('/');
        docs.push({
          id: [...folders, node.name].join('/'),
          name: node.name,
          path: [...folders, node.name],
          folder,
          size: typeof blob?.size === 'number' ? blob.size : null,
          rank: rankSubject(folders[0] ?? '', labelKey, node.name)
            - docs.length * 0.001,
        });
      }
    }
  };
  walk(tree, [], null, 0);
  return docs.sort((a, b) => b.rank - a.rank);
}

function rankSubject(
  folder: string,
  labelKey: string | null,
  name: string,
): number {
  let score = 20;
  if (labelKey === 'project') score += 100;
  if (/^(project|projet|subject|sujet|[ée]nonc[ée])$/i.test(folder.trim())) {
    score += 90;
  }
  if (/(subject|sujet|project|projet|[ée]nonc[ée])/i.test(name)) score += 30;
  if (/bootstrap|kick-?off|slides?|correction|solution|annexe|appendix/i.test(`${folder} ${name}`)) {
    score -= 15;
  }
  return score;
}

export function pickSubjectDocument(
  docs: SubjectDocument[],
  preferredId?: string,
): SubjectDocument | undefined {
  return (preferredId ? docs.find((d) => d.id === preferredId) : undefined)
    ?? docs[0];
}

/**
 * Route that answers with a short-lived signed download URL for one attached
 * file.
 */
export function resourceRoute(
  projectId: number,
  doc: Pick<SubjectDocument, 'path'>,
): string {
  return `/api/units/instances/projects/${projectId}/related-resources/files/${doc.path.map(encodeURIComponent).join('/')}`;
}

/**
 * The route answers with a bare URL as text (content-type text/html); tolerate
 * JSON or quoted forms too.
 */
export function parseResourceLink(body: string): string | null {
  let text = body.trim();
  if (/^["{]/.test(text)) {
    try {
      const json: unknown = JSON.parse(text);
      text = typeof json === 'string'
        ? json
        : String(object(json)?.url ?? object(json)?.link
          ?? object(json)?.href ?? '');
    } catch {
      return null;
    }
  }
  return /^https:\/\/[^\s]+$/i.test(text) ? text : null;
}
