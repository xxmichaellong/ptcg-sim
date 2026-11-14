/**
 * Sign in with Google, for the developers' own addresses (ADR-054): the
 * dashboard's sign-in when it isn't behind Cloudflare Access. It uses the
 * sim's Google OAuth client, as its code flow does
 * (`apps/server/src/accounts/sign-in-providers.ts`).
 *
 * - `GET /auth/sign-in` sends the person to Google: the code flow, PKCE
 *   S256 and a random state, the attempt kept in a ten-minute signed
 *   cookie on `/auth`.
 * - `GET /auth/callback` checks the state, trades the code at Google's
 *   token endpoint and reads who it is from the ID token that comes back.
 *   A verified address on the list gets a session: a signed cookie holding
 *   the address, for seven days.
 * - `POST /auth/sign-out` (or `GET`) ends it.
 *
 * Each request checks the session's signature and time, and its address
 * against the list again, so an address taken off the list is out at once.
 * The cookies are signed with HMAC-SHA256 under the Worker's own key;
 * nothing is stored.
 */

export interface GoogleSignInEnv {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  /** Who may sign in: addresses with commas or spaces between them. */
  readonly OPS_EMAILS?: string;
  /** The cookies' signing key, at least 32 characters. */
  readonly OPS_SESSION_KEY?: string;
}

export interface GoogleSignIn {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Lower case. */
  readonly emails: ReadonlySet<string>;
  readonly sessionKey: string;
}

export const MIN_SESSION_KEY_LENGTH = 32;
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SIGN_IN_LIFETIME_MS = 10 * 60 * 1000;

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS: readonly unknown[] = [
  'accounts.google.com',
  'https://accounts.google.com',
];
const MAX_RETURN_LENGTH = 2048;

const EMAIL = /^[^@\s]+@[^@\s]+$/u;

/** The addresses on a list: split on commas and spaces, in lower case. */
export const parseEmails = (text: string | undefined): ReadonlySet<string> =>
  new Set(
    (text ?? '')
      .split(/[\s,;]+/u)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => EMAIL.test(entry))
  );

const secretOf = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Google sign-in's settings, or undefined unless all four are good. */
export const readGoogleSignIn = (
  env: GoogleSignInEnv
): GoogleSignIn | undefined => {
  const clientId = secretOf(env.GOOGLE_CLIENT_ID);
  const clientSecret = secretOf(env.GOOGLE_CLIENT_SECRET);
  const sessionKey = secretOf(env.OPS_SESSION_KEY);
  const emails = parseEmails(env.OPS_EMAILS);
  if (
    !clientId ||
    !clientSecret ||
    !sessionKey ||
    sessionKey.length < MIN_SESSION_KEY_LENGTH ||
    emails.size === 0
  )
    return undefined;
  return { clientId, clientSecret, emails, sessionKey };
};

/**
 * The secrets Google sign-in still lacks, once any of them is set: what a
 * half-done setup shows on the "not set up" page. Names only.
 */
export const missingGoogleSecrets = (env: GoogleSignInEnv): string[] => {
  const started = [
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.OPS_EMAILS,
    env.OPS_SESSION_KEY,
  ].some((value) => secretOf(value) !== undefined);
  if (!started) return [];
  return [
    ...(secretOf(env.GOOGLE_CLIENT_ID) ? [] : ['GOOGLE_CLIENT_ID']),
    ...(secretOf(env.GOOGLE_CLIENT_SECRET) ? [] : ['GOOGLE_CLIENT_SECRET']),
    ...(parseEmails(env.OPS_EMAILS).size > 0 ? [] : ['OPS_EMAILS']),
    ...((secretOf(env.OPS_SESSION_KEY)?.length ?? 0) >= MIN_SESSION_KEY_LENGTH
      ? []
      : ['OPS_SESSION_KEY']),
  ];
};

// ---- Encoding and secrets ----

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | undefined => {
  if (!/^[A-Za-z0-9_-]*$/u.test(text)) return undefined;
  try {
    const binary = atob(
      text.replaceAll('-', '+').replaceAll('_', '/') +
        '='.repeat((4 - (text.length % 4)) % 4)
    );
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
};

const jsonObject = (
  bytes: Uint8Array | undefined
): Record<string, unknown> | undefined => {
  if (!bytes) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const randomText = (bytes: number): string =>
  base64Url(crypto.getRandomValues(new Uint8Array(bytes)));

/** S256 PKCE challenge for a verifier (RFC 7636). */
export const pkceChallenge = async (verifier: string): Promise<string> =>
  base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
    )
  );

