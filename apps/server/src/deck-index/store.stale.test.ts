import { describe, expect, it } from 'vitest';

import { DeckIndex } from './deck-index.js';
import { memoryIndexStorage } from './node-sql.test-support.js';
import { DeckIndexStore } from './store.js';

const START = Date.parse('2026-10-22T12:00:00.000Z');
const DAY = 86_400_000;
const hex = (n: number) => n.toString(16).padStart(24, '0');
const LIST =
  'Pokémon (4)\n4 Gardevoir ex SVI 86\n\nEnergy (56)\n56 Psychic Energy MEE 13';
const deck = {
  id: 'gardevoir-ex',
  name: 'Gardevoir ex',
  icons: ['gardevoir'],
};
const entry = (playerId: string, placing: number) => ({
  playerId,
  name: playerId,
  country: 'US',
  placing,
  wins: 5,
  losses: 1,
  ties: 0,
  dropped: false,
  archetype: deck,
  list: LIST,
});

const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

describe('rows stored before the reads were bounded', () => {
  it('are put right once on migrating: no username of dots, no player count past the bound, in any page, count or filter', async () => {
    const storage = memoryIndexStorage();
    const index = new DeckIndex({
      storage,
      fetch: offline,
      now: () => START,
      enabled: false,
    });
    index.migrate();
    const store = new DeckIndexStore(storage);
    // As an older build stored them: ".." was a username, and an event's
    // player count was any safe integer.
    store.recordListed(
      [
        {
          id: hex(1),
          name: 'Cup',
          date: START - 3 * DAY,
          format: 'STANDARD',
          players: 64,
          organizerId: 1,
          indexable: true,
        },
        {
          id: hex(2),
          name: 'Big',
          date: START - 3 * DAY,
          format: 'STANDARD',
          players: 5_000_000,
          organizerId: 1,
          indexable: true,
        },
      ],
      START - 3 * DAY
    );
    store.recordStandings(
      hex(1),
      [entry('..', 1), entry('alice', 2)],
      new Map([[LIST, 'h1']]),
      { now: START - 2 * DAY, etag: null, provisional: false }
    );
    store.recordStandings(hex(2), [entry('bob', 1)], new Map([[LIST, 'h1']]), {
      now: START - 2 * DAY,
      etag: null,
      provisional: false,
    });
    // Stored by schema 1; the next start migrates.
    store.setMeta('schema', '1');
    index.migrate();
    expect(store.getMeta('schema')).toBe('2');
    const search = index.search('gardevoir', 'STANDARD', 5);
    expect(
      search.available
        ? search.results[0]?.best.map((finish) => finish.player.id).sort()
        : search
    ).toEqual(['alice', 'bob']);
    // Counted as shown.
    expect(search.available ? search.results[0]?.lists : search).toBe(2);
    // Paged one at a time, every finish comes, the big event's included.
    const paged: string[] = [];
    let after = null;
    for (let page = 0; page < 5; page += 1) {
      const lists = index.archetype('gardevoir-ex', 'STANDARD', 90, after, 1);
      if (lists.kind !== 'ok') throw new Error(lists.kind);
      paged.push(...lists.finishes.map((finish) => finish.player.id));
      if (!lists.next) break;
      after = lists.next;
    }
    expect(paged.sort()).toEqual(['alice', 'bob']);
    const standings = await index.tournament(hex(1));
    expect(
      standings.kind === 'ok'
        ? standings.standings.map((row) => row.player.id)
        : standings
    ).toEqual(['alice']);
    const events = index.tournaments({
      q: '',
      format: null,
      minimumPlayers: 0,
      before: null,
      pageSize: 10,
    });
    for (const event of events.tournaments) {
      expect(event.players).toBeLessThanOrEqual(1_000_000);
    }
    // Its count unknown now, the big event is no 16-player event.
    expect(
      index
        .tournaments({
          q: '',
          format: null,
          minimumPlayers: 16,
          before: null,
          pageSize: 10,
        })
        .tournaments.map((event) => event.id)
    ).toEqual([hex(1)]);
  });
});
