import { projectRepoLink, findSubjectUrl } from './resources';
import type { Person, ProjectStatus, ProjectVM } from '../shared/types';
import { parseEpitechRepoName, parseRemote, sameRepo } from './git';

type Json = Record<string, any>;

export function classify(
  startDate: string,
  endDate: string,
  now = Date.now(),
): ProjectStatus {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isFinite(start) && start > now) return 'upcoming';
  if (Number.isFinite(end) && end < now) return 'past';
  return 'ongoing';
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const MID_KEYS = [
  'midDate',
  'midProjectDate',
  'midTermDate',
  'midpointDate',
  'checkpointDate',
  'intermediateDate',
];

function pickMid(raw: Json): string | null {
  for (const key of MID_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && Number.isFinite(Date.parse(v))) return v;
  }
  return null;
}

export function midpoint(startDate: string, endDate: string): string {
  const s = Date.parse(startDate);
  const e = Date.parse(endDate);
  return Number.isFinite(s) && Number.isFinite(e)
    ? new Date(s + (e - s) / 2).toISOString()
    : '';
}

function people(list: unknown): Person[] {
  if (!Array.isArray(list)) return [];
  return list.map((p: Json) => ({
    name: [p.firstname, p.lastname]
      .map((s: unknown) => String(s ?? '').trim())
      .filter(Boolean)
      .join(' ')
      || String(p.login ?? ''),
    login: String(p.login ?? ''),
  }));
}

function groupPeople(registration: Json | undefined): Person[] {
  if (!registration) return [];
  const seen = new Set<string>();
  const list = [
    registration.leader,
    ...(Array.isArray(registration.members) ? registration.members : []),
  ].filter(Boolean);
  return people(list)
    .filter(p => p.login
      && !seen.has(p.login.toLowerCase())
      && seen.add(p.login.toLowerCase()));
}

/** Converts one entry of `/api/units/instances/projects` into the view-model used everywhere else. */
export function normalizeProject(
  raw: Json,
  baseUrl: string,
  now: number = Date.now(),
  login?: string | null,
): ProjectVM {
  const unit: Json = raw.unitInstance ?? {};
  const registrations: Json[] = Array.isArray(raw.registrations)
    ? raw.registrations
    : [];
  const identity = login?.trim().toLowerCase();
  const sameLogin = (value: unknown) => !!identity
    && typeof value === 'string'
    && value.trim().toLowerCase() === identity;
  const registration = registrations.find(r => sameLogin(r.leader?.login)
    || r.members?.some((m: Json) => sameLogin(m.login)))
    ?? (registrations.length === 1
      && raw.isUserRegistered !== false
      && (!identity || (!registrations[0].leader?.login
        && !Array.isArray(registrations[0].members)))
      ? registrations[0]
      : undefined);
  const members: Json[] | undefined = Array.isArray(registration?.members)
    ? registration.members
    : undefined;
  const memberLogins = members
    ? new Set(members
      .map(m => String(m.login ?? '').trim().toLowerCase())
      .filter(Boolean))
    : null;
  if (memberLogins && registration?.leader?.login) {
    memberLogins.add(String(registration.leader.login).trim().toLowerCase());
  }

  const startDate = String(raw.startDate);
  const endDate = String(raw.endDate);
  const explicitMid = pickMid(raw) ?? pickMid(unit);
  const unitCode = String(unit.unitCode ?? raw.unitCode ?? '');
  const instanceCode = String(unit.code ?? raw.instanceCode ?? '');
  const schoolYear = Number(
    raw.schoolYear ?? unit.schoolYear ?? new Date().getFullYear(),
  );

  return {
    id: Number(raw.id),
    name: String(raw.fullName ?? raw.name ?? `Project ${raw.id}`),
    description: String(raw.description ?? ''),
    unitName: String(unit.name ?? raw.unitName ?? ''),
    unitCode,
    instanceCode,
    schoolYear,
    startDate,
    endDate,
    endRegistrationDate: raw.endRegistrationDate
      ? String(raw.endRegistrationDate)
      : null,
    midDate: explicitMid ?? midpoint(startDate, endDate),
    midEstimated: explicitMid === null,
    status: classify(startDate, endDate, now),
    registered: Boolean(raw.isUserRegistered ?? registration),
    registrationId: registration ? Number(registration.id) : null,
    groupName: registration?.groupName ? String(registration.groupName) : null,
    groupMemberCount: memberLogins?.size ?? null,
    isGroupLeader: identity && typeof registration?.leader?.login === 'string'
      ? sameLogin(registration.leader.login)
      : null,
    groupSizeMin: Number(raw.groupSizeMin ?? 1),
    groupSizeMax: Number(raw.groupSizeMax ?? 1),
    registrationsCount: Number(raw.registrationsCount ?? 0),
    repoEnabled: Boolean(raw.repoEnabled),
    repoLink: projectRepoLink({
      ...raw,
      registrations: registration ? [registration] : [],
    }),
    subjectUrl: findSubjectUrl(raw),
    projectCode: typeof raw.projectCode === 'string' ? raw.projectCode : null,
    hermesUrl: raw.hermesActivityUrl ? String(raw.hermesActivityUrl) : null,
    intranetUrl: `${baseUrl.replace(/\/+$/, '')}/units/${schoolYear}/${unitCode}/${instanceCode}/projects/${raw.id}`,
    responsibles: people(unit.responsibles),
    groupMembers: groupPeople(registration),
    peerEvaluation: Boolean(raw.peerEvaluation),
    unitDescription: String(unit.description ?? ''),
  };
}

