import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LimitlessRequestError } from '../limitless.js';
import { CRAWL_POLICY, DeckIndex, MAJORS_POLICY } from './deck-index.js';
import { deckIndexRoute, handleDeckIndexRequest } from './http.js';
import {
  labsGet,
  majorName,
  readLabsStandings,
  readLabsTournament,
  readLabsTournaments,
} from './labs.js';
import { memoryIndexStorage } from './node-sql.test-support.js';
import { DeckIndexStore } from './store.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = Date.parse('2026-10-28T12:00:00.000Z');

let now = START;
const clock = () => now;

const labsTime = (time: number): string =>
  new Date(time).toISOString().slice(0, 19).replace('T', ' ');

/** A 60-card list whose first line names the deck. */
const list = (main: string) => ({
  pokemon: [{ count: 4, name: main, set: 'TWM', number: '128' }],
  trainer: [],
  energy: [{ count: 56, name: 'Psychic Energy', set: 'MEE', number: '13' }],
});

interface FakeMajor {
  readonly id: number;
  readonly type: string;
  readonly city: string;
  readonly country: string;
  readonly season: number;
  readonly start: number;
  completed: number;
  version: string;
  standings: Record<string, unknown>[];
  readonly lists: Map<number, unknown>;
}

const standing = (
  tpId: number,
  placement: number | null,
  deck: { id: string; name: string; icons: string } | null,
  withList = true
): Record<string, unknown> => ({
  player_id: 50_000 + tpId,
  tp_id: tpId,
  name: `Player ${String(tpId)}`,
  country: 'FR',
  drop_round: null,
  late: 0,
  dqed: placement === null ? 1 : 0,
  placement,
  points: 30,
  wins: 10,
  losses: 3,
  ties: 1,
  day2: placement !== null && placement <= 3 ? 1 : 0,
  topcut: 0,
  dropped: 0,
  decklist: withList ? 1 : 0,
  deck_id: deck?.id ?? null,
  deck_name: deck?.name ?? null,
  icons: deck?.icons ?? null,
});

const dragapult = {
  id: 'dragapult-ex',
  name: 'Dragapult ex',
  icons: 'dragapult',
};
const gardevoir = {
  id: 'gardevoir-ex',
  name: 'Gardevoir ex',
  icons: 'gardevoir',
};

/**
 * A stand-in for Limitless: Labs (its list of majors, each one's state,
 * standings and lists) and an online API with no events.
 */
class FakeLimitless {
  readonly majors = new Map<number, FakeMajor>();
  readonly labsCalls: { readonly at: number; readonly path: string }[] = [];
  readonly onlineCalls: string[] = [];
  readonly labsFailures: Response[] = [];
  onlineEvents: unknown[] = [];

