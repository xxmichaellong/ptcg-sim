import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BUDGET, nextAllowedAt } from './budget.js';
import { CRAWL_POLICY, DeckIndex } from './deck-index.js';
import { memoryIndexStorage } from './node-sql.test-support.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = Date.parse('2026-10-22T12:00:00.000Z');

let now = START;
const clock = () => now;

const id = (n: number) => n.toString(16).padStart(24, '0');

interface FakeTournament {
  readonly id: string;
  readonly name: string;
  readonly date: number;
  readonly format: string | null;
  readonly players: number;
}

const tournament = (
  n: number,
  options: Partial<Omit<FakeTournament, 'id'>> = {}
): FakeTournament => ({
  id: id(n),
  name: options.name ?? `Event ${String(n)}`,
  date: options.date ?? START - 30 * DAY,
  format: options.format === undefined ? 'STANDARD' : options.format,
  players: options.players ?? 64,
});

/** A 60-card list whose first line names the deck. */
const list = (main: string) => ({
  pokemon: [{ count: 4, name: main, set: 'TWM', number: '128' }],
  trainer: [],
  energy: [{ count: 56, name: 'Psychic Energy', set: 'MEE', number: '13' }],
});

const standing = (
  player: string,
  placing: number | null,
  deck: { id: string; name: string; icons?: string[] } | null,
  withList = true
) => ({
  player,
  name: player.toUpperCase(),
  country: 'US',
  placing,
  record: { wins: 5, losses: 2, ties: 0 },
  drop: placing === null ? 2 : null,
  deck: deck ? { icons: [], ...deck } : null,
  ...(withList && deck ? { decklist: list(deck.name) } : {}),
});

const gardevoir = {
  id: 'gardevoir-ex',
  name: 'Gardevoir ex',
  icons: ['gardevoir'],
};
const jellicent = {
  id: 'gardevoir-jellicent',
  name: 'Gardevoir Jellicent',
  icons: ['gardevoir', 'jellicent'],
};
const dragapult = {
  id: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  icons: ['dragapult', 'dusknoir'],
};

/**
 * A stand-in for Limitless: the tournament list (newest first, paged as
 * asked), each tournament's standings, an ETag per standings body, and a
 * way to make the next answers fail.
 */
class FakeLimitless {
  tournaments: FakeTournament[] = [];
  readonly standings = new Map<string, unknown>();
  readonly calls: string[] = [];
  readonly failures: Response[] = [];
  /** How many standings requests answer 503 before they work again. */
  failStandings = 0;

  readonly fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      this.calls.push(url.pathname + url.search);
      const failure = this.failures.shift();
      if (failure) return failure;
      if (url.pathname === '/api/tournaments') {
        const limit = Number(url.searchParams.get('limit'));
        const page = Number(url.searchParams.get('page'));
        const sorted = [...this.tournaments].sort(
          (left, right) => right.date - left.date
        );
        return Response.json(
          sorted.slice((page - 1) * limit, page * limit).map((row) => ({
            game: 'PTCG',
            id: row.id,
            name: row.name,
            date: new Date(row.date).toISOString(),
            format: row.format,
            players: row.players,
          }))
        );
      }
      const match = /^\/api\/tournaments\/([a-f0-9]{24})\/standings$/u.exec(
        url.pathname
      );
      if (match) {
        if (this.failStandings > 0) {
          this.failStandings -= 1;
          return new Response('down', { status: 503 });
        }
        const body = this.standings.get(match[1]!);
        if (body === undefined) return new Response('unknown', { status: 400 });
        const etag = `W/"${String(JSON.stringify(body).length)}"`;
        if (new Headers(init?.headers).get('If-None-Match') === etag) {
          return new Response(null, { status: 304 });
        }
        return Response.json(body, { headers: { etag } });
      }
      return new Response('nope', { status: 404 });
    }
  );

  standingsCalls(): string[] {
    return this.calls
      .filter((call) => call.endsWith('/standings'))
      .map((call) => call.split('/')[3]!);
  }
}

let limitless: FakeLimitless;

const createIndex = (enabled = true) => {
  const index = new DeckIndex({
    storage: memoryIndexStorage(),
    fetch: limitless.fetch,
    now: clock,
    enabled,
  });
  index.migrate();
  return index;
};

/** Runs crawl steps as the alarm would, the clock moving to each. */
const crawl = async (index: DeckIndex, steps: number) => {
  for (let step = 0; step < steps; step += 1) {
    const next = await index.step();
    if (next === null) return;
    now = Math.max(now, next);
  }
};

