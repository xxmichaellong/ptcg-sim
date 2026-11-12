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
  /** The tab's live line: messages as they come, and a way to wait for one. */
  const live = async () => {
    const response = await fetch('/v2/account/live', {
      headers: { Upgrade: 'websocket', Origin: ORIGIN },
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(`no socket: ${String(response.status)}`);
    socket.accept();
    const messages: unknown[] = [];
    const waiting: {
      readonly test: (message: unknown) => boolean;
      readonly resolve: (message: unknown) => void;
    }[] = [];
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      const message: unknown = JSON.parse(event.data);
      messages.push(message);
      for (const waiter of [...waiting]) {
        if (waiter.test(message)) {
          waiting.splice(waiting.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    const next = (test: (message: unknown) => boolean) =>
      new Promise<unknown>((resolve, reject) => {
        const found = messages.find(test);
        if (found) {
          messages.splice(messages.indexOf(found), 1);
          resolve(found);
          return;
        }
        waiting.push({ test, resolve });
        setTimeout(
          () =>
            reject(
              new Error(`no such message; had ${JSON.stringify(messages)}`)
            ),
          5000
        );
      });
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    return { socket, next, send };
  };
  return { fetch, signIn, friends, act, live };
};

const presenceOf =
  (id: string, state: string) =>
  (message: unknown): boolean => {
    const value = message as {
      type?: string;
      id?: string;
      view?: { state?: string };
      friends?: Record<string, { state?: string }>;
    };
    return (
      value.type === 'presence' &&
      (value.id === id
        ? value.view?.state === state
        : value.friends?.[id]?.state === state)
    );
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

  it('tells friends who is online, in a game and gone, over live lines', async () => {
    const dawn = browser();
    const may = browser();
    const dawnId = await dawn.signIn(someone('Dawn'));
    const mayId = await may.signIn(someone('May'));
    await dawn.act(mayId, 'request');
    await may.act(dawnId, 'accept');

    const dawnTab = await dawn.live();
    dawnTab.send({ type: 'hello', where: { kind: 'none' } });
    await dawnTab.next(presenceOf(mayId, 'offline'));

    const mayTab = await may.live();
    mayTab.send({ type: 'hello', where: { kind: 'none' } });
    // May hears Dawn is online; Dawn hears May came online.
    await mayTab.next(presenceOf(dawnId, 'online'));
    await dawnTab.next(presenceOf(mayId, 'online'));

    // In a game: the room's code comes with it, to join through.
    mayTab.send({
      type: 'where',
      where: { kind: 'room', role: 'player', room: 'K7PQ' },
    });
    const playing = (await dawnTab.next(presenceOf(mayId, 'playing'))) as {
      view: { room?: string };
    };
    expect(playing.view.room).toBe('K7PQ');

    // Appear offline: Dawn sees May offline though her tab is open.
    await may.fetch('/v2/friends/settings', {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appearOffline: true }),
    });
    await dawnTab.next(presenceOf(mayId, 'offline'));
    const listed = (await (await dawn.fetch('/v2/friends')).json()) as {
      friends: { presence: Record<string, { state: string }> };
    };
    expect(listed.friends.presence[mayId]?.state).toBe('offline');

    // Dawn closing her tab tells May.
    dawnTab.socket.close(1000, 'bye');
    await mayTab.next(presenceOf(dawnId, 'offline'));
    mayTab.socket.close(1000, 'bye');
  }, 30_000);
});
