/**
 * Accounts' identifiers, session tokens and cookies (ADR-052).
 *
 * - An account is `a_` and 16 base64url characters (96 random bits).
 * - A session cookie holds `<account id>.<secret>`: the id routes the
 *   request to the account's object, which keeps only the secret's
 *   SHA-256, so a stolen copy of storage signs nobody in.
 * - Over HTTPS the cookies are `__Host-` cookies: Secure, the whole site's
 *   path and this host alone. Plain-HTTP development uses the same names
 *   without the prefix, which browsers refuse there.
 */

export const ACCOUNT_SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
/** A session in use is renewed at most this often: one row a day. */
export const ACCOUNT_SESSION_RENEWAL_MS = 24 * 60 * 60 * 1000;
/** How long a sign-in may take at the provider. */
export const SIGN_IN_ATTEMPT_LIFETIME_MS = 10 * 60 * 1000;

const ACCOUNT_ID = /^a_[A-Za-z0-9_-]{16}$/u;
const SECRET = /^[A-Za-z0-9_-]{43}$/u;

export const base64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

export const fromBase64Url = (
  text: string
): Uint8Array<ArrayBuffer> | undefined => {
  if (!/^[A-Za-z0-9_-]*$/u.test(text)) return undefined;
  try {
    const binary = atob(
      text.replaceAll('-', '+').replaceAll('_', '/') +
        '='.repeat((4 - (text.length % 4)) % 4)
    );
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
};

const randomText = (bytes: number): string =>
  base64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export const newAccountId = (): string => `a_${randomText(12)}`;

export const isAccountId = (value: unknown): value is string =>
  typeof value === 'string' && ACCOUNT_ID.test(value);

/** A random value for a sign-in's state or PKCE verifier. */
export const newSignInSecret = (): string => randomText(32);

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/** S256 PKCE challenge for a verifier (RFC 7636). */
export const pkceChallenge = async (verifier: string): Promise<string> =>
  base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    )
  );

export interface SessionToken {
  readonly accountId: string;
  readonly secret: string;
}

export const newSessionToken = (accountId: string): SessionToken => ({
  accountId,
  secret: randomText(32),
});

export const formatSessionToken = (token: SessionToken): string =>
  `${token.accountId}.${token.secret}`;

export const parseSessionToken = (
  value: string | undefined
): SessionToken | undefined => {
  if (!value) return undefined;
  const dot = value.indexOf('.');
  if (dot < 0) return undefined;
  const accountId = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  return isAccountId(accountId) && SECRET.test(secret)
    ? { accountId, secret }
    : undefined;
};

const secure = (request: Request): boolean =>
  new URL(request.url).protocol === 'https:';

export const sessionCookieName = (request: Request): string =>
  secure(request) ? '__Host-ptcgsim-session' : 'ptcgsim-session';

export const signInCookieName = (request: Request): string =>
  secure(request) ? '__Host-ptcgsim-sign-in' : 'ptcgsim-sign-in';

/** One cookie's value from a request, or undefined. */
export const readCookie = (
  request: Request,
  name: string
): string | undefined => {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 && value.length <= 4096 ? value : undefined;
    }
  }
  return undefined;
};

/** A Set-Cookie for this site alone; `maxAgeSeconds` 0 clears it. */
export const setCookie = (
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number
): string =>
  [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSeconds)))}`,
    ...(secure(request) ? ['Secure'] : []),
  ].join('; ');

export const readSessionToken = (
  request: Request
): SessionToken | undefined =>
  parseSessionToken(readCookie(request, sessionCookieName(request)));
