import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createRoom, issuePlayerTicket, helloFrame, admissionHelloFrame, nextServerFrames } from './runtime-harness.js';

const ORIGIN = 'https://play.example';
let nextBrowserAddress = 1;

/** Wait for the room's disconnect/filing work before tearing down its Worker. */
const closeSocket = async (socket: WebSocket): Promise<void> => {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) =>
    socket.addEventListener('close', () => resolve(), { once: true })
  );
  socket.close(1000, 'done');
  await closed;
};

/** One browser's cookies, signed in through the stand-in provider. */
const browser = () => {
  const address = `198.51.100.${nextBrowserAddress++}`;
  const cookies = new Map<string, string>();
  const fetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('CF-Connecting-IP', address);
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

const hostRoom = async (tab: ReturnType<typeof browser>) => {
  const created = await createRoom();
  const ticket = await issuePlayerTicket(created, 'one', 'Friend');
  const upgrade = await tab.fetch(`/v2/rooms/${created.roomCode}/connect`, {headers:{Origin:ORIGIN,Upgrade:'websocket'}});
  const socket = upgrade.webSocket!;
  socket.accept();
  const welcome = nextServerFrames(socket, 1);
  socket.send(helloFrame(created, ticket, 'Friend'));
  await welcome;
  const response = await tab.fetch(`/v2/rooms/${created.roomCode}/code`, {
    method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({resumeToken:ticket.resumeToken})
  });
  expect(response.status).toBe(200);
  const {code} = await response.json() as {code:string};
  return {code,socket,created,ticket};
};

describe('friends, through the Worker', () => {
  it('revokes only the signed-out session’s live connections', async () => {
    const first = browser();
    const second = browser();
    const name = someone('Session');
    await first.signIn(name);
    await second.signIn(name);
    const old = await first.live();
    const kept = await second.live();
    const closed = new Promise<number>((resolve) => old.socket.addEventListener('close', (event) => resolve(event.code)));
    const response = await first.fetch('/v2/account/sign-out', {method:'POST',headers:{Origin:ORIGIN}});
    expect(response.status).toBe(204);
    expect((await first.fetch('/v2/friends')).status).toBe(401);
    expect(await closed).toBe(1008);
    kept.send({type:'hello',where:{kind:'none'}});
    expect(await kept.next((value) => (value as {type?:string}).type === 'presence')).toBeTruthy();
    await closeSocket(kept.socket);
  }, 10000);

  it('closes expired sessions before sending a friend’s private presence', async () => {
    const tab = browser();
    const id = await tab.signIn(someone('Expiry'));
    const live = await tab.live();
    live.send({type:'hello',where:{kind:'none'}});
    await live.next((value) => (value as {type?:string}).type === 'presence');
    const closed = new Promise<number>((resolve) => live.socket.addEventListener('close', (event) => resolve(event.code)));
    await runInDurableObject(env.PTCG_ACCOUNT.getByName(id), async (_instance, state) => {
      state.storage.sql.exec('UPDATE session SET expires = ?', Date.now()-1);
    });
    // A malformed or ordinary message must not revive the expired session.
    live.send({type:'hello',where:{kind:'none'}});
    expect(await closed).toBe(1008);
    expect(await env.PTCG_ACCOUNT.getByName(id).isLive()).toBe(false);
  }, 10000);

  it('does not publish a room claimed by an unadmitted client', async () => {
    const host = browser();
    const guest = browser();
    const hostId = await host.signIn(someone('Actual host'));
    const guestId = await guest.signIn(someone('Not admitted'));
    await guest.act(hostId, 'request');
    await host.act(guestId, 'accept');
    const hosted = await hostRoom(host);
    const live = await guest.live();
    live.send({type:'hello',where:{kind:'room',role:'player',room:hosted.code}});
    await live.next((value) => (value as {type?:string}).type === 'presence');
    const listed = await (await host.fetch('/v2/friends')).json() as {friends:{presence:Record<string,{state:string;room?:string}>}};
    expect(listed.friends.presence[guestId]).toEqual({state:'online'});
    await closeSocket(live.socket);
    await closeSocket(hosted.socket);
  }, 10000);

  it('verifies spectators without letting them advertise a player seat', async () => {
    const host = browser();
    const hosted = await hostRoom(host);
    const viewer = browser();
    const id = await viewer.signIn(someone('Watcher'));
    const response = await viewer.fetch('/v2/join', {method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({code:hosted.code,requestedRole:'spectator',displayName:'Watcher'})});
    expect(response.status).toBe(201);
    const ticket = await response.json() as {admissionTicket:string;resumeToken:string;expiresAt:number};
    const upgrade = await viewer.fetch(`/v2/rooms/${hosted.created.roomCode}/connect`, {headers:{Origin:ORIGIN,Upgrade:'websocket'}});
    const socket = upgrade.webSocket!;
    socket.accept();
    const welcomed = nextServerFrames(socket,1);
    socket.send(admissionHelloFrame(hosted.created,ticket,{requestedRole:'spectator',displayName:'Watcher'}));
    await welcomed;
    const room = env.PTCG_ROOM.getByName(hosted.created.roomCode);
    expect(await room.hasAccountPresence(id,hosted.code,'spectator')).toBe(true);
    expect(await room.hasAccountPresence(id,hosted.code,'player')).toBe(false);
    await closeSocket(socket);
    await closeSocket(hosted.socket);
  }, 10000);

  it('rejects another account’s room and a forged player role, and binds a later sign-in', async () => {
    const guest = browser();
    const hosted = await hostRoom(guest);
    const id = await guest.signIn(someone('Late sign-in'));
    const room = env.PTCG_ROOM.getByName(hosted.created.roomCode);
    expect(await room.hasAccountPresence(id, hosted.code, 'player')).toBe(false);
    const bound = await guest.fetch(`/v2/rooms/${hosted.created.roomCode}/account`, {
      method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
      body:JSON.stringify({resumeToken:hosted.ticket.resumeToken})
    });
    expect(bound.status).toBe(204);
    expect(await room.hasAccountPresence(id, hosted.code, 'player')).toBe(true);
    expect(await room.hasAccountPresence(id, hosted.code, 'spectator')).toBe(false);
    const intruder = browser();
    const other = await intruder.signIn(someone('Not in room'));
    await intruder.act(id, 'request');
    await guest.act(other, 'accept');
    const live = await intruder.live();
    live.send({type:'hello',where:{kind:'room',role:'player',room:hosted.code}});
    await live.next((value) => (value as {type?:string}).type === 'presence');
    const listed = await (await guest.fetch('/v2/friends')).json() as {friends:{presence:Record<string,{state:string;room?:string}>}};
    expect(listed.friends.presence[other]).toEqual({state:'online'});
    const invite = await intruder.fetch(`/v2/friends/${id}/invite`, {method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({kind:'invite'})});
    expect(await invite.json()).toEqual({outcome:'not_in_room'});
    await closeSocket(live.socket);
    await closeSocket(hosted.socket);
    await expect.poll(() => room.hasAccountPresence(id, hosted.code, 'player')).toBe(false);
  }, 10000);

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
    const hosted = await hostRoom(may);
    mayTab.send({
      type: 'where',
      where: { kind: 'room', role: 'player', room: hosted.code },
    });
    const playing = (await dawnTab.next(presenceOf(mayId, 'playing'))) as {
      view: { room?: string };
    };
    expect(playing.view.room).toBe(hosted.code);

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
    await closeSocket(dawnTab.socket);
    await mayTab.next(presenceOf(dawnId, 'offline'));
    await closeSocket(mayTab.socket);
    await closeSocket(hosted.socket);
  }, 30_000);

  it('invites to the room its tab plays in, and asks, over live lines', async () => {
    const dawn = browser();
    const may = browser();
    const dawnId = await dawn.signIn(someone('Dawn'));
    const mayId = await may.signIn(someone('May'));
    await dawn.act(mayId, 'request');
    await may.act(dawnId, 'accept');
    const invite = (from: ReturnType<typeof browser>, id: string, body: unknown) =>
      from
        .fetch(`/v2/friends/${id}/invite`, {
          method: 'POST',
          headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        .then(async (response) => ((await response.json()) as { outcome: string }).outcome);

    const hosted = await hostRoom(dawn);
    // No tab of May's open: she can't be invited.
    const dawnTab = await dawn.live();
    dawnTab.send({
      type: 'hello',
      where: { kind: 'room', role: 'player', room: hosted.code },
    });
    await dawnTab.next(presenceOf(mayId, 'offline'));
    expect(await invite(dawn, mayId, { kind: 'invite' })).toBe('offline');

    const mayTab = await may.live();
    mayTab.send({ type: 'hello', where: { kind: 'none' } });
    await mayTab.next(presenceOf(dawnId, 'playing'));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await invite(dawn, mayId, { kind: 'invite' })).toBe('sent');
    const received = (await mayTab.next(
      (message) => (message as { type?: string }).type === 'invite'
    )) as { from: { id: string }; room: string; expiresAt: number };
    expect(received.from.id).toBe(dawnId);
    // The room is Dawn's, as her tab said: never one the request names.
    expect(received.room).toBe(hosted.code);

    // May isn't in a room to invite to; she can ask to join instead.
    expect(await invite(may, dawnId, { kind: 'invite' })).toBe('not_in_room');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await invite(may, dawnId, { kind: 'ask' })).toBe('sent');
    const ask = (await dawnTab.next(
      (message) => (message as { type?: string }).type === 'ask'
    )) as { from: { id: string } };
    expect(ask.from.id).toBe(mayId);
    await closeSocket(dawnTab.socket);
    await closeSocket(mayTab.socket);
    await closeSocket(hosted.socket);
  }, 30_000);
});
