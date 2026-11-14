import { exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { WireGameCommand } from '@ptcgsim/protocol';

import {
  RUNTIME_ORIGIN,
  commandFrame,
  createRoom,
  helloFrame,
  issuePlayerTicket,
  nextServerFrames,
  roomStub,
  type RuntimeWelcome,
} from './runtime-harness.js';

/** One browser's cookies, as in account-runtime.test.ts. */
const browser = () => {
  const cookies = new Map<string, string>();
  const cookieHeader = () =>
    [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const fetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) headers.set('Cookie', cookieHeader());
    const response = await exports.default.fetch(
      new Request(`${RUNTIME_ORIGIN}${path}`, {
        ...init,
        headers,
        redirect: 'manual',
      })
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
    const authorize = new URL(start.headers.get('Location') ?? '');
    const state = authorize.searchParams.get('state') ?? '';
    const finish = await fetch(
      `/v2/auth/test/callback?state=${state}&code=${encodeURIComponent(name)}`
    );
    return /data-result="([a-z_]+)"/u.exec(await finish.text())?.[1];
  };
  const send = (path: string, method: string, body?: unknown) =>
    fetch(path, {
      method,
      headers: {
        Origin: RUNTIME_ORIGIN,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { fetch, signIn, send, cookieHeader };
};

const deck = Array.from({ length: 60 }, (_, index) => ({
  definition: {
    id: `replay-definition-${String(index).padStart(3, '0')}`,
    name: `Replay card ${String(index)}`,
    category: (['Pokémon', 'Trainer', 'Energy'] as const)[index % 3]!,
    imageUrl: `https://assets.example/replay/${String(index)}.webp`,
  },
  count: 1,
}));

interface ReplayListing {
  readonly id: string;
  readonly moves: number;
  readonly parts: number;
  readonly players: readonly string[];
  readonly viewer: string;
  readonly starred: boolean;
  readonly shareLink?: string;
}

interface ReplayPart {
  readonly part: number;
  readonly parts: number;
  readonly replay: {
    readonly viewer: { readonly kind: string; readonly playerId?: string };
    readonly startRevision: number;
    readonly endRevision: number;
    readonly frames: readonly { readonly snapshot: unknown }[];
  };
}

describe('replays kept in the account, through the Worker', () => {
  it('files a signed-in Solo game when it is reset, and shows it by part', async () => {
    const tab = browser();
    expect(await tab.signIn('Replay Runtime Iris')).toBe('signed_in');

    const created = await createRoom('solo');
    const ticket = await issuePlayerTicket(created, 'one', 'Iris');
    const upgrade = await exports.default.fetch(
      new Request(`${RUNTIME_ORIGIN}/v2/rooms/${created.roomCode}/connect`, {
        headers: {
          Origin: RUNTIME_ORIGIN,
          Upgrade: 'websocket',
          Cookie: tab.cookieHeader(),
        },
      })
    );
    expect(upgrade.status).toBe(101);
    const socket = upgrade.webSocket!;
    socket.accept();
    const welcomed = nextServerFrames(socket, 1);
    socket.send(helloFrame(created, ticket, 'Iris'));
    const welcome = (await welcomed)[0]!.message as RuntimeWelcome;
    expect(welcome.type).toBe('Welcome');

    let sequence = welcome.nextClientSequence;
    let revision = welcome.snapshot.revision;
    let serial = 0;
    const run = async (command: WireGameCommand) => {
      serial += 1;
      const frames = nextServerFrames(socket, 2, { ignorePresence: true });
      socket.send(
        commandFrame(welcome, sequence, revision, `replay-${String(serial)}`, command)
      );
      const answer = (await frames).find(
        (frame) => frame.message.type === 'CommandResult'
      )?.message;
      expect(answer).toMatchObject({ accepted: true });
      sequence += 1;
      revision = (answer as { revision: number }).revision;
    };

    await run({ type: 'LoadDeck', entries: deck } as WireGameCommand);
    await run({ type: 'SetupPlayer' } as WireGameCommand);
    // Past the history's 128 moves: the oldest are dropped in a block and
    // kept for the game's record.
    for (let flip = 0; flip < 140; flip += 1) {
      await run({ type: 'FlipCoin' } as WireGameCommand);
    }
    const archived = await runInDurableObject(
      roomStub(created),
      async (_instance, state) =>
        [...(await state.storage.list({ prefix: 'replay-archive:' })).keys()]
    );
    // The base the kept moves start from, and one block of them.
    expect(archived.length).toBe(2);

    await run({ type: 'ResetPlayer' } as WireGameCommand);

    const listed = (await (await tab.fetch('/v2/account/replays')).json()) as {
      replays: ReplayListing[];
    };
    expect(listed.replays).toHaveLength(1);
    const [game] = listed.replays;
    // The deck loaded, set up and 140 flips; the reset starts the next.
    expect(game).toMatchObject({ parts: 2, starred: false });
    expect(game!.moves).toBeGreaterThanOrEqual(142);
    expect(game!.moves).toBeLessThan(150);
    expect(game!.players[0]).toBe('Iris');

    // The game's own blocks went once it was filed.
    const left = await runInDurableObject(
      roomStub(created),
      async (_instance, state) =>
        (await state.storage.list({ prefix: 'replay-archive:' })).size
    );
    expect(left).toBe(0);

    const first = (await (
      await tab.fetch(`/v2/account/replays/${game!.id}/parts/0`)
    ).json()) as ReplayPart;
    expect(first.parts).toBe(2);
    expect(first.replay.viewer).toEqual({
      kind: 'player',
      playerId: game!.viewer,
    });
    expect(first.replay.frames).toHaveLength(129);
    const second = (await (
      await tab.fetch(`/v2/account/replays/${game!.id}/parts/1`)
    ).json()) as ReplayPart;
    expect(second.replay.frames).toHaveLength(game!.moves - 128 + 1);
    expect(second.replay.startRevision).toBe(first.replay.endRevision);
    expect(
      (await tab.fetch(`/v2/account/replays/${game!.id}/parts/2`)).status
    ).toBe(404);

    expect(
      (
        await tab.send(`/v2/account/replays/${game!.id}`, 'PATCH', {
          starred: true,
        })
      ).status
    ).toBe(200);
    const shared = (await (
      await tab.send(`/v2/account/replays/${game!.id}/share`, 'POST')
    ).json()) as { shareLink: string };
    const token = new URL(shared.shareLink, RUNTIME_ORIGIN).hash.slice(
      '#replay='.length
    );
    const [accountId, replayId, secret] = token.split('.');
    // Nobody signed in: the share link's spectator view.
    const watched = await exports.default.fetch(
      new Request(
        `${RUNTIME_ORIGIN}/v2/replays/${accountId}/${replayId}/${secret}/parts/0`
      )
    );
    expect(watched.status).toBe(200);
    expect(((await watched.json()) as ReplayPart).replay.viewer).toEqual({
      kind: 'spectator',
    });
    const wrong = await exports.default.fetch(
      new Request(
        `${RUNTIME_ORIGIN}/v2/replays/${accountId}/${replayId}/${'A'.repeat(22)}/parts/0`
      )
    );
    expect(wrong.status).toBe(404);

    socket.close(1000, 'done');
    const record = await runInDurableObject(
      env.PTCG_ACCOUNT.getByName(accountId!),
      async (_instance, state) =>
        state.storage.sql
          .exec('SELECT LENGTH(body) AS bytes, starred FROM replay')
          .toArray()
    );
    expect(record).toEqual([{ bytes: expect.any(Number), starred: 1 }]);
  }, 120_000);

  it('files nothing for a cookie whose session the account never made', async () => {
    const tab = browser();
    expect(await tab.signIn('Replay Runtime Forged')).toBe('signed_in');
    const accountId = tab.cookieHeader().split('=')[1]!.split('.')[0]!;
    const created = await createRoom('solo');
    const ticket = await issuePlayerTicket(created, 'one', 'Forger');
    const upgrade = await exports.default.fetch(
      new Request(`${RUNTIME_ORIGIN}/v2/rooms/${created.roomCode}/connect`, {
        headers: {
          Origin: RUNTIME_ORIGIN,
          Upgrade: 'websocket',
          // That account's id, with a secret it never gave out.
          Cookie: `__Host-ptcgsim-session=${accountId}.${'f'.repeat(43)}`,
        },
      })
    );
    const socket = upgrade.webSocket!;
    socket.accept();
    const welcomed = nextServerFrames(socket, 1);
    socket.send(helloFrame(created, ticket, 'Forger'));
    const welcome = (await welcomed)[0]!.message as RuntimeWelcome;
    let sequence = welcome.nextClientSequence;
    let revision = welcome.snapshot.revision;
    const run = async (command: WireGameCommand, id: string) => {
      const frames = nextServerFrames(socket, 2, { ignorePresence: true });
      socket.send(commandFrame(welcome, sequence, revision, id, command));
      const answer = (await frames).find(
        (frame) => frame.message.type === 'CommandResult'
      )?.message as { accepted: boolean; revision: number };
      expect(answer.accepted).toBe(true);
      sequence += 1;
      revision = answer.revision;
    };
    await run({ type: 'LoadDeck', entries: deck } as WireGameCommand, 'f-load');
    await run({ type: 'SetupPlayer' } as WireGameCommand, 'f-setup');
    for (let flip = 0; flip < 6; flip += 1) {
      await run({ type: 'FlipCoin' } as WireGameCommand, `f-flip-${String(flip)}`);
    }
    await run({ type: 'ResetPlayer' } as WireGameCommand, 'f-reset');
    socket.close(1000, 'done');
    const listed = (await (await tab.fetch('/v2/account/replays')).json()) as {
      replays: unknown[];
    };
    expect(listed.replays).toEqual([]);
  }, 60_000);
});