  readonly fetch = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.origin === 'https://play.limitlesstcg.com') {
        this.onlineCalls.push(url.pathname + url.search);
        if (url.pathname === '/api/tournaments') {
          return Response.json(
            Number(url.searchParams.get('page')) > 1 ? [] : this.onlineEvents
          );
        }
        return new Response('unknown', { status: 400 });
      }
      expect(url.origin).toBe('https://mew.limitlesstcg.com');
      const path = url.pathname.replace('/labs/data/tcg', '');
      this.labsCalls.push({ at: now, path: path + url.search });
      const failure = this.labsFailures.shift();
      if (failure) return failure;
      const ok = (message: unknown) => Response.json({ ok: true, message });
      if (path === '/tournaments') {
        return ok(
          [...this.majors.values()].map((major) => ({
            id: major.id,
            season: major.season,
            type: major.type,
            city: major.city,
            country: major.country,
            date: 'whenever',
            utc_start: labsTime(major.start),
            started: 1,
            completed: major.completed,
          }))
        );
      }
      // Masters only: no other division is ever asked for.
      const division = url.searchParams.get('division');
      if (path === '/tournament') {
        expect(division).toBe('MA');
        const major = this.majors.get(Number(url.searchParams.get('id')));
        return ok(
          major
            ? {
                players: major.standings.length,
                updated_at: major.version,
                decklists: 1,
                completed: major.completed,
              }
            : null
        );
      }
      if (path === '/standings') {
        expect(division).toBe('MA');
        const major = this.majors.get(
          Number(url.searchParams.get('tournamentId'))
        );
        return ok(major ? major.standings : null);
      }
      if (path === '/decklist') {
        const major = this.majors.get(
          Number(url.searchParams.get('tournamentId'))
        );
        const playerId = url.searchParams.get('playerId') ?? '';
        expect(playerId).toMatch(/^\d{4}$/u);
        return ok(major?.lists.get(Number(playerId)) ?? null);
      }
      return new Response('nope', { status: 404 });
    }
  );

  add(
    id: number,
    options: Partial<
      Pick<
        FakeMajor,
        'type' | 'city' | 'country' | 'season' | 'start' | 'completed'
      >
    > = {}
  ): FakeMajor {
    const major: FakeMajor = {
      id,
      type: options.type ?? 'regional',
      city: options.city ?? 'Nice',
      country: options.country ?? 'FR',
      season: options.season ?? 2027,
      start: options.start ?? START - 10 * DAY,
      completed: options.completed ?? 1,
      version: '2026-10-19 02:00:00',
      standings: [
        standing(7, 1, dragapult),
        standing(3, 2, gardevoir),
        standing(12, 3, dragapult),
        standing(1, 4, gardevoir, false),
        standing(9, null, null, false),
      ],
      lists: new Map([
        [7, list('Dreepy')],
        [3, list('Ralts')],
        [12, list('Drakloak')],
      ]),
    };
    this.majors.set(id, major);
    return major;
  }

  labsPaths(): string[] {
    return this.labsCalls.map((call) => call.path);
  }

  /** Labs' requests from the `from`th on, its list of majors aside. */
  majorPaths(from: number): string[] {
    return this.labsPaths()
      .slice(from)
      .filter((path) => path !== '/tournaments');
  }
}

let limitless: FakeLimitless;

const createIndex = (storage = memoryIndexStorage()) => {
  const index = new DeckIndex({
    storage,
    fetch: limitless.fetch,
    now: clock,
    enabled: true,
    majors: true,
  });
  index.migrate();
  return index;
};

/** Steps as the alarm would until nothing is due for a while. */
const crawlUntilIdle = async (index: DeckIndex) => {
  for (let step = 0; step < 2_000; step += 1) {
    const calls = limitless.labsCalls.length + limitless.onlineCalls.length;
    const next = await index.step();
    if (next === null) return;
    if (
      limitless.labsCalls.length + limitless.onlineCalls.length === calls &&
      next - now >= 20 * MINUTE
    ) {
      return;
    }
    now = Math.max(now, next);
  }
  throw new Error('the crawl never settled');
};

/** The crawl's steps for `ms`, the clock moving to each. */
const crawlFor = async (index: DeckIndex, ms: number) => {
  const end = now + ms;
  for (let step = 0; step < 10_000; step += 1) {
    const next = await index.step();
    if (next === null || next > end) break;
    now = Math.max(now, next);
  }
  now = end;
};

beforeEach(() => {
  now = START;
  limitless = new FakeLimitless();
});

