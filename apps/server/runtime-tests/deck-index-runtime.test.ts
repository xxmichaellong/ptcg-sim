import { env, exports } from 'cloudflare:workers';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListedTournament } from '../src/deck-index/parse.js';
import { DeckIndexStore, type SqlValue } from '../src/deck-index/store.js';

const DAY = 24 * 60 * 60 * 1000;
const TOURNAMENT = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const indexStub = () => env.PTCG_DECK_INDEX.getByName('index');

const list = (main: string) => ({
  pokemon: [{ count: 4, name: main, set: 'TWM', number: '128' }],
  trainer: [],
  energy: [{ count: 56, name: 'Psychic Energy', set: 'MEE', number: '13' }],
});

/** One finished 200-player event, won by Dragapult. */
const limitlessRoutes = (): Record<string, unknown> => ({
  '/api/tournaments': [
    {
      id: TOURNAMENT,
      game: 'PTCG',
      format: 'STANDARD',
      name: 'Weekly Pokémon Cup',
      date: new Date(Date.now() - 2 * DAY).toISOString(),
      players: 200,
    },
  ],
  [`/api/tournaments/${TOURNAMENT}/standings`]: [
    {
      player: 'second',
      name: 'Second',
      country: 'DE',
      placing: 2,
      record: { wins: 6, losses: 2, ties: 1 },
      deck: { id: 'gardevoir-ex', name: 'Gardevoir ex', icons: ['gardevoir'] },
      decklist: list('Ralts'),
    },
    {
      player: 'redthegoat',
      name: 'REDTHEGOAT',
      country: 'FR',
      placing: 1,
      record: { wins: 8, losses: 2, ties: 0 },
      deck: {
        id: 'dragapult-dusknoir',
        name: 'Dragapult Dusknoir',
        icons: ['dragapult', 'dusknoir'],
      },
      decklist: list('Dreepy'),
    },
  ],
});

let calls: string[] = [];
const serveLimitless = (routes: Record<string, unknown>) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== 'https://play.limitlesstcg.com') {
        throw new Error(`unexpected request to ${url.origin}`);
      }
      calls.push(url.pathname + url.search);
      const body = routes[url.pathname];
      if (body === undefined) return new Response('unknown', { status: 400 });
      return Response.json(body);
    });

const get = (path: string) =>
  exports.default.fetch(new Request(`https://play.example${path}`));

const alarmAt = () =>
  runInDurableObject(indexStub(), (_instance, state) =>
    state.storage.getAlarm()
  );

beforeEach(async () => {
  calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await runInDurableObject(indexStub(), async (_instance, state) => {
    await state.storage.deleteAlarm();
    await state.storage.deleteAll();
  });
  await evictDurableObject(indexStub());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the tournament deck index', () => {
  it('starts crawling on the first search, then answers searches, tournaments, standings and lists', async () => {
    serveLimitless(limitlessRoutes());
    const empty = await get('/v2/decks/search?q=dragapult');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ available: false });
    expect(calls).toEqual([]);
    expect(await alarmAt()).not.toBeNull();

    // The alarm's steps: the list, then the standings.
    expect(await runDurableObjectAlarm(indexStub())).toBe(true);
    expect(await runDurableObjectAlarm(indexStub())).toBe(true);
    expect(calls).toEqual([
      '/api/tournaments?game=PTCG&limit=1000&page=1',
      `/api/tournaments/${TOURNAMENT}/standings`,
    ]);
    expect(await alarmAt()).not.toBeNull();

    const search = await get('/v2/decks/search?q=Dragapult');
    expect(search.headers.get('Cache-Control')).toBe('public, max-age=300');
    const found = (await search.json()) as {
      available: boolean;
      results: { archetype: { id: string }; best: { placing: number }[] }[];
    };
    expect(found.available).toBe(true);
    expect(found.results.map((result) => result.archetype.id)).toEqual([
      'dragapult-dusknoir',
    ]);
    expect(found.results[0]!.best[0]!.placing).toBe(1);

    const tournaments = (await (
      await get('/v2/tournaments?q=pokemon%20cup')
    ).json()) as { tournaments: { id: string; hasLists: boolean }[] };
    expect(tournaments.tournaments).toEqual([
      expect.objectContaining({ id: TOURNAMENT, hasLists: true }),
    ]);

    const standings = await get(`/v2/tournaments/${TOURNAMENT}`);
    expect(standings.headers.get('Cache-Control')).toBe(
      'public, max-age=86400'
    );
    const body = (await standings.json()) as {
      standings: { player: { id: string }; placing: number }[];
    };
    expect(body.standings.map((row) => [row.player.id, row.placing])).toEqual([
      ['redthegoat', 1],
      ['second', 2],
    ]);

    const decklist = (await (
      await get(`/v2/tournaments/${TOURNAMENT}/players/redthegoat/list`)
    ).json()) as { text: string; url: string };
    expect(decklist.text).toBe(
      'Pokémon (4)\n4 Dreepy TWM 128\n\nEnergy (56)\n56 Psychic Energy MEE 13'
    );
    expect(decklist.url).toBe(
      `https://play.limitlesstcg.com/tournament/${TOURNAMENT}/player/redthegoat/decklist`
    );
    // Everything came from what was stored: no more requests.
    expect(calls).toHaveLength(2);
  });

  it('reads a tournament a player opens before the crawl gets to it', async () => {
    serveLimitless(limitlessRoutes());
    await get('/v2/tournaments');
    await runDurableObjectAlarm(indexStub());
    expect(calls).toHaveLength(1);
    const response = await get(`/v2/tournaments/${TOURNAMENT}`);
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      '/api/tournaments?game=PTCG&limit=1000&page=1',
      `/api/tournaments/${TOURNAMENT}/standings`,
    ]);
    expect((await get('/v2/tournaments/cccccccccccccccccccccccc')).status).toBe(
      404
    );
  });

  it('discovers at once when the daily cron asks', async () => {
    serveLimitless(limitlessRoutes());
    await indexStub().refresh();
    expect(await runDurableObjectAlarm(indexStub())).toBe(true);
    expect(calls).toEqual(['/api/tournaments?game=PTCG&limit=1000&page=1']);
  });

  it('refuses malformed requests before asking the index', async () => {
    serveLimitless(limitlessRoutes());
    for (const path of [
      '/v2/decks/search',
      '/v2/decks/search?q=x&page=2',
      '/v2/tournaments/123',
      '/v2/decks/archetype/Bad%20Id',
    ]) {
      expect((await get(path)).status, path).toBe(400);
    }
    const post = await exports.default.fetch(
      new Request('https://play.example/v2/tournaments', { method: 'POST' })
    );
    expect(post.status).toBe(405);
    expect(calls).toEqual([]);
    expect(await alarmAt()).toBeNull();
  });
});

