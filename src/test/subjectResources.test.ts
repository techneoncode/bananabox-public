import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { EpitechClient } from '../api/client';
import { listSubjectDocuments, parseResourceLink, pickSubjectDocument, resourceRoute } from '../domain/resources';
import { parseGitStatus } from '../domain/git';
import { normalizeProject } from '../domain/projects';
import { SubjectService } from '../services/subjectService';
import { afterClone, confirmGraderRun, graderWarnings } from '../ui/prompts';
import { createT } from '../shared/i18n';

// Real payload captured from my.epitech.eu (project 4108): a "Project" folder and a "Bootstrap" folder.
const tree = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'test', 'fixtures', 'subject-resources.json'), 'utf8')) as unknown[];
const SIGNED = 'https://production-my.s3.gra.io.cloud.ovh.net/files/units/projects/x/mini_printf-project.pdf?X-Amz-Signature=abc';
const PDF = Buffer.from('%PDF-1.7\nfixture');

test('the project folder PDF is ranked as the subject, bootstrap PDFs come after', () => {
  const docs = listSubjectDocuments(tree);
  assert.deepEqual(docs.map((d) => d.id), ['Project/mini_printf-project.pdf', 'Bootstrap - mini_printf/mini_printf-bootstrap.pdf']);
  assert.equal(docs[0].size, 557606);
  assert.equal(pickSubjectDocument(docs)?.name, 'mini_printf-project.pdf');
  assert.equal(pickSubjectDocument(docs, 'Bootstrap - mini_printf/mini_printf-bootstrap.pdf')?.folder, 'Bootstrap - mini_printf');
  assert.equal(pickSubjectDocument(docs, 'missing')?.id, docs[0].id);
});

test('download routes encode each segment exactly like the website', () => {
  const docs = listSubjectDocuments(tree);
  assert.equal(resourceRoute(4108, docs[0]), '/api/units/instances/projects/4108/related-resources/files/Project/mini_printf-project.pdf');
  assert.equal(resourceRoute(4108, docs[1]), '/api/units/instances/projects/4108/related-resources/files/Bootstrap%20-%20mini_printf/mini_printf-bootstrap.pdf');
});

test('ranking prefers labelled/named subjects, ignores non-PDF files and nested folders are walked', () => {
  const nested = [
    { id: -1, kind: 'folder', name: 'Annexes', childrens: [{ kind: 'file', name: 'slides.pdf', blob: { mimeType: 'application/pdf' } }, { kind: 'file', name: 'data.zip', blob: { mimeType: 'application/zip' } }] },
    { id: -2, kind: 'folder', name: 'Projet', labelKey: 'project', childrens: [{ kind: 'folder', name: 'v2', childrens: [{ kind: 'file', name: 'sujet.pdf', blob: { mimeType: 'application/pdf' } }] }] },
    { kind: 'file', name: 'loose.pdf', blob: { mimeType: 'application/pdf' } },
  ];
  const docs = listSubjectDocuments(nested);
  assert.equal(docs[0].id, 'Projet/v2/sujet.pdf');
  assert.ok(!docs.some((d) => d.name === 'data.zip'));
  assert.equal(docs.find((d) => d.name === 'loose.pdf')?.path.length, 1);
  assert.deepEqual(listSubjectDocuments(undefined), []);
});

test('signed links are accepted as bare text, JSON string or {url}; anything else is rejected', () => {
  assert.equal(parseResourceLink(`${SIGNED}\n`), SIGNED);
  assert.equal(parseResourceLink(JSON.stringify(SIGNED)), SIGNED);
  assert.equal(parseResourceLink(JSON.stringify({ url: SIGNED })), SIGNED);
  assert.equal(parseResourceLink('http://insecure.example/x.pdf'), null);
  assert.equal(parseResourceLink('<html>nope</html>'), null);
  assert.equal(parseResourceLink(''), null);
});