describe('reading Labs', () => {
  it('names majors as limitlesstcg.com does', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(
      majorName({
        kind: 'regional',
        city: 'Nice',
        country: 'FR',
        season: 2027,
        date: at('2026-10-17T06:30:00Z'),
      })
    ).toBe('Regional Nice');
    expect(
      majorName({
        kind: 'special',
        city: 'Lima',
        country: 'PE',
        season: 2026,
        date: at('2026-05-23T06:30:00Z'),
      })
    ).toBe('Special Event Lima');
    expect(
      majorName({
        kind: 'international',
        city: 'São Paulo',
        country: 'BR',
        season: 2026,
        date: at('2025-11-21T12:00:00Z'),
      })
    ).toBe('LAIC 2025–26, São Paulo');
    expect(
      majorName({
        kind: 'international',
        city: 'London',
        country: 'GB',
        season: 2026,
        date: at('2026-02-13T09:00:00Z'),
      })
    ).toBe('EUIC 2026, London');
    expect(
      majorName({
        kind: 'international',
        city: 'New Orleans',
        country: 'US',
        season: 2026,
        date: at('2026-06-12T14:00:00Z'),
      })
    ).toBe('NAIC 2026, New Orleans');
    expect(
      majorName({
        kind: 'worlds',
        city: 'San Francisco',
        country: 'US',
        season: 2026,
        date: at('2026-08-28T16:00:00Z'),
      })
    ).toBe('World Championships 2026');
  });

  it('keeps only well formed majors that have started, numbered as the index numbers them', () => {
    const rows = readLabsTournaments([
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
      // Not started, an unknown kind, a malformed start, a junk city, a
      // repeat: all dropped.
      {
        id: 78,
        season: 2027,
        type: 'regional',
        city: 'Puebla',
        utc_start: '2026-10-24 14:30:00',
        started: 0,
        completed: 0,
      },
      {
        id: 79,
        season: 2027,
        type: 'cup',
        city: 'Lille',
        utc_start: '2026-10-24 14:30:00',
        started: 1,
        completed: 1,
      },
      {
        id: 80,
        season: 2027,
        type: 'regional',
        city: 'Lille',
        utc_start: '2026-10-24T14:30:00Z',
        started: 1,
        completed: 1,
      },
      {
        id: 81,
        season: 2027,
        type: 'regional',
        city: 'Li\nlle',
        utc_start: '2026-10-24 14:30:00',
        started: 1,
        completed: 1,
      },
      {
        id: 77,
        season: 2027,
        type: 'regional',
        city: 'Nice',
        utc_start: '2026-10-17 06:30:00',
        started: 1,
        completed: 1,
      },
      'junk',
    ]);
    expect(rows).toEqual([
      {
        id: 'labs-0077',
        name: 'Regional Nice',
        date: Date.parse('2026-10-17T06:30:00Z'),
        format: 'STANDARD',
        players: 0,
        organizerId: null,
        indexable: true,
        kind: 'regional',
        completed: true,
      },
    ]);
    expect(readLabsTournaments({ not: 'a list' })).toEqual([]);
  });

  it('reads a major’s state, its version Labs’ updated_at', () => {
    expect(
      readLabsTournament({
        players: 2234,
        updated_at: '2026-10-26 02:17:38',
        decklists: 1,
        completed: 1,
      })
    ).toEqual({
      players: 2234,
      version: '2026-10-26 02:17:38',
      completed: true,
    });
    expect(
      readLabsTournament({ players: 10, updated_at: 'yesterday' })
    ).toBeNull();
    expect(readLabsTournament(null)).toBeNull();
  });

  it('reads standings: players by their number in the event, icons split, the disqualified last, which lists Labs has', () => {
    const entries = readLabsStandings([
      standing(1454, null, null, false),
      { ...standing(900, 2, gardevoir), icons: 'gardevoir kirlia ../x' },
      standing(2115, 1, dragapult),
      standing(2115, 3, dragapult),
      { ...standing(5, 4, { id: 'Not A Slug', name: 'Odd', icons: '' }) },
      { tp_id: 'seven' },
    ]);
    expect(entries.map((entry) => entry.playerId)).toEqual([
      '2115',
      '0900',
      '0005',
      '1454',
    ]);
    expect(entries[1]).toMatchObject({
      name: 'Player 900',
      country: 'FR',
      placing: 2,
      archetype: {
        id: 'gardevoir-ex',
        name: 'Gardevoir ex',
        icons: ['gardevoir', 'kirlia'],
      },
      list: null,
      listPublished: true,
    });
    expect(entries[2]!.archetype).toBeNull();
    expect(entries[3]).toMatchObject({
      placing: null,
      dropped: true,
      listPublished: false,
    });
  });

  it('asks Labs plainly, takes its message, and says how a request failed', async () => {
    const answer = (response: Response) =>
      labsGet(
        {
          fetch: async () => response,
          maximumBytes: 1_000,
          timeoutMs: 1_000,
        },
        '/tournaments'
      );
    await expect(
      answer(Response.json({ ok: true, message: [1] }))
    ).resolves.toEqual([1]);
    await expect(
      answer(Response.json({ ok: true, message: null }))
    ).resolves.toBeNull();
    const code = (response: Response) =>
      answer(response).then(
        () => 'answered',
        (error: unknown) =>
          error instanceof LimitlessRequestError
            ? [error.code, error.retryAfterMs]
            : 'other'
      );
    expect(await code(Response.json({ ok: false, message: 'no' }))).toEqual([
      'invalid_response',
      undefined,
    ]);
    expect(
      await code(
        new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '120' },
        })
      )
    ).toEqual(['rate_limited', 120_000]);
    expect(await code(new Response('', { status: 404 }))).toEqual([
      'not_found',
      undefined,
    ]);
    expect(await code(new Response('', { status: 502 }))).toEqual([
      'request_failed',
      undefined,
    ]);
    expect(
      await code(Response.json({ ok: true, message: 'x'.repeat(2_000) }))
    ).toEqual(['invalid_response', undefined]);
  });
});