const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

/** Whether two strings are equal, in time that doesn't depend on where they differ. */
export const sameSecret = async (
  left: string,
  right: string
): Promise<boolean> => {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
};

let signingKey:
  { readonly secret: string; readonly key: Promise<CryptoKey> } | undefined;

const hmacKey = (secret: string): Promise<CryptoKey> => {
  if (signingKey?.secret !== secret)
    signingKey = {
      secret,
      key: crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      ),
    };
  return signingKey.key;
};

/** What a signed value is for: one kind is never read as the other. */
export type SignedPurpose = 'session' | 'sign-in';

/** `<payload>.<signature>`: the value as base64url JSON, and its HMAC. */
export const signValue = async (
  secret: string,
  purpose: SignedPurpose,
  value: object
): Promise<string> => {
  const payload = base64Url(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${purpose}.${payload}`)
  );
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
};

/** A signed value's contents, or undefined if it isn't one of ours. */
export const readSignedValue = async (
  secret: string,
  purpose: SignedPurpose,
  text: string | undefined
): Promise<Record<string, unknown> | undefined> => {
  if (!text || text.length > 4096) return undefined;
  const parts = text.split('.');
  if (parts.length !== 2) return undefined;
  const [payload, signatureText] = parts as [string, string];
  const signature = fromBase64Url(signatureText);
  if (!signature) return undefined;
  // HMAC verification compares in constant time.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(`${purpose}.${payload}`)
  );
  return valid ? jsonObject(fromBase64Url(payload)) : undefined;
};

// ---- Cookies ----

const secure = (url: URL): boolean => url.protocol === 'https:';

/**
 * Over HTTPS the session is a `__Host-` cookie (Secure, the whole site,
 * this host alone) and the attempt a `__Secure-` one on `/auth`. Plain-HTTP
 * development drops the prefixes and Secure, which browsers refuse there.
 */
export const sessionCookieName = (url: URL): string =>
  secure(url) ? '__Host-ops-session' : 'ops-session';
export const signInCookieName = (url: URL): string =>
  secure(url) ? '__Secure-ops-sign-in' : 'ops-sign-in';

const setCookie = (
  url: URL,
  name: string,
  value: string,
  path: '/' | '/auth',
  maxAgeMs: number
): string =>
  [
    `${name}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeMs / 1000)))}`,
    ...(secure(url) ? ['Secure'] : []),
  ].join('; ');

const readCookie = (request: Request, name: string): string | undefined => {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
};

const clearSession = (url: URL): string =>
  setCookie(url, sessionCookieName(url), '', '/', 0);
const clearSignIn = (url: URL): string =>
  setCookie(url, signInCookieName(url), '', '/auth', 0);

/** The signed-in address, while its session is current and it is on the list. */
export const sessionEmail = async (
  request: Request,
  config: GoogleSignIn,
  now: number
): Promise<string | undefined> => {
  const url = new URL(request.url);
  const session = await readSignedValue(
    config.sessionKey,
    'session',
    readCookie(request, sessionCookieName(url))
  );
  const email = session?.['email'];
  const expires = session?.['exp'];
  if (
    typeof email !== 'string' ||
    typeof expires !== 'number' ||
    !(expires > now)
  )
    return undefined;
  return config.emails.has(email.toLowerCase()) ? email : undefined;
};

// ---- Where to come back to ----

/**
 * A path on this origin to come back to after signing in, or `/`. Anything
 * that could leave the origin (`//host`, `/\host`, a full URL, a path that
 * normalizes to `//host`) is refused, and so is `/auth/` itself.
 */
export const returnPathOf = (value: string | null, origin: string): string => {
  if (!value || value.length > MAX_RETURN_LENGTH || !value.startsWith('/'))
    return '/';
  try {
    const url = new URL(value, origin);
    const path = `${url.pathname}${url.search}`;
    return url.origin === origin &&
      !url.pathname.startsWith('//') &&
      !url.pathname.startsWith('/auth/')
      ? path
      : '/';
  } catch {
    return '/';
  }
};

// ---- Pages ----

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char
  );

/** Google's four-colour G (Sign in with Google branding guidelines). */
const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

const ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233987e5'/%3E%3Cpath d='M5 17h5l3-7 5 13 3-6h6' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

