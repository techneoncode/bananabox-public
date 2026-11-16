import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivities, normalizeSlots, projectMidpoint } from '../domain/activities';
import { defenseEvents, dueDefenseAlert, acknowledgedDefenseKeys } from '../domain/defenseReminders';
import { normalizeDetail } from '../domain/grader';
import { ApiError, EpitechClient } from '../api/client';
import { ActivityService } from '../services/activityService';
import type { ProjectVM } from '../shared/types';

const start = '2026-12-10T10:00:00Z', end = '2026-12-10T10:15:00Z';
const raw = { id: 12, eventId: 42, name: 'Mid-term defense', startDate: '2026-12-10T09:00:00Z', endDate: end, status: 'registered' };
const slot = (id: number, registration: any = null) => ({ id, startDate: start, endDate: end, registration });
const booking = { projectRegistrationId: 111, projectRegistration: { id: 111, groupName: 'Our group', members: [
  { login: 'member@example.test', firstname: 'Group', lastname: 'Member', status: 'accepted' },
  { login: 'invited@example.test', firstname: 'Invited', status: 'pending' },
], leader: { login: 'leader@example.test', firstname: 'The', lastname: 'Leader' } }, registeredStudents: [{ login: 'member@example.test', firstname: 'Group', lastname: 'Member' }] };
const project = { id: 7, name: 'Project', midEstimated: true, midDate: '2026-12-01T10:00:00Z' } as ProjectVM;

test('grader preserves successful FullSkillReport tasks before the first failure and matches spaced trace headings', () => {
  const names = ['01 - List directory contents', '02 - Handle hidden entries', '03 - Invalid paths', '04 - Sizes and dates', '05 - Ownership', '06 - Traverse directories'];
  const skills = names.map((name, i) => i < 4 ? { FullSkillReport: { name, tests: [
    { passed: true }, { passed: true },
  ] } } : { BreakdownSkillReport: { name, breakdown: { count: 2, passed: i === 4 ? 1 : 2, crashed: 0 } } });
  const detail = normalizeDetail({ skills, poolTrace: `====================\n${names[4]}\n====================\n${names[4]}: FAILURE` });
  assert.deepEqual(detail.tasks.map(t => t.name), names);
  assert.deepEqual(detail.tasks.map(t => t.status), ['passed', 'passed', 'passed', 'passed', 'failed', 'passed']);
  assert.equal(detail.total, 12); assert.equal(detail.passed, 11);
  const counts = normalizeDetail({ skills: [{ FullSkillReport: { name: 'A', tests: [{ passed: false, crashed: true, mandatory: true }, { skipped: true }] } }] });
  assert.equal(counts.tasks[0].crashed, 1); assert.equal(counts.tasks[0].mandatoryFailed, 1);
  const matched = normalizeDetail({ skills: [{ FullSkillReport: { name: '02 - task02', tests: [{ passed: true }] } }], poolTrace: '====================\ntask02 - testing cat\n====================\ntask02 - testing cat: SUCCESS' });
  assert.equal(matched.tasks.length, 1); assert.equal(matched.tasks[0].status, 'passed');
});

test('slot identity uses registration or accepted group members, with deduplicated names and explicit availability', () => {
  const slots = normalizeSlots([slot(1, booking), slot(2), slot(3, { student: { login: 'solo@example.test' } }), { id: 4, startDate: 'bad' }, { id: 5, startDate: start, endDate: end }], 'MEMBER@example.test', null);
  assert.equal(slots[0].mine, true); assert.equal(slots[0].available, false);
  assert.deepEqual(slots[0].members.map(m => m.login), ['member@example.test', 'leader@example.test']);
  assert.equal(slots[1].available, true); assert.equal(slots.at(-1)?.available, false, 'missing registration metadata is not proof of availability');
  assert.equal(normalizeSlots([slot(1, booking)], null, 111)[0].mine, true);
  assert.equal(normalizeSlots([slot(1, booking)], 'invited@example.test', null)[0].mine, false);
  assert.equal(normalizeSlots([slot(3, { student: { login: 'solo@example.test' } })], 'solo@example.test', null)[0].mine, true);
});