function withFetch(handler: (url: string) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => handler(String(input))) as typeof fetch;
  return () => void (globalThis.fetch = original);
}
const project = normalizeProject({ id: 4108, name: 'mini_printf' }, 'https://my.epitech.eu');
const bytesResponse = (status: number, body: Buffer = PDF) => new Response(status === 200 ? new Uint8Array(body) : null, { status, statusText: status === 200 ? 'OK' : 'Forbidden' });

test('subject = attached "Project" PDF, fetched through its signed URL without the Epitech token', async () => {
  const routes: string[] = [];
  const fetched: string[] = [];
  const client = { projectResources: async () => tree, resourceLink: async (route: string) => (routes.push(route), SIGNED), download: async () => { throw new Error('must not use the authenticated download'); } } as unknown as EpitechClient;
  const restore = withFetch((url) => (fetched.push(url), bytesResponse(200)));
  try {
    const service = new SubjectService(client);
    const state = await service.load(project);
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready') return;
    assert.equal(state.name, 'mini_printf-project.pdf');
    assert.equal(state.docId, 'Project/mini_printf-project.pdf');
    assert.equal(state.documents.length, 2);
    assert.equal(Buffer.from(state.base64, 'base64').toString(), PDF.toString());
    assert.deepEqual(routes, ['/api/units/instances/projects/4108/related-resources/files/Project/mini_printf-project.pdf']);
    assert.deepEqual(fetched, [SIGNED]);
    assert.equal(await service.load(project), state); // cached
    // Switch to the bootstrap PDF.
    const other = await service.load(project, 'Bootstrap - mini_printf/mini_printf-bootstrap.pdf');
    assert.equal(other.status === 'ready' && other.name, 'mini_printf-bootstrap.pdf');
    assert.match(routes[1], /Bootstrap%20-%20mini_printf/);
    service.clear();
  } finally {
    restore();
  }
});

test('an expired/rejected signed link is replaced by a fresh one (single retry)', async () => {
  let links = 0;
  const client = { projectResources: async () => tree, resourceLink: async () => `${SIGNED}&n=${++links}` } as unknown as EpitechClient;
  const restore = withFetch((url) => (url.endsWith('n=1') ? bytesResponse(403) : bytesResponse(200)));
  try {
    const state = await new SubjectService(client).load(project);
    assert.equal(state.status, 'ready');
    assert.equal(links, 2);
  } finally {
    restore();
  }
});

test('no PDF attached → unavailable; intranet down → retryable error; non-PDF payload → error', async () => {
  const empty = { projectResources: async () => [], projectDetail: async () => ({}) } as unknown as EpitechClient;
  assert.deepEqual(await new SubjectService(empty).load(project), { status: 'unavailable', reason: 'no_link' });

  const down = { projectResources: async () => { throw Object.assign(new Error('boom'), { status: 503 }); }, projectDetail: async () => { throw new Error('down'); } } as unknown as EpitechClient;
  const downState = await new SubjectService(down).load(project);
  assert.equal(downState.status, 'error');

  const html = { projectResources: async () => tree, resourceLink: async () => SIGNED } as unknown as EpitechClient;
  const restore = withFetch(() => bytesResponse(200, Buffer.from('<html>login</html>')));
  try {
    assert.equal((await new SubjectService(html).load(project)).status, 'error');
  } finally {
    restore();
  }
});

test('opening online asks for a fresh signed link', async () => {
  let links = 0;
  const client = { projectResources: async () => tree, resourceLink: async () => `${SIGNED}&n=${++links}` } as unknown as EpitechClient;
  const restore = withFetch(() => bytesResponse(200));
  const opened: string[] = [];
  (vscode.env as any).openExternal = async (uri: vscode.Uri) => (opened.push(uri.toString()), true);
  try {
    const service = new SubjectService(client);
    await service.load(project);
    await service.openInBrowser(project);
    assert.match(opened[0], /n=2$/);
  } finally {
    restore();
  }
});

