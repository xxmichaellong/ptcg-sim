import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkAccess,
  forgetAccessKeys,
  protectionOf,
  sameSecret,
  verifyAccessJwt,
} from './access.js';

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
    // A short password doesn't count.
    expect(
      protectionOf({ OPS_PASSWORD: 'short' }, new URL('https://x.example/'))
    ).toBe('none');
    // A malformed team doesn't count.
    expect(
      protectionOf(
        { ACCESS_TEAM_DOMAIN: 'evil.example', ACCESS_AUD: AUD },
        new URL('https://x.example/')
      )
    ).toBe('none');
  });

  it('asks the browser for the password, and lets the right one in', async () => {
    const env = { OPS_PASSWORD: 'correct horse battery' };
    const url = 'https://ptcgsim-ops.example.workers.dev/api/status';
    const missing = await checkAccess(request(url), env, fetch, NOW);
    expect(missing?.status).toBe(401);
    expect(missing?.headers.get('WWW-Authenticate')).toMatch(/^Basic realm=/u);
    const wrong = await checkAccess(
      request(url, { Authorization: `Basic ${btoa('ops:wrong password!')}` }),
      env,
      fetch,
      NOW
    );
    expect(wrong?.status).toBe(401);
    const right = await checkAccess(
      request(url, {
        Authorization: `Basic ${btoa('anyone:correct horse battery')}`,
      }),
      env,
      fetch,
      NOW
    );
    expect(right).toBeUndefined();
  });

  it('takes Access over the password once Access is set', async () => {
    const { privateKey, publicKey } = await keyPair();
    const fetcher = await certs(publicKey, 'k');
    const env = {
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: AUD,
      OPS_PASSWORD: 'correct horse battery',
    };
    const url = 'https://ptcgsim-ops.example.workers.dev/';
    expect(
      (
        await checkAccess(
          request(url, {
            Authorization: `Basic ${btoa('x:correct horse battery')}`,
          }),
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

  it('compares secrets whole', async () => {
    expect(await sameSecret('abc', 'abc')).toBe(true);
    expect(await sameSecret('abc', 'abd')).toBe(false);
    expect(await sameSecret('abc', 'abcd')).toBe(false);
  });
});
