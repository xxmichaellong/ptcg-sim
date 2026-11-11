/**
 * Who may see the dashboard (ADR-054). It shows the site's traffic and its
 * Worker holds a Cloudflare API token, so nothing is served without one of:
 *
 * - **Cloudflare Access** (`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`): the edge
 *   signs a JWT for each signed-in visitor; it is checked here too, by its
 *   team's keys, issuer, audience and time.
 * - **A password** (secret `OPS_PASSWORD`): the browser's own sign-in
 *   prompt (HTTP Basic), compared in constant time.
 * - **This machine** (`OPS_LOCAL=on`, set only by the dev server): only
 *   requests to localhost.
 *
 * With none set it refuses everything: a fresh deploy shows nothing.
 */

export interface ProtectionEnv {
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly OPS_PASSWORD?: string;
  readonly OPS_LOCAL?: string;
}

export type Protection = 'access' | 'password' | 'local' | 'none';

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/u;

export const protectionOf = (env: ProtectionEnv, url: URL): Protection => {
  if (
    env.ACCESS_TEAM_DOMAIN &&
    env.ACCESS_AUD &&
    TEAM_DOMAIN.test(env.ACCESS_TEAM_DOMAIN)
  )
    return 'access';
  if (env.OPS_PASSWORD && env.OPS_PASSWORD.length >= 12) return 'password';
  if (
    env.OPS_LOCAL === 'on' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]')
  )
    return 'local';
  return 'none';
};

const base64UrlBytes = (text: string): Uint8Array<ArrayBuffer> => {
  const base64 = text.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const base64UrlJson = (text: string): unknown =>
  JSON.parse(new TextDecoder().decode(base64UrlBytes(text)));

interface AccessKeys {
  readonly keys: ReadonlyMap<string, CryptoKey>;
  readonly expires: number;
}
const keyCache = new Map<string, AccessKeys>();
const KEY_CACHE_MS = 60 * 60 * 1000;

const accessKeys = async (
  team: string,
  fetcher: typeof fetch,
  now: number,
  refresh = false
): Promise<ReadonlyMap<string, CryptoKey>> => {
  const cached = keyCache.get(team);
  if (cached && cached.expires > now && !refresh) return cached.keys;
  const response = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Access keys unavailable');
  const body = (await response.json()) as {
    keys?: readonly (JsonWebKey & { kid?: string })[];
  };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      )
    );
  }
  keyCache.set(team, { keys, expires: now + KEY_CACHE_MS });
  return keys;
};

/** Clears the cached Access keys (tests). */
export const forgetAccessKeys = (): void => keyCache.clear();

const CLOCK_SKEW_S = 60;

/** Whether an Access JWT is this team's, for this application, and current. */
export const verifyAccessJwt = async (
  token: string,
  team: string,
  audience: string,
  fetcher: typeof fetch,
  now: number
): Promise<boolean> => {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerText, payloadText, signatureText] = parts as [
    string,
    string,
    string,
  ];
  let header: { alg?: unknown; kid?: unknown };
  let payload: { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown };
  try {
    header = base64UrlJson(headerText) as typeof header;
    payload = base64UrlJson(payloadText) as typeof payload;
  } catch {
    return false;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
  let key = (await accessKeys(team, fetcher, now)).get(header.kid);
  // Keys rotate: an unknown key id is asked for once more.
  key ??= (await accessKeys(team, fetcher, now, true)).get(header.kid);
  if (!key) return false;
  const signed = new TextEncoder().encode(`${headerText}.${payloadText}`);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlBytes(signatureText),
      signed
    );
  } catch {
    return false;
  }
  if (!valid) return false;
  const seconds = now / 1000;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return (
    payload.iss === `https://${team}` &&
    audiences.includes(audience) &&
    typeof payload.exp === 'number' &&
    payload.exp + CLOCK_SKEW_S > seconds &&
    (payload.nbf === undefined ||
      (typeof payload.nbf === 'number' &&
        payload.nbf - CLOCK_SKEW_S <= seconds))
  );
};

const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  );

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

const basicPassword = (request: Request): string | undefined => {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Basic ([A-Za-z0-9+/=]+)$/u.exec(header);
  if (!match?.[1]) return undefined;
  try {
    const decoded = atob(match[1]);
    const colon = decoded.indexOf(':');
    return colon >= 0 ? decoded.slice(colon + 1) : undefined;
  } catch {
    return undefined;
  }
};

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

export const refusal = (
  status: number,
  error: string,
  headers: Record<string, string> = {}
) =>
  Response.json(
    { error },
    { status, headers: { ...PRIVATE_HEADERS, ...headers } }
  );

/** Undefined when the request may go on; otherwise the answer to give it. */
export const checkAccess = async (
  request: Request,
  env: ProtectionEnv,
  fetcher: typeof fetch,
  now: number
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  switch (protectionOf(env, url)) {
    case 'access': {
      const token =
        request.headers.get('Cf-Access-Jwt-Assertion') ??
        /(?:^|;\s*)CF_Authorization=([^;]+)/u.exec(
          request.headers.get('Cookie') ?? ''
        )?.[1];
      if (
        token &&
        (await verifyAccessJwt(
          token,
          env.ACCESS_TEAM_DOMAIN ?? '',
          env.ACCESS_AUD ?? '',
          fetcher,
          now
        ).catch(() => false))
      )
        return undefined;
      return refusal(403, 'access_required');
    }
    case 'password': {
      const password = basicPassword(request);
      if (
        password !== undefined &&
        (await sameSecret(password, env.OPS_PASSWORD ?? ''))
      )
        return undefined;
      return refusal(401, 'password_required', {
        'WWW-Authenticate': 'Basic realm="PTCG Sim Ops", charset="UTF-8"',
      });
    }
    case 'local':
      return undefined;
    case 'none':
      return refusal(503, 'protection_not_configured');
  }
};
