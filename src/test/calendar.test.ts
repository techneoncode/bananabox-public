import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRegister, eventType, normalizeEvents, normalizePeople, pickSlot, validatePrefs, weekStart } from '../domain/calendar';

const ev = (id: number, extra: Record<string, unknown> = {}) => ({ id, startDate: '2030-11-10T13:00:00.000Z', endDate: '2030-11-10T16:00:00.000Z', activityName: 'Defense - my_ls',
  unitCode: 'G-PSU-100', unitName: 'Unix', projectInstanceId: 3644, activitySlotsEnabled: true, slotsCount: 30, slotRegistrationsCount: 29, registrationDeadlineHours: 12, ...extra });

test('calendar: only sessions of my units and projects, mine always, registration marked', () => {
  const events = normalizeEvents([ev(1), ev(2, { unitCode: 'G-OTHER' }), ev(3, { projectInstanceId: 99 }), ev(4, { projectInstanceId: null, activitySlotsEnabled: false, maxCapacity: 2, simpleRegistrationsCount: 2 })],
    [ev(5, { unitCode: 'X', mySlotStartDate: '2030-11-10T13:15:00.000Z', mySlotEndDate: '2030-11-10T13:30:00.000Z' })], new Set(['G-PSU-100']), new Set([3644]));
  assert.deepEqual(events.map(e => e.id), [1, 4, 5]);
  assert.equal(events[0].registered, false);
  assert.equal(events[0].type, 'Defense');
  assert.equal(events[0].deadline, '2030-11-10T01:00:00.000Z');
  assert.equal(events[1].full, true);
  assert.equal(events[2].registered, true);
  assert.equal(events[2].mySlot?.start, '2030-11-10T13:15:00.000Z');
  assert.equal(canRegister(events[0], Date.parse('2030-11-09T00:00:00Z')), true);
  assert.equal(canRegister(events[0], Date.parse('2030-11-10T02:00:00Z')), false);
});

test('calendar: extracurricular units, optional sessions and other sessions of a held activity are not required', () => {
  const base = { startDate: '2030-11-10T08:00:00.000Z', endDate: '2030-11-10T10:00:00.000Z', projectInstanceId: null };
  const events = normalizeEvents([
    { ...base, id: 1, activityName: 'Kick-off - 102architect', unitCode: 'G-MAT-100', projectInstanceId: 4345, activityInstanceId: 10 },
    { ...base, id: 2, activityName: 'Bootstrap - 102architect', unitCode: 'G-MAT-100', projectInstanceId: 4345, activityInstanceId: 11 },
    { ...base, id: 3, activityName: 'Evaluation - Professional e-mail', activityDescription: 'Registration and attendance are mandatory.', unitCode: 'G-PRO-100', activityInstanceId: 12 },
    { ...base, id: 4, activityName: 'JPO', unitCode: 'S-EPI-000', activityInstanceId: 13 },
    { ...base, id: 5, activityName: 'Workshop - Making yourself understandable', unitCode: 'G-PRO-100', activityInstanceId: 14 },
    { ...base, id: 6, activityName: 'Workshop - Making yourself understandable', unitCode: 'G-PRO-100', activityInstanceId: 14 },
  ], [{ ...base, id: 6, activityName: 'Workshop - Making yourself understandable', unitCode: 'G-PRO-100', activityInstanceId: 14 }],
  new Set(['G-MAT-100', 'G-PRO-100', 'S-EPI-000']), new Set([4345]));
  assert.deepEqual(events.map(e => [e.id, e.required, e.alternative, e.sessions]), [[1, true, false, 1], [2, false, false, 1], [3, true, false, 1], [5, false, true, 2], [6, false, false, 2]]);
});

test('calendar: the first free slot in preference order is picked', () => {
  const at = (h: number, m: number) => new Date(2030, 10, 12, h, m).toISOString();
  const slot = (id: number, start: string, available = true) => ({ id, startDate: start, endDate: start, available, mine: false, groupName: null, members: [] });
  const slots = [slot(1, at(9, 0), false), slot(2, at(9, 15)), slot(3, at(10, 0))];
  const prefs = validatePrefs({ autoRegister: false, preferences: [{ type: 'defense', slots: [{ day: null, time: '09:00' }, { day: new Date(2030, 10, 12).getDay(), time: '10:00' }, { day: null, time: '09:15' }] }] })!;
  assert.equal(pickSlot('Defense', slots, prefs)?.id, 3);
  assert.equal(pickSlot('Kick-off', slots, prefs), null);
  assert.equal(validatePrefs({ autoRegister: true, preferences: [{ type: 'x', slots: [{ day: 9, time: '09:00' }] }] }), null);
  assert.equal(eventType('Midterm Defense - my_ls'), 'Midterm Defense');
  assert.equal(weekStart(new Date(2026, 10, 15)).getDate(), 9);
});

test('calendar: booking a shared time takes the next free place when the first was taken meanwhile', async () => {
  const { CalendarService } = await import('../services/calendarService');
  const { ApiError } = await import('../api/client');
  const at = '2030-11-12T14:00:00.000Z', start = '2030-11-12T13:00:00.000Z';
  const free = (id: number, startDate = at) => ({ id, startDate, endDate: startDate, registration: null });
  const tried: number[] = [];
  const client: any = {
    unitInstances: async () => [{ unitCode: 'G-PSU-100', isRegistered: true }],
    events: async (q: any) => q.registered ? [] : [{ id: 7, startDate: start, endDate: '2030-11-12T17:00:00.000Z', activityName: 'Defense - my_sudo', unitCode: 'G-PSU-100', activitySlotsEnabled: true, slotsCount: 30, slotRegistrationsCount: 9 }],
    eventSlots: async () => [free(1), free(2), free(3), free(4, start)],
    registerSlot: async (_: number, id: number) => { tried.push(id); if (id === 1) throw new ApiError('taken', 409, '/slots'); },
  };
  const store = new Map<string, unknown>();
  const service = new CalendarService(client, { get: (k: string) => store.get(k), update: async (k: string, v: unknown) => { store.set(k, v); } } as any,
    () => 'tests', () => ({ login: 'me@epitech.eu', promotion: null, cursus: null, projects: [] }));
  await service.load('2030-11-11', '2030-11-17');
  (service as any).lastWrite = 0;
  await service.register(7, 1);
  assert.deepEqual(tried, [1, 2]);
  service.dispose();
});

