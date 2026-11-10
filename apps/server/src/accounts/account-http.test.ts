import { beforeEach, describe, expect, it } from 'vitest';

import { accountRoute, handleAccountRequest } from './account-http.js';
import { base64Url } from './account-session.js';
import { memoryAccounts } from './accounts.test-support.js';
import {
  resetGoogleKeyCache,
  type Fetch,
  type SignInConfiguration,
} from './sign-in-providers.js';

const ORIGIN = 'https://play.example';
const GOOGLE = { clientId: 'google-client', clientSecret: 'google-secret' };

/** A browser's cookies for one origin. */
class Jar {
  private readonly cookies = new Map<string, string>();

  take(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const cleared = attributes.some((part) =>
        /^\s*max-age=0\s*$/iu.test(part)
      );
      if (cleared || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  clone(): Jar {
    const copy = new Jar();
    for (const [name, value] of this.cookies) copy.cookies.set(name, value);
    return copy;
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

/** Google's token endpoint and keys, signing tokens for `google:<sub>` codes. */
const fakeGoogle = async (): Promise<Fetch> => {
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
  const encode = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  return async (input, init) => {
    if (input === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json(
        { keys: [{ ...jwk, kid: 'k1', alg: 'RS256' }] },
        { headers: { 'Cache-Control': 'max-age=600' } }
      );
    }
    if (input === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      const sub = body.get('code')?.replace(/^google:/u, '') ?? '';
      const head = encode({ alg: 'RS256', kid: 'k1' });
      const payload = encode({
        iss: 'https://accounts.google.com',
        aud: GOOGLE.clientId,
        sub,
        email: `${sub}@gmail.example`,
        given_name: `G ${sub}`,
        exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 * 20,
      });
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          keys.privateKey,
          new TextEncoder().encode(`${head}.${payload}`)
        )
      );
      return Response.json({ id_token: `${head}.${payload}.${base64Url(signature)}` });
    }
    return new Response('not found', { status: 404 });
  };
};

const setup = (
  configuration: SignInConfiguration = { test: true },
  fetch?: Fetch
) => {
  const accounts = memoryAccounts(configuration, fetch);
  const call = (path: string, init: RequestInit = {}, jar?: Jar) => {
    const request = new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: {
        ...(jar ? { Cookie: jar.header() } : {}),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    });
    const route = accountRoute(new URL(request.url).pathname);
    if (!route) throw new Error(`no route for ${path}`);
    return handleAccountRequest(request, route, accounts.dependencies);
  };
  /** Starts a sign-in and comes back from the provider with `code`. */
  const signIn = async (
    jar: Jar,
    code: string,
    { provider = 'test', intent = 'sign-in' } = {}
  ) => {
    const start = await call(
      `/v2/auth/${provider}/start?intent=${intent}&display=popup&return=${encodeURIComponent('/?room=ABCD')}`,
      {},
      jar
    );
    expect(start.status).toBe(302);
    jar.take(start);
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get(
      'state'
    );
    const finish = await call(
      `/v2/auth/${provider}/callback?state=${state ?? ''}&code=${encodeURIComponent(code)}`,
      {},
      jar
    );
    jar.take(finish);
    const html = await finish.text();
    return /data-result="([a-z_]+)"/u.exec(html)?.[1];
  };
  const me = async (jar: Jar) =>
    (
      await (await call('/v2/account', {}, jar)).json<{
        providers: string[];
        account: {
          id: string;
          name: string;
          avatar: string;
          methods: { provider: string; label: string }[];
          sessionProvider: string;
        } | null;
      }>()
    );
  const send = (jar: Jar, path: string, method: string, body?: unknown) =>
    call(
      path,
      {
        method,
        headers: {
          Origin: ORIGIN,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      jar
    );
  return { ...accounts, call, signIn, me, send };
};

beforeEach(() => resetGoogleKeyCache());

describe('accounts over HTTP', () => {
  it('routes only its own paths', () => {
    expect(accountRoute('/v2/account')).toEqual({ kind: 'account' });
    expect(accountRoute('/v2/auth/google/start')).toEqual({
      kind: 'start',
      provider: 'google',
    });
    expect(accountRoute('/v2/auth/github/start')).toBeUndefined();
    expect(accountRoute('/v2/account/sign-in-methods/discord')).toEqual({
      kind: 'method',
      provider: 'discord',
    });
    expect(accountRoute('/v2/accounts')).toBeUndefined();
  });

  it('makes an account on a first sign-in and finds it on the next', async () => {
    const { signIn, me } = setup();
    const jar = new Jar();
    expect((await me(jar)).account).toBeNull();
    expect(await signIn(jar, 'Dawn')).toBe('signed_in');
    const first = await me(jar);
    expect(first.providers).toEqual(['test']);
    expect(first.account).toMatchObject({
      name: 'Dawn',
      avatar: 'initials',
      sessionProvider: 'test',
      methods: [{ provider: 'test', label: 'dawn@example.test' }],
    });

    const other = new Jar();
    expect(await signIn(other, 'Dawn')).toBe('signed_in');
    expect((await me(other)).account?.id).toBe(first.account?.id);
    expect(await signIn(new Jar(), 'Misty')).toBe('signed_in');
    expect((await me(jar)).account?.id).toBe(first.account?.id);
  });

  it('ends the session this browser had when it signs in again', async () => {
    const { signIn, me } = setup();
    const jar = new Jar();
    await signIn(jar, 'Dawn');
    const before = jar.clone();
    const id = (await me(jar)).account?.id;
    await signIn(jar, 'Misty');
    expect((await me(before)).account).toBeNull();
    expect((await me(jar)).account?.name).toBe('Misty');
    await signIn(jar, 'Dawn');
    expect((await me(jar)).account?.id).toBe(id);
  });

  it('finishes on a page that tells the table and returns to it', async () => {
    const { call } = setup();
    const jar = new Jar();
    const start = await call(
      `/v2/auth/test/start?display=page&return=${encodeURIComponent('/?room=ABCD')}`
    );
    jar.take(start);
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get(
      'state'
    );
    const finish = await call(
      `/v2/auth/test/callback?state=${state ?? ''}&code=Dawn`,
      {},
      jar
    );
    const html = await finish.text();
    expect(finish.headers.get('Content-Security-Policy')).toContain(
      "script-src 'nonce-"
    );
    expect(html).toContain('"ptcgsim-account"');
    expect(html).toContain('/?room=ABCD&account=signed_in');
  });

  it('never returns to another site', async () => {
    const { call } = setup();
    const start = await call(
      `/v2/auth/test/start?display=page&return=${encodeURIComponent('https://evil.example/?x')}`
    );
    const jar = new Jar();
    jar.take(start);
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get(
      'state'
    );
    const html = await (
      await call(`/v2/auth/test/callback?state=${state ?? ''}&code=Dawn`, {}, jar)
    ).text();
    expect(html).not.toContain('evil.example');
    expect(html).toContain('"/?account=signed_in"');
  });

  it('refuses a callback it did not start, an old one, or a cancelled one', async () => {
    const { call, advance } = setup();
    const result = async (response: Response) =>
      /data-result="([a-z_]+)"/u.exec(await response.text())?.[1];
    // No attempt cookie at all.
    expect(
      await result(await call('/v2/auth/test/callback?state=x&code=Dawn'))
    ).toBe('expired');

    const jar = new Jar();
    const start = await call('/v2/auth/test/start', {}, jar);
    jar.take(start);
    const state =
      new URL(start.headers.get('Location') ?? '').searchParams.get('state') ??
      '';
    expect(
      await result(
        await call('/v2/auth/test/callback?state=wrong&code=Dawn', {}, jar)
      )
    ).toBe('expired');
    expect(
      await result(
        await call(
          `/v2/auth/test/callback?state=${state}&error=access_denied`,
          {},
          jar
        )
      )
    ).toBe('cancelled');
    advance(11 * 60 * 1000);
    expect(
      await result(
        await call(`/v2/auth/test/callback?state=${state}&code=Dawn`, {}, jar)
      )
    ).toBe('expired');
    expect(jar.has('__Host-ptcgsim-session')).toBe(false);
  });

  it('offers only configured providers', async () => {
    const { call, me } = setup({ test: false });
    expect((await me(new Jar())).providers).toEqual([]);
    const html = await (await call('/v2/auth/google/start')).text();
    expect(html).toContain('data-result="unavailable"');
    expect((await call('/v2/auth/test/authorize?state=x')).status).toBe(404);
  });

  it('renames and changes the avatar, same-origin only', async () => {
    const { signIn, send, call, me } = setup();
    const jar = new Jar();
    await signIn(jar, 'Dawn');
    const renamed = await send(jar, '/v2/account', 'PATCH', {
      name: '  Dawn   Berlitz  ',
      avatar: 'emblem:pokemon-25',
    });
    expect(renamed.status).toBe(200);
    expect((await me(jar)).account).toMatchObject({
      name: 'Dawn Berlitz',
      avatar: 'emblem:pokemon-25',
    });
    for (const body of [
      { avatar: 'emblem:none' },
      { avatar: 'https://evil.example/a.png' },
      { name: '   ' },
      { name: 'Dawn', admin: true },
    ]) {
      expect((await send(jar, '/v2/account', 'PATCH', body)).status).toBe(400);
    }
    const crossSite = await call(
      '/v2/account',
      {
        method: 'PATCH',
        headers: {
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Pwned' }),
      },
      jar
    );
    expect(crossSite.status).toBe(403);
    expect((await me(jar)).account?.name).toBe('Dawn Berlitz');
  });

  it('signs out this session only', async () => {
    const { signIn, send, me } = setup();
    const phone = new Jar();
    const laptop = new Jar();
    await signIn(phone, 'Dawn');
    await signIn(laptop, 'Dawn');
    const out = await send(phone, '/v2/account/sign-out', 'POST');
    expect(out.status).toBe(204);
    phone.take(out);
    expect((await me(phone)).account).toBeNull();
    expect((await me(laptop)).account?.name).toBe('Dawn');
  });

  it('ends a session after 90 days unused, and renews one in use', async () => {
    const { signIn, me, advance } = setup();
    const used = new Jar();
    const idle = new Jar();
    await signIn(used, 'Dawn');
    await signIn(idle, 'Dawn');
    for (let day = 0; day < 100; day += 10) {
      advance(10 * 24 * 60 * 60 * 1000);
      expect((await me(used)).account?.name).toBe('Dawn');
    }
    expect((await me(idle)).account).toBeNull();
  });

  describe('with Google too', () => {
    const google = async () =>
      setup({ test: true, google: GOOGLE }, await fakeGoogle());

    it('signs in with Google by its verified ID token', async () => {
      const { signIn, me } = await google();
      const jar = new Jar();
      expect(await signIn(jar, 'google:111', { provider: 'google' })).toBe(
        'signed_in'
      );
      expect((await me(jar)).account).toMatchObject({
        name: 'G 111',
        methods: [{ provider: 'google', label: '111@gmail.example' }],
      });
    });

    it('adds a method, which then signs in to the same account', async () => {
      const { signIn, me } = await google();
      const jar = new Jar();
      await signIn(jar, 'Dawn');
      expect(
        await signIn(jar, 'google:222', { provider: 'google', intent: 'link' })
      ).toBe('linked');
      const account = (await me(jar)).account;
      expect(account?.methods.map((method) => method.provider)).toEqual([
        'test',
        'google',
      ]);
      const other = new Jar();
      await signIn(other, 'google:222', { provider: 'google' });
      expect((await me(other)).account?.id).toBe(account?.id);
    });

    it("won't add an id another account has, or a second id at a provider", async () => {
      const { signIn } = await google();
      await signIn(new Jar(), 'google:333', { provider: 'google' });
      const jar = new Jar();
      await signIn(jar, 'Dawn');
      expect(
        await signIn(jar, 'google:333', { provider: 'google', intent: 'link' })
      ).toBe('already_linked');
      expect(
        await signIn(jar, 'google:444', { provider: 'google', intent: 'link' })
      ).toBe('linked');
      expect(
        await signIn(jar, 'google:555', { provider: 'google', intent: 'link' })
      ).toBe('provider_taken');
      expect(
        await signIn(new Jar(), 'google:444', {
          provider: 'google',
          intent: 'link',
        })
      ).toBe('signed_out');
    });

    it('removes a method but never the last, and frees its id', async () => {
      const { signIn, send, me } = await google();
      const jar = new Jar();
      await signIn(jar, 'Dawn');
      expect(
        (await send(jar, '/v2/account/sign-in-methods/test', 'DELETE')).status
      ).toBe(409);
      await signIn(jar, 'google:666', { provider: 'google', intent: 'link' });
      const removed = await send(
        jar,
        '/v2/account/sign-in-methods/google',
        'DELETE'
      );
      expect(removed.status).toBe(200);
      const id = (await me(jar)).account?.id;
      expect((await me(jar)).account?.methods).toHaveLength(1);
      // The Google id now makes an account of its own.
      const other = new Jar();
      await signIn(other, 'google:666', { provider: 'google' });
      expect((await me(other)).account?.id).not.toBe(id);
    });
  });

  it('deletes the account for the account on screen, and frees its ids', async () => {
    const { signIn, send, me, stores, records } = setup();
    const jar = new Jar();
    await signIn(jar, 'Dawn');
    const id = (await me(jar)).account?.id ?? '';
    expect(
      (
        await send(jar, '/v2/account', 'DELETE', {
          expectedAccountId: 'a_AAAAAAAAAAAAAAAA',
        })
      ).status
    ).toBe(409);
    const deleted = await send(jar, '/v2/account', 'DELETE', {
      expectedAccountId: id,
    });
    expect(deleted.status).toBe(204);
    jar.take(deleted);
    expect(stores.has(id)).toBe(false);
    expect(records.size).toBe(0);
    expect((await me(jar)).account).toBeNull();
    await signIn(jar, 'Dawn');
    expect((await me(jar)).account?.id).not.toBe(id);
  });

  it('finishes making an account its record points to', async () => {
    const { signIn, me, records } = setup();
    // Claimed, but the account was never written (a failure in between).
    records.set('test:test-dawn', {
      accountId: 'a_BBBBBBBBBBBBBBBB',
      claimedAt: 0,
    });
    const jar = new Jar();
    expect(await signIn(jar, 'Dawn')).toBe('signed_in');
    expect((await me(jar)).account?.id).toBe('a_BBBBBBBBBBBBBBBB');
  });

  it('gives up a record whose account no longer has the id', async () => {
    const { signIn, me, records } = setup();
    const misty = new Jar();
    await signIn(misty, 'Misty');
    const mistyId = (await me(misty)).account?.id ?? '';
    records.set('test:test-dawn', { accountId: mistyId, claimedAt: 0 });
    const jar = new Jar();
    expect(await signIn(jar, 'Dawn')).toBe('signed_in');
    const id = (await me(jar)).account?.id;
    expect(id).not.toBe(mistyId);
    expect(records.get('test:test-dawn')?.accountId).toBe(id);
    expect((await me(misty)).account?.name).toBe('Misty');
  });
});