describe('the majors lane', () => {
  it('lists majors, reads one once it is over, then every Masters list one at a time, at its own pace', async () => {
    limitless.add(77);
    limitless.add(78, { city: 'Puebla', completed: 0, start: START - DAY });
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(limitless.labsPaths()).toEqual([
      '/tournaments',
      '/tournament?id=0077&division=MA',
      '/standings?tournamentId=0077&division=MA',
      // The best placed first; none for players Labs has none for.
      '/decklist?tournamentId=0077&playerId=0007',
      '/decklist?tournamentId=0077&playerId=0003',
      '/decklist?tournamentId=0077&playerId=0012',
    ]);
    // Never two requests to Labs closer than its gap.
    const gaps = limitless.labsCalls
      .slice(1)
      .map((call, n) => call.at - limitless.labsCalls[n]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(
      MAJORS_POLICY.requestGapMs
    );
    // The running one isn't listed until it is over.
    const browse = index.tournaments({
      q: '',
      format: null,
      minimumPlayers: 0,
      before: null,
      pageSize: 10,
    });
    expect(browse.tournaments).toEqual([
      {
        id: 'labs-0077',
        name: 'Regional Nice',
        date: new Date(START - 10 * DAY).toISOString(),
        format: 'STANDARD',
        players: 5,
        kind: 'regional',
        organizer: null,
        hasLists: true,
      },
    ]);
    // Found by its kind, and listed alone among majors.
    expect(
      index
        .tournaments({
          q: 'regionals',
          format: null,
          minimumPlayers: 0,
          before: null,
          pageSize: 10,
          majors: true,
        })
        .tournaments.map((row) => row.id)
    ).toEqual(['labs-0077']);
    const standings = await index.tournament('labs-0077');
    expect(standings.kind === 'ok' ? standings.standings : standings).toEqual([
      expect.objectContaining({ placing: 1, hasList: true }),
      expect.objectContaining({ placing: 2, hasList: true }),
      expect.objectContaining({ placing: 3, hasList: true }),
      expect.objectContaining({ placing: 4, hasList: false }),
      expect.objectContaining({ placing: null, dropped: true, hasList: false }),
    ]);
    // Majors count in deck search as online events do.
    const search = index.search('dragapult', 'STANDARD', 5);
    expect(search.available ? search.results : search).toEqual([
      expect.objectContaining({
        archetype: {
          id: 'dragapult-ex',
          name: 'Dragapult ex',
          icons: ['dragapult'],
        },
        lists: 2,
        top8s: 2,
      }),
    ]);
    const answer = await index.playerList('labs-0077', '0007');
    expect(answer).toMatchObject({
      kind: 'ok',
      text: expect.stringContaining('4 Dreepy TWM 128'),
      player: { id: '0007', name: 'Player 7', country: 'FR' },
      tournament: { id: 'labs-0077', kind: 'regional' },
    });

    // Puebla, over now, is read at the next listing.
    limitless.majors.get(78)!.completed = 1;
    await crawlFor(index, MAJORS_POLICY.discoveryEveryMs);
    expect(
      index
        .tournaments({
          q: 'puebla',
          format: null,
          minimumPlayers: 0,
          before: null,
          pageSize: 10,
        })
        .tournaments.map((row) => row.id)
    ).toEqual(['labs-0078']);
  });

  it('checks a recent major daily, reading its standings again only when its version changes, its lists kept', async () => {
    const major = limitless.add(77);
    const index = createIndex();
    await crawlUntilIdle(index);
    const read = limitless.labsCalls.length;
    await crawlFor(index, DAY + MINUTE);
    // Unchanged: the state alone (and Labs' list every six hours).
    expect(limitless.majorPaths(read)).toEqual([
      '/tournament?id=0077&division=MA',
    ]);
    // Re-categorised, and a late list.
    major.version = '2026-10-29 10:00:00';
    major.standings = [
      standing(7, 1, gardevoir),
      ...major.standings.slice(1, 3),
      standing(1, 4, gardevoir, true),
      major.standings[4]!,
    ];
    major.lists.set(1, list('Kirlia'));
    const before = limitless.labsCalls.length;
    await crawlFor(index, DAY + MINUTE);
    expect(limitless.majorPaths(before)).toEqual([
      '/tournament?id=0077&division=MA',
      '/standings?tournamentId=0077&division=MA',
      '/decklist?tournamentId=0077&playerId=0001',
    ]);
    const standings = await index.tournament('labs-0077');
    expect(
      standings.kind === 'ok'
        ? standings.standings.map((row) => [
            row.player.id,
            row.archetype?.id,
            row.hasList,
          ])
        : standings
    ).toEqual([
      ['0007', 'gardevoir-ex', true],
      ['0003', 'gardevoir-ex', true],
      ['0012', 'dragapult-ex', true],
      ['0001', 'gardevoir-ex', true],
      ['0009', undefined, false],
    ]);
    // Past its window, it is checked no more.
    now = START + 20 * DAY;
    const after = limitless.labsCalls.length;
    await crawlFor(index, 2 * DAY);
    expect(limitless.majorPaths(after)).toEqual([]);
  });

  it('reads a list a player loads before the lane reaches it, and never asks again for one Labs doesn’t have', async () => {
    const major = limitless.add(77);
    major.lists.delete(3);
    const index = createIndex();
    // The list, its state and the standings: no list read yet.
    await index.step();
    now += MAJORS_POLICY.requestGapMs;
    await index.step();
    now += MAJORS_POLICY.requestGapMs;
    await index.step();
    expect(limitless.labsPaths()).toHaveLength(3);
    now += 100;
    const answer = await index.playerList('labs-0077', '0012');
    expect(answer).toMatchObject({
      kind: 'ok',
      text: expect.stringContaining('Drakloak'),
    });
    // None for 0003: not found, and not asked again by the lane.
    expect(await index.playerList('labs-0077', '0003')).toEqual({
      kind: 'not_found',
    });
    await crawlUntilIdle(index);
    expect(
      limitless
        .labsPaths()
        .filter((path) => path.startsWith('/decklist'))
        .sort()
    ).toEqual([
      '/decklist?tournamentId=0077&playerId=0003',
      '/decklist?tournamentId=0077&playerId=0007',
      '/decklist?tournamentId=0077&playerId=0012',
    ]);
    // An online player id, or a major's player not in it: not found.
    expect(await index.playerList('labs-0077', '0002')).toEqual({
      kind: 'not_found',
    });
  });

  it('holds back on Labs’ 429 as long as it says, and longer each time it fails, while the online crawl goes on', async () => {
    limitless.add(77);
    limitless.onlineEvents = [];
    limitless.labsFailures.push(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '600' },
      })
    );
    const index = createIndex();
    await crawlFor(index, 9 * MINUTE);
    // One refused request, nothing more for ten minutes.
    expect(limitless.labsPaths()).toEqual(['/tournaments']);
    // The online crawl wasn't held: its list was read meanwhile.
    expect(limitless.onlineCalls[0]).toBe(
      '/api/tournaments?game=PTCG&limit=1000&page=1'
    );
    await crawlFor(index, 2 * MINUTE);
    expect(limitless.labsPaths().slice(0, 2)).toEqual([
      '/tournaments',
      '/tournaments',
    ]);

    // Down: held back 30 s, then 60 s.
    const down = createIndex();
    limitless.labsCalls.length = 0;
    limitless.labsFailures.push(
      new Response('down', { status: 502 }),
      new Response('down', { status: 502 })
    );
    const started = now;
    await crawlFor(down, 2 * MINUTE);
    const times = limitless.labsCalls
      .slice(0, 3)
      .map((call) => call.at - started);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(
      CRAWL_POLICY.firstHoldMs
    );
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(
      2 * CRAWL_POLICY.firstHoldMs
    );
  });

  it('backs off longer each time Labs answers what can’t be read, as for an outage', async () => {
    limitless.add(77);
    limitless.onlineEvents = [];
    const unreadable = () =>
      new Response(JSON.stringify({ ok: true, message: { not: 'a list' } }), {
        headers: { 'content-type': 'application/json' },
      });
    limitless.labsFailures.push(unreadable(), unreadable(), unreadable());
    const index = createIndex();
    const started = now;
    await crawlFor(index, 4 * MINUTE);
    const times = limitless.labsCalls
      .slice(0, 4)
      .map((call) => call.at - started);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(
      CRAWL_POLICY.firstHoldMs
    );
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(
      2 * CRAWL_POLICY.firstHoldMs
    );
    expect(times[3]! - times[2]!).toBeGreaterThanOrEqual(
      4 * CRAWL_POLICY.firstHoldMs
    );
  });

  it('busies a player loading a list while Labs holds the lane back', async () => {
    limitless.add(77);
    const index = createIndex();
    for (let step = 0; step < 3; step += 1) {
      await index.step();
      now += MAJORS_POLICY.requestGapMs;
    }
    limitless.labsFailures.push(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '300' },
      })
    );
    // The lane's next list read is refused: held for five minutes.
    await index.step();
    expect(await index.playerList('labs-0077', '0003')).toEqual({
      kind: 'busy',
      retryAfterMs: expect.any(Number),
    });
  });

  it('never reads a major on demand, nor shows one not read', async () => {
    const index = createIndex();
    expect(await index.tournament('labs-0077')).toEqual({ kind: 'not_found' });
    expect(await index.playerList('labs-0077', '0001')).toEqual({
      kind: 'not_found',
    });
    expect(limitless.labsCalls).toEqual([]);
  });

  it('leaves majors to their own lane: the online crawl reads none of them', async () => {
    limitless.add(77);
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(
      limitless.onlineCalls.filter((call) => call.includes('labs'))
    ).toEqual([]);
  });
});

