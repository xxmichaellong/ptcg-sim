import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkAccess,
  forgetAccessKeys,
  protectionOf,
  verifyAccessJwt,
} from './access.js';
import { signValue } from './google.js';

const TEAM = 'ptcgsim.cloudflareaccess.com';
const AUD = 'aud-tag-0123456789';
const NOW = Date.parse('2026-11-11T12:00:00Z');

const base64Url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      )
    )
  )
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
const encode = (value: unknown): string =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

const keyPair = async () =>
  crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

const sign = async (
  privateKey: CryptoKey,
  header: object,
  payload: object
): Promise<string> => {
  const signed = `${encode(header)}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signed)
  );
  return `${signed}.${base64Url(signature)}`;
};

const certs = async (publicKey: CryptoKey, kid: string) => {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return vi.fn(async () =>
    Response.json({ keys: [{ ...jwk, kid, alg: 'RS256' }] })
  );
};

const seconds = NOW / 1000;
const claims = {
  iss: `https://${TEAM}`,
  aud: [AUD],
  exp: seconds + 600,
  nbf: seconds - 10,
  email: 'owner@example.com',
};

beforeEach(() => forgetAccessKeys());

describe('verifyAccessJwt', () => {
  it("accepts this team's signed token for this application while it is current", async () => {
    const { privateKey, publicKey } = await keyPair();
    const fetcher = await certs(publicKey, 'key-1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'key-1' },
      claims
    );
    expect(await verifyAccessJwt(token, TEAM, AUD, fetcher, NOW)).toBe(true);
    // The keys are kept: a second check asks for nothing.
    expect(await verifyAccessJwt(token, TEAM, AUD, fetcher, NOW)).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      `https://${TEAM}/cdn-cgi/access/certs`
    );
  });

  it('refuses another audience, another issuer, an expired or early token, and a forged one', async () => {
    const { privateKey, publicKey } = await keyPair();
    const other = await keyPair();
    const fetcher = await certs(publicKey, 'key-1');
    const header = { alg: 'RS256', kid: 'key-1' };
    const cases = [
      await sign(privateKey, header, { ...claims, aud: ['someone-else'] }),
      await sign(privateKey, header, {
        ...claims,
        iss: 'https://evil.cloudflareaccess.com',
      }),
      await sign(privateKey, header, { ...claims, exp: seconds - 120 }),
      await sign(privateKey, header, { ...claims, nbf: seconds + 600 }),
      await sign(other.privateKey, header, claims),
      await sign(privateKey, { alg: 'HS256', kid: 'key-1' }, claims),
      await sign(privateKey, { alg: 'RS256', kid: 'unknown' }, claims),
      'not.a.token',
      'nope',
    ];
    for (const token of cases)
      expect(await verifyAccessJwt(token, TEAM, AUD, fetcher, NOW)).toBe(false);
  });

  it('asks for the keys again when a token names one it has not seen (rotation)', async () => {
    const first = await keyPair();
    const second = await keyPair();
    const firstJwk = await crypto.subtle.exportKey('jwk', first.publicKey);
    const secondJwk = await crypto.subtle.exportKey('jwk', second.publicKey);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ keys: [{ ...firstJwk, kid: 'old' }] })
      )
      .mockResolvedValueOnce(
        Response.json({
          keys: [
            { ...firstJwk, kid: 'old' },
            { ...secondJwk, kid: 'new' },
          ],
        })
      );
    expect(
      await verifyAccessJwt(
        await sign(first.privateKey, { alg: 'RS256', kid: 'old' }, claims),
        TEAM,
        AUD,
        fetcher,
        NOW
      )
    ).toBe(true);
    expect(
      await verifyAccessJwt(
        await sign(second.privateKey, { alg: 'RS256', kid: 'new' }, claims),
        TEAM,
        AUD,
        fetcher,
        NOW
      )
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('checkAccess', () => {
  const request = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers });

  it('serves nothing until it is protected', async () => {
    const answer = await checkAccess(
      request('https://ptcgsim-ops.example.workers.dev/api/status'),
      {},
      fetch,
      NOW
    );
    expect(answer?.status).toBe(503);
    // `OPS_LOCAL` only counts on this machine.
    expect(
      protectionOf(
        { OPS_LOCAL: 'on' },
        new URL('https://ptcgsim-ops.example.workers.dev/')
      )
    ).toBe('none');
    expect(
      protectionOf({ OPS_LOCAL: 'on' }, new URL('http://localhost:5180/'))
    ).toBe('local');
    // Google sign-in counts only with all four of its secrets.
    expect(
      protectionOf(
        {
          GOOGLE_CLIENT_ID: 'client',
          GOOGLE_CLIENT_SECRET: 'secret',
          OPS_EMAILS: 'dev@example.com',
        },
        new URL('https://x.example/')
      )
    ).toBe('none');
    // A malformed team doesn't count.
    expect(
      protectionOf(
        { ACCESS_TEAM_DOMAIN: 'evil.example', ACCESS_AUD: AUD },
        new URL('https://x.example/')
      )
    ).toBe('none');
  });

  it('takes Access over Google sign-in once Access is set', async () => {
    const { privateKey, publicKey } = await keyPair();
    const fetcher = await certs(publicKey, 'k');
    const sessionKey = 'a-session-key-for-tests-only-0123456789';
    const env = {
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: AUD,
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      OPS_EMAILS: 'owner@example.com',
      OPS_SESSION_KEY: sessionKey,
    };
    const url = 'https://ptcgsim-ops.example.workers.dev/';
    expect(protectionOf(env, new URL(url))).toBe('access');
    // A good Google session doesn't stand in for Access.
    const session = await signValue(sessionKey, 'session', {
      email: 'owner@example.com',
      exp: NOW + 60_000,
    });
    expect(
      (
        await checkAccess(
          request(url, { Cookie: `__Host-ops-session=${session}` }),
          env,
          fetcher,
          NOW
        )
      )?.status
    ).toBe(403);
    const token = await sign(privateKey, { alg: 'RS256', kid: 'k' }, claims);
    expect(
      await checkAccess(
        request(url, { 'Cf-Access-Jwt-Assertion': token }),
        env,
        fetcher,
        NOW
      )
    ).toBeUndefined();
    expect(
      await checkAccess(
        request(url, { Cookie: `theme=dark; CF_Authorization=${token}` }),
        env,
        fetcher,
        NOW
      )
    ).toBeUndefined();
  });
});