const STYLE = `:root{color-scheme:dark;--page:#121211;--text:#d9d7d0;--strong:#f0efec;--muted:#85837c;--button:#131314;--button-text:#e3e3e3;--button-border:#8e918f}
@media (prefers-color-scheme:light){:root{color-scheme:light;--page:#f4f3f0;--text:#2b2a28;--strong:#0b0b0b;--muted:#6f6d68;--button:#fff;--button-text:#1f1f1f;--button-border:#747775}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--page);color:var(--text);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{display:grid;justify-items:center;gap:18px;text-align:center}h1{margin:0;font-size:17px;font-weight:650;color:var(--strong)}h1 span{color:var(--muted);font-weight:500}p{margin:0}
.google{display:inline-flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:1px solid var(--button-border);border-radius:4px;background:var(--button);color:var(--button-text);font:500 14px/1 system-ui,-apple-system,'Segoe UI',sans-serif;text-decoration:none}
.google:hover{filter:brightness(1.08)}a{color:inherit}`;

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

const signInHref = (returnTo: string): string =>
  returnTo === '/'
    ? '/auth/sign-in'
    : `/auth/sign-in?return=${encodeURIComponent(returnTo)}`;

interface PageContent {
  /** One line above the action, if any. */
  readonly message?: string;
  /** The way on: Google's button, or a plain link. */
  readonly action: {
    readonly href: string;
    readonly label: string;
    readonly google?: boolean;
  };
}

const page = (
  status: number,
  { message, action }: PageContent,
  cookies: readonly string[] = []
): Response => {
  const link = action.google
    ? `<a class="google" href="${escapeHtml(action.href)}">${GOOGLE_G}${escapeHtml(action.label)}</a>`
    : `<a href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
  const headers = new Headers(PAGE_HEADERS);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>PTCG Sim Ops</title><link rel="icon" href="${ICON}"><style>${STYLE}</style><main><h1>PTCG Sim <span>Ops</span></h1>${message ? `<p>${escapeHtml(message)}</p>` : ''}${link}</main></html>`,
    { status, headers }
  );
};

/** The page an unsigned-in visitor sees: Google's button, back to here after. */
export const signInPage = (url: URL, cookies: readonly string[] = []) =>
  page(
    401,
    {
      action: {
        href: signInHref(
          returnPathOf(`${url.pathname}${url.search}`, url.origin)
        ),
        label: 'Sign in with Google',
        google: true,
      },
    },
    cookies
  );

const redirect = (
  location: string,
  cookies: readonly string[],
  status = 302
): Response => {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status, headers });
};

// ---- The flow ----

export const callbackUrl = (origin: string): string =>
  `${origin}/auth/callback`;

interface Attempt {
  readonly state: string;
  readonly verifier: string;
  readonly returnTo: string;
  readonly exp: number;
}