describe('a database made before majors', () => {
  it('gains their columns on migrating, its rows as they were', () => {
    const storage = memoryIndexStorage();
    const store = new DeckIndexStore(storage);
    store.migrate();
    store.recordListed(
      [
        {
          id: 'a'.repeat(24),
          name: 'Weekly Cup',
          date: START - DAY,
          format: 'STANDARD',
          players: 32,
          organizerId: null,
          indexable: true,
        },
      ],
      START
    );
    // As schema 2 made it.
    storage.database.exec('DROP INDEX tournaments_by_kind');
    storage.database.exec('ALTER TABLE tournaments DROP COLUMN kind');
    storage.database.exec('ALTER TABLE tournaments DROP COLUMN lists_pending');
    storage.database.exec('ALTER TABLE entries DROP COLUMN list_state');
    store.setMeta('schema', '2');
    store.migrate();
    expect(store.getMeta('schema')).toBe('3');
    expect(store.tournament('a'.repeat(24))).toMatchObject({
      name: 'Weekly Cup',
      kind: null,
    });
    store.recordMajorsListed(
      readLabsTournaments([
        {
          id: 77,
          season: 2027,
          type: 'regional',
          city: 'Nice',
          utc_start: '2026-10-17 06:30:00',
          started: 1,
          completed: 1,
        },
      ]),
      START
    );
    expect(store.nextMajorToRead(START)?.id).toBe('labs-0077');
    // The online crawl's queue holds none of it.
    expect(store.nextToRead(START)?.id).toBe('a'.repeat(24));
  });
});

