import { describe, expect, it } from 'vitest';

import type { FriendsView } from './account-friends.js';
import {
  formatSessionToken,
  newSessionToken,
  sha256Hex,
} from './account-session.js';
import {
  friendsRoute,
  handleFriendsRequest,
  type FriendsAccountObject,
  type FriendsHttpDependencies,
} from './friends-http.js';

const ORIGIN = 'https://play.example';
const DAWN = 'a_dawn000000000000';
const MAY = 'a_may0000000000000';

const EMPTY: FriendsView = {
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  recent: [],
  appearOffline: false,
};

const setup = async () => {
  const token = newSessionToken(DAWN);
  const secretHash = await sha256Hex(token.secret);
  const changes: string[] = [];
  const dawn: FriendsAccountObject = {
    friends: async (hash) => (hash === secretHash ? EMPTY : null),
    changeFriend: async (hash, _now, other, action) => {
      if (hash !== secretHash) return null;
      changes.push(`${action}:${other}`);
      return { answer: { outcome: 'sent', name: 'May' }, friends: EMPTY };
    },
    publicProfile: async () => ({ id: DAWN, name: 'Dawn', avatar: 'initials' }),
  };
  const may: FriendsAccountObject = {
    ...dawn,
    publicProfile: async () => ({ id: MAY, name: 'May', avatar: 'initials' }),
  };
  let allowed = true;
  const dependencies: FriendsHttpDependencies = {
    account: (id) =>
      id === DAWN
        ? dawn
        : id === MAY
          ? may
          : { ...dawn, publicProfile: async () => null },
    now: () => 1,
    rateLimit: async () =>
      allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 9 },
  };
  const cookie = `__Host-ptcgsim-session=${formatSessionToken(token)}`;
  const send = (
    path: string,
    init: RequestInit & { readonly signedIn?: boolean } = {}
  ) => {
    const route = friendsRoute(new URL(path, ORIGIN).pathname);
    if (!route) throw new Error(`no route for ${path}`);
    const headers = new Headers(init.headers);
    if (init.signedIn !== false) headers.set('Cookie', cookie);
    return handleFriendsRequest(
      new Request(`${ORIGIN}${path}`, { ...init, headers }),
      route,
      dependencies
    );
  };
  return {
    send,
    changes,
    limit: (value: boolean) => {
      allowed = value;
    },
  };
};

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('friends over HTTP', () => {
  it('routes only well-formed ids', () => {
    expect(friendsRoute('/v2/friends')).toEqual({ kind: 'friends' });
    expect(friendsRoute(`/v2/friends/${MAY}`)).toEqual({ kind: 'friend', id: MAY });
    expect(friendsRoute(`/v2/players/${MAY}`)).toEqual({ kind: 'player', id: MAY });
    expect(friendsRoute('/v2/friends/a_short')).toBeUndefined();
    expect(friendsRoute('/v2/players/../account')).toBeUndefined();
  });

  it('lists, looks up and changes for the signed-in player', async () => {
    const { send, changes } = await setup();
    const list = await send('/v2/friends');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ friends: EMPTY });
    const player = await send(`/v2/players/${MAY}`);
    expect(await player.json()).toEqual({
      player: { id: MAY, name: 'May', avatar: 'initials' },
    });
    expect((await send('/v2/players/a_nobody0000000000')).status).toBe(404);
    const change = await send(`/v2/friends/${MAY}`, post({ action: 'request' }));
    expect(change.status).toBe(200);
    expect(await change.json()).toEqual({
      outcome: 'sent',
      name: 'May',
      friends: EMPTY,
    });
    expect(changes).toEqual([`request:${MAY}`]);
  });

  it('refuses the signed out, other sites, odd actions and floods', async () => {
    const { send, changes, limit } = await setup();
    expect((await send('/v2/friends', { signedIn: false })).status).toBe(401);
    expect(
      (
        await send('/v2/friends', {
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await send(`/v2/friends/${MAY}`, {
          ...post({ action: 'request' }),
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
          },
        })
      ).status
    ).toBe(403);
    expect((await send(`/v2/friends/${MAY}`, post({ action: 'hug' }))).status).toBe(
      400
    );
    expect((await send(`/v2/friends/${MAY}`, { method: 'DELETE' })).status).toBe(
      405
    );
    limit(false);
    const limited = await send('/v2/friends');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');
    expect(changes).toEqual([]);
  });
});
