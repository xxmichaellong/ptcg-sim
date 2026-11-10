import { fromBase64Url } from './account-session.js';
import type { AccountProvider, SignInIdentity } from './account-store.js';

/**
 * The providers players sign in with (ADR-052): Google and Discord, by the
 * OAuth code flow, and a stand-in for local and test builds. Each turns the
 * code the provider sends back into who the person is there, and nothing is
 * kept of the provider's tokens: the sim never calls them again.
 *
 * Google's half follows MagicCircle's `server/src/google/auth.ts`
 * (verifyGoogleIdToken, exchangeGoogleAuthCode; magiccircle.gg 8668411a7e,
 * ADR-019), with WebCrypto in place of `jose` and without refresh tokens.
 */

export interface SignInConfiguration {
  readonly google?: { readonly clientId: string; readonly clientSecret: string };
  readonly discord?: {
    readonly clientId: string;
    readonly clientSecret: string;
  };
  /** The stand-in provider, for local and test builds only. */
  readonly test: boolean;
}

const secretOf = (env: object, name: string): string | undefined => {
  const value: unknown = Reflect.get(env, name);
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
};

/** Which providers this deployment has: those whose app is configured. */
export const readSignInConfiguration = (env: object): SignInConfiguration => {
  const googleId = secretOf(env, 'GOOGLE_CLIENT_ID');
  const googleSecret = secretOf(env, 'GOOGLE_CLIENT_SECRET');
  const discordId = secretOf(env, 'DISCORD_CLIENT_ID');
  const discordSecret = secretOf(env, 'DISCORD_CLIENT_SECRET');
  return {
    ...(googleId && googleSecret
      ? { google: { clientId: googleId, clientSecret: googleSecret } }
      : {}),
    ...(discordId && discordSecret
      ? { discord: { clientId: discordId, clientSecret: discordSecret } }
      : {}),
    test: Reflect.get(env, 'AUTH_TEST_PROVIDER') === 'on',
  };
};

export const availableProviders = (
  configuration: SignInConfiguration
): AccountProvider[] => [
  ...(configuration.google ? (['google'] as const) : []),
  ...(configuration.discord ? (['discord'] as const) : []),
  ...(configuration.test ? (['test'] as const) : []),
];

export const callbackUrl = (origin: string, provider: AccountProvider) =>
  `${origin}/v2/auth/${provider}/callback`;

export interface AuthorizeInput {
  readonly origin: string;
  readonly state: string;
  readonly codeChallenge: string;
}

/** Where to send the person to sign in, or undefined if not configured. */
export const authorizeUrl = (
  configuration: SignInConfiguration,
  provider: AccountProvider,
  { origin, state, codeChallenge }: AuthorizeInput
): string | undefined => {
  const redirect = callbackUrl(origin, provider);
  switch (provider) {
    case 'google': {
      if (!configuration.google) return undefined;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: configuration.google.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.toString();
    }
    case 'discord': {
      if (!configuration.discord) return undefined;
      const url = new URL('https://discord.com/oauth2/authorize');
      url.search = new URLSearchParams({
        client_id: configuration.discord.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'identify',
        state,
        // A confidential client: the state and the client secret guard
        // the code, as MagicCircle's Discord sign-in does.
        prompt: 'none',
      }).toString();
      return url.toString();
    }
    case 'test': {
      if (!configuration.test) return undefined;
      const url = new URL(`${origin}/v2/auth/test/authorize`);
      url.search = new URLSearchParams({ state }).toString();
      return url.toString();
    }
  }
};

export type Fetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class SignInExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInExchangeError';
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw new SignInExchangeError(
      `provider answered ${String(response.status)}`
    );
  }
  return response.json();
};

const text = (value: unknown, maximum = 256): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;

// ---- Google's ID token ------------------------------------------------

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** Clock skew allowed on a token's expiry and issue time. */
const CLOCK_SKEW_SECONDS = 60;

interface JwksCache {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
}

let googleKeys: JwksCache | undefined;

/** Google's signing keys, kept for as long as Google says they hold. */
const googleSigningKey = async (
  kid: string,
  fetcher: Fetch,
  now: number,
  jwksUri = GOOGLE_JWKS_URI
): Promise<CryptoKey | undefined> => {
  if (!googleKeys || googleKeys.expiresAt <= now || !googleKeys.keys.has(kid)) {
    const response = await fetcher(jwksUri);
    const body = await readJson(response);
    const maxAge = /max-age=(\d+)/u.exec(
      response.headers.get('Cache-Control') ?? ''
    );
    const keys = new Map<string, CryptoKey>();
    const list: unknown = Reflect.get(Object(body), 'keys');
    for (const jwk of Array.isArray(list) ? list : []) {
      const id = text(Reflect.get(Object(jwk), 'kid'));
      if (!id || Reflect.get(Object(jwk), 'kty') !== 'RSA') continue;
      keys.set(
        id,
        await crypto.subtle.importKey(
          'jwk',
          {
            kty: 'RSA',
            n: String(Reflect.get(Object(jwk), 'n')),
            e: String(Reflect.get(Object(jwk), 'e')),
            alg: 'RS256',
            ext: true,
          },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        )
      );
    }
    googleKeys = {
      keys,
      expiresAt:
        now + Math.min(Number(maxAge?.[1] ?? 3600), 24 * 3600) * 1000,
    };
  }
  return googleKeys.keys.get(kid);
};