test('git status parsing', () => {
  assert.deepEqual(parseGitStatus('## main...origin/main [ahead 2, behind 1]\n M a.c\n?? b.c\n'), { branch: 'main', hasUpstream: true, ahead: 2, behind: 1, dirty: 2 });
  assert.deepEqual(parseGitStatus('## main...origin/main\n'), { branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirty: 0 });
  assert.equal(parseGitStatus('## feature\n').hasUpstream, false);
  assert.equal(parseGitStatus('## main...origin/main [gone]\n').hasUpstream, false);
  assert.equal(parseGitStatus('## No commits yet on main\n?? a\n').branch, null);
});

test('grader warnings flag unpushed or uncommitted work', () => {
  const t = createT('en');
  assert.deepEqual(graderWarnings(undefined, t), []);
  assert.deepEqual(graderWarnings({ branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirty: 0 }, t), []);
  assert.deepEqual(graderWarnings({ branch: 'main', hasUpstream: true, ahead: 2, behind: 0, dirty: 3 }, t), ['2 commit(s) not pushed yet.', '3 file(s) with uncommitted changes.']);
  assert.deepEqual(graderWarnings({ branch: 'x', hasUpstream: false, ahead: 0, behind: 0, dirty: 0 }, t), ['This branch has not been pushed yet.']);
});

function mockDialogs(settings: Record<string, unknown>, answer: (message: string, options: any, items: any[]) => any) {
  const calls: Array<{ message: string; options: any; titles: string[]; level: string }> = [];
  (vscode.workspace as any).getConfiguration = () => ({ get: (k: string) => settings[k] });
  const make = (level: string) => async (message: string, options: any, ...items: any[]) => (calls.push({ message, options, titles: items.map((i) => i.title), level }), answer(message, options, items));
  (vscode.window as any).showInformationMessage = make('info');
  (vscode.window as any).showWarningMessage = make('warning');
  return calls;
}

test('after a clone, a modal offers this window / new window / workspace / ignore', async () => {
  const calls = mockDialogs({}, (_m, _o, items) => items[1]);
  assert.equal(await afterClone('mini_printf', '/home/me/mini_printf', true), 'window');
  assert.equal(calls[0].options.modal, true);
  assert.deepEqual(calls[0].titles, ['Open in this window', 'Open in a new window', 'Add to this workspace', 'Ignore']);
  assert.match(calls[0].options.detail, /\/home\/me\/mini_printf/);
  const calls2 = mockDialogs({}, () => undefined); // dismissed with Esc
  assert.equal(await afterClone('x', '/x', false), 'ignore');
  assert.ok(!calls2[0].titles.includes('Add to this workspace'));
});

test('grader confirmation: skipped when disabled and clean, forced when work is unpushed', async () => {
  const none = mockDialogs({ confirmGraderRun: false }, () => { throw new Error('no dialog expected'); });
  assert.equal(await confirmGraderRun({ name: 'P', remaining: 3, total: 6, git: { branch: 'main', hasUpstream: true, ahead: 0, behind: 0, dirty: 0 } }), 'run');
  assert.equal(none.length, 0);

  const warned = mockDialogs({ confirmGraderRun: false }, (_m, _o, items) => items[0]);
  assert.equal(await confirmGraderRun({ name: 'P', remaining: 1, total: 6, git: { branch: 'main', hasUpstream: true, ahead: 1, behind: 0, dirty: 0 } }), 'run');
  assert.equal(warned[0].level, 'warning');
  assert.deepEqual(warned[0].titles, ['Run anyway']);
  assert.match(warned[0].options.detail, /1 commit\(s\) not pushed yet/);
  assert.match(warned[0].options.detail, /last token/);

  const asked = mockDialogs({}, (_m, _o, items) => items[1]);
  assert.equal(await confirmGraderRun({ name: 'P', remaining: 4, total: 6 }), 'runAlways');
  assert.deepEqual(asked[0].titles, ['Run the grader', 'Run, and don’t ask again']);
  assert.match(asked[0].options.detail, /4 of 6 left/);
});