test('midpoint uses the actual midterm booking, published session or explicit date, never a guessed midpoint', () => {
  const activities = normalizeActivities([raw, { ...raw, id: 13, name: 'Soutenance finale' }]);
  assert.deepEqual(activities.map(a => a.kind), ['midterm', 'defense']);
  assert.equal(activities[0].eventId, 42);
  assert.equal(projectMidpoint(project, []).date, null);
  assert.equal(projectMidpoint(project, undefined).source, 'unknown');
  assert.equal(projectMidpoint({ ...project, midEstimated: false }, []).date, project.midDate);
  assert.equal(projectMidpoint(project, activities).date, raw.startDate);
  activities[0].slots = normalizeSlots([slot(1, booking)], null, 111);
  assert.deepEqual(projectMidpoint(project, activities), { date: start, source: 'slot' });
});

test('defense reminders follow only booked slots at 60, 30 and 15 minutes, persist acknowledgements and catch up after sleep', () => {
  const activities = normalizeActivities([raw]);
  assert.deepEqual(defenseEvents(project, activities), []);
  activities[0].slots = normalizeSlots([slot(1, booking), slot(2)], null, 111);
  const events = defenseEvents(project, activities);
  assert.equal(events.length, 1); assert.equal(events[0].startDate, start);
  const now = (mins: number) => Date.parse(start) - mins * 60_000;
  const seen = new Set<string>();
  assert.equal(dueDefenseAlert(events[0], seen, now(61)), null);
  for (const m of [60, 30, 15] as const) {
    const alert = dueDefenseAlert(events[0], seen, now(m))!;
    assert.equal(alert.minutes, m);
    acknowledgedDefenseKeys(alert).forEach(k => seen.add(k));
    assert.equal(dueDefenseAlert(events[0], seen, now(m - 1)), null);
  }
  const late = dueDefenseAlert(events[0], new Set(), now(10))!;
  assert.equal(late.minutes, 15); assert.equal(acknowledgedDefenseKeys(late).length, 3);
  assert.equal(dueDefenseAlert(events[0], new Set(), Date.parse(end)), null);
  assert.equal(dueDefenseAlert({ ...events[0], key: 'rescheduled' }, seen, now(5))?.minutes, 15);
  assert.equal(dueDefenseAlert(events[0], new Set(), now(-1))?.minutes, 15, 'an unacknowledged alert stays until the slot ends');
});

test('HAR activity routes use POST/DELETE and never retry slot or activity requests', async () => {
  const original = globalThis.fetch, calls: Array<[string, string, unknown]> = [];
  const client = new EpitechClient({ baseUrl: () => 'https://example.test', token: () => 'test', onUnauthorized() {}, userAgent: 'test' });
  globalThis.fetch = async (url, init) => { calls.push([new URL(String(url)).pathname, init!.method!, init!.body]); return Response.json([]); };
  try {
    await client.eventSlots(42); await client.registerSlot(42, 8); await client.unregisterSlot(42, 8);
    assert.deepEqual(calls, [['/api/events/42/slots', 'GET', undefined], ['/api/events/42/slots/8/registrations', 'POST', '{}'], ['/api/events/42/slots/8/registrations', 'DELETE', '{}']]);
    globalThis.fetch = async () => { calls.push(['failure', 'POST', '']); return Response.json({}, { status: 500 }); };
    await assert.rejects(client.registerSlot(42, 8)); assert.equal(calls.length, 4);
    await assert.rejects(client.eventSlots(42)); assert.equal(calls.length, 5);
    await assert.rejects(client.myActivities(7)); assert.equal(calls.length, 6);
  } finally { globalThis.fetch = original; }
});

