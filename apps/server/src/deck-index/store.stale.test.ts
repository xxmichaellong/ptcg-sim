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
  it('reads out no username of dots and no player count past the bound', async () => {
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
    const search = index.search('gardevoir', 'STANDARD', 5);
    expect(
      search.available
        ? search.results[0]?.best.map((finish) => finish.player.id)
        : search
    ).toEqual(['alice']);
    const lists = index.archetype('gardevoir-ex', 'STANDARD', 90, null, 50);
    expect(
      lists.kind === 'ok'
        ? lists.finishes.map((finish) => finish.player.id)
        : lists
    ).toEqual(['alice']);
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
  });
});
