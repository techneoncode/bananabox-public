import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { AuthManager } from '../auth/authManager';
import type { EpitechClient } from '../api/client';

test('sign-out wins over sign-in while secure storage is still writing', async () => {
  const saved = new Map<string, string>();
  let finishStore!: () => void;
  let entered!: () => void;
  const storing = new Promise<void>((r) => { entered = r; });
  const hold = new Promise<void>((r) => { finishStore = r; });
  const secrets = {
    get: async (key: string) => saved.get(key),
    store: async (key: string, value: string) => { entered(); await hold; saved.set(key, value); },
    delete: async (key: string) => { saved.delete(key); },
  } as unknown as vscode.SecretStorage;
  const auth = new AuthManager(secrets);
  auth.client = { verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  const signingIn = auth.signIn('opaque-test-token');
  await storing;
  const signingOut = auth.signOut();
  assert.equal(auth.snapshot.status, 'signedOut');
  finishStore();
  await Promise.all([signingIn, signingOut]);
  assert.equal(auth.accessToken, undefined);
  assert.equal(auth.snapshot.status, 'signedOut');
  assert.equal(saved.size, 0);
  auth.dispose();
});

// ───────── Microsoft refresh / silent renewal ─────────

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

function memorySecrets(initial: Record<string, string> = {}) {
  const saved = new Map(Object.entries(initial));
  const secrets = {
    get: async (k: string) => saved.get(k),
    store: async (k: string, v: string) => void saved.set(k, v),
    delete: async (k: string) => void saved.delete(k),
  } as unknown as vscode.SecretStorage;
  return { saved, secrets };
}

const msIdToken = () => jwt({ iss: 'https://login.microsoftonline.com/tenant/v2.0', exp: Math.floor(Date.now() / 1000) + 3600 });
const epitechToken = (expInSeconds: number) => jwt({ login: 'demo@example.invalid', exp: Math.floor(Date.now() / 1000) + expInSeconds });

test('signing in with a Microsoft ID token exchanges it and stores the Microsoft refresh token', async () => {
  const { saved, secrets } = memorySecrets();
  const fresh = epitechToken(3600);
  const auth = new AuthManager(secrets);
  auth.client = { exchangeMicrosoftToken: async () => ({ access_token: fresh, refresh_token: 'opaque' }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.signIn(msIdToken(), { msRefresh: 'MS-RT' });
  assert.equal(auth.snapshot.status, 'signedIn');
  assert.equal(auth.accessToken, fresh);
  assert.equal(saved.get('epibox.msRefreshToken'), 'MS-RT');
  assert.equal(auth.snapshot.pending, null);
  auth.dispose();
});

test('an expired stored session is renewed silently through the Microsoft refresh token', async () => {
  const { saved, secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60), 'epibox.msRefreshToken': 'MS-RT-1' });
  const fresh = epitechToken(3600);
  const auth = new AuthManager(secrets, { refresh: async (rt) => (assert.equal(rt, 'MS-RT-1'), { idToken: msIdToken(), refreshToken: 'MS-RT-2' }) });
  auth.client = { exchangeMicrosoftToken: async () => ({ access_token: fresh }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.restore();
  assert.equal(auth.snapshot.status, 'signedIn');
  assert.equal(auth.accessToken, fresh);
  assert.equal(saved.get('epibox.msRefreshToken'), 'MS-RT-2'); // rotated token is persisted
  auth.dispose();
});

test('a server 401 triggers one renewal; a lost Microsoft session ends in "expired" and drops the refresh token', async () => {
  const { MicrosoftAuthError } = await import('../auth/microsoft');
  const { saved, secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(3600), 'epibox.msRefreshToken': 'MS-RT' });
  let refreshes = 0;
  const auth = new AuthManager(secrets, { refresh: async () => { refreshes++; throw new MicrosoftAuthError('reauth', 'again'); } });
  auth.client = { verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.restore();
  assert.equal(auth.snapshot.status, 'signedIn');
  auth.markExpired();
  auth.markExpired(); // concurrent 401s must share a single renewal
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(refreshes, 1);
  assert.equal(auth.snapshot.status, 'expired');
  assert.equal(saved.has('epibox.msRefreshToken'), false);
  auth.dispose();
});

test('without a Microsoft refresh token, an expired session simply asks to sign in again', async () => {
  const { secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60) });
  const auth = new AuthManager(secrets);
  auth.client = {} as unknown as EpitechClient;
  await auth.restore();
  assert.equal(auth.snapshot.status, 'expired');
  auth.dispose();
});

test('pending browser step is published, keeps the page on a bad paste, and is cleared', () => {
  const { secrets } = memorySecrets();
  const auth = new AuthManager(secrets);
  auth.setPending({ url: 'https://login.microsoftonline.com/x/oauth2/v2.0/authorize?a=b' });
  assert.equal(auth.snapshot.busy, false);
  assert.ok(auth.snapshot.pending);
  auth.reportError('wrong address', true);
  assert.deepEqual([auth.snapshot.busy, auth.snapshot.error, Boolean(auth.snapshot.pending)], [false, 'wrong address', true]);
  auth.setPending(null, true); // token exchange in flight
  assert.deepEqual([auth.snapshot.busy, auth.snapshot.pending], [true, null]);
  auth.reportError('nope');
  assert.deepEqual([auth.snapshot.busy, auth.snapshot.pending, auth.snapshot.error], [false, null, 'nope']);
  auth.dispose();
});

// ───────── invisible renewal through the Bananabox browser profile ─────────

test('when the Microsoft refresh token is gone, a browser-signed-in user is renewed invisibly', async () => {
  const { saved, secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60), 'epibox.browserSession': '1' });
  const fresh = epitechToken(3600);
  let silent = 0;
  const auth = new AuthManager(secrets, { silentLogin: async () => (silent++, { idToken: msIdToken(), refreshToken: 'MS-RT-NEW' }) });
  auth.client = { exchangeMicrosoftToken: async () => ({ access_token: fresh }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.restore();
  assert.equal(silent, 1);
  assert.equal(auth.snapshot.status, 'signedIn');
  assert.equal(saved.get('epibox.msRefreshToken'), 'MS-RT-NEW');
  assert.equal(saved.get('epibox.browserSession'), '1');
  auth.dispose();
});

test('a lost refresh token (reauth) falls through to the invisible renewal; if that needs the user, the session is "expired"', async () => {
  const { MicrosoftAuthError } = await import('../auth/microsoft');
  const { saved, secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60), 'epibox.msRefreshToken': 'MS-RT', 'epibox.browserSession': '1' });
  let silent = 0;
  const auth = new AuthManager(secrets, { refresh: async () => { throw new MicrosoftAuthError('reauth', 'again'); }, silentLogin: async () => (silent++, null) });
  auth.client = {} as unknown as EpitechClient;
  await auth.restore();
  assert.equal(silent, 1);
  assert.equal(auth.snapshot.status, 'expired');
  assert.equal(saved.has('epibox.msRefreshToken'), false);
  auth.dispose();
});