const ORDER: Record<ProjectStatus, number> = {
  ongoing: 0,
  upcoming: 1,
  past: 2,
};

/** Ongoing first (soonest deadline first), then upcoming (soonest start), then past (most recent first). */
export function sortProjects(list: ProjectVM[]): ProjectVM[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return ORDER[a.status] - ORDER[b.status];
    const [x, y] = a.status === 'past'
      ? [Date.parse(b.endDate), Date.parse(a.endDate)]
      : a.status === 'upcoming'
        ? [Date.parse(a.startDate), Date.parse(b.startDate)]
        : [Date.parse(a.endDate), Date.parse(b.endDate)];
    return x - y || a.name.localeCompare(b.name);
  });
}

/**
 * Finds the project a local repository belongs to.
 * 1. Exact `owner/repo` match against a known `repoLink` (most reliable).
 * 2. Epitech naming convention `UNIT-INSTANCE-PROJECTCODE-GROUP`, compared to the project code, or
 *    to the slugified project name when the code is not known yet (`[CPool] Day13` → `cpoolday13`).
 */
export function matchProjectToRemotes(
  projects: ProjectVM[],
  remoteUrls: string[],
): ProjectVM | null {
  const remotes = remoteUrls
    .map(parseRemote)
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (remotes.length === 0) return null;
  for (const project of projects) {
    if (!project.repoLink) continue;
    const link = parseRemote(project.repoLink);
    if (link && remotes.some((r) => sameRepo(r, link))) return project;
  }

  const named = projects.filter((p) => {
    const link = p.repoLink ? parseRemote(p.repoLink) : null;
    return link
      && remotes.some((r) => r.repo.toLowerCase() === link.repo.toLowerCase());
  });
  if (named.length === 1) return named[0];

  let best: { project: ProjectVM; rank: number } | null = null;
  for (const remote of remotes) {
    const parsed = parseEpitechRepoName(remote.repo);
    if (!parsed) continue;
    for (const project of projects) {
      if (project.unitCode.toUpperCase() !== parsed.unitCode) continue;
      if (project.instanceCode
        && !parsed.instance.startsWith(project.instanceCode.toUpperCase())) {
        continue;
      }
      const byCode = project.projectCode?.toLowerCase() === parsed.projectCode;
      const bySlug = slugify(project.name) === slugify(parsed.projectCode);
      if (!byCode && !bySlug) continue;
      const rank = (project.registered ? 2 : 0)
        + (byCode ? 1 : 0)
        + project.schoolYear / 10000;
      if (!best || rank > best.rank) best = { project, rank };
    }
  }
  return best?.project ?? null;
}

export function repoFolderName(repoLink: string): string {
  return parseRemote(repoLink)?.repo
    ?? repoLink.split('/').pop()?.replace(/\.git$/, '')
    ?? 'project';
}

/** User policy: requests close at exactly 66% of the scheduled project duration. */
export function separateGradesEligible(p: ProjectVM, now = Date.now()): boolean {
  const start = Date.parse(p.startDate);
  const end = Date.parse(p.endDate);
  return p.registered
    && (p.groupMemberCount ?? 0) > 1
    && Number.isFinite(start)
    && Number.isFinite(end)
    && end > start
    && now >= start
    && now < start + (end - start) * 0.66;
}

export function graderGroupRestriction(
  p: ProjectVM,
): 'group_unknown' | 'leader_only' | null {
  if (p.groupMemberCount == null) {
    return p.groupSizeMax > 1 ? 'group_unknown' : null;
  }
  if (p.groupMemberCount <= 1) return null;
  if (p.isGroupLeader === true) return null;
  if (p.isGroupLeader === false) return 'leader_only';
  return 'group_unknown';
}
