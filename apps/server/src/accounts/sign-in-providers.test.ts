import { beforeEach, describe, expect, it } from 'vitest';

import { base64Url, parseSessionToken, pkceChallenge } from './account-session.js';
import {
  authorizeUrl,
  availableProviders,
  readSignInConfiguration,
  resetGoogleKeyCache,
  verifyGoogleIdToken,
  type Fetch,
} from './sign-in-providers.js';

const NOW = 1_800_000_000_000;

const signer = async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  let jwksFetches = 0;
  const fetch: Fetch = async () => {
    jwksFetches += 1;
    return Response.json({ keys: [{ ...jwk, kid: 'k1' }] });
  };
  const encode = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const token = async (
    claims: Record<string, unknown>,
    header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }
  ) => {
    const head = encode(header);
    const body = encode(claims);
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keys.privateKey,
        new TextEncoder().encode(`${head}.${body}`)
      )
    );
    return `${head}.${body}.${base64Url(signature)}`;
  };
  return { fetch, token, fetches: () => jwksFetches };
};

const good = {
  iss: 'https://accounts.google.com',
  aud: 'client',
  sub: '1234',
  exp: NOW / 1000 + 600,
};

beforeEach(() => resetGoogleKeyCache());

describe("Google's ID token", () => {
  it('accepts a token Google signed for this client, fetching keys once', async () => {
    const { fetch, token, fetches } = await signer();
    await expect(
      verifyGoogleIdToken(await token(good), 'client', fetch, NOW)
    ).resolves.toMatchObject({ sub: '1234' });
    await verifyGoogleIdToken(await token(good), 'client', fetch, NOW);
    expect(fetches()).toBe(1);
  });

  it.each([
    ['another client', { ...good, aud: 'other' }],
    ['another issuer', { ...good, iss: 'https://evil.example' }],
    ['an expired token', { ...good, exp: NOW / 1000 - 3600 }],
    ['a token without a subject', { ...good, sub: '' }],
  ])('refuses %s', async (_, claims) => {
    const { fetch, token } = await signer();
    await expect(
      verifyGoogleIdToken(await token(claims), 'client', fetch, NOW)
    ).rejects.toThrow();
  });

  it('refuses a token signed by another key or another algorithm', async () => {
    const { fetch } = await signer();
    const forger = await signer();
    await expect(
      verifyGoogleIdToken(await forger.token(good), 'client', fetch, NOW)
    ).rejects.toThrow();
    const { token } = await signer();
    await expect(
      verifyGoogleIdToken(
        await token(good, { alg: 'none', kid: 'k1' }),
        'client',
        fetch,
        NOW
      )
    ).rejects.toThrow();
  });
});

describe('sign-in configuration', () => {
  it('offers a provider only when its app is set', () => {
    expect(availableProviders(readSignInConfiguration({}))).toEqual([]);
    expect(
      availableProviders(
        readSignInConfiguration({
          GOOGLE_CLIENT_ID: 'id',
          GOOGLE_CLIENT_SECRET: 'secret',
          DISCORD_CLIENT_ID: 'id',
          AUTH_TEST_PROVIDER: 'off',
        })
      )
    ).toEqual(['google']);
    expect(
      availableProviders(readSignInConfiguration({ AUTH_TEST_PROVIDER: 'on' }))
    ).toEqual(['test']);
  });

  it("sends Google the PKCE challenge and its own callback", async () => {
    const challenge = await pkceChallenge('verifier');
    const url = new URL(
      authorizeUrl(
        { test: false, google: { clientId: 'id', clientSecret: 's' } },
        'google',
        { origin: 'https://beta.example', state: 'st', codeChallenge: challenge }
      ) ?? ''
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'id',
      redirect_uri: 'https://beta.example/v2/auth/google/callback',
      scope: 'openid email profile',
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.has('access_type')).toBe(false);
  });

  it('reads only well-formed session cookies', () => {
    const secret = 'x'.repeat(43);
    expect(parseSessionToken(`a_ABCDEFGHIJKLMNOP.${secret}`)).toEqual({
      accountId: 'a_ABCDEFGHIJKLMNOP',
      secret,
    });
    for (const value of [
      '',
      'a_short.secret',
      `b_ABCDEFGHIJKLMNOP.${secret}`,
      `a_ABCDEFGHIJKLMNOP.${secret}x`,
      `a_ABCDEFGHIJKLMNOP`,
    ]) {
      expect(parseSessionToken(value)).toBeUndefined();
    }
  });
});
