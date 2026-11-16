export interface TokenInfo {
  kind: 'epitech' | 'microsoft' | 'unknown';
  /** Expiry as epoch milliseconds, when the token carries an `exp` claim. */
  expiresAt: number | null;
  claims: Record<string, unknown> | null;
}

/**
 * Decodes the payload of a JWT *without* verifying it. Never trust the result
 * for security decisions.
 */
export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(
      b64 + '='.repeat((4 - (b64.length % 4)) % 4),
      'base64',
    ).toString('utf8');
    const value = JSON.parse(json);
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Strips a leading `Bearer ` and surrounding whitespace/quotes users tend to
 * copy along.
 */
export function cleanToken(raw: string): string {
  return raw.trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^bearer\s+/i, '')
    .trim();
}

export function inspectToken(token: string): TokenInfo {
  const claims = decodeJwt(token);
  if (!claims) {
    return { kind: 'unknown', expiresAt: null, claims: null };
  }
  const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  const iss = typeof claims.iss === 'string' ? claims.iss : '';
  if (/login\.microsoftonline\.com|sts\.windows\.net/i.test(iss)) {
    return { kind: 'microsoft', expiresAt: exp, claims };
  }
  if (typeof claims.login === 'string') {
    return { kind: 'epitech', expiresAt: exp, claims };
  }
  return { kind: 'unknown', expiresAt: exp, claims };
}