const decodeJsonPart = (part: string | undefined): Record<string, unknown> => {
  const bytes = part === undefined ? undefined : fromBase64Url(part);
  if (!bytes) throw new SignInExchangeError('malformed token');
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'object' || value === null) {
    throw new SignInExchangeError('malformed token');
  }
  return value as Record<string, unknown>;
};

/**
 * Verifies a Google ID token's signature, issuer, audience and times, and
 * returns its claims. The token comes straight from Google's token endpoint
 * over TLS already; checking it too means a token minted for another client
 * can never make a session here.
 */
export const verifyGoogleIdToken = async (
  idToken: string,
  clientId: string,
  fetcher: Fetch,
  now: number,
  jwksUri?: string
): Promise<Record<string, unknown>> => {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new SignInExchangeError('malformed token');
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = decodeJsonPart(headerPart);
  const kid = text(header['kid']);
  if (header['alg'] !== 'RS256' || !kid) {
    throw new SignInExchangeError('unexpected token algorithm');
  }
  const key = await googleSigningKey(kid, fetcher, now, jwksUri);
  const signatureBytes = fromBase64Url(signaturePart);
  const signature = signatureBytes ? new Uint8Array(signatureBytes) : undefined;
  if (
    !key ||
    !signature ||
    !(await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    ))
  ) {
    throw new SignInExchangeError('token signature');
  }
  const claims = decodeJsonPart(payloadPart);
  const seconds = Math.floor(now / 1000);
  if (
    !GOOGLE_ISSUERS.includes(String(claims['iss'])) ||
    claims['aud'] !== clientId ||
    typeof claims['exp'] !== 'number' ||
    claims['exp'] + CLOCK_SKEW_SECONDS < seconds ||
    (typeof claims['iat'] === 'number' &&
      claims['iat'] - CLOCK_SKEW_SECONDS > seconds) ||
    !text(claims['sub'])
  ) {
    throw new SignInExchangeError('token claims');
  }
  return claims;
};

/** Forgets Google's cached keys (tests). */
export const resetGoogleKeyCache = (): void => {
  googleKeys = undefined;
};

// ---- The exchange --------------------------------------------------------

export interface ExchangeInput {
  readonly origin: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly now: number;
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
  body: new URLSearchParams(fields).toString(),
});

/** Who the code says the person is at the provider. */
export const exchangeSignInCode = async (
  configuration: SignInConfiguration,
  provider: AccountProvider,
  { origin, code, codeVerifier, now }: ExchangeInput,
  fetcher: Fetch
): Promise<SignInIdentity> => {
  switch (provider) {
    case 'google': {
      const google = configuration.google;
      if (!google) throw new SignInExchangeError('not configured');
      const tokens = await readJson(
        await fetcher(
          GOOGLE_TOKEN_ENDPOINT,
          form({
            client_id: google.clientId,
            client_secret: google.clientSecret,
            code,
            code_verifier: codeVerifier,
            redirect_uri: callbackUrl(origin, 'google'),
            grant_type: 'authorization_code',
          })
        )
      );
      const idToken = text(Reflect.get(Object(tokens), 'id_token'), 8192);
      if (!idToken) throw new SignInExchangeError('no id token');
      const claims = await verifyGoogleIdToken(
        idToken,
        google.clientId,
        fetcher,
        now
      );
      const email = text(claims['email']);
      const name =
        text(claims['given_name']) ?? text(claims['name']) ?? 'Player';
      return {
        provider,
        subject: String(claims['sub']),
        label: email ?? name,
        name,
      };
    }
    case 'discord': {
      const discord = configuration.discord;
      if (!discord) throw new SignInExchangeError('not configured');
      const tokens = await readJson(
        await fetcher(
          'https://discord.com/api/oauth2/token',
          form({
            client_id: discord.clientId,
            client_secret: discord.clientSecret,
            code,
            redirect_uri: callbackUrl(origin, 'discord'),
            grant_type: 'authorization_code',
          })
        )
      );
      const accessToken = text(
        Reflect.get(Object(tokens), 'access_token'),
        4096
      );
      if (!accessToken) throw new SignInExchangeError('no access token');
      const user = Object(
        await readJson(
          await fetcher('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
        )
      );
      const id = text(Reflect.get(user, 'id'), 32);
      const username = text(Reflect.get(user, 'username'), 64);
      if (!id || !/^\d+$/u.test(id) || !username) {
        throw new SignInExchangeError('malformed user');
      }
      return {
        provider,
        subject: id,
        label: `@${username}`,
        name: text(Reflect.get(user, 'global_name'), 64) ?? username,
      };
    }
    case 'test': {
      if (!configuration.test) throw new SignInExchangeError('not configured');
      // The stand-in's code is the name typed on its page.
      const name = code.trim().slice(0, 32);
      if (!name) throw new SignInExchangeError('no name');
      const handle = name.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
      return {
        provider,
        subject: `test-${handle}`,
        label: `${handle}@example.test`,
        name,
      };
    }
  }
};
