import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_MS, FORCE_AFTER_MS, MAX_POSTPONES, POSTPONE_MS, QUIET_TYPING_MS, UpdateRestart, type RestartCountdown } from '../services/updateRestart';
import { sameRuntimeContract } from '../domain/hotSwap';

/** A fake clock: sleeping advances time at once, and `onSleep` lets a test act during a wait. */
function harness(opts: { busyUntil?: number; debugging?: boolean; lastEdit?: number } = {}) {
  let now = 1_000_000;
  const shown: Array<RestartCountdown | undefined> = [];
  const sleeps: number[] = [];
  let restarted = 0;
  let onSleep: ((ms: number) => void) | undefined;
  const restarter = new UpdateRestart({
    busy: () => now < (opts.busyUntil ?? 0),
    debugging: () => opts.debugging ?? false,
    lastEdit: () => opts.lastEdit ?? 0,
    show: (c) => shown.push(c),
    restart: async () => { restarted++; },
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); onSleep?.(ms); now += ms; },
  });
  return {
    restarter, shown, sleeps,
    get restarted() { return restarted; },
    get now() { return now; },
    set onSleep(fn: ((ms: number) => void) | undefined) { onSleep = fn; },
  };
}

test('update restart: a quiet moment gets a 10 s countdown, then the restart', async () => {
  const h = harness();
  await h.restarter.run('2.2.0');
  assert.equal(h.restarted, 1);
  assert.deepEqual(h.shown[0], { at: 1_000_000 + COUNTDOWN_MS, version: '2.2.0', postponesLeft: MAX_POSTPONES });
  assert.equal(h.shown.at(-1), undefined);
});

test('update restart: waits while a run is in progress or the student just typed', async () => {
  const h = harness({ busyUntil: 1_000_000 + 7_000, lastEdit: 1_000_000 - QUIET_TYPING_MS + 3_000 });
  await h.restarter.run('2.2.0');
  assert.equal(h.restarted, 1);
  assert.ok(h.shown[0]!.at >= 1_000_000 + 7_000 + COUNTDOWN_MS, 'the countdown starts once the run ended');
});

test('update restart: "Later" works three times, five minutes each, then the restart is forced', async () => {
  const h = harness();
  let postponed = 0;
  h.onSleep = (ms) => { if (ms === COUNTDOWN_MS && h.restarter.postpone()) postponed++; };
  await h.restarter.run('2.2.0');
  assert.equal(postponed, MAX_POSTPONES);
  assert.equal(h.sleeps.filter(ms => ms === POSTPONE_MS).length, MAX_POSTPONES);
  assert.deepEqual(h.shown.filter(Boolean).map(c => c!.postponesLeft), [3, 2, 1, 0]);
  assert.equal(h.restarted, 1);
});

test('update restart: after the last postpone, a session never quiet still restarts within the limit', async () => {
  const h = harness({ debugging: true });
  h.onSleep = (ms) => { if (ms === COUNTDOWN_MS) h.restarter.postpone(); };
  // Debugging forever: only the forced path can end the wait.
  (h.restarter as unknown as { postponesLeft: number }).postponesLeft = 0;
  const started = h.now;
  await h.restarter.run('2.2.0');
  assert.equal(h.restarted, 1);
  assert.ok(h.now - started <= FORCE_AFTER_MS + COUNTDOWN_MS + 2_000);
});

test('update restart: disposing stops the countdown without restarting', async () => {
  const h = harness();
  h.onSleep = (ms) => { if (ms === COUNTDOWN_MS) h.restarter.dispose(); };
  await h.restarter.run('2.2.0');
  assert.equal(h.restarted, 0);
});

test('hot swap: only a version with the same package.json contract can run in place', () => {
  const base = { main: './dist/loader.js', contributes: { commands: [{ command: 'a' }] }, activationEvents: ['onStartupFinished'], engines: { vscode: '^1.95.0' }, version: '2.1.0' };
  assert.ok(sameRuntimeContract(base, { ...base, version: '2.2.0', description: 'new words' }));
  assert.ok(!sameRuntimeContract(base, { ...base, contributes: { commands: [{ command: 'a' }, { command: 'b' }] } }));
  assert.ok(!sameRuntimeContract(base, { ...base, activationEvents: ['*'] }));
});
