import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AVATAR_TTL, AvatarService, validAvatarLogin } from '../services/avatarService';
import { normalizeProject } from '../domain/projects';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function setup(answers: Record<string, Buffer | null | Error> = {}) {
  const dir = join(await mkdtemp(join(tmpdir(), 'bbx-avatars-')), 'avatars');
  const calls: string[] = [];
  let clock = 1_000_000;
  const fetcher = async (login: string) => {
    calls.push(login);
    await new Promise(r => setTimeout(r, 5));
    const a = login in answers ? answers[login] : JPEG;
    if (a instanceof Error) throw a;
    return a;
  };
  const make = () => new AvatarService(dir, fetcher, () => clock);
  return { dir, calls, make, tick: (ms: number) => { clock += ms; } };
}

test('avatars: concurrent asks share one fetch and a cached picture is not fetched again', async () => {
  const { calls, make } = await setup();
  const s = make();
  const [a, b] = await Promise.all([s.get('ada@epitech.eu'), s.get('ada@epitech.eu')]);
  assert.equal(a, `data:image/jpeg;base64,${JPEG.toString('base64')}`);
  assert.equal(b, a);
  assert.equal(await s.get('ada@epitech.eu'), a);
  assert.deepEqual(calls, ['ada@epitech.eu']);
  assert.deepEqual(await s.due(['ada@epitech.eu', 'bob@epitech.eu']), ['bob@epitech.eu']);
});

test('avatars: a missing picture (404) is remembered as null', async () => {
  const { calls, make } = await setup({ 'none@epitech.eu': null });
  const s = make();
  assert.equal(await s.get('none@epitech.eu'), null);
  assert.equal(await s.get('none@epitech.eu'), null);
  assert.deepEqual(calls, ['none@epitech.eu']);
  assert.deepEqual(await s.cached(['none@epitech.eu']), { 'none@epitech.eu': null });
});

test('avatars: the disk cache survives a restart and expires after a day', async () => {
  const { calls, make, tick } = await setup();
  const first = make();
  const value = await first.get('ada@epitech.eu');
  await new Promise(r => setTimeout(r, 600)); // index is written after a short debounce
  const second = make();
  assert.deepEqual(await second.cached(['ada@epitech.eu']), { 'ada@epitech.eu': value });
  assert.deepEqual(await second.due(['ada@epitech.eu']), []);
  tick(AVATAR_TTL + 1);
  assert.deepEqual(await second.due(['ada@epitech.eu']), ['ada@epitech.eu']);
  await second.get('ada@epitech.eu');
  assert.equal(calls.length, 2);
});

test('avatars: a failed refresh keeps the stale picture', async () => {
  const answers: Record<string, Buffer | null | Error> = {};
  const { make, tick } = await setup(answers);
  const s = make();
  const value = await s.get('ada@epitech.eu');
  tick(AVATAR_TTL + 1);
  answers['ada@epitech.eu'] = new Error('offline');
  assert.equal(await s.get('ada@epitech.eu'), value);
});

test('avatars: invalid logins are refused and sign-out wipes the cache', async () => {
  const { dir, calls, make } = await setup();
  const s = make();
  for (const bad of ['../etc/passwd', 'no-at-sign', 'a@b/c', '', 'x'.repeat(300) + '@e.eu']) assert.equal(validAvatarLogin(bad), false);
  assert.equal(await s.get('../../secret'), null);
  assert.deepEqual(await s.due(['../x', 'ada@epitech.eu']), ['ada@epitech.eu']);
  await s.get('ada@epitech.eu');
  await s.clear();
  await assert.rejects(readdir(dir));
  assert.deepEqual(await s.cached(['ada@epitech.eu']), {});
  assert.deepEqual(calls, ['ada@epitech.eu']);
});

test('normalizeProject lists the group, leader first, without duplicates', () => {
  const raw = { id: 1, name: 'p', startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-20T00:00:00Z', unitInstance: {},
    registrations: [{ id: 9, leader: { login: 'ada@epitech.eu', firstname: 'Ada', lastname: 'L' },
      members: [{ login: 'ada@epitech.eu', firstname: 'Ada', lastname: 'L' }, { login: 'bob@epitech.eu', firstname: 'Bob', lastname: 'K' }] }] };
  const vm = normalizeProject(raw, 'https://my.epitech.eu', Date.parse('2026-10-05T00:00:00Z'), 'bob@epitech.eu');
  assert.deepEqual(vm.groupMembers, [{ name: 'Ada L', login: 'ada@epitech.eu' }, { name: 'Bob K', login: 'bob@epitech.eu' }]);
  assert.deepEqual(normalizeProject({ ...raw, registrations: [] }, 'https://my.epitech.eu').groupMembers, []);
});
