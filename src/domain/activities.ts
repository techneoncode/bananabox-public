import type {
  ActivitySlotVM,
  ActivityVM,
  ProjectVM,
  Person,
} from '../shared/types';

const validDate = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v));
const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? v as Record<string, any> : {};

export function activityKind(name: string): ActivityVM['kind'] {
  if (/mid[\s-]?(?:term|point)|intermediate|mi[\s-]?parcours|soutenance intermédiaire/i.test(name)) {
    return 'midterm';
  }
  if (/defen[cs]e|soutenance|final\s+(?:review|presentation)/i.test(name)) {
    return 'defense';
  }
  if (/follow[\s-]?up|\bsuivi\b/i.test(name)) return 'followup';
  if (/\bsusie\b/i.test(name)) return 'susie';
  if (/^\s*kick[\s-]?off\b/i.test(name)) return 'kickoff';
  if (/^\s*boot[\s-]?strap\b/i.test(name)) return 'bootstrap';
  return 'activity';
}

/**
 * Normalises `my-activities`, keeping the event coordinates needed for slot
 * registration.
 */
export function normalizeActivities(raw: unknown): ActivityVM[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    const r = record(entry);
    if (!Number.isSafeInteger(r.id)
      || typeof r.name !== 'string'
      || !r.name.trim()
      || !validDate(r.startDate)
      || !validDate(r.endDate)) {
      return [];
    }
    const name = r.name.trim();
    return [{
      id: r.id,
      name,
      kind: activityKind(name),
      startDate: r.startDate,
      endDate: r.endDate,
      mandatory: r.mandatory === true,
      hasDocuments: r.hasStudentDocuments === true,
      status: typeof r.status === 'string' && r.status ? r.status : null,
      eventId: Number.isSafeInteger(r.eventId) && r.eventId > 0
        ? r.eventId
        : null,
      location: typeof r.location === 'string'
        ? r.location
        : typeof r.room?.name === 'string'
          ? r.room.name
          : null,
      registrationDeadline: validDate(r.endRegistrationDate)
        ? r.endRegistrationDate
        : null,
    }];
  }).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)
    || a.id - b.id);
}

export function normalizeSlots(
  raw: unknown,
  login: string | null,
  registrationId: number | null,
): ActivitySlotVM[] {
  if (!Array.isArray(raw)) return [];
  const identity = login?.trim().toLowerCase();
  return raw.flatMap(entry => {
    const s = record(entry);
    if (!Number.isSafeInteger(s.id) || !validDate(s.startDate)
      || !validDate(s.endDate)) {
      return [];
    }
    const r = record(s.registration);
    const group = record(r.projectRegistration);
    const members = new Map<string, Person>();
    for (const rawPerson of [
      ...(Array.isArray(group.members)
        ? group.members.filter((p: any) => !p.status || p.status === 'accepted')
        : []),
      group.leader,
      ...(Array.isArray(r.registeredStudents) ? r.registeredStudents : []),
      r.student,
    ]) {
      const p = record(rawPerson);
      if (typeof p.login !== 'string' || !p.login) continue;
      members.set(p.login.toLowerCase(), {
        login: p.login,
        name: [p.firstname, p.lastname]
          .filter(v => typeof v === 'string')
          .join(' ')
          .trim() || p.login,
      });
    }
    return [{
      id: s.id,
      startDate: s.startDate,
      endDate: s.endDate,
      available: s.registration === null,
      mine: !!s.registration && ((registrationId !== null
        && (r.projectRegistrationId === registrationId
          || group.id === registrationId))
        || !!identity && members.has(identity)),
      groupName: typeof group.groupName === 'string' ? group.groupName : null,
      members: [...members.values()],
    }];
  }).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)
    || a.id - b.id);
}

/**
 * Prefer the student's booked midterm, then its published session, then an
 * explicit project date.
 */
export function projectMidpoint(
  project: ProjectVM,
  activities: ActivityVM[] | undefined,
): {
  date: string | null;
  source: 'slot' | 'session' | 'project' | 'unknown';
} {
  const midterms = activities?.filter(a => a.kind === 'midterm') ?? [];
  const slot = midterms.flatMap(a => a.slots ?? []).find(s => s.mine);
  if (slot) return { date: slot.startDate, source: 'slot' };
  if (midterms.length) {
    return { date: midterms[0].startDate, source: 'session' };
  }
  return project.midEstimated
    ? { date: null, source: 'unknown' }
    : { date: project.midDate, source: 'project' };
}