test('the invisible renewal is only attempted for users who signed in through the browser window', async () => {
  const { secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60) });
  let silent = 0;
  const auth = new AuthManager(secrets, { silentLogin: async () => (silent++, null) });
  auth.client = {} as unknown as EpitechClient;
  await auth.restore();
  assert.equal(silent, 0);
  assert.equal(auth.snapshot.status, 'expired');
  auth.dispose();
});

test('signing in through the browser remembers it; signing out forgets it', async () => {
  const { saved, secrets } = memorySecrets();
  const fresh = epitechToken(3600);
  const auth = new AuthManager(secrets);
  auth.client = { exchangeMicrosoftToken: async () => ({ access_token: fresh }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.signIn(msIdToken(), { msRefresh: 'RT', viaBrowser: true });
  assert.equal(saved.get('epibox.browserSession'), '1');
  await auth.signOut();
  assert.equal(saved.has('epibox.browserSession'), false);
  auth.dispose();
});

// ───────── regression: the controller raises `busy` while it redeems the code, then signs in ─────────

test('signIn works while the controller holds the busy flag (no "already in progress" after the browser step)', async () => {
  const { secrets } = memorySecrets();
  const fresh = epitechToken(3600);
  const auth = new AuthManager(secrets);
  auth.client = { exchangeMicrosoftToken: async () => ({ access_token: fresh, refresh_token: 'MY-RT' }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  auth.setPending(null, true); // what Controller does right before redeeming the code
  await auth.signIn(msIdToken(), { msRefresh: 'MS-RT', viaBrowser: true });
  assert.equal(auth.snapshot.status, 'signedIn');
  assert.equal(auth.snapshot.busy, false);
  await assert.rejects(Promise.all([auth.signIn(fresh), auth.signIn(fresh)]), /already in progress/); // real concurrency is still refused
  auth.dispose();
});

// ───────── MyEpitech rotating refresh token (POST /api/auth/refresh) ─────────

test('an expired session is renewed with the MyEpitech refresh token, which is rotated and keeps the Microsoft one', async () => {
  const { saved, secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60), 'epibox.refreshToken': 'MY-RT-1', 'epibox.msRefreshToken': 'MS-RT' });
  const fresh = epitechToken(3600);
  const used: string[] = [];
  const auth = new AuthManager(secrets, { refresh: async () => { throw new Error('Microsoft must not be needed'); } });
  auth.client = { refreshSession: async (rt: string) => (used.push(rt), { access_token: fresh, refresh_token: 'MY-RT-2' }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.restore();
  assert.deepEqual(used, ['MY-RT-1']);
  assert.equal(auth.snapshot.status, 'signedIn');
  assert.equal(auth.accessToken, fresh);
  assert.equal(saved.get('epibox.refreshToken'), 'MY-RT-2');
  assert.equal(saved.get('epibox.msRefreshToken'), 'MS-RT');
  auth.dispose();
});

test('a refused MyEpitech refresh token is dropped and Microsoft takes over; a network failure keeps it', async () => {
  const { ApiError } = await import('../api/client');
  const { saved, secrets } = memorySecrets({ 'epibox.accessToken': epitechToken(-60), 'epibox.refreshToken': 'BAD', 'epibox.msRefreshToken': 'MS-RT' });
  const fresh = epitechToken(3600);
  const auth = new AuthManager(secrets, { refresh: async () => ({ idToken: msIdToken(), refreshToken: 'MS-RT-2' }) });
  auth.client = { refreshSession: async () => { throw new ApiError('invalid', 401, '/api/auth/refresh'); }, exchangeMicrosoftToken: async () => ({ access_token: fresh, refresh_token: 'MY-NEW' }), verify: async () => ({ login: 'demo@example.invalid' }) } as unknown as EpitechClient;
  await auth.restore();
  assert.equal(auth.snapshot.status, 'signedIn');
  assert.equal(saved.get('epibox.refreshToken'), 'MY-NEW'); // re-issued by the Microsoft exchange
  auth.dispose();

  const offline = memorySecrets({ 'epibox.accessToken': epitechToken(-60), 'epibox.refreshToken': 'KEEP' });
  const a2 = new AuthManager(offline.secrets);
  a2.client = { refreshSession: async () => { throw new ApiError('Network error', 0, '/api/auth/refresh'); } } as unknown as EpitechClient;
  await a2.restore();
  assert.equal(a2.snapshot.status, 'expired');
  assert.equal(offline.saved.get('epibox.refreshToken'), 'KEEP');
  a2.dispose();
});
