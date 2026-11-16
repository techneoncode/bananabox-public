import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiActivity, activityRoute } from '../domain/apiActivity';
import { EpitechClient } from '../api/client';

test('activity counters aggregate real attempts by method/route and count only observed HTTP 429 responses', () => {
  const activity = new ApiActivity(() => 1234);
  const complete = activity.begin('GET', '/api/students/profile');
  activity.begin('GET', '/api/students/profile')(200);
  complete(429); complete(429);
  activity.begin('POST', '/api/auth/token')(403);
  assert.deepEqual(activity.snapshot(), { startedAt: 1234, endpoints: [
    { method: 'GET', route: '/api/students/profile', calls: 2, rateLimitedResponses: 1 },
    { method: 'POST', route: '/api/auth/token', calls: 1, rateLimitedResponses: 0 },
  ] });
  const copy = activity.snapshot(); copy.endpoints[0].calls = 999;
  assert.equal(activity.snapshot().endpoints[0].calls, 2);
});

test('activity snapshots omit IDs, account details, credentials and query parameters', () => {
  const cases = [
    ['/api/auth/verify?token=private-token', '/api/auth/verify'],
    ['/api/units/instances/projects/3227/my-activities?login=user@example.org', '/api/units/instances/projects/{projectId}/my-activities'],
    ['/api/units/2026/G-CPE-100/STG-1/projects/3227/registrations/35569/ta', '/api/units/{year}/{unitCode}/{instanceCode}/projects/{projectId}/registrations/{registrationId}/ta'],
    ['/api/units/2026/G-CPE-100/STG-1/projects/3227', '/api/units/{year}/{unitCode}/{instanceCode}/projects/{projectId}'],
    ['/api/students/test-results/9876', '/api/students/test-results/{resultId}'],
    ['/api/units/instances/projects/3227/related-resources/files', '/api/units/instances/projects/{projectId}/related-resources/files'],
    ['/api/private/user@example.org/private-token?secret=yes', '/api/{other}'],
  ];
  const activity = new ApiActivity();
  for (const [path, expected] of cases) {
    assert.equal(activityRoute(path), expected);
    activity.begin('GET', path)(200);
  }
  assert.doesNotMatch(JSON.stringify(activity.snapshot()), /private-token|example\.org|3227|35569|9876|G-CPE-100|secret/);
});

test('reset clears the session and ignores late responses from the previous account', () => {
  let now = 1000;
  const activity = new ApiActivity(() => now);
  const oldResponse = activity.begin('GET', '/api/auth/verify');
  now = 2000; activity.clear();
  oldResponse(429);
  assert.deepEqual(activity.snapshot(), { startedAt: 2000, endpoints: [] });
  activity.begin('GET', '/api/auth/verify')(200);
  assert.equal(activity.snapshot().endpoints[0].rateLimitedResponses, 0);
});

test('client instrumentation matches fetch attempts, includes retries, and stops everything after a rate limit', async () => {
  const original = globalThis.fetch;
  let enabled = true, fetches = 0, changes = 0, failures = 0;
  const client = new EpitechClient({ baseUrl: () => 'https://my.epitech.eu', token: () => 'private-token',
    userAgent: 'test', onUnauthorized() {}, isEnabled: () => enabled, onActivityChange: () => changes++ });
  try {
    // A transient 502 is retried once; the retry is a counted call.
    globalThis.fetch = async () => { fetches++; return Response.json({ login: 'private-user' }, { status: failures++ === 0 ? 502 : 200 }); };
    await client.profile();
    globalThis.fetch = async () => { fetches++; return Response.json({}); };
    await client.startGrader({ year: 2026, unitCode: 'secret-unit', instanceCode: 'secret-instance', projectId: 3227, registrationId: 35569 });
    enabled = false;
    const before = client.activity.snapshot();
    await assert.rejects(client.verify(), /remote disabled/);
    assert.deepEqual(client.activity.snapshot(), before);
    enabled = true;
    // One 429: counted, never retried, and every later request stays home.
    globalThis.fetch = async () => { fetches++; return Response.json({}, { status: 429 }); };
    await assert.rejects(client.verify());
    const sent = fetches;
    await assert.rejects(client.testResults(1), /paused/);
    await assert.rejects(client.startGrader({ year: 2026, unitCode: 'u', instanceCode: 'i', projectId: 1, registrationId: 2 }), /paused/);
    assert.equal(fetches, sent);
    assert.ok(client.guard.snapshot().pausedUntil);
    const snapshot = client.activity.snapshot();
    assert.equal(snapshot.endpoints.reduce((total, row) => total + row.calls, 0), fetches);
    assert.equal(snapshot.endpoints.find(row => row.route === '/api/students/profile')!.calls, 2);
    assert.equal(snapshot.endpoints.find(row => row.route === '/api/auth/verify')!.rateLimitedResponses, 1);
    assert.equal(snapshot.endpoints.find(row => row.route === '/api/auth/verify')!.calls, 1);
    assert.ok(snapshot.endpoints.some(row => row.method === 'POST'));
    assert.doesNotMatch(JSON.stringify(snapshot), /private-token|private-user|secret-unit|secret-instance|3227|35569/);
    assert.ok(changes > 0);
  } finally { globalThis.fetch = original; }
});
