import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachePolicy, fresh, GuardPausedError, inBackground, RequestGuard } from '../api/requestGuard';

/** A guard on a fake clock: `sleep` advances time instantly so budgets can be tested without waiting. */
function fakeGuard(opts: ConstructorParameters<typeof RequestGuard>[0] = {}) {
  let now = 1_000_000;
  const guard = new RequestGuard({ now: () => now, sleep: async ms => { now += ms; }, minGapMs: 0, ...opts });
  return { guard, advance: (ms: number) => { now += ms; }, now: () => now };
}

test('request guard: a young cached GET is served without asking again; an identical GET in flight is shared', async () => {
  const { guard, advance } = fakeGuard();
  let calls = 0;
  const load = async () => { calls++; return { value: calls }; };
  const policy = { ttl: 60_000, floor: 10_000 };
  const [a, b] = await Promise.all([guard.get('k', policy, load), guard.get('k', policy, load)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  // Fresh requests still respect the floor…
  advance(5_000);
  assert.deepEqual(await fresh(() => guard.get('k', policy, load)), { value: 1 });
  assert.equal(calls, 1);
  // …ordinary ones the whole ttl…
  advance(25_000);
  assert.deepEqual(await guard.get('k', policy, load), { value: 1 });
  assert.equal(calls, 1);
  // …and past the floor a fresh request refetches.
  assert.deepEqual(await fresh(() => guard.get('k', policy, load)), { value: 2 });
  assert.equal(calls, 2);
});

test('request guard: cached answers are copies, so editing one never edits the cache', async () => {
  const { guard } = fakeGuard();
  const policy = { ttl: 60_000, floor: 0 };
  const first = await guard.get('k', policy, async () => ({ list: [1, 2] }));
  first.list.push(3);
  assert.deepEqual(await guard.get('k', policy, async () => ({ list: [] as number[] })), { list: [1, 2] });
});

test('request guard: one 429 stops every request for the pause and nothing is sent meanwhile', async () => {
  const { guard, advance } = fakeGuard({ pauseMs: 15 * 60_000 });
  let sent = 0;
  await guard.run(async () => { sent++; guard.observe(429, null); });
  assert.ok(guard.snapshot().pausedUntil);
  await assert.rejects(guard.run(async () => { sent++; }), GuardPausedError);
  await assert.rejects(guard.get('x', { ttl: 0, floor: 0 }, async () => { sent++; }), GuardPausedError);
  assert.equal(sent, 1);
  advance(15 * 60_000 + 1);
  await guard.run(async () => { sent++; });
  assert.equal(sent, 2);
});

test('request guard: Retry-After longer than the pause is honoured', async () => {
  const { guard, now } = fakeGuard({ pauseMs: 60_000 });
  guard.observe(429, '3600');
  assert.equal(guard.snapshot().pausedUntil, now() + 3_600_000);
  guard.observe(200);
  assert.equal(guard.snapshot().pausedUntil, now() + 3_600_000);
});

test('request guard: the per-minute budget delays starts; background work gets a smaller share', async () => {
  const { guard, now } = fakeGuard({ perMinute: 4, backgroundPerMinute: 2, maxConcurrent: 10 });
  const t0 = now();
  const starts: Array<[string, number]> = [];
  const job = (name: string) => async () => { starts.push([name, now() - t0]); };
  await Promise.all([inBackground(() => guard.run(job('b1'))), inBackground(() => guard.run(job('b2'))), inBackground(() => guard.run(job('b3')))]);
  // Two background starts fit in the minute, the third waits for the window to slide.
  assert.deepEqual(starts.map(s => s[0]), ['b1', 'b2', 'b3']);
  assert.ok(starts[2][1] >= 60_000, `third background start at ${starts[2][1]}ms`);
  assert.ok(guard.snapshot().lastMinute <= 4);
});

test('request guard: a student request goes ahead of background work already waiting', async () => {
  const { guard } = fakeGuard({ maxConcurrent: 1 });
  const order: string[] = [];
  let release!: () => void;
  const blocker = guard.run(() => new Promise<void>(r => { release = () => { order.push('blocker'); r(); }; }));
  const background = inBackground(() => guard.run(async () => { order.push('background'); }));
  const user = guard.run(async () => { order.push('user'); });
  await new Promise(r => setImmediate(r));
  release();
  await Promise.all([blocker, background, user]);
  assert.deepEqual(order, ['blocker', 'user', 'background']);
});

test('request guard: invalidation after a change forces the next read', async () => {
  const { guard } = fakeGuard();
  let calls = 0;
  const policy = { ttl: 60_000, floor: 0 };
  const key = '/api/events/4/slots';
  await guard.get(key, policy, async () => ++calls);
  guard.invalidate('/api/events/4/slots');
  assert.equal(await guard.get(key, policy, async () => ++calls), 2);
  guard.clear();
  assert.equal(await guard.get(key, policy, async () => ++calls), 3);
});

test('cache policy: results never change, sign-in is never cached, unknown routes are not kept', () => {
  assert.ok(cachePolicy('/api/students/test-results/42').ttl >= 3_600_000);
  assert.equal(cachePolicy('/api/auth/verify').ttl, 0);
  assert.equal(cachePolicy('/api/users/a/avatar').ttl, 0);
  assert.ok(cachePolicy('/api/units/2026/B-CPE-110/PAR-1-1/projects/9/registrations/3/ta').floor >= 5_000);
  assert.ok(cachePolicy('/api/units/instances/projects/9/my-activities').ttl >= 60_000);
});
