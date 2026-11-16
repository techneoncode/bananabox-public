import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EpitechClient } from '../api/client';

test('API contract: auth, pagination beyond ten pages, grader and credential boundaries', async () => {
  const original = globalThis.fetch;
  let unauthorized = 0;
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const client = new EpitechClient({ baseUrl: () => 'https://my.epitech.eu', token: () => 'test-only', onUnauthorized: () => unauthorized++, userAgent: 'epibox-test' });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    if (url.pathname.endsWith('/projects')) {
      const page = Number(url.searchParams.get('page'));
      return Response.json({ data: [{ id: page }], meta: { hasNext: page < 12 } });
    }
    return Response.json({ access_token: 'exchanged' });
  };
  try {
    assert.equal((await client.listProjects('ongoing', true)).length, 12);
    assert.equal(calls[0].url.searchParams.get('registeredOnly'), 'true');
    await client.exchangeMicrosoftToken('microsoft-test');
    const exchange = calls.at(-1)!;
    assert.equal(exchange.url.pathname, '/api/auth/token');
    assert.equal(exchange.init?.method, 'POST');
    assert.equal((exchange.init?.headers as Record<string, string>).Authorization, 'Bearer microsoft-test');
    assert.equal(exchange.init?.redirect, 'error');
    globalThis.fetch = async (input, init) => { calls.push({ url: new URL(String(input)), init }); return Response.json({ access_token: 'A2', refresh_token: 'R2' }); };
    assert.deepEqual(await client.refreshSession('R1'), { access_token: 'A2', refresh_token: 'R2' });
    const refresh = calls.at(-1)!;
    assert.equal(refresh.url.pathname, '/api/auth/refresh');
    assert.equal(refresh.init?.method, 'POST');
    assert.equal(refresh.init?.body, JSON.stringify({ refresh_token: 'R1' }));
    assert.equal((refresh.init?.headers as Record<string, string>).Authorization, undefined); // unauthenticated
    globalThis.fetch = async () => Response.json({ access_token: 'only' });
    await assert.rejects(client.refreshSession('R1'), /did not contain new tokens/);
    globalThis.fetch = async () => Response.json({}, { status: 401 });
    await assert.rejects(client.refreshSession('R1'));
    assert.equal(unauthorized, 0); // a refused refresh must not trigger the global "expired" handler
    globalThis.fetch = async (input, init) => { calls.push({ url: new URL(String(input)), init }); return Response.json({ access_token: 'exchanged' }); };
    await client.projectDetail(3227, { schoolYear: 2026, unitCode: 'G-CPE-100', instanceCode: 'STG-1' });
    assert.equal(calls.at(-1)?.url.pathname, '/api/units/2026/G-CPE-100/STG-1/projects/3227');
    await client.startGrader({ year: 2026, unitCode: 'G-CPE-100', instanceCode: 'STG-1', projectId: 3227, registrationId: 35569 });
    assert.equal(calls.at(-1)?.url.pathname, '/api/units/2026/G-CPE-100/STG-1/projects/3227/registrations/35569/ta');
    await assert.rejects(client.download('https://foreign.example/subject.pdf'), /foreign host/);
    globalThis.fetch = async () => Response.json({ message: 'Forbidden' }, { status: 403 });
    await assert.rejects(client.verify());
    assert.equal(unauthorized, 0);
    globalThis.fetch = async () => Response.json({}, { status: 401 });
    await assert.rejects(client.verify());
    assert.equal(unauthorized, 1);
  } finally { globalThis.fetch = original; }
});