describe('the rows the deck index writes', () => {
  it('writes nothing for a page of the list or standings that come round unchanged, and a few rows a player otherwise', async () => {
    const stub = env.PTCG_DECK_INDEX.getByName('rows written');
    await runInDurableObject(stub, async (_instance, state) => {
      // The Durable Object's own SQL, counting rows written as billed
      // (an index entry is a row too).
      let written = 0;
      const storage = {
        sql: {
          exec<T extends Record<string, SqlValue>>(
            query: string,
            ...bindings: SqlValue[]
          ) {
            const cursor = state.storage.sql.exec<T>(query, ...bindings);
            const rows = cursor.toArray();
            written += cursor.rowsWritten;
            return { toArray: () => rows };
          },
        },
        transaction: <T>(body: () => T): T =>
          state.storage.transactionSync(body),
      };
      const store = new DeckIndexStore(storage);
      store.migrate();
      const now = Date.now();
      const page = Array.from({ length: 1000 }, (_, n): ListedTournament => ({
        id: `c${n.toString(16).padStart(23, '0')}`,
        name: `Weekly Cup ${String(n)}`,
        date: now - DAY - n * 60_000,
        format: 'STANDARD',
        players: 32,
        organizerId: null,
        indexable: true,
      }));
      const writes = (body: () => void): number => {
        const before = written;
        body();
        return written - before;
      };
      const listed = writes(() => store.recordListed(page, now));
      expect(listed).toBeGreaterThan(1000);
      expect(writes(() => store.recordListed(page, now))).toBe(0);
      const renamed = [{ ...page[0]!, name: 'Weekly Cup, renamed' }];
      expect(writes(() => store.recordListed(renamed, now))).toBeLessThan(20);

      // A 64-player event, every list its own, eight decks.
      const entries = Array.from({ length: 64 }, (_, n) => ({
        playerId: `player-${String(n)}`,
        name: `Player ${String(n)}`,
        country: 'US',
        placing: n + 1,
        wins: 5,
        losses: 2,
        ties: 0,
        dropped: false,
        archetype: {
          id: `deck-${String(n % 8)}`,
          name: `Deck ${String(n % 8)}`,
          icons: ['dragapult'],
        },
        list: `4 Dreepy TWM 128\n56 Psychic Energy MEE 13\n# ${String(n)}`,
      }));
      const hashes = new Map(
        entries.map((entry, n) => [
          entry.list,
          n.toString(16).padStart(64, '0'),
        ])
      );
      const read = { now, etag: null, provisional: false };
      const standings = writes(() =>
        store.recordStandings(page[1]!.id, entries, hashes, read)
      );
      const again = writes(() =>
        store.recordStandings(page[1]!.id, entries, hashes, read)
      );
      console.log(
        `rows written: a new page of 1,000 events ${String(listed)}; 64 standings ${String(standings)} first, ${String(again)} read again`
      );
      // A player is their row and one index entry, a list its row.
      expect(standings).toBeLessThan(64 * 4);
      // Read again unchanged: the event's row, its index, the update time.
      expect(again).toBeLessThan(10);
    });
  });
});
