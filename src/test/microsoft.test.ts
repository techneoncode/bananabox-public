import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MS_CLIENT_ID, MS_REDIRECT_URI, MicrosoftAuthError, buildAuthRequest, cleanDescription, parseRedirect, redeemAuthCode, refreshMicrosoftTokens } from '../auth/microsoft';

type Reply = { status: number; body: unknown };
interface Call { url: string; headers: Record<string, string>; form: URLSearchParams }

/** A scripted fetch: each call consumes the next reply and is recorded for assertions. */
function scripted(replies: Reply[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, form: new URLSearchParams(String(init.body)) });
    const r = replies.shift();
    assert.ok(r, 'unexpected extra request');
    return { status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const isMsError = (code: string) => (e: unknown) => e instanceof MicrosoftAuthError && e.code === code;

test('buildAuthRequest produces the same authorization request as the website (code + PKCE S256)', () => {
  const req = buildAuthRequest();
  const url = new URL(req.url);
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/901cb4ca-b862-4029-9306-e5cd0f6d9f86/oauth2/v2.0/authorize');
  const q = url.searchParams;
  assert.equal(q.get('client_id'), MS_CLIENT_ID);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('redirect_uri'), MS_REDIRECT_URI);
  assert.equal(q.get('scope'), 'User.Read openid profile offline_access');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge'), createHash('sha256').update(req.codeVerifier).digest('base64url'));
  assert.equal(q.get('state'), req.state);
  assert.ok(req.codeVerifier.length >= 43 && /^[\w-]+$/.test(req.codeVerifier)); // RFC 7636 charset/length
  assert.notEqual(buildAuthRequest().state, req.state);
});

test('parseRedirect accepts the page address (fragment or query), a code= string, or a bare code', () => {
  const code = 'C'.repeat(60);
  assert.equal(parseRedirect(`https://my.epitech.eu/#code=${code}&client_info=1&state=S1&session_state=x`, 'S1').code, code);
  assert.equal(parseRedirect(`https://my.epitech.eu/?code=${code}&state=S1`, 'S1').code, code);
  assert.equal(parseRedirect(`  "https://my.epitech.eu#code=${code}&state=S1"\n`, 'S1').code, code);
  assert.equal(parseRedirect(`code=${code}&state=S1`, 'S1').code, code);
  assert.equal(parseRedirect(code, 'S1').code, code);
});

test('parseRedirect rejects empty input, missing codes, foreign states and Microsoft errors', () => {
  assert.throws(() => parseRedirect('   ', 'S'), isMsError('invalid'));
  assert.throws(() => parseRedirect('https://my.epitech.eu/dashboard', 'S'), isMsError('invalid'));
  assert.throws(() => parseRedirect('https://my.epitech.eu/#code=abc&state=OTHER', 'S'), isMsError('invalid'));
  assert.throws(() => parseRedirect('https://my.epitech.eu/#error=access_denied&error_description=nope', 'S'), isMsError('declined'));
  assert.throws(() => parseRedirect('https://my.epitech.eu/#error=server_error&error_description=boom', 'S'), isMsError('failed'));
});

test('redeemAuthCode sends the SPA request the website sends (Origin, redirect_uri, verifier)', async () => {
  const { fetchImpl, calls } = scripted([{ status: 200, body: { id_token: 'ID', refresh_token: 'RT', refresh_token_expires_in: 86399 } }]);
  const tokens = await redeemAuthCode('CODE', 'VERIFIER', { fetchImpl });
  assert.deepEqual(tokens, { idToken: 'ID', refreshToken: 'RT' });
  assert.match(calls[0].url, /\/oauth2\/v2\.0\/token$/);
  assert.equal(calls[0].headers.Origin, 'https://my.epitech.eu');
  assert.deepEqual(Object.fromEntries(calls[0].form), {
    grant_type: 'authorization_code',
    client_id: MS_CLIENT_ID,
    redirect_uri: MS_REDIRECT_URI,
    scope: 'User.Read openid profile offline_access',
    code: 'CODE',
    code_verifier: 'VERIFIER',
  });
});

test('redeemAuthCode maps used/expired codes and other failures', async () => {
  for (const body of [{ error: 'invalid_grant', error_description: 'AADSTS54005: OAuth2 Authorization code was already redeemed.\r\nTrace ID: x' }, { error: 'x', error_description: 'AADSTS70008: expired' }]) {
    await assert.rejects(redeemAuthCode('C', 'V', { fetchImpl: scripted([{ status: 400, body }]).fetchImpl }), isMsError('expired'));
  }
  await assert.rejects(redeemAuthCode('C', 'V', { fetchImpl: scripted([{ status: 400, body: { error: 'server_error', error_description: 'boom\r\nTrace ID: 1' } }]).fetchImpl }), (e: unknown) => e instanceof MicrosoftAuthError && e.code === 'failed' && e.message === 'boom');
  await assert.rejects(redeemAuthCode('C', 'V', { fetchImpl: scripted([{ status: 200, body: {} }]).fetchImpl }), isMsError('failed')); // no id_token
});

test('Origin is dropped once if Microsoft says the client is not an SPA (AADSTS9002326)', async () => {
  const { fetchImpl, calls } = scripted([
    { status: 400, body: { error: 'invalid_request', error_description: "AADSTS9002326: Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type." } },
    { status: 200, body: { id_token: 'ID' } },
  ]);
  assert.equal((await redeemAuthCode('C', 'V', { fetchImpl })).idToken, 'ID');
  assert.deepEqual(calls.map((c) => c.headers.Origin), ['https://my.epitech.eu', undefined]);
});

test('refreshMicrosoftTokens sends Origin, keeps the old refresh token if none is rotated, and flags reauth', async () => {
  const ok = scripted([{ status: 200, body: { id_token: 'ID2' } }]);
  assert.deepEqual(await refreshMicrosoftTokens('RT1', { fetchImpl: ok.fetchImpl }), { idToken: 'ID2', refreshToken: 'RT1' });
  assert.equal(ok.calls[0].form.get('grant_type'), 'refresh_token');
  assert.equal(ok.calls[0].form.get('refresh_token'), 'RT1');
  assert.equal(ok.calls[0].headers.Origin, 'https://my.epitech.eu');
  const bad = scripted([{ status: 400, body: { error: 'invalid_grant' } }]);
  await assert.rejects(refreshMicrosoftTokens('RT1', { fetchImpl: bad.fetchImpl }), isMsError('reauth'));
});

test('network failures surface as "network" and error descriptions lose trace ids', async () => {
  const fetchImpl = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
  await assert.rejects(redeemAuthCode('C', 'V', { fetchImpl }), isMsError('network'));
  assert.equal(cleanDescription('AADSTS70000: nope.\r\nTrace ID: x\r\nCorrelation ID: y'), 'AADSTS70000: nope.');
});

test('buildAuthRequest adds prompt and login_hint only when asked (invisible renewal)', () => {
  const plain = new URL(buildAuthRequest().url);
  assert.equal(plain.searchParams.has('prompt'), false);
  assert.equal(plain.searchParams.has('login_hint'), false);
  const silent = new URL(buildAuthRequest(undefined, { prompt: 'none', loginHint: 'demo@example.invalid' }).url);
  assert.equal(silent.searchParams.get('prompt'), 'none');
  assert.equal(silent.searchParams.get('login_hint'), 'demo@example.invalid');
  assert.equal(silent.searchParams.get('redirect_uri'), MS_REDIRECT_URI);
});
