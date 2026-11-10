import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://play.example';

/** One browser's cookies. */
const browser = () => {
  const cookies = new Map<string, string>();
  const fetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set(
        'Cookie',
        [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
      );
    }
    const response = await exports.default.fetch(
      new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: 'manual' })
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair = ''] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /max-age=0(;|$)/iu.test(header)) cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  };
  const signIn = async (name: string) => {
    const start = await fetch('/v2/auth/test/start?display=popup');
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('Location') ?? '');
    const page = await fetch(`${authorize.pathname}${authorize.search}`);
    expect(await page.text()).toContain('id="testSignInContinue"');
    const state = authorize.searchParams.get('state') ?? '';
    const finish = await fetch(
      `/v2/auth/test/callback?state=${state}&code=${encodeURIComponent(name)}`
    );
    return /data-result="([a-z_]+)"/u.exec(await finish.text())?.[1];
  };
  const me = async () =>
    (await (await fetch('/v2/account')).json()) as {
      providers: string[];
      account: { id: string; name: string } | null;
    };
  const send = (path: string, method: string, body?: unknown) =>
    fetch(path, {
      method,
      headers: {
        Origin: ORIGIN,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { fetch, signIn, me, send, cookies };
};

describe('accounts, through the Worker', () => {
  it('signs in, renames, signs out and deletes with real objects', async () => {
    const tab = browser();
    expect(await tab.me()).toEqual({ providers: ['test'], account: null });
    expect(await tab.signIn('Runtime Dawn')).toBe('signed_in');
    expect([...tab.cookies.keys()]).toEqual(['__Host-ptcgsim-session']);
    const { account } = await tab.me();
    expect(account?.name).toBe('Runtime Dawn');

    expect(
      (await tab.send('/v2/account', 'PATCH', { name: 'Dawn' })).status
    ).toBe(200);
    const second = browser();
    await second.signIn('Runtime Dawn');
    expect((await second.me()).account).toMatchObject({
      id: account?.id,
      name: 'Dawn',
    });

    expect((await tab.send('/v2/account/sign-out', 'POST')).status).toBe(204);
    expect((await tab.me()).account).toBeNull();

    expect(
      (
        await second.send('/v2/account', 'DELETE', {
          expectedAccountId: account?.id,
        })
      ).status
    ).toBe(204);
    const again = browser();
    await again.signIn('Runtime Dawn');
    expect((await again.me()).account?.id).not.toBe(account?.id);
    // A dozen round trips through four objects: room for a loaded machine.
  }, 30_000);

  it('never serves the stand-in where it is off', async () => {
    const response = await exports.default.fetch(
      new Request(`${ORIGIN}/v2/auth/google/start`)
    );
    expect(await response.text()).toContain('data-result="unavailable"');
  });
});