test('calendar: registered people are read from students, groups or the entries themselves, once each', () => {
  const people = normalizePeople({ data: [
    { student: { login: 'zoe.b@epitech.eu', firstname: 'Zoé', lastname: 'B' } },
    { projectRegistration: { members: [{ login: 'al.c@epitech.eu', firstname: 'Al', lastname: 'C', status: 'accepted' }, { login: 'x@epitech.eu', status: 'pending' }] } },
    { login: 'ZOE.B@epitech.eu' }, { id: 3 },
  ] });
  assert.deepEqual(people, [{ login: 'al.c@epitech.eu', name: 'Al C' }, { login: 'zoe.b@epitech.eu', name: 'Zoé B' }]);
  assert.deepEqual(normalizePeople(null), []);
});

test('calendar: missing people are the expected ones holding no session of the activity', async () => {
  const { missingPeople } = await import('../domain/calendar');
  const unit = normalizePeople([{ student: { login: 'a@epitech.eu', firstname: 'A' } }, { student: { login: 'b@epitech.eu', firstname: 'B' } },
    { student: { login: 'c@epitech.eu', firstname: 'C' } }, { outOfScope: true, student: { login: 'd@epitech.eu', firstname: 'D' } }]);
  const project = normalizePeople([{ groupName: 'G', leader: { login: 'e@epitech.eu', firstname: 'E' }, members: [{ login: 'f@epitech.eu', firstname: 'F', status: 'accepted' }] }]);
  assert.deepEqual(unit.map(p => p.login), ['a@epitech.eu', 'b@epitech.eu', 'c@epitech.eu']);
  assert.deepEqual(project.map(p => p.login), ['e@epitech.eu', 'f@epitech.eu']);
  assert.deepEqual(missingPeople(unit, [{ login: 'A@epitech.eu', name: 'A' }], [{ login: 'c@epitech.eu', name: 'C' }]).map(p => p.login), ['b@epitech.eu']);
});

test('calendar: quick navigation reads only the last week, and a week seen before shows at once from the cache', async () => {
  const { CalendarService } = await import('../services/calendarService');
  const reads: string[] = [];
  const client: any = {
    unitInstances: async () => [{ unitCode: 'G-PSU-100', isRegistered: true }],
    events: async (q: any) => { if (!q.registered) reads.push(q.startDate); return q.registered ? [] : [{ id: 7, startDate: `${q.startDate}T09:00:00.000Z`, endDate: `${q.startDate}T10:00:00.000Z`, activityName: 'Kick-off - x', unitCode: 'G-PSU-100' }]; },
  };
  const store = new Map<string, unknown>();
  const service = new CalendarService(client, { get: (k: string) => store.get(k), update: async (k: string, v: unknown) => { store.set(k, v); } } as any,
    () => 'tests', () => ({ login: 'me@epitech.eu', promotion: null, cursus: null, projects: [] }));
  const a = service.load('2030-11-04', '2030-11-10'), b = service.load('2030-11-11', '2030-11-17'), c = service.load('2030-11-18', '2030-11-24');
  await Promise.all([a, b, c]);
  assert.deepEqual(reads, ['2030-11-18']);
  void service.load('2030-11-11', '2030-11-17');
  assert.equal(service.snapshot().events, null, 'never read: nothing to show yet');
  const back = service.load('2030-11-18', '2030-11-24');
  assert.equal(service.snapshot().events?.length, 1, 'shown from the cache before any read');
  assert.equal(service.snapshot().loading, true);
  await back;
  service.dispose();
});

test('calendar: the automation plan says what happens to each open required session', async () => {
  const { autoPlan } = await import('../domain/calendar');
  const base = { startDate: '2030-11-10T08:00:00.000Z', endDate: '2030-11-10T10:00:00.000Z', unitCode: 'G-PSU-100', projectInstanceId: null };
  const events = normalizeEvents([
    { ...base, id: 1, activityName: 'Kick-off - a', activityInstanceId: 1 },
    { ...base, id: 2, activityName: 'Review - b', activityInstanceId: 2 }, { ...base, id: 3, activityName: 'Review - b', activityInstanceId: 2 },
    { ...base, id: 4, activityName: 'Defense - c', activitySlotsEnabled: true, slotsCount: 9, slotRegistrationsCount: 1, activityInstanceId: 4 },
    { ...base, id: 5, activityName: 'Follow-up - d', activitySlotsEnabled: true, slotsCount: 9, slotRegistrationsCount: 1, activityInstanceId: 5 },
  ], [], new Set(['G-PSU-100']), new Set());
  const prefs = { autoRegister: true, preferences: [{ type: 'Defense', slots: [{ day: null, time: '09:00' }] }] };
  const now = Date.parse('2030-11-01T00:00:00Z');
  assert.deepEqual(autoPlan(events, prefs, now).map(p => [p.event.id, p.action]), [[1, 'register'], [2, 'manual'], [3, 'manual'], [4, 'book'], [5, 'manual']]);
  assert.equal(autoPlan(events, { ...prefs, autoRegister: false }, now)[0].action, 'off');
});