/** Runs the crawl's steps due up to `time`, and leaves the clock there. */
const crawlUntil = async (index: DeckIndex, time: number) => {
  for (let step = 0; step < 500; step += 1) {
    const next = await index.step();
    if (next === null || next > time) {
      now = time;
      return;
    }
    now = Math.max(now, next);
  }
  throw new Error('the crawl never got there');
};

/** Steps until nothing is left to do before the next discovery. */
const crawlUntilIdle = async (index: DeckIndex) => {
  for (let step = 0; step < 500; step += 1) {
    const calls = limitless.calls.length;
    const next = await index.step();
    if (next === null) return;
    if (limitless.calls.length === calls && next - now >= 20 * MINUTE) return;
    now = Math.max(now, next);
  }
  throw new Error('the crawl never settled');
};

beforeEach(() => {
  now = START;
  limitless = new FakeLimitless();
});

describe('discovering tournaments', () => {
  it('reads the whole list once in pages of 1,000, then reads finished standings by priority', async () => {
    // Filler: old and tiny, so never queued.
    limitless.tournaments = Array.from({ length: 1_195 }, (_, n) =>
      tournament(1_000 + n, { players: 4, date: START - 400 * DAY })
    );
    limitless.tournaments.push(
      tournament(1, { players: 100, date: START - 2 * DAY }),
      tournament(2, { players: 10, date: START - 1 * DAY }),
      tournament(3, {
        players: 200,
        date: START - 1 * DAY,
        format: 'EXPANDED',
      }),
      tournament(4, { players: 300, date: START - 6 * HOUR }),
      tournament(5, { players: 64, date: START - 200 * DAY }),
      tournament(6, { players: 64, date: START - DAY, format: 'GLC' })
    );
    for (const n of [1, 2, 3, 5]) {
      limitless.standings.set(id(n), [standing('alice', 1, dragapult)]);
    }
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(limitless.calls.slice(0, 2)).toEqual([
      '/api/tournaments?game=PTCG&limit=1000&page=1',
      '/api/tournaments?game=PTCG&limit=1000&page=2',
    ]);
    // Recent big Standard, recent small Standard, then the rest newest
    // first; nothing still running (4) and nothing in a format whose lists
    // aren't kept (6).
    expect(limitless.standingsCalls()).toEqual([id(1), id(2), id(3), id(5)]);
  });

  it('runs every half hour, stopping at a page of tournaments it knows that are over two days old', async () => {
    limitless.tournaments = Array.from({ length: 250 }, (_, n) =>
      tournament(1_000 + n, { players: 4, date: START - 10 * DAY - n * HOUR })
    );
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(limitless.calls).toEqual([
      '/api/tournaments?game=PTCG&limit=1000&page=1',
    ]);
    // New tournaments at the top of the list.
    limitless.tournaments.push(
      ...Array.from({ length: 120 }, (_, n) =>
        tournament(5_000 + n, { players: 4, date: START - n * MINUTE })
      )
    );
    now += CRAWL_POLICY.discoveryEveryMs;
    await crawlUntilIdle(index);
    expect(limitless.calls.slice(1)).toEqual([
      // 100 new.
      '/api/tournaments?game=PTCG&limit=100&page=1',
      // 20 new, 80 known.
      '/api/tournaments?game=PTCG&limit=100&page=2',
      // All known and over two days old: the run stops.
      '/api/tournaments?game=PTCG&limit=100&page=3',
    ]);
  });

  it('takes a page that is not a list for a failure, not the end of the list', async () => {
    limitless.tournaments = Array.from({ length: 1_200 }, (_, n) =>
      tournament(1_000 + n, { players: 4, date: START - 400 * DAY })
    );
    // The first page answers an object, then Limitless recovers.
    limitless.failures.push(Response.json({ error: 'maintenance' }));
    const index = createIndex();
    await crawlUntilIdle(index);
    const pages = limitless.calls.filter((call) =>
      call.startsWith('/api/tournaments?')
    );
    // Asked again, and the backfill goes on to the second page.
    expect(pages.slice(0, 3)).toEqual([
      '/api/tournaments?game=PTCG&limit=1000&page=1',
      '/api/tournaments?game=PTCG&limit=1000&page=1',
      '/api/tournaments?game=PTCG&limit=1000&page=2',
    ]);
  });

  it('takes up a skipped tournament once it is worth reading', async () => {
    // Listed while players were still registering, before its format was set.
    limitless.tournaments = [
      tournament(1, {
        name: 'Late Cup',
        players: 4,
        format: null,
        date: START - HOUR,
      }),
    ];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(await index.tournament(id(1))).toEqual({ kind: 'not_found' });
    limitless.tournaments = [
      tournament(1, { name: 'Late Cup', players: 32, date: START - HOUR }),
    ];
    now += CRAWL_POLICY.discoveryEveryMs;
    await crawlUntilIdle(index);
    const browse = index.tournaments({
      q: 'late',
      format: 'STANDARD',
      minimumPlayers: 0,
      before: null,
      pageSize: 10,
    });
    expect(browse.tournaments.map((row) => [row.id, row.players])).toEqual([
      [id(1), 32],
    ]);
    expect(await index.tournament(id(1))).toMatchObject({ kind: 'ok' });
  });

  it('holds back longer each time Limitless answers a list with nonsense', async () => {
    limitless.tournaments = [tournament(1, { players: 4 })];
    for (let n = 0; n < 1_000; n += 1) {
      limitless.failures.push(Response.json({ error: 'maintenance' }));
    }
    const index = createIndex();
    await crawlUntil(index, START + 2 * HOUR);
    // 30 s, then a minute, two, four... at most half an hour: not one ask
    // every 30 s for two hours.
    expect(limitless.calls.length).toBeLessThan(15);
  });

  it('discovers again at once when the daily cron asks', async () => {
    limitless.tournaments = [tournament(1, { players: 4 })];
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(limitless.calls).toHaveLength(1);
    index.discoverSoon();
    await crawl(index, 1);
    expect(limitless.calls.at(-1)).toBe(
      '/api/tournaments?game=PTCG&limit=100&page=1'
    );
  });
});

