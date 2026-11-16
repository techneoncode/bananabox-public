import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRepoLink, findSubjectUrl } from '../domain/resources';
import { normalizeProject } from '../domain/projects';
import { ProjectService } from '../services/projectService';
import type { EpitechClient } from '../api/client';
import type * as vscode from 'vscode';

const link = 'https://github.com/school/project-15';
test('repositoryUrl is sufficient to clone without any grader results', () => {
  for (const field of ['repositoryUrl', 'repoLink', 'repoUrl']) {
    assert.equal(normalizeProject({ id: 1, [field]: link }, 'https://my.epitech.eu').repoLink, link);
    assert.equal(projectRepoLink({ registrations: [{ [field]: link }] }), link);
  }
  assert.equal(projectRepoLink({ cursus: { repositoryUrl: 'https://github.com/Epitech/pge/' } }), null);
  assert.equal(projectRepoLink({ unitInstance: { repositoryUrl: link } }), null);
  assert.equal(projectRepoLink({ repositoryUrl: '--bad-option' }), null);
});
test('subject discovery supports nested signed file links and prioritises the subject', () => {
  assert.equal(findSubjectUrl({ subject: { url: '/api/files/123/download?signature=demo' } }), '/api/files/123/download?signature=demo');
  assert.equal(findSubjectUrl({ files: [{ filename: 'subject.pdf', downloadUrl: 'https://files.example/download/42' }] }), 'https://files.example/download/42');
  assert.equal(findSubjectUrl({ attachment: '/other.pdf', subjectUrl: '/subject.pdf' }), '/subject.pdf');
  assert.equal(findSubjectUrl({ subjectUrl: 'javascript:alert(1)' }), null);
});
test('project detail supplies repositoryUrl and PDF without invoking the grader', async () => {
  let requests = 0;
  const client = { projectDetail: async () => { requests++; return { repositoryUrl: link, subject: { url: '/subject.pdf' } }; } } as unknown as EpitechClient;
  const memento = { get: (_key: string, fallback: unknown) => fallback, update: async () => {} } as unknown as vscode.Memento;
  const service = new ProjectService(client, memento);
  service.projects = [normalizeProject({ id: 1 }, 'https://my.epitech.eu')];
  const [project] = await Promise.all([service.resolveResources(1), service.resolveResources(1)]);
  assert.equal(requests, 1);
  assert.equal(project?.repoLink, link);
  assert.equal(project?.subjectUrl, '/subject.pdf');
  service.learnRepo(1, 'https://github.com/school/old-repo', null);
  assert.equal(service.get(1)?.repoLink, link);
  service.dispose();
});

test('project details enrich only the signed-in student group and its repository', async () => {
  const client = { projectDetail: async () => ({ registrations: [
    { id: 10, leader: { login: 'other' }, members: [{ login: 'other' }], repoLink: 'https://github.com/school/other' },
    { id: 20, leader: { login: 'chief' }, members: [{ login: 'chief' }, { login: 'mate' }], repoLink: link },
  ] }) } as unknown as EpitechClient;
  const memento = { get: (_key: string, fallback: unknown) => fallback, update: async () => {} } as unknown as vscode.Memento;
  const service = new ProjectService(client, memento, () => 'mate');
  service.projects = [normalizeProject({ id: 1, isUserRegistered: true, groupSizeMax: 4 }, '')];
  try {
    const p = await service.resolveResources(1);
    assert.equal(p?.registrationId, 20);
    assert.equal(p?.groupMemberCount, 2);
    assert.equal(p?.isGroupLeader, false);
    assert.equal(p?.repoLink, link);
  } finally { service.dispose(); }
});
