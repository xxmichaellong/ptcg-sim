import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://play.example';

/** One browser's cookies, signed in through the stand-in provider. */
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
  const signIn = async (name: string): Promise<string> => {
    const start = await fetch('/v2/auth/test/start?display=popup');
    const authorize = new URL(start.headers.get('Location') ?? '');
    const state = authorize.searchParams.get('state') ?? '';
    await fetch(
      `/v2/auth/test/callback?state=${state}&code=${encodeURIComponent(name)}`
    );
    const me = (await (await fetch('/v2/account')).json()) as {
      account: { id: string } | null;
    };
    if (!me.account) throw new Error('not signed in');
    return me.account.id;
  };
  const friends = async () =>
    (
      (await (await fetch('/v2/friends')).json()) as {
        friends: {
          friends: { id: string; name: string }[];
          incoming: { id: string; name: string }[];
          outgoing: { id: string; name: string }[];
          blocked: { id: string }[];
        };
      }
    ).friends;
  const act = async (id: string, action: string) =>
    (await (
      await fetch(`/v2/friends/${id}`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    ).json()) as { outcome: string; name?: string };
  return { fetch, signIn, friends, act };
};

const someone = (name: string) =>
  `${name} ${Math.random().toString(36).slice(2, 7)}`;

describe('friends, through the Worker', () => {
  it('befriends, renames, blocks and deletes with real objects', async () => {
    const dawn = browser();
    const may = browser();
    const dawnId = await dawn.signIn(someone('Dawn'));
    const mayId = await may.signIn(someone('May'));

    const lookup = await dawn.fetch(`/v2/players/${mayId}`);
    expect(((await lookup.json()) as { player: { id: string } }).player.id).toBe(
      mayId
    );

    expect((await dawn.act(mayId, 'request')).outcome).toBe('sent');
    expect((await may.friends()).incoming.map((entry) => entry.id)).toEqual([
      dawnId,
    ]);
    expect((await may.act(dawnId, 'accept')).outcome).toBe('friends');
    expect((await dawn.friends()).friends.map((entry) => entry.id)).toEqual([
      mayId,
    ]);

    // A rename reaches the friend's list.
    await may.fetch('/v2/account', {
      method: 'PATCH',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'May Maple' }),
    });
    expect((await dawn.friends()).friends[0]?.name).toBe('May Maple');

    // A block ends it on both sides, unseen.
    expect((await may.act(dawnId, 'block')).outcome).toBe('blocked');
    expect((await dawn.friends()).friends).toEqual([]);
    // One request a second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await dawn.act(mayId, 'request')).outcome).toBe('sent');
    expect((await may.friends()).incoming).toEqual([]);

    // Deleting an account takes it off every list.
    await may.act(dawnId, 'unblock');
    expect((await may.act(dawnId, 'accept')).outcome).toBe('gone');
    expect((await may.act(dawnId, 'request')).outcome).toBe('friends');
    await dawn.fetch('/v2/account', {
      method: 'DELETE',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedAccountId: dawnId }),
    });
    expect((await may.friends()).friends).toEqual([]);
  }, 30_000);
});