describe('the request budget', () => {
  it('spends at most 20 crawl requests in five minutes', async () => {
    limitless.tournaments = Array.from({ length: 40 }, (_, n) =>
      tournament(n + 1, { date: START - DAY - n * HOUR })
    );
    for (const row of limitless.tournaments) {
      limitless.standings.set(row.id, [standing('p', 1, dragapult)]);
    }
    const index = createIndex();
    // Every step at the same moment: only the budget holds them back.
    let next = 0;
    for (let step = 0; step < 30; step += 1) {
      next = (await index.step())!;
    }
    expect(limitless.calls).toHaveLength(BUDGET.crawl);
    expect(next).toBe(START + BUDGET.windowMs);
  });

  it('stops every request after a 429 for as long as Limitless asks', async () => {
    limitless.tournaments = [tournament(1, { date: START - DAY })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    limitless.failures.push(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '120' },
      })
    );
    const blockedAt = now;
    const next = await index.step();
    expect(next).toBeGreaterThanOrEqual(blockedAt + 120_000);
    expect(limitless.calls).toHaveLength(2);
    // The tournament wasn't at fault: it is read once the block is over.
    now = next!;
    await crawl(index, 1);
    expect(limitless.standingsCalls()).toEqual([id(1), id(1)]);
    expect((await index.tournament(id(1))).kind).toBe('ok');
  });

  it('holds the crawl back after Limitless fails, retries a tournament an hour later and then two, then gives up on it', async () => {
    limitless.tournaments = [tournament(1, { date: START - DAY })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    limitless.failStandings = 3;
    const index = createIndex();
    await crawl(index, 1);
    const before = now;
    const next = (await index.step())!;
    expect(limitless.standingsCalls()).toHaveLength(1);
    expect(next).toBeGreaterThanOrEqual(before + CRAWL_POLICY.firstHoldMs);
    await crawlUntil(index, START + 59 * MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(1);
    await crawlUntil(index, START + HOUR + MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(2);
    await crawlUntil(index, START + 3 * HOUR + MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(3);
    await crawlUntil(index, START + 20 * HOUR);
    expect(limitless.standingsCalls()).toHaveLength(3);
    // Given up on by the crawl; a player opening it still has it read.
    expect((await index.tournament(id(1))).kind).toBe('ok');
    expect(limitless.standingsCalls()).toHaveLength(4);
  });

  it('forgets a tournament Limitless no longer knows', async () => {
    limitless.tournaments = [tournament(1, { date: START - DAY })];
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toEqual([id(1)]);
    expect(await index.tournament(id(1))).toEqual({ kind: 'not_found' });
    expect(
      index.tournaments({
        q: '',
        format: null,
        minimumPlayers: 0,
        before: null,
        pageSize: 10,
      }).tournaments
    ).toEqual([]);
  });
});

describe('reading standings again', () => {
  it('reads recent tournaments again weekly, conditionally', async () => {
    limitless.tournaments = [tournament(1, { date: START - 2 * DAY })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toEqual([id(1)]);
    now += CRAWL_POLICY.discoveryEveryMs;
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toEqual([id(1)]);
    now = START + 8 * DAY;
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toEqual([id(1), id(1)]);
    const conditional = limitless.fetch.mock.calls.at(-1)!;
    expect(new Headers(conditional[1]?.headers).get('If-None-Match')).toMatch(
      /^W\//u
    );
    // Unchanged: still there, and not read again for another week.
    expect((await index.tournament(id(1))).kind).toBe('ok');
    now += 2 * DAY;
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toHaveLength(2);
  });

  it('holds the crawl back when standings come back as nonsense', async () => {
    limitless.tournaments = Array.from({ length: 40 }, (_, n) =>
      tournament(n + 1, { date: START - DAY - n * HOUR })
    );
    const index = createIndex();
    await crawl(index, 1);
    for (let n = 0; n < 1_000; n += 1) {
      limitless.failures.push(Response.json({ error: 'maintenance' }));
    }
    await crawlUntil(index, START + 4 * HOUR);
    // Not the whole queue worn out at the budget's pace.
    expect(limitless.standingsCalls().length).toBeLessThan(25);
  });

  it('reads a re-categorised deck again', async () => {
    limitless.tournaments = [tournament(1, { date: START - 2 * DAY })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawlUntilIdle(index);
    limitless.standings.set(id(1), [standing('p', 1, gardevoir)]);
    now = START + 8 * DAY;
    await crawlUntilIdle(index);
    const answer = await index.tournament(id(1));
    expect(answer.kind === 'ok' && answer.standings[0]!.archetype?.id).toBe(
      'gardevoir-ex'
    );
  });
});

/** An index with three archetypes over a few tournaments. */
const searchable = async () => {
  limitless.tournaments = [
    tournament(1, { name: 'Big Recent', players: 500, date: START - 5 * DAY }),
    tournament(2, { name: 'Small Recent', players: 16, date: START - 3 * DAY }),
    tournament(3, {
      name: 'Old Standard',
      players: 300,
      date: START - 300 * DAY,
    }),
    tournament(4, {
      name: 'Expanded Cup',
      players: 40,
      date: START - 4 * DAY,
      format: 'EXPANDED',
    }),
  ];
  limitless.standings.set(id(1), [
    standing('a1', 1, jellicent),
    standing('a2', 2, jellicent),
    standing('a3', 3, dragapult),
    standing('a4', 9, gardevoir),
    standing('a5', null, gardevoir),
  ]);
  limitless.standings.set(id(2), [
    standing('b1', 1, gardevoir),
    standing('b2', 2, dragapult, false),
  ]);
  limitless.standings.set(id(3), [standing('c1', 1, dragapult)]);
  limitless.standings.set(id(4), [standing('d1', 1, gardevoir)]);
  const index = createIndex();
  await crawlUntilIdle(index);
  return index;
};

describe('searching by deck', () => {
  it('says nothing is available before any lists are read', () => {
    const index = createIndex();
    expect(index.search('gardevoir', 'STANDARD', 8)).toEqual({
      available: false,
    });
  });

  it('puts the exact name first, then decks by their recent top 8s', async () => {
    const index = await searchable();
    const answer = index.search('Gardévoir', 'STANDARD', 8);
    expect(answer.available).toBe(true);
    if (!answer.available) return;
    expect(answer.results.map((result) => result.archetype.id)).toEqual([
      // "Gardevoir" is "Gardevoir ex" without its optional word.
      'gardevoir-ex',
      'gardevoir-jellicent',
    ]);
    const [ex, jelly] = answer.results;
    // a5 dropped: their list isn't offered or counted.
    expect(ex!.lists).toBe(2);
    expect(ex!.top8s).toBe(1);
    expect(jelly!.lists).toBe(2);
    expect(jelly!.top8s).toBe(2);
    // Best first: placing, then the bigger event; dropped and unplaced
    // finishes are left out.
    expect(
      ex!.best.map((finish) => [finish.player.id, finish.placing])
    ).toEqual([
      ['b1', 1],
      ['a4', 9],
    ]);
    expect(ex!.best[0]).toEqual({
      tournament: {
        id: id(2),
        name: 'Small Recent',
        date: new Date(START - 3 * DAY).toISOString(),
        players: 16,
        format: 'STANDARD',
      },
      player: { id: 'b1', name: 'B1', country: 'US' },
      placing: 1,
      record: { wins: 5, losses: 2, ties: 0 },
    });
  });

  it('matches word starts, any word of the name, id or icons, and ranks by recent top 8s', async () => {
    const index = await searchable();
    const ids = (query: string) => {
      const answer = index.search(query, 'STANDARD', 8);
      return answer.available
        ? answer.results.map((result) => result.archetype.id)
        : [];
    };
    expect(ids('drag')).toEqual(['dragapult-dusknoir']);
    expect(ids('dusknoir')).toEqual(['dragapult-dusknoir']);
    expect(ids('jelli')).toEqual(['gardevoir-jellicent']);
    // Not an exact name: by recent top 8s (two 1st/2nd at 500 players).
    expect(ids('garde')).toEqual(['gardevoir-jellicent', 'gardevoir-ex']);
    expect(ids('zzz')).toEqual([]);
  });

  it('keeps to the format, and takes best finishes from all time when none are recent', async () => {
    const index = await searchable();
    const expanded = index.search('gardevoir', 'EXPANDED', 8);
    expect(
      expanded.available &&
        expanded.results.map((result) => result.archetype.id)
    ).toEqual(['gardevoir-ex']);
    now = START + 200 * DAY;
    const later = index.search('dragapult', 'STANDARD', 8);
    expect(
      later.available &&
        later.results[0]!.best.map((finish) => finish.player.id)
    ).toEqual(['c1', 'a3']);
  });

  it('counts no placing from an event still running until it is read once over', async () => {
    limitless.tournaments = [
      tournament(1, { name: 'Weekly', players: 32, date: START - 3 * DAY }),
      tournament(2, { name: 'Live Cup', players: 200, date: START - 2 * HOUR }),
    ];
    limitless.standings.set(id(1), [standing('a', 9, dragapult)]);
    limitless.standings.set(id(2), [standing('b', 1, dragapult)]);
    const index = createIndex();
    await crawlUntilIdle(index);
    // A player opens the event while it runs: its standings so far show
    // there, and nowhere else.
    expect((await index.tournament(id(2))).kind).toBe('ok');
    const live = index.search('dragapult', 'STANDARD', 8);
    expect(
      live.available && live.results[0]!.best.map((finish) => finish.player.id)
    ).toEqual(['a']);
    expect(live.available && live.results[0]!.top8s).toBe(0);
    const view = index.archetype('dragapult-dusknoir', 'STANDARD', 90, 0, 50);
    expect(
      view.kind === 'ok' && view.finishes.map((finish) => finish.player.id)
    ).toEqual(['a']);
    now = START + 13 * HOUR;
    await crawlUntilIdle(index);
    const over = index.search('dragapult', 'STANDARD', 8);
    expect(
      over.available && over.results[0]!.best.map((finish) => finish.player.id)
    ).toEqual(['b', 'a']);
  });

  it('pages an archetype’s finishes, best first, from a window of days', async () => {
    limitless.tournaments = Array.from({ length: 60 }, (_, n) =>
      tournament(n + 1, { players: 100 + n, date: START - DAY - n * HOUR })
    );
    for (const row of limitless.tournaments) {
      limitless.standings.set(row.id, [standing('p', 1, dragapult)]);
    }
    const index = createIndex();
    await crawlUntilIdle(index);
    const first = index.archetype('dragapult-dusknoir', 'STANDARD', 90, 0, 50);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(first.finishes).toHaveLength(50);
    // Biggest event first among the 1st places.
    expect(first.finishes[0]!.tournament.players).toBe(159);
    expect(first.nextOffset).toBe(50);
    const second = index.archetype(
      'dragapult-dusknoir',
      'STANDARD',
      90,
      50,
      50
    );
    expect(second.kind === 'ok' && second.finishes).toHaveLength(10);
    expect(second.kind === 'ok' && second.nextOffset).toBeNull();
    const recent = index.archetype('dragapult-dusknoir', 'STANDARD', 2, 0, 50);
    expect(recent.kind === 'ok' && recent.finishes).toHaveLength(24);
    expect(index.archetype('nope', 'STANDARD', 90, 0, 50)).toEqual({
      kind: 'not_found',
    });
  });
});

describe('browsing tournaments', () => {
  it('lists indexable tournaments newest first, by format, size and name, a page at a time', async () => {
    limitless.tournaments = [
      tournament(1, {
        name: 'Pokémon League Cup',
        players: 40,
        date: START - 1 * DAY,
      }),
      tournament(2, {
        name: 'Weekly Showdown',
        players: 120,
        date: START - 2 * DAY,
      }),
      tournament(3, {
        name: 'Expanded Weekly',
        players: 30,
        date: START - 3 * DAY,
        format: 'EXPANDED',
      }),
      tournament(4, { name: 'Tiny', players: 4, date: START - 4 * DAY }),
      tournament(5, {
        name: 'Weekly Classic',
        players: 64,
        date: START - 5 * DAY,
      }),
    ];
    const index = createIndex();
    await crawl(index, 1);
    const list = (query: Partial<Parameters<DeckIndex['tournaments']>[0]>) =>
      index.tournaments({
        q: '',
        format: null,
        minimumPlayers: 0,
        before: null,
        pageSize: 10,
        ...query,
      });
    expect(list({}).tournaments.map((row) => row.id)).toEqual([
      id(1),
      id(2),
      id(3),
      id(5),
    ]);
    expect(
      list({ format: 'EXPANDED' }).tournaments.map((row) => row.id)
    ).toEqual([id(3)]);
    expect(
      list({ minimumPlayers: 64 }).tournaments.map((row) => row.id)
    ).toEqual([id(2), id(5)]);
    expect(list({ q: 'weekly' }).tournaments.map((row) => row.id)).toEqual([
      id(2),
      id(3),
      id(5),
    ]);
    expect(list({ q: 'pokemon cup' }).tournaments.map((row) => row.id)).toEqual(
      [id(1)]
    );
    const first = list({ pageSize: 2 });
    expect(first.tournaments.map((row) => row.id)).toEqual([id(1), id(2)]);
    expect(first.next).toEqual({ date: START - 2 * DAY, id: id(2) });
    const second = list({ pageSize: 2, before: first.next });
    expect(second.tournaments.map((row) => row.id)).toEqual([id(3), id(5)]);
    expect(second.next).toBeNull();
    expect(first.tournaments[0]).toEqual({
      id: id(1),
      name: 'Pokémon League Cup',
      date: new Date(START - DAY).toISOString(),
      format: 'STANDARD',
      players: 40,
      organizer: null,
      hasLists: null,
    });
  });
});

describe('a tournament a player opens', () => {
  it('is read at once if it never was, and two asking together share one read', async () => {
    limitless.tournaments = [tournament(1, { date: START - 3 * DAY })];
    limitless.standings.set(id(1), [
      standing('second', 2, gardevoir),
      standing('first', 1, dragapult),
      standing('gone', null, null),
    ]);
    const index = createIndex();
    await crawl(index, 1);
    const [one, two] = await Promise.all([
      index.tournament(id(1)),
      index.tournament(id(1)),
    ]);
    expect(limitless.standingsCalls()).toEqual([id(1)]);
    expect(one).toEqual(two);
    expect(one.kind).toBe('ok');
    if (one.kind !== 'ok') return;
    expect(one.settled).toBe(true);
    expect(one.tournament.hasLists).toBe(true);
    expect(
      one.standings.map((row) => [row.player.id, row.placing, row.hasList])
    ).toEqual([
      ['first', 1, true],
      ['second', 2, true],
      ['gone', null, false],
    ]);
    expect(one.standings[0]).toEqual({
      player: { id: 'first', name: 'FIRST', country: 'US' },
      placing: 1,
      record: { wins: 5, losses: 2, ties: 0 },
      dropped: false,
      archetype: dragapult,
      hasList: true,
    });
    // Read: the crawl doesn't read it again.
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toEqual([id(1)]);
  });

  it('is busy when the budget kept for players is spent', async () => {
    // Still running: the crawl leaves them alone, players don't.
    limitless.tournaments = Array.from({ length: 35 }, (_, n) =>
      tournament(n + 1, { date: START - 2 * HOUR })
    );
    for (const row of limitless.tournaments) {
      limitless.standings.set(row.id, [standing('p', 1, dragapult)]);
    }
    const index = createIndex();
    await crawl(index, 1);
    const answers = [];
    for (let n = 1; n <= 35; n += 1)
      answers.push(await index.tournament(id(n)));
    // Players have 15 of the five minutes' 30: the crawl keeps the rest.
    expect(answers.filter((answer) => answer.kind === 'ok')).toHaveLength(
      BUDGET.demand
    );
    const refused = answers.filter((answer) => answer.kind === 'busy');
    expect(refused).toHaveLength(35 - BUDGET.demand);
    // Until the first of them leaves the window.
    expect(refused[0]).toEqual({ kind: 'busy', retryAfterMs: BUDGET.windowMs });
    expect(limitless.standingsCalls()).toHaveLength(BUDGET.demand);
    // The crawl still has its own.
    expect(nextAllowedAt(index.budgetState(), 'crawl', now)).toBe(now);
  });

  it('is read again after a few minutes while under a day old', async () => {
    limitless.tournaments = [tournament(1, { date: START - 2 * HOUR })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    const first = await index.tournament(id(1));
    expect(first.kind === 'ok' && first.settled).toBe(false);
    await index.tournament(id(1));
    expect(limitless.standingsCalls()).toHaveLength(1);
    now += CRAWL_POLICY.liveRereadMs + 1;
    await index.tournament(id(1));
    expect(limitless.standingsCalls()).toHaveLength(2);
    // Read while it may have been running: read again once it is over.
    now = START + 13 * HOUR;
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toHaveLength(3);
  });

  it('waits between failed reads of an event read while young, and keeps what it read', async () => {
    limitless.tournaments = [tournament(1, { date: START - 2 * HOUR })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    await index.tournament(id(1));
    expect(limitless.standingsCalls()).toHaveLength(1);
    // Over now, but Limitless fails every read after.
    limitless.failStandings = 100;
    now = START + 13 * HOUR;
    await crawlUntil(index, START + 13 * HOUR + 30 * MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(2);
    // An hour, then two, between tries; then it is left as it was read.
    await crawlUntil(index, START + 14 * HOUR + 45 * MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(3);
    await crawlUntil(index, START + 17 * HOUR + 30 * MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(4);
    await crawlUntil(index, START + 30 * HOUR);
    expect(limitless.standingsCalls()).toHaveLength(4);
    const read = await index.tournament(id(1));
    expect(read.kind).toBe('ok');
  });

  it('spends no tries on failed live re-reads of an event still running', async () => {
    limitless.tournaments = [tournament(1, { date: START - HOUR })];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    await index.tournament(id(1));
    expect(limitless.standingsCalls()).toHaveLength(1);
    limitless.failStandings = 3;
    for (let n = 0; n < 3; n += 1) {
      now += 20 * MINUTE;
      expect((await index.tournament(id(1))).kind).toBe('ok');
    }
    expect(limitless.standingsCalls()).toHaveLength(4);
    // Over now: the crawl still reads it, as it would any event read live.
    now = START + 13 * HOUR;
    await crawlUntilIdle(index);
    expect(limitless.standingsCalls()).toHaveLength(5);
  });

  it('spends no tries on players’ failed reads of an event still running, or before the next try is due', async () => {
    limitless.tournaments = [
      tournament(1, { name: 'Big Cup', players: 300, date: START - HOUR }),
      tournament(2, {
        name: 'Late Cup',
        players: 300,
        date: START - 12 * HOUR - 5 * MINUTE,
      }),
    ];
    limitless.standings.set(id(1), [standing('a', 1, dragapult)]);
    limitless.standings.set(id(2), [standing('b', 1, gardevoir)]);
    const index = createIndex();
    await crawl(index, 1);
    // Limitless fails while players open both, a minute or two apart.
    limitless.failStandings = 6;
    for (let n = 0; n < 3; n += 1) {
      expect((await index.tournament(id(1))).kind).toBe('busy');
      expect((await index.tournament(id(2))).kind).toBe('busy');
      now += 2 * MINUTE;
    }
    // Back again: the crawl reads both once they are over.
    now = START + 13 * HOUR;
    await crawlUntil(index, START + 2 * DAY);
    for (const [deck, player] of [
      ['dragapult', 'a'],
      ['gardevoir', 'b'],
    ] as const) {
      const found = index.search(deck, 'STANDARD', 8);
      expect(
        found.available && found.results[0]?.best[0]?.player.id,
        deck
      ).toBe(player);
    }
  });

  it('reads an event read while running once it is over, though players’ reads fail meanwhile', async () => {
    limitless.tournaments = [
      tournament(1, { name: 'Live Cup', players: 200, date: START - 2 * HOUR }),
    ];
    limitless.standings.set(id(1), [standing('b', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    await index.tournament(id(1));
    // A ten-minute outage as it ends: the crawl's read fails, then two
    // players'.
    limitless.failStandings = 3;
    await crawlUntil(index, START + 10 * HOUR + MINUTE);
    expect(limitless.standingsCalls()).toHaveLength(2);
    now += 5 * MINUTE;
    await index.tournament(id(1));
    now += 5 * MINUTE;
    await index.tournament(id(1));
    expect(limitless.standingsCalls()).toHaveLength(4);
    // Limitless is back: the crawl's next try, an hour on, reads it.
    limitless.failStandings = 0;
    await crawlUntil(index, START + 12 * HOUR);
    expect(limitless.standingsCalls()).toHaveLength(5);
    const answer = await index.tournament(id(1));
    expect(answer.kind === 'ok' && answer.settled).toBe(false);
    const found = index.search('dragapult', 'STANDARD', 8);
    expect(found.available && found.results[0]?.best[0]?.player.id).toBe('b');
  });

  it('never counts an event read while running as final when every read after it fails', async () => {
    limitless.tournaments = [
      tournament(1, { name: 'Live Cup', players: 200, date: START - 2 * HOUR }),
    ];
    limitless.standings.set(id(1), [standing('b', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    await index.tournament(id(1));
    // Over, and Limitless fails every read until the tries run out.
    limitless.failStandings = 100;
    now = START + 13 * HOUR;
    await crawlUntil(index, START + 30 * HOUR);
    const unconfirmed = await index.tournament(id(1));
    expect(unconfirmed.kind).toBe('ok');
    expect(unconfirmed.kind === 'ok' && unconfirmed.settled).toBe(false);
    const search = index.search('dragapult', 'STANDARD', 8);
    expect(search.available && search.results).toEqual([]);
    // The weekly resync reads it again, and then it counts.
    limitless.failStandings = 0;
    now = START + 8 * DAY;
    await crawlUntilIdle(index);
    const confirmed = index.search('dragapult', 'STANDARD', 8);
    expect(
      confirmed.available &&
        confirmed.results[0]!.best.map((finish) => finish.player.id)
    ).toEqual(['b']);
  });

  it('is not found when unknown, skipped, or when the index is off', async () => {
    limitless.tournaments = [
      tournament(1, { date: START - 2 * DAY }),
      tournament(2, { date: START - 2 * DAY, players: 4 }),
    ];
    limitless.standings.set(id(1), [standing('p', 1, dragapult)]);
    const index = createIndex();
    await crawl(index, 1);
    expect(await index.tournament(id(9))).toEqual({ kind: 'not_found' });
    expect(await index.tournament(id(2))).toEqual({ kind: 'not_found' });
    const off = createIndex(false);
    expect(await off.step()).toBeNull();
    expect(await off.tournament(id(1))).toEqual({ kind: 'not_found' });
    expect(limitless.calls).toHaveLength(1);
  });

  it('gives one player’s list as text, credited', async () => {
    limitless.tournaments = [
      tournament(1, { name: 'Cup', date: START - 3 * DAY }),
    ];
    limitless.standings.set(id(1), [
      standing('first', 1, dragapult),
      standing('nolist', 2, gardevoir, false),
    ]);
    const index = createIndex();
    await crawlUntilIdle(index);
    const answer = await index.playerList(id(1), 'first');
    expect(answer).toEqual({
      kind: 'ok',
      text: 'Pokémon (4)\n4 Dragapult Dusknoir TWM 128\n\nEnergy (56)\n56 Psychic Energy MEE 13',
      archetype: dragapult,
      player: { id: 'first', name: 'FIRST', country: 'US' },
      tournament: {
        id: id(1),
        name: 'Cup',
        date: new Date(START - 3 * DAY).toISOString(),
        format: 'STANDARD',
        players: 64,
        organizer: null,
        hasLists: true,
      },
      settled: true,
    });
    expect(await index.playerList(id(1), 'nolist')).toEqual({
      kind: 'not_found',
    });
    expect(await index.playerList(id(1), 'nobody')).toEqual({
      kind: 'not_found',
    });
  });
});
