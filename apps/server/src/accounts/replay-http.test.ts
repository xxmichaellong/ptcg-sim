import { describe, expect, it } from 'vitest';

import {
  handleReplayRequest,
  replayRoute,
  type ReplayAccountObject,
  type ReplayHttpDependencies,
} from './replay-http.js';

const ORIGIN = 'https://play.example';
const ACCOUNT = 'a_AAAAAAAAAAAAAAAA';
const REPLAY = 'R'.repeat(22);
const SECRET = 'S'.repeat(22);
const COOKIE = `__Host-ptcgsim-session=${ACCOUNT}.${'x'.repeat(43)}`;

const listing = {
  id: REPLAY,
  filedAt: 5,
  moves: 10,
  parts: 1,
  players: ['Iris', 'Cyrus'],
  playerOrder: ['player-one', 'player-two'],
  viewer: 'player-one',
  mode: 'solo' as const,
  truncated: false,
  starred: false,
  share: SECRET,
};

const part = {
  format: 'ptcgsim-account-replay-part-v1' as const,
  part: 0,
  parts: 1,
  replay: {
    replayId: 'account-x-0',
    viewer: { kind: 'spectator' as const },
    startRevision: 0,
    endRevision: 0,
    truncated: false,
    frames: [],
  },
};

const fake = (signedIn = true) => {
  const calls: string[] = [];
  const object: ReplayAccountObject = {
    listReplays: async () => (signedIn ? [listing] : null),
    starReplay: async (_hash, _now, _id, starred) => {
      calls.push(`star:${String(starred)}`);
      return signedIn ? (starred ? 'star_limit' : 'unstarred') : null;
    },
    deleteReplay: async () => (signedIn ? true : null),
    shareReplay: async (_hash, _now, _id, shared) =>
      signedIn ? { found: true, ...(shared ? { secret: SECRET } : {}) } : null,
    replayPart: async () => (signedIn ? part : null),
    sharedReplayPart: async (_id, secret) =>
      secret === SECRET ? part : 'missing',
  };
  const dependencies: ReplayHttpDependencies = {
    account: () => object,
    now: () => 10,
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 60 }),
  };
  return { dependencies, calls };
};

const request = (
  path: string,
  init: RequestInit & { readonly cookie?: boolean } = {}
) => {
  const headers = new Headers(init.headers);
  if (init.cookie !== false) headers.set('Cookie', COOKIE);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};

const handle = (req: Request, dependencies: ReplayHttpDependencies) => {
  const route = replayRoute(new URL(req.url).pathname);
  if (!route) throw new Error('no route');
  return handleReplayRequest(req, route, dependencies);
};

describe('replay routes', () => {
  it('matches only well-formed paths', () => {
    expect(replayRoute('/v2/account/replays')).toEqual({ kind: 'list' });
    expect(replayRoute(`/v2/account/replays/${REPLAY}/parts/2`)).toEqual({
      kind: 'part',
      id: REPLAY,
      part: 2,
    });
    expect(replayRoute(`/v2/account/replays/${REPLAY}/parts/02`)).toBeUndefined();
    expect(replayRoute(`/v2/account/replays/${REPLAY}/parts/65`)).toBeUndefined();
    expect(replayRoute(`/v2/account/replays/short`)).toBeUndefined();
    expect(
      replayRoute(`/v2/replays/${ACCOUNT}/${REPLAY}/${SECRET}/parts/0`)
    ).toMatchObject({ kind: 'shared_part', accountId: ACCOUNT });
    expect(
      replayRoute(`/v2/replays/nobody/${REPLAY}/${SECRET}/parts/0`)
    ).toBeUndefined();
  });

  it('lists with each shared game’s link, and refuses another site', async () => {
    const { dependencies } = fake();
    const listed = await handle(request('/v2/account/replays'), dependencies);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { replays: unknown[] };
    expect(body.replays).toEqual([
      expect.objectContaining({
        id: REPLAY,
        shareLink: `/#replay=${ACCOUNT}.${REPLAY}.${SECRET}`,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('"share"');
    const crossSite = await handle(
      request('/v2/account/replays', {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      }),
      dependencies
    );
    expect(crossSite.status).toBe(403);
  });

  it('answers signed out without a session, or one that ended', async () => {
    expect(
      (
        await handle(
          request('/v2/account/replays', { cookie: false }),
          fake().dependencies
        )
      ).status
    ).toBe(401);
    expect(
      (await handle(request('/v2/account/replays'), fake(false).dependencies))
        .status
    ).toBe(401);
  });

  it('stars only from this origin, and says when 50 are starred', async () => {
    const { dependencies, calls } = fake();
    const star = (origin: string | undefined) =>
      handle(
        request(`/v2/account/replays/${REPLAY}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(origin ? { Origin: origin } : {}),
          },
          body: JSON.stringify({ starred: true }),
        }),
        dependencies
      );
    expect((await star('https://elsewhere.example')).status).toBe(403);
    expect((await star(undefined)).status).toBe(403);
    expect(calls).toEqual([]);
    const limited = await star(ORIGIN);
    expect(limited.status).toBe(409);
    expect(await limited.json()).toEqual({ error: 'star_limit' });
  });

  it('opens a shared game for anyone with its link, and nothing without it', async () => {
    const { dependencies } = fake();
    const opened = await handle(
      request(`/v2/replays/${ACCOUNT}/${REPLAY}/${SECRET}/parts/0`, {
        cookie: false,
      }),
      dependencies
    );
    expect(opened.status).toBe(200);
    const refused = await handle(
      request(`/v2/replays/${ACCOUNT}/${REPLAY}/${'T'.repeat(22)}/parts/0`, {
        cookie: false,
      }),
      dependencies
    );
    expect(refused.status).toBe(404);
    const posted = await handle(
      request(`/v2/replays/${ACCOUNT}/${REPLAY}/${SECRET}/parts/0`, {
        method: 'POST',
        headers: { Origin: ORIGIN },
      }),
      dependencies
    );
    expect(posted.status).toBe(405);
  });

  it('shares with a link to the app, and unshares', async () => {
    const { dependencies } = fake();
    const shared = await handle(
      request(`/v2/account/replays/${REPLAY}/share`, {
        method: 'POST',
        headers: { Origin: ORIGIN },
      }),
      dependencies
    );
    expect(await shared.json()).toEqual({
      shareLink: `/#replay=${ACCOUNT}.${REPLAY}.${SECRET}`,
    });
    const unshared = await handle(
      request(`/v2/account/replays/${REPLAY}/share`, {
        method: 'DELETE',
        headers: { Origin: ORIGIN },
      }),
      dependencies
    );
    expect(unshared.status).toBe(204);
  });
});