describe('the routes for majors', () => {
  const reader = {
    search: vi.fn(),
    archetype: vi.fn(),
    tournaments: vi.fn(async () => ({ tournaments: [], next: null })),
    tournament: vi.fn(async () => ({
      kind: 'ok' as const,
      tournament: {
        id: 'labs-0077',
        name: 'Regional Nice',
        date: new Date(START).toISOString(),
        format: 'STANDARD' as const,
        players: 5,
        kind: 'regional' as const,
        organizer: null,
        hasLists: true,
      },
      standings: [],
      settled: true,
    })),
    playerList: vi.fn(async () => ({ kind: 'not_found' as const })),
  };

  it('take a major’s id and its players’ numbers, and link to Labs', async () => {
    expect(deckIndexRoute('/v2/tournaments/labs-0077')).toEqual({
      kind: 'tournament',
      id: 'labs-0077',
    });
    expect(
      deckIndexRoute('/v2/tournaments/labs-0077/players/2115/list')
    ).toEqual({ kind: 'player_list', id: 'labs-0077', playerId: '2115' });
    // A username at a major, or a malformed major id: refused.
    expect(deckIndexRoute('/v2/tournaments/labs-0077/players/alice/list')).toBe(
      'invalid'
    );
    expect(deckIndexRoute('/v2/tournaments/labs-77')).toBe('invalid');
    const response = await handleDeckIndexRequest(
      new Request('https://play.example/v2/tournaments/labs-0077'),
      { kind: 'tournament', id: 'labs-0077' },
      reader
    );
    expect(
      ((await response.json()) as { tournament: { url: string } }).tournament
        .url
    ).toBe('https://labs.limitlesstcg.com/0077/standings');
  });

  it('list majors alone when asked, and refuse any other kind', async () => {
    const ask = (search: string) =>
      handleDeckIndexRequest(
        new Request(`https://play.example/v2/tournaments${search}`),
        { kind: 'tournaments' },
        reader
      );
    expect((await ask('?kind=major')).status).toBe(200);
    expect(reader.tournaments).toHaveBeenLastCalledWith(
      expect.objectContaining({ majors: true })
    );
    expect((await ask('?kind=online')).status).toBe(400);
    // A page's cursor may end at a major.
    const cursor = btoa(JSON.stringify({ d: START, i: 'labs-0077' }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');
    expect((await ask(`?cursor=${cursor}`)).status).toBe(200);
  });
});
