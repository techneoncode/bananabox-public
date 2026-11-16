import { createHash, randomBytes } from 'node:crypto';

export const MS_TENANT = '901cb4ca-b862-4029-9306-e5cd0f6d9f86';
export const MS_CLIENT_ID = '6cace631-d5fa-43cb-9903-f88d5ee17576';
/** Same scopes as the website, so the consent already granted applies. */
export const MS_SCOPE = 'User.Read openid profile offline_access';
/** The only redirect URI registered for the client. */
export const MS_REDIRECT_URI = 'https://my.epitech.eu';
/**
 * SPA token redemption is cross-origin: Microsoft requires the registered
 * origin.
 */
export const MS_ORIGIN = 'https://my.epitech.eu';

const BASE = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0`;
const REQUEST_TIMEOUT_MS = 20_000;

export type MicrosoftErrorCode =
  | 'invalid'
  | 'declined'
  | 'expired'
  | 'reauth'
  | 'network'
  | 'failed';

export class MicrosoftAuthError extends Error {
  constructor(
    readonly code: MicrosoftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MicrosoftAuthError';
  }
}

export interface MicrosoftTokens {
  /** ID token (JWT), what `POST /api/auth/token` expects. */
  idToken: string;
  refreshToken?: string;
}

export interface AuthRequest {
  /** Page to open in the system browser. */
  url: string;
  codeVerifier: string;
  state: string;
}

export interface Deps {
  fetchImpl?: typeof fetch;
}

type Json = Record<string, any>;

const b64url = (buf: Buffer): string => buf.toString('base64url');

/**
 * Keeps the first line of an Entra error and drops the Trace/Correlation ids.
 */
export function cleanDescription(text: unknown): string {
  return String(text ?? '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim();
}

export interface AuthRequestOptions {
  /**
   * `none` = silent attempt (no UI): Microsoft answers with
   * `error=login_required` if it needs the user.
   */
  prompt?: 'none' | 'select_account';
  loginHint?: string;
}

/**
 * Builds a PKCE authorization request (S256). `random` is injectable for tests.
 */
export function buildAuthRequest(
  random: (n: number) => Buffer = randomBytes,
  opts: AuthRequestOptions = {},
): AuthRequest {
  const codeVerifier = b64url(random(32));
  const state = b64url(random(16));
  const nonce = b64url(random(16));
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MS_REDIRECT_URI,
    scope: MS_SCOPE,
    response_mode: 'fragment',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(codeVerifier).digest()),
    code_challenge_method: 'S256',
  });
  if (opts.prompt) params.set('prompt', opts.prompt);
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return {
    url: `${BASE}/authorize?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Extracts the authorization code from whatever the user pasted: the full
 * address of the page they landed on (code in the `#fragment` or in the
 * query), a bare `code=...&state=...` string, or the code.
 */
export function parseRedirect(
  input: string,
  expectedState: string,
): { code: string } {
  const text = input.trim().replace(/^["'<]+|["'>]+$/g, '');
  if (!text) throw new MicrosoftAuthError('invalid', 'Nothing was pasted.');
  let params: URLSearchParams | undefined;
  try {
    const url = new URL(text);
    const merged = new URLSearchParams(url.search);
    for (const [k, v] of new URLSearchParams(url.hash.replace(/^#/, ''))) {
      merged.set(k, v);
    }

    params = merged;
  } catch {
    if (text.includes('=')) {
      params = new URLSearchParams(text.replace(/^[?#]/, ''));
    }
  }

  const get = (k: string) => params?.get(k) ?? undefined;
  if (params && get('error')) {
    const desc = cleanDescription(get('error_description')) || get('error');
    throw new MicrosoftAuthError(
      get('error') === 'access_denied' ? 'declined' : 'failed',
      `Microsoft refused the sign-in: ${desc}`,
    );
  }

  const code = params
    ? get('code')
    : text.length > 40 && !/\s/.test(text)
      ? text
      : undefined;
  if (!code) {
    throw new MicrosoftAuthError(
      'invalid',
      'No authorization code found. Paste the full address of the my.epitech.eu page you landed on.',
    );
  }

  const state = get('state');
  if (state !== undefined && state !== expectedState) {
    throw new MicrosoftAuthError(
      'invalid',
      'This address belongs to another sign-in attempt. Use the page opened by the latest "Sign in with Microsoft".',
    );
  }

  return { code };
}

async function post(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
  origin: boolean,
): Promise<{ status: number; json: Json }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${BASE}/token`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...(origin ? { Origin: MS_ORIGIN } : {}),
      },
      body: new URLSearchParams(body).toString(),
    });
    const json: Json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) {
    throw new MicrosoftAuthError(
      'network',
      `Could not reach Microsoft: ${(e as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Posts to the token endpoint with the SPA `Origin` header, and retries once
 * without it when Microsoft answers AADSTS9002326 (the client is not treated
 * as a single-page application).
 */
async function postToken(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: Json }> {
  let res = await post(body, fetchImpl, true);
  const desc = String(res.json.error_description ?? '');
  if (/AADSTS9002326/.test(desc)) res = await post(body, fetchImpl, false);
  return res;
}

function toTokens(json: Json): MicrosoftTokens {
  if (!json.id_token) {
    throw new MicrosoftAuthError(
      'failed',
      'Microsoft did not return an ID token.',
    );
  }

  return {
    idToken: String(json.id_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
  };
}

/**
 * Redeems the authorization code (single use, ~10 minutes) with the PKCE
 * verifier. A used, expired or otherwise rejected code (AADSTS54005, 70008,
 * 50148, 9002313, `invalid_grant`) is reported as `expired`.
 */
export async function redeemAuthCode(
  code: string,
  codeVerifier: string,
  deps: Deps = {},
): Promise<MicrosoftTokens> {
  const { status, json } = await postToken(
    {
      grant_type: 'authorization_code',
      client_id: MS_CLIENT_ID,
      redirect_uri: MS_REDIRECT_URI,
      scope: MS_SCOPE,
      code,
      code_verifier: codeVerifier,
    },
    deps.fetchImpl ?? fetch,
  );
  if (status === 200) return toTokens(json);
  const desc = cleanDescription(json.error_description);
  if (
    json.error === 'invalid_grant'
    || /AADSTS(54005|70008|50148|9002313)/.test(desc)
  ) {
    throw new MicrosoftAuthError(
      'expired',
      'This code was already used or has expired. Start again with "Sign in with Microsoft".',
    );
  }

  throw new MicrosoftAuthError(
    'failed',
    desc || `Microsoft answered ${status}.`,
  );
}

/**
 * Silent renewal with the Microsoft refresh token (24 hours for this
 * single-page application).
 */
export async function refreshMicrosoftTokens(
  refreshToken: string,
  deps: Deps = {},
): Promise<MicrosoftTokens> {
  const { status, json } = await postToken(
    {
      grant_type: 'refresh_token',
      client_id: MS_CLIENT_ID,
      refresh_token: refreshToken,
      scope: MS_SCOPE,
    },
    deps.fetchImpl ?? fetch,
  );
  if (status === 200) {
    const tokens = toTokens(json);
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
  }

  if (
    json.error === 'invalid_grant'
    || json.error === 'interaction_required'
    || json.error === 'invalid_request'
  ) {
    throw new MicrosoftAuthError(
      'reauth',
      'Your Microsoft session expired. Sign in again.',
    );
  }

  throw new MicrosoftAuthError(
    'failed',
    cleanDescription(json.error_description) || `Microsoft answered ${status}.`,
  );
}
