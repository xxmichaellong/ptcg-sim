import { env, exports } from 'cloudflare:workers';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readLabsStandings,
  readLabsTournaments,
} from '../src/deck-index/labs.js';
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
let labsCalls: string[] = [];
const serveLimitless = (
  routes: Record<string, unknown>,
  // Labs' answers by path and query; no majors unless given.
  labs: Record<string, unknown> = { '/labs/data/tcg/tournaments': [] }
) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://mew.limitlesstcg.com') {
        labsCalls.push(url.pathname + url.search);
        const message = labs[url.pathname + url.search];
        return Response.json({ ok: true, message: message ?? null });
      }
      if (url.origin !== 'https://play.limitlesstcg.com') {
        throw new Error(`unexpected request to ${url.origin}`);
      }
      calls.push(url.pathname + url.search);
      // The list's pages past the first are empty, as past its end.
      if (Number(url.searchParams.get('page') ?? '1') > 1) {
        return Response.json([]);
      }
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
  labsCalls = [];
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

    // The alarm's steps: the list, the empty page past it (its end), then
    // the standings.
    expect(await runDurableObjectAlarm(indexStub())).toBe(true);
    expect(await runDurableObjectAlarm(indexStub())).toBe(true);
    expect(await runDurableObjectAlarm(indexStub())).toBe(true);
    expect(calls).toEqual([
      '/api/tournaments?game=PTCG&limit=1000&page=1',
      '/api/tournaments?game=PTCG&limit=1000&page=2',
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
    expect(calls).toHaveLength(3);
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
    // Majors too, from Labs, in the same step.
    expect(labsCalls).toEqual(['/labs/data/tcg/tournaments']);
  });

  it('reads a major from Labs, Masters only, and links its standings there', async () => {
    serveLimitless(
      { '/api/tournaments': [] },
      {
        '/labs/data/tcg/tournaments': [
          {
            id: 77,
            season: 2027,
            type: 'regional',
            city: 'Nice',
            country: 'FR',
            utc_start: '2026-10-17 06:30:00',
            started: 1,
            completed: 1,
          },
        ],
        '/labs/data/tcg/tournament?id=0077&division=MA': {
          players: 1,
          updated_at: '2026-10-19 02:00:00',
          decklists: 1,
          completed: 1,
        },
        '/labs/data/tcg/standings?tournamentId=0077&division=MA': [
          {
            tp_id: 2115,
            name: 'Luc',
            country: 'CH',
            placement: 1,
            wins: 15,
            losses: 1,
            ties: 2,
            drop_round: null,
            dqed: 0,
            decklist: 1,
            deck_id: 'basic-box-m',
            deck_name: 'Basic Box',
            icons: 'ogerpon clefairy',
          },
        ],
        '/labs/data/tcg/decklist?tournamentId=0077&playerId=2115':
          list('Mega Kangaskhan ex'),
      }
    );
    await indexStub().refresh();
    // A step each lane, Labs' at its own pace (a request every 2 s).
    for (let step = 0; step < 3; step += 1) {
      await runDurableObjectAlarm(indexStub());
      await new Promise((resolve) => setTimeout(resolve, 2_050));
    }
    // (Its own alarms may go on to the list meanwhile.)
    expect(labsCalls.slice(0, 3)).toEqual([
      '/labs/data/tcg/tournaments',
      '/labs/data/tcg/tournament?id=0077&division=MA',
      '/labs/data/tcg/standings?tournamentId=0077&division=MA',
    ]);
    const response = await get('/v2/tournaments/labs-0077');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tournament: { name: string; kind: string; url: string };
      standings: { player: { id: string }; hasList: boolean }[];
    };
    expect(body.tournament).toMatchObject({
      name: 'Regional Nice',
      kind: 'regional',
      url: 'https://labs.limitlesstcg.com/0077/standings',
    });
    expect(body.standings).toEqual([
      expect.objectContaining({
        player: expect.objectContaining({ id: '2115' }),
        hasList: true,
      }),
    ]);
    // Its list: read when loaded, if the lane hasn't yet, and only once.
    const loaded = await get('/v2/tournaments/labs-0077/players/2115/list');
    expect(loaded.status).toBe(200);
    expect(((await loaded.json()) as { url: string }).url).toBe(
      'https://labs.limitlesstcg.com/0077/player/2115/decklist'
    );
    expect(
      labsCalls.filter(
        (call) =>
          call === '/labs/data/tcg/decklist?tournamentId=0077&playerId=2115'
      )
    ).toHaveLength(1);
    // Masters only.
    expect(
      labsCalls.filter(
        (call) => call.includes('division=') && !call.endsWith('division=MA')
      )
    ).toEqual([]);
    expect(calls.every((call) => !call.includes('labs'))).toBe(true);
  }, 20_000);

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
  it('writes a few rows a player at a major, and none for a check that finds it as it was', async () => {
    const stub = env.PTCG_DECK_INDEX.getByName('major rows written');
    await runInDurableObject(stub, async (_instance, state) => {
      let written = 0;
      const store = new DeckIndexStore({
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
      });
      store.migrate();
      const writes = (body: () => void): number => {
        const before = written;
        body();
        return written - before;
      };
      const now = Date.now();
      // A 2,000-player Regional, 1,990 lists, 40 decks among them.
      const listed = writes(() =>
        store.recordMajorsListed(
          readLabsTournaments([
            {
              id: 77,
              season: 2027,
              type: 'regional',
              city: 'Nice',
              country: 'FR',
              utc_start: '2026-10-17 06:30:00',
              started: 1,
              completed: 1,
            },
          ]),
          now
        )
      );
      const players = 2_000;
      const entries = readLabsStandings(
        Array.from({ length: players }, (_, n) => ({
          tp_id: n + 1,
          name: `Player ${String(n)}`,
          country: 'FR',
          placement: n + 1,
          wins: 9,
          losses: 4,
          ties: 1,
          drop_round: null,
          dqed: 0,
          decklist: n < players - 10 ? 1 : 0,
          deck_id: `deck-${String(n % 40)}`,
          deck_name: `Deck ${String(n % 40)}`,
          icons: 'dragapult',
        }))
      );
      const read = { now, version: '2026-10-19 02:00:00', players };
      const standings = writes(() =>
        store.recordMajorStandings('labs-0077', entries, read)
      );
      let lists = 0;
      for (const playerId of store.wantedLists('labs-0077', players)) {
        lists += writes(() =>
          store.recordMajorList(
            'labs-0077',
            playerId,
            playerId.padStart(32, '0'),
            `4 Dreepy TWM 128\n56 Psychic Energy MEE 13\n# ${playerId}`
          )
        );
      }
      const again = writes(() =>
        store.recordMajorStandings('labs-0077', entries, read)
      );
      const checked = writes(() => store.recordMajorChecked('labs-0077', now));
      const perPlayer = (standings + lists) / players;
      console.log(
        `rows written: a major listed ${String(listed)}; 2,000 standings ${String(standings)}, 1,990 lists ${String(lists)} (${perPlayer.toFixed(2)} a player); read again unchanged ${String(again)}; a daily check ${String(checked)}`
      );
      // A player is their row and an index entry; a list its row and the
      // player's row again.
      expect(perPlayer).toBeLessThan(4.2);
      expect(again).toBeLessThan(10);
      expect(checked).toBeLessThan(3);
    });
  });
  it('reads a deck’s own finishes for it, not every event’s', async () => {
    const stub = env.PTCG_DECK_INDEX.getByName('rows read');
    await runInDurableObject(stub, async (_instance, state) => {
      let read = 0;
      const store = new DeckIndexStore({
        sql: {
          exec<T extends Record<string, SqlValue>>(
            query: string,
            ...bindings: SqlValue[]
          ) {
            const cursor = state.storage.sql.exec<T>(query, ...bindings);
            const rows = cursor.toArray();
            read += cursor.rowsRead;
            return { toArray: () => rows };
          },
        },
        transaction: <T>(body: () => T): T =>
          state.storage.transactionSync(body),
      });
      store.migrate();
      const now = Date.now();
      // 60 events of 64 players, eight decks among them.
      const events = Array.from({ length: 60 }, (_, n): ListedTournament => ({
        id: `d${n.toString(16).padStart(23, '0')}`,
        name: `Weekly Cup ${String(n)}`,
        date: now - 2 * DAY - n * 60 * 60_000,
        format: 'STANDARD',
        players: 64,
        organizerId: null,
        indexable: true,
      }));
      store.recordListed(events, now);
      for (const event of events) {
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
          list: `4 Dreepy TWM 128\n56 Psychic Energy MEE 13\n# ${event.id} ${String(n)}`,
        }));
        store.recordStandings(
          event.id,
          entries,
          new Map(
            entries.map((entry, n) => [
              entry.list,
              `${event.id}${n.toString(16).padStart(40, '0')}`,
            ])
          ),
          { now, etag: null, provisional: false }
        );
      }
      read = 0;
      const finishes = store.archetypeFinishes(
        'deck-3',
        'STANDARD',
        now - 90 * DAY,
        null,
        20
      );
      console.log(
        `rows read: one deck's finishes over 3,840 entries ${String(read)}`
      );
      expect(finishes).toHaveLength(20);
      // Its own 480 entries and their events, not all 3,840.
      expect(read).toBeLessThan(1_500);
    });
  });
});