const startSignIn = async (
  url: URL,
  config: GoogleSignIn,
  now: number
): Promise<Response> => {
  const attempt: Attempt = {
    state: randomText(32),
    verifier: randomText(32),
    returnTo: returnPathOf(url.searchParams.get('return'), url.origin),
    exp: now + SIGN_IN_LIFETIME_MS,
  };
  const google = new URL(GOOGLE_AUTHORIZE);
  google.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(url.origin),
    response_type: 'code',
    scope: 'openid email',
    state: attempt.state,
    code_challenge: await pkceChallenge(attempt.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(google.toString(), [
    setCookie(
      url,
      signInCookieName(url),
      await signValue(config.sessionKey, 'sign-in', attempt),
      '/auth',
      SIGN_IN_LIFETIME_MS
    ),
  ]);
};

const readAttempt = async (
  request: Request,
  url: URL,
  config: GoogleSignIn,
  now: number
): Promise<Attempt | undefined> => {
  const value = await readSignedValue(
    config.sessionKey,
    'sign-in',
    readCookie(request, signInCookieName(url))
  );
  const state = value?.['state'];
  const verifier = value?.['verifier'];
  const returnTo = value?.['returnTo'];
  const expires = value?.['exp'];
  if (
    typeof state !== 'string' ||
    typeof verifier !== 'string' ||
    typeof returnTo !== 'string' ||
    typeof expires !== 'number' ||
    !(expires > now)
  )
    return undefined;
  return {
    state,
    verifier,
    returnTo: returnPathOf(returnTo, url.origin),
    exp: expires,
  };
};

type GoogleAnswer =
  | { readonly kind: 'signed_in'; readonly email: string }
  | { readonly kind: 'unverified' }
  | { readonly kind: 'failed' };

/**
 * Who Google says signed in. The ID token comes straight from Google's
 * token endpoint over TLS, in answer to this client's secret and PKCE
 * verifier, so its claims are read without checking its signature (OpenID
 * Connect Core 3.1.3.7); its issuer, audience and time still are.
 */
const exchange = async (
  config: GoogleSignIn,
  origin: string,
  code: string,
  verifier: string,
  fetcher: typeof fetch,
  now: number
): Promise<GoogleAnswer> => {
  let body: unknown;
  try {
    const response = await fetcher(GOOGLE_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: callbackUrl(origin),
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!response.ok) return { kind: 'failed' };
    body = await response.json();
  } catch {
    return { kind: 'failed' };
  }
  const idToken: unknown = Reflect.get(Object(body), 'id_token');
  if (typeof idToken !== 'string' || idToken.length > 8192)
    return { kind: 'failed' };
  const parts = idToken.split('.');
  const claims =
    parts.length === 3 && parts[1] !== undefined
      ? jsonObject(fromBase64Url(parts[1]))
      : undefined;
  if (
    !claims ||
    !GOOGLE_ISSUERS.includes(claims['iss']) ||
    claims['aud'] !== config.clientId ||
    typeof claims['exp'] !== 'number' ||
    !(claims['exp'] * 1000 > now)
  )
    return { kind: 'failed' };
  const email = claims['email'];
  if (typeof email !== 'string' || !EMAIL.test(email))
    return { kind: 'failed' };
  if (claims['email_verified'] !== true && claims['email_verified'] !== 'true')
    return { kind: 'unverified' };
  return { kind: 'signed_in', email: email.trim().toLowerCase() };
};

const finishSignIn = async (
  request: Request,
  url: URL,
  config: GoogleSignIn,
  fetcher: typeof fetch,
  now: number
): Promise<Response> => {
  const cookies = [clearSignIn(url)];
  const attempt = await readAttempt(request, url, config, now);
  const state = url.searchParams.get('state');
  if (!attempt || !state || !(await sameSecret(state, attempt.state)))
    return page(
      400,
      {
        message: 'That sign-in expired.',
        action: {
          href: signInHref(attempt?.returnTo ?? '/'),
          label: 'Try again',
        },
      },
      cookies
    );
  const again = signInHref(attempt.returnTo);
  // Turned back at Google: the button again.
  if (url.searchParams.has('error'))
    return page(
      401,
      { action: { href: again, label: 'Sign in with Google', google: true } },
      cookies
    );
  const code = url.searchParams.get('code');
  const answer =
    code && code.length <= 2048
      ? await exchange(config, url.origin, code, attempt.verifier, fetcher, now)
      : ({ kind: 'failed' } as const);
  if (answer.kind === 'failed')
    return page(
      502,
      {
        message: 'Google didn’t sign you in.',
        action: { href: again, label: 'Try again' },
      },
      cookies
    );
  if (answer.kind === 'unverified' || !config.emails.has(answer.email))
    return page(
      403,
      {
        message: 'That Google account can’t open this dashboard.',
        action: { href: again, label: 'Use another account' },
      },
      [...cookies, clearSession(url)]
    );
  return redirect(`${url.origin}${attempt.returnTo}`, [
    ...cookies,
    setCookie(
      url,
      sessionCookieName(url),
      await signValue(config.sessionKey, 'session', {
        email: answer.email,
        exp: now + SESSION_LIFETIME_MS,
      }),
      '/',
      SESSION_LIFETIME_MS
    ),
  ]);
};

/** `/auth/*`: signing in and out. */
export const handleAuthRequest = async (
  request: Request,
  config: GoogleSignIn,
  fetcher: typeof fetch,
  now: number
): Promise<Response> => {
  const url = new URL(request.url);
  const notAllowed = (allow: string) =>
    new Response('Method not allowed', {
      status: 405,
      headers: { 'Cache-Control': 'no-store', Allow: allow },
    });
  switch (url.pathname) {
    case '/auth/sign-in':
      return request.method === 'GET'
        ? startSignIn(url, config, now)
        : notAllowed('GET');
    case '/auth/callback':
      return request.method === 'GET'
        ? finishSignIn(request, url, config, fetcher, now)
        : notAllowed('GET');
    case '/auth/sign-out':
      // A forged sign-out can only sign someone out.
      return request.method === 'POST' || request.method === 'GET'
        ? redirect(`${url.origin}/`, [clearSession(url)], 303)
        : notAllowed('POST, GET');
    default:
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
  }
};