test('activity booking rechecks conflicts, protects other groups and refreshes only the changed event', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  let now = Date.now();
  const next = () => t.mock.timers.setTime(now += 16_000);
  let slots = [slot(1), slot(2, booking)], reads = 0;
  const writes: string[] = [];
  const client = { myActivities: async () => [raw], eventSlots: async () => { reads++; return slots; },
    registerSlot: async (_event: number, id: number) => { writes.push(`book:${id}`); slots = [slot(id, booking)]; },
    unregisterSlot: async (_event: number, id: number) => { writes.push(`cancel:${id}`); slots = [slot(id)]; },
  } as unknown as EpitechClient;
  const service = new ActivityService(client, () => ({ login: 'leader@example.test', registrationId: 111 }));
  try {
    await service.load(7);
    await assert.rejects(service.changeSlot(7, 12, 1, false), /already have/);
    next(); await service.changeSlot(7, 12, 2, true);
    next(); await service.changeSlot(7, 12, 2, false);
    assert.deepEqual(writes, ['cancel:2', 'book:2']);
    assert.equal(service.get(7)?.[0].slots?.[0].mine, true);
    slots = [slot(2, { projectRegistrationId: 222 })];
    next(); await assert.rejects(service.changeSlot(7, 12, 2, true), /not your/);
    next(); await assert.rejects(service.changeSlot(7, 12, 2, false), /already been booked/);
    assert.equal(writes.length, 2); assert.equal(reads, 8);
  } finally { service.dispose(); }
});

test('switching reads once, cancels only the owned slot, registers once and verifies only that event', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  let slots = [slot(1, booking), slot(2)], activityReads = 0;
  const calls: string[] = [];
  const client = { myActivities: async () => { activityReads++; return [raw]; },
    eventSlots: async () => { calls.push('GET'); return slots; },
    unregisterSlot: async (_event: number, id: number) => { calls.push(`DELETE:${id}`); slots = [slot(1), slot(2)]; },
    registerSlot: async (_event: number, id: number) => { calls.push(`POST:${id}`); slots = [slot(1), slot(2, booking)]; },
  } as unknown as EpitechClient;
  const service = new ActivityService(client, () => ({ login: 'leader@example.test', registrationId: 111 }));
  try {
    await service.load(7); calls.length = 0;
    await service.changeSlot(7, 12, 2, false, 1);
    assert.deepEqual(calls, ['GET', 'DELETE:1', 'POST:2', 'GET']);
    assert.equal(activityReads, 1);
    assert.equal(service.get(7)?.[0].slots?.find(s => s.mine)?.id, 2);
    await assert.rejects(service.changeSlot(7, 12, 1, false, 2), /15 seconds/);
    assert.equal(calls.length, 4, 'rapid repeat attempts do not reach the API');
  } finally { service.dispose(); }
});

test('refresh storms are deduplicated and cooled down; a simultaneous booking never sends a second transaction', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  let reads = 0, writes = 0, release!: () => void;
  const client = { myActivities: async () => { reads++; return [raw]; }, eventSlots: async () => { reads++; return [slot(1)]; },
    registerSlot: async () => { writes++; await new Promise<void>(resolve => { release = resolve; }); },
  } as unknown as EpitechClient;
  const service = new ActivityService(client, () => ({ login: 'student@example.test', registrationId: 111 }));
  try {
    await Promise.all(Array.from({ length: 15 }, () => service.load(7)));
    await service.load(7); assert.equal(reads, 2);
    t.mock.timers.setTime(Date.now() + 31_000);
    await service.load(7); assert.equal(reads, 4);
    const pending = service.changeSlot(7, 12, 1, false);
    while (!release) await Promise.resolve();
    await assert.rejects(service.changeSlot(7, 12, 1, false), /already being updated/);
    await service.load(7); assert.equal(reads, 5);
    release(); await pending;
    assert.equal(writes, 1); assert.equal(reads, 6);
  } finally { service.dispose(); }
});

test('a stale switch never cancels the old booking when the target is occupied or the old slot belongs to someone else', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  let slots = [slot(1, booking), slot(2, { projectRegistrationId: 222 })], writes = 0;
  const client = { myActivities: async () => [raw], eventSlots: async () => slots,
    registerSlot: async () => { writes++; }, unregisterSlot: async () => { writes++; },
  } as unknown as EpitechClient;
  const service = new ActivityService(client, () => ({ login: 'leader@example.test', registrationId: 111 }));
  try {
    await service.load(7);
    await assert.rejects(service.changeSlot(7, 12, 2, false, 1), /already been booked/);
    t.mock.timers.setTime(Date.now() + 16_000); slots = [slot(1, { projectRegistrationId: 222 }), slot(2)];
    await assert.rejects(service.changeSlot(7, 12, 2, false, 1), /booking changed/);
    assert.equal(writes, 0);
  } finally { service.dispose(); }
});

