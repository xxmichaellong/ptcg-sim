import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatusResponse } from '../shared/api.js';
import { checkAccess, protectionOf } from './access.js';
import {
  missingGoogleSecrets,
  parseEmails,
  pkceChallenge,
  readGoogleSignIn,
  readSignedValue,
  returnPathOf,
  sameSecret,
  SESSION_LIFETIME_MS,
  sessionEmail,
  signValue,
  type GoogleSignIn,
} from './google.js';
import { forgetAnswers, handleOpsRequest, type OpsEnv } from './index.js';

const ORIGIN = 'https://ptcgsim-ops.example.workers.dev';
const NOW = Date.parse('2026-11-12T12:00:00Z');
const CLIENT_ID = 'client-0123.apps.googleusercontent.com';
const KEY = 'a-session-key-for-tests-only-0123456789';

const google = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'client-secret-for-tests',
  OPS_EMAILS: ' Dev@Example.com, ops@example.com\nthird@example.org ',
  OPS_SESSION_KEY: KEY,
};

const env: OpsEnv = {
  CLOUDFLARE_ACCOUNT_ID: 'account-0000',
  CLOUDFLARE_ZONE_ID: 'zone-0000',
  OPS_DEMO: 'on',
  ...google,
};

const config = readGoogleSignIn(google) as GoogleSignIn;

const base64Url = (text: string): string =>
  btoa(text).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

/** An ID token as Google's token endpoint returns it. */
const idToken = (claims: Record<string, unknown>): string =>
  `${base64Url(JSON.stringify({ alg: 'RS256', kid: 'k' }))}.${base64Url(
    JSON.stringify(claims)
  )}.c2lnbmF0dXJl`;

const claims = {
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1234567890',
  email: 'dev@example.com',
  email_verified: true,
  iat: NOW / 1000 - 5,
  exp: NOW / 1000 + 3600,
};

/** Google's token endpoint: checks what it is sent, answers with `answer`. */
const tokenEndpoint = (
  answer: () => Response,
  expected: { code?: string; verifier?: string } = {}
) =>
  vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(String(input)).toBe('https://oauth2.googleapis.com/token');
      expect(init?.method).toBe('POST');
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('client_id')).toBe(CLIENT_ID);
      expect(form.get('client_secret')).toBe('client-secret-for-tests');
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
      if (expected.code) expect(form.get('code')).toBe(expected.code);
      if (expected.verifier)
        expect(form.get('code_verifier')).toBe(expected.verifier);
      return answer();
    }
  );

const answerWith = (tokenClaims: Record<string, unknown>) => () =>
  Response.json({ id_token: idToken(tokenClaims), token_type: 'Bearer' });

const cookieOf = (response: Response, name: string) => {
  const line = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`));
  return line
    ? {
        line,
        value: line.slice(name.length + 1, line.indexOf(';')),
      }
    : undefined;
};

const decodePayload = (signed: string): Record<string, unknown> =>
  JSON.parse(
    atob((signed.split('.')[0] ?? '').replace(/-/gu, '+').replace(/_/gu, '/'))
  ) as Record<string, unknown>;

/** Starts a sign-in: where it sends the browser and the cookie it sets. */
const start = async (query = '', now = NOW) => {
  const response = await handleOpsRequest(
    new Request(`${ORIGIN}/auth/sign-in${query}`),
    env,
    vi.fn(),
    now
  );
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('Location') ?? '');
  const cookie = cookieOf(response, '__Secure-ops-sign-in');
  expect(cookie).toBeDefined();
  return {
    location,
    state: location.searchParams.get('state') ?? '',
    cookie: cookie?.value ?? '',
    cookieLine: cookie?.line ?? '',
  };
};

const callback = (
  query: Record<string, string>,
  cookie: string | undefined,
  fetcher: typeof fetch,
  now = NOW
) =>
  handleOpsRequest(
    new Request(
      `${ORIGIN}/auth/callback?${new URLSearchParams(query).toString()}`,
      cookie ? { headers: { Cookie: `__Secure-ops-sign-in=${cookie}` } } : {}
    ),
    env,
    fetcher,
    now
  );

const session = async (email: string, expires = NOW + 60_000) =>
  `__Host-ops-session=${await signValue(KEY, 'session', { email, exp: expires })}`;

beforeEach(() => forgetAnswers());

describe('settings', () => {
  it('reads the list in lower case, split on commas and spaces', () => {
    expect([...parseEmails(google.OPS_EMAILS)]).toEqual([
      'dev@example.com',
      'ops@example.com',
      'third@example.org',
    ]);
    expect(parseEmails('a@example.com,,b@example.com;  ').size).toBe(2);
    expect(parseEmails('').size).toBe(0);
    expect(parseEmails(undefined).size).toBe(0);
    // Not addresses.
    expect(parseEmails('nobody, @example.com, dev@').size).toBe(0);
  });

  it('turns Google sign-in on only with all four secrets good', () => {
    const url = new URL(`${ORIGIN}/`);
    expect(protectionOf(google, url)).toBe('google');
    expect(config.emails.has('dev@example.com')).toBe(true);
    for (const broken of [
      { GOOGLE_CLIENT_ID: '' },
      { GOOGLE_CLIENT_ID: '   ' },
      { GOOGLE_CLIENT_SECRET: undefined },
      { OPS_EMAILS: ' , ' },
      { OPS_EMAILS: 'not-an-address' },
      { OPS_SESSION_KEY: 'x'.repeat(31) },
      { OPS_SESSION_KEY: undefined },
    ]) {
      const half = { ...google, ...broken };
      expect(readGoogleSignIn(half)).toBeUndefined();
      expect(protectionOf(half, url)).toBe('none');
      expect(missingGoogleSecrets(half)).toHaveLength(1);
    }
    expect(missingGoogleSecrets({})).toEqual([]);
    expect(missingGoogleSecrets(google)).toEqual([]);
    expect(missingGoogleSecrets({ OPS_EMAILS: 'dev@example.com' })).toEqual([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'OPS_SESSION_KEY',
    ]);
  });

  it('takes Access first, then Google, then this machine', () => {
    const access = {
      ACCESS_TEAM_DOMAIN: 'ptcgsim.cloudflareaccess.com',
      ACCESS_AUD: 'aud-tag',
    };
    const local = new URL('http://localhost:5180/');
    expect(protectionOf({ ...access, ...google, OPS_LOCAL: 'on' }, local)).toBe(
      'access'
    );
    expect(protectionOf({ ...google, OPS_LOCAL: 'on' }, local)).toBe('google');
    expect(protectionOf({ OPS_LOCAL: 'on' }, local)).toBe('local');
    expect(protectionOf({}, local)).toBe('none');
  });

  it('shows a half-done setup what it still needs, and serves nothing', async () => {
    const half: OpsEnv = { ...env, OPS_SESSION_KEY: 'too-short' };
    const page = await handleOpsRequest(
      new Request(`${ORIGIN}/auth/sign-in`),
      half,
      vi.fn(),
      NOW
    );
    expect(page.status).toBe(503);
    const text = await page.text();
    expect(text).toMatch(/Not set up yet/u);
    expect(text).toContain(
      'Still missing or too short: <code>OPS_SESSION_KEY</code>.'
    );
    expect(text).not.toContain('too-short');
    const api = await handleOpsRequest(
      new Request(`${ORIGIN}/api/status`),
      half,
      vi.fn(),
      NOW
    );
    expect(api.status).toBe(503);
  });
});

describe('signed values', () => {
  it('reads back what it signed, for the same purpose and key only', async () => {
    const signed = await signValue(KEY, 'session', {
      email: 'dev@example.com',
      exp: 1,
    });
    expect(await readSignedValue(KEY, 'session', signed)).toEqual({
      email: 'dev@example.com',
      exp: 1,
    });
    // A sign-in attempt's cookie is never a session.
    expect(await readSignedValue(KEY, 'sign-in', signed)).toBeUndefined();
    expect(
      await readSignedValue(`${KEY}-other`, 'session', signed)
    ).toBeUndefined();
  });

  it('refuses a changed payload or signature, and anything malformed', async () => {
    const signed = await signValue(KEY, 'session', {
      email: 'dev@example.com',
      exp: 1,
    });
    const [payload, signature] = signed.split('.') as [string, string];
    const forged = base64Url(
      JSON.stringify({ email: 'evil@example.com', exp: 1 })
    );
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const text of [
      `${forged}.${signature}`,
      `${payload}.${flipped}`,
      `${payload}.`,
      payload,
      `${signed}.extra`,
      `${payload}.not base64!`,
      '',
      undefined,
      'x'.repeat(5000),
    ])
      expect(await readSignedValue(KEY, 'session', text)).toBeUndefined();
  });

  it('compares secrets whole', async () => {
    expect(await sameSecret('abc', 'abc')).toBe(true);
    expect(await sameSecret('abc', 'abd')).toBe(false);
    expect(await sameSecret('abc', 'abcd')).toBe(false);
  });
});

describe('sessions', () => {
  const request = (cookie: string) =>
    new Request(`${ORIGIN}/api/status`, { headers: { Cookie: cookie } });

  it('lets a current session on the list in, by any case', async () => {
    expect(
      await sessionEmail(request(await session('dev@example.com')), config, NOW)
    ).toBe('dev@example.com');
    expect(
      await sessionEmail(request(await session('OPS@Example.COM')), config, NOW)
    ).toBe('OPS@Example.COM');
  });

  it('refuses an expired session, a forged one, and one taken off the list', async () => {
    expect(
      await sessionEmail(
        request(await session('dev@example.com', NOW - 1)),
        config,
        NOW
      )
    ).toBeUndefined();
    const forged = `__Host-ops-session=${await signValue(
      'another-key-entirely-0123456789-abcdef',
      'session',
      { email: 'dev@example.com', exp: NOW + 60_000 }
    )}`;
    expect(await sessionEmail(request(forged), config, NOW)).toBeUndefined();
    // Off the list: the same cookie no longer opens anything.
    const cookie = await session('dev@example.com');
    const shorter = readGoogleSignIn({
      ...google,
      OPS_EMAILS: 'ops@example.com',
    }) as GoogleSignIn;
    expect(await sessionEmail(request(cookie), shorter, NOW)).toBeUndefined();
    expect(
      await checkAccess(
        request(cookie),
        { ...google, OPS_EMAILS: 'ops@example.com' },
        fetch,
        NOW
      )
    ).toBeInstanceOf(Response);
    expect(await checkAccess(request(cookie), google, fetch, NOW)).toBe(
      undefined
    );
  });

  it('asks the API for a sign-in in JSON, and a page for one with a button', async () => {
    const api = await handleOpsRequest(
      new Request(`${ORIGIN}/api/view?view=live&env=beta&days=7`),
      env,
      vi.fn(),
      NOW
    );
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'sign_in_required' });
    const page = await handleOpsRequest(
      new Request(`${ORIGIN}/?view=live&env=preview`),
      env,
      vi.fn(),
      NOW
    );
    expect(page.status).toBe(401);
    expect(page.headers.get('Content-Type')).toMatch(/^text\/html/u);
    expect(page.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    const html = await page.text();
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('#4285F4');
    expect(html).toContain(
      'href="/auth/sign-in?return=%2F%3Fview%3Dlive%26env%3Dpreview"'
    );
  });

  it('says who is signed in, and serves the page', async () => {
    const assets = {
      fetch: vi.fn(async () => new Response('<!doctype html>')),
    };
    const cookie = await session('dev@example.com');
    const status = await handleOpsRequest(
      new Request(`${ORIGIN}/api/status`, { headers: { Cookie: cookie } }),
      env,
      vi.fn(),
      NOW
    );
    expect((await status.json()) as StatusResponse).toEqual({
      demo: true,
      token: false,
      protection: 'google',
      email: 'dev@example.com',
      accountId: 'account-0000',
    });
    const page = await handleOpsRequest(
      new Request(`${ORIGIN}/`, { headers: { Cookie: cookie } }),
      { ...env, ASSETS: assets },
      vi.fn(),
      NOW
    );
    expect(await page.text()).toBe('<!doctype html>');
  });
});

describe('where to come back to', () => {
  it('keeps a path on this origin', () => {
    expect(returnPathOf('/?view=live&env=preview', ORIGIN)).toBe(
      '/?view=live&env=preview'
    );
    expect(returnPathOf('/a/../b#x', ORIGIN)).toBe('/b');
  });

  it('refuses anything that could leave it', () => {
    for (const attempt of [
      '//evil.example',
      '//evil.example/path',
      '/\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
      '/.//evil.example',
      '/..//evil.example',
      'https://evil.example/',
      'http://ptcgsim-ops.example.workers.dev/',
      'javascript:alert(1)',
      'evil.example',
      '/auth/callback?code=x',
      `/${'x'.repeat(2048)}`,
      '',
      null,
    ])
      expect(returnPathOf(attempt, ORIGIN)).toBe('/');
  });
});

describe('signing in', () => {
  it('sends the browser to Google with PKCE and a state, kept in a short cookie on /auth', async () => {
    const { location, state, cookie, cookieLine } = await start(
      '?return=%2F%3Fview%3Derrors'
    );
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    const params = Object.fromEntries(location.searchParams);
    expect(params).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: `${ORIGIN}/auth/callback`,
      response_type: 'code',
      scope: 'openid email',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const attempt = decodePayload(cookie);
    expect(attempt).toMatchObject({
      state,
      returnTo: '/?view=errors',
      exp: NOW + 10 * 60_000,
    });
    expect(params['code_challenge']).toBe(
      await pkceChallenge(String(attempt['verifier']))
    );
    expect(cookieLine).toContain('; Path=/auth');
    expect(cookieLine).toContain('; HttpOnly');
    expect(cookieLine).toContain('; Secure');
    expect(cookieLine).toContain('; SameSite=Lax');
    expect(cookieLine).toContain('; Max-Age=600');
    // Each attempt is its own.
    expect((await start()).state).not.toBe(state);
  });

  it('forgets a return path that leaves the origin', async () => {
    for (const query of [
      '?return=%2F%2Fevil.example',
      '?return=https%3A%2F%2Fevil.example%2F',
      '?return=%2F.%2F%2Fevil.example',
      '?return=%2F%5Cevil.example',
    ])
      expect(decodePayload((await start(query)).cookie)['returnTo']).toBe('/');
  });

  it('signs a verified address on the list in, for seven days, and goes back', async () => {
    const { state, cookie } = await start('?return=%2F%3Fview%3Dbudget');
    const verifier = String(decodePayload(cookie)['verifier']);
    const fetcher = tokenEndpoint(
      answerWith({ ...claims, email: 'Dev@Example.com' }),
      { code: 'code-from-google', verifier }
    );
    const response = await callback(
      { state, code: 'code-from-google' },
      cookie,
      fetcher
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/?view=budget`);
    const signed = cookieOf(response, '__Host-ops-session');
    expect(signed?.line).toContain('; Path=/;');
    expect(signed?.line).toContain('; HttpOnly');
    expect(signed?.line).toContain('; Secure');
    expect(signed?.line).toContain('; SameSite=Lax');
    expect(signed?.line).toContain(
      `; Max-Age=${String(SESSION_LIFETIME_MS / 1000)}`
    );
    expect(decodePayload(signed?.value ?? '')).toEqual({
      email: 'dev@example.com',
      exp: NOW + SESSION_LIFETIME_MS,
    });
    // The attempt is spent.
    expect(cookieOf(response, '__Secure-ops-sign-in')?.line).toContain(
      'Max-Age=0'
    );
    // The session opens the API, and runs out after seven days.
    const status = (now: number) =>
      handleOpsRequest(
        new Request(`${ORIGIN}/api/status`, {
          headers: { Cookie: `__Host-ops-session=${signed?.value ?? ''}` },
        }),
        env,
        vi.fn(),
        now
      );
    expect((await status(NOW + 60_000)).status).toBe(200);
    expect((await status(NOW + SESSION_LIFETIME_MS + 1)).status).toBe(401);
  });

  it("turns away an address that isn't on the list, or isn't verified", async () => {
    for (const tokenClaims of [
      { ...claims, email: 'stranger@example.com' },
      { ...claims, email_verified: false },
      { ...claims, email_verified: undefined },
    ]) {
      const { state, cookie } = await start();
      const response = await callback(
        { state, code: 'code' },
        cookie,
        tokenEndpoint(answerWith(tokenClaims))
      );
      expect(response.status).toBe(403);
      const html = await response.text();
      expect(html).toContain('That Google account can’t open this dashboard.');
      expect(html).toContain('<a href="/auth/sign-in">Use another account</a>');
      expect(cookieOf(response, '__Host-ops-session')?.line).toContain(
        'Max-Age=0'
      );
    }
  });

  it('refuses a token for another client, from another issuer, or out of date', async () => {
    for (const answer of [
      answerWith({
        ...claims,
        aud: 'another-client.apps.googleusercontent.com',
      }),
      answerWith({ ...claims, aud: [CLIENT_ID] }),
      answerWith({ ...claims, iss: 'https://evil.example' }),
      answerWith({ ...claims, exp: NOW / 1000 - 1 }),
      answerWith({ ...claims, email: undefined }),
      () => Response.json({ access_token: 'no id token' }),
      () => Response.json({ id_token: 'not-a-token' }),
      () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      () => new Response('not json'),
    ]) {
      const { state, cookie } = await start();
      const response = await callback(
        { state, code: 'code' },
        cookie,
        tokenEndpoint(answer)
      );
      expect(response.status).toBe(502);
      expect(await response.text()).toContain('Google didn’t sign you in.');
      expect(cookieOf(response, '__Host-ops-session')).toBeUndefined();
    }
  });

  it('refuses a state that is not its own, before asking Google anything', async () => {
    const { state, cookie } = await start();
    const other = await start();
    const fetcher = tokenEndpoint(answerWith(claims));
    const tampered = `${base64Url(
      JSON.stringify({ ...decodePayload(cookie), state: 'chosen' })
    )}.${cookie.split('.')[1] ?? ''}`;
    for (const [query, sent, now] of [
      [{ state: other.state, code: 'code' }, cookie, NOW],
      [{ state: '', code: 'code' }, cookie, NOW],
      [{ code: 'code' }, cookie, NOW],
      [{ state, code: 'code' }, undefined, NOW],
      [{ state, code: 'code' }, other.cookie, NOW],
      [{ state: 'chosen', code: 'code' }, tampered, NOW],
      // The attempt lasts ten minutes.
      [{ state, code: 'code' }, cookie, NOW + 10 * 60_000 + 1],
    ] as const) {
      const response = await callback(query, sent, fetcher, now);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('That sign-in expired.');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('shows the button again when turned back at Google', async () => {
    const { state, cookie } = await start();
    const fetcher = tokenEndpoint(answerWith(claims));
    const response = await callback(
      { state, error: 'access_denied' },
      cookie,
      fetcher
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Sign in with Google');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('signs out', async () => {
    for (const method of ['POST', 'GET']) {
      const response = await handleOpsRequest(
        new Request(`${ORIGIN}/auth/sign-out`, {
          method,
          headers: { Cookie: await session('dev@example.com') },
        }),
        env,
        vi.fn(),
        NOW
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/`);
      expect(cookieOf(response, '__Host-ops-session')?.line).toMatch(
        /^__Host-ops-session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/u
      );
    }
    const put = await handleOpsRequest(
      new Request(`${ORIGIN}/auth/sign-out`, { method: 'PUT' }),
      env,
      vi.fn(),
      NOW
    );
    expect(put.status).toBe(405);
    const elsewhere = await handleOpsRequest(
      new Request(`${ORIGIN}/auth/nope`),
      env,
      vi.fn(),
      NOW
    );
    expect(elsewhere.status).toBe(404);
  });

  it('leaves /auth to Access once Access is set', async () => {
    const response = await handleOpsRequest(
      new Request(`${ORIGIN}/auth/sign-in`, {
        headers: { Cookie: await session('dev@example.com') },
      }),
      {
        ...env,
        ACCESS_TEAM_DOMAIN: 'ptcgsim.cloudflareaccess.com',
        ACCESS_AUD: 'aud-tag',
      },
      vi.fn(),
      NOW
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_required' });
  });
});