test('failed new booking reports that the old booking was cancelled, with no retry or automatic rollback', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  let slots = [slot(1, booking), slot(2)]; const calls: string[] = [];
  const client = { myActivities: async () => [raw], eventSlots: async () => { calls.push('GET'); return slots; },
    unregisterSlot: async () => { calls.push('DELETE'); slots = [slot(1), slot(2)]; },
    registerSlot: async () => { calls.push('POST'); throw new ApiError('Slot taken', 409, '/slots'); },
  } as unknown as EpitechClient;
  const service = new ActivityService(client, () => ({ login: 'leader@example.test', registrationId: 111 }));
  try {
    await service.load(7); calls.length = 0;
    await assert.rejects(service.changeSlot(7, 12, 2, false, 1), /previous slot was cancelled/);
    assert.deepEqual(calls, ['GET', 'DELETE', 'POST', 'GET']);
    assert.equal(service.get(7)?.[0].status, 'not_registered');
    assert.equal(service.get(7)?.[0].slots?.some(s => s.mine), false);
  } finally { service.dispose(); }
});

test('HTTP 429 at any switch stage stops further calls, including refreshes and requests after reauthentication', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  for (const failAt of ['read', 'delete', 'post', 'verify']) {
    let active = false, reads = 0, calls = 0;
    const limit = () => { throw new ApiError('Rate limited', 429, '/slots'); };
    const client = { myActivities: async () => { calls++; return [raw]; },
      eventSlots: async () => { calls++; if (active && (failAt === 'read' || failAt === 'verify' && reads++ > 0)) limit(); return [slot(1, booking), slot(2)]; },
      unregisterSlot: async () => { calls++; if (failAt === 'delete') limit(); },
      registerSlot: async () => { calls++; if (failAt === 'post') limit(); },
    } as unknown as EpitechClient;
    const service = new ActivityService(client, () => ({ login: 'leader@example.test', registrationId: 111 }));
    try {
      await service.load(7); active = true;
      await service.changeSlot(7, 12, 2, false, 1).catch(() => {});
      assert.equal(service.limits(7).rateLimited, true, failAt);
      const stoppedAt = calls;
      t.mock.timers.setTime(Date.now() + 300_000);
      await service.load(7); await service.load(8);
      await assert.rejects(service.changeSlot(7, 12, 2, false, 1), /429/);
      service.clear(); await service.load(7);
      assert.equal(calls, stoppedAt, failAt);
    } finally { service.dispose(); }
  }
});

test('a split defense: slots of every window are read, the slot in the second window is found and cancelled on its own event', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-12-01T09:00:00Z') });
  const calls: string[] = [];
  const windows: Record<number, any[]> = { 42: [slot(1)], 43: [{ ...slot(5, booking), startDate: '2026-12-10T14:00:00Z', endDate: '2026-12-10T14:20:00Z' }] };
  const client = { myActivities: async () => [raw], eventSlots: async (id: number) => { calls.push(`GET:${id}`); return windows[id]; },
    unregisterSlot: async (event: number, id: number) => { calls.push(`DELETE:${event}/${id}`); windows[43] = [{ ...windows[43][0], registration: null }]; },
  } as unknown as EpitechClient;
  const service = new ActivityService(client, () => ({ login: 'leader@example.test', registrationId: 111 }), undefined,
    async () => [{ eventId: 42, room: 'L104' }, { eventId: 43, room: 'L105' }]);
  try {
    await service.load(7);
    const a = service.get(7)![0];
    assert.equal(a.slots?.find(s => s.mine)?.id, 5);
    assert.equal(a.slots?.find(s => s.mine)?.room, 'L105');
    assert.equal(a.location, 'L104, L105');
    calls.length = 0;
    await service.changeSlot(7, 12, 5, true);
    assert.deepEqual(calls, ['GET:42', 'GET:43', 'DELETE:43/5', 'GET:42', 'GET:43']);
  } finally { service.dispose(); }
});
