import { describe, expect, it } from 'vitest';

import { DeckIndex } from './deck-index.js';
import { memoryIndexStorage } from './node-sql.test-support.js';
import type { FinishKey } from './store.js';
import { DeckIndexStore } from './store.js';

const START = Date.parse('2026-10-30T12:00:00.000Z');
const DAY = 86_400_000;
const hex = (n: number) => n.toString(16).padStart(24, '0');
const LIST =
  'Pokémon (4)\n4 Gardevoir ex SVI 86\n\nEnergy (56)\n56 Psychic Energy MEE 13';
const gardevoir = {
  id: 'gardevoir-ex',
  name: 'Gardevoir ex',
  icons: ['gardevoir'],
};
const dragapult = {
  id: 'dragapult-ex',
  name: 'Dragapult ex',
  icons: ['dragapult'],
};
const entry = (
  playerId: string,
  placing: number,
  archetype: typeof gardevoir
) => ({
  playerId,
  name: playerId,
  country: 'US',
  placing,
  wins: 5,
  losses: 1,
  ties: 0,
  dropped: false,
  archetype,
  list: LIST,
});

const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

/**
 * A big online event Gardevoir won (and took second at), and a Regional
 * where Dragapult finished 20th and Gardevoir 40th (a list there, but past
 * the top 32 that counts toward a deck's ranking).
 */
const seeded = () => {
  const storage = memoryIndexStorage();
  const index = new DeckIndex({
    storage,
    fetch: offline,
    now: () => START,
    enabled: false,
  });
  index.migrate();
  const store = new DeckIndexStore(storage);
  store.recordListed(
    [
      {
        id: hex(1),
        name: 'Online Cup',
        date: START - 3 * DAY,
        format: 'STANDARD',
        players: 512,
        organizerId: 1,
        indexable: true,
      },
      {
        id: hex(2),
        name: 'Regional Nice',
        date: START - 10 * DAY,
        format: 'STANDARD',
        players: 2_000,
        organizerId: 1,
        indexable: true,
      },
    ],
    START - 3 * DAY
  );
  const read = { now: START - 2 * DAY, etag: null, provisional: false };
  const hashes = new Map([[LIST, 'h1']]);
  store.recordStandings(
    hex(1),
    [entry('ann', 1, gardevoir), entry('bea', 2, gardevoir)],
    hashes,
    read
  );
  store.recordStandings(
    hex(2),
    [entry('cid', 20, dragapult), entry('dee', 40, gardevoir)],
    hashes,
    read
  );
  // The second is an official major (as Labs' lane records one).
  storage.sql.exec(
    `UPDATE tournaments SET kind = 'regional' WHERE id = ?`,
    hex(2)
  );
  return index;
};

const ids = (answer: ReturnType<DeckIndex['search']>) =>
  answer.available ? answer.results.map((result) => result.archetype.id) : [];

describe('majors first (ADR-037 §9)', () => {
  it('ranks a deck with a major result above one with online results alone', () => {
    const index = seeded();
    // Gardevoir's two online top 8s at 512 players outweigh Dragapult's
    // 20th place by count, but a major result comes first.
    expect(ids(index.search('ex', 'STANDARD', 8))).toEqual([
      'dragapult-ex',
      'gardevoir-ex',
    ]);
  });

  it('counts and shows majors alone when asked', () => {
    const index = seeded();
    const answer = index.search('ex', 'STANDARD', 8, { majors: true });
    if (!answer.available) throw new Error('unavailable');
    expect(
      answer.results.map((result) => [
        result.archetype.id,
        result.lists,
        result.best.map((finish) => finish.player.id),
      ])
    ).toEqual([
      ['dragapult-ex', 1, ['cid']],
      ['gardevoir-ex', 1, ['dee']],
    ]);
    expect(answer.results[0]!.best[0]!.tournament.kind).toBe('regional');
    // Every event: the online lists count too.
    const every = index.search('gardevoir', 'STANDARD', 8);
    expect(every.available && every.results[0]!.lists).toBe(3);
  });

  it('lists a deck’s major finishes before its online ones, a page at a time across both', () => {
    const index = seeded();
    const search = index.search('gardevoir', 'STANDARD', 8);
    if (!search.available) throw new Error('unavailable');
    // A 40th at a Regional before a 1st online.
    expect(search.results[0]!.best.map((finish) => finish.player.id)).toEqual([
      'dee',
      'ann',
      'bea',
    ]);
    const paged: string[] = [];
    let after: FinishKey | null = null;
    for (let page = 0; page < 5; page += 1) {
      const lists = index.archetype('gardevoir-ex', 'STANDARD', 90, after, 1);
      if (lists.kind !== 'ok') throw new Error(lists.kind);
      paged.push(...lists.finishes.map((finish) => finish.player.id));
      if (!lists.next) break;
      after = lists.next;
    }
    expect(paged).toEqual(['dee', 'ann', 'bea']);
    const majors = index.archetype('gardevoir-ex', 'STANDARD', 90, null, 10, {
      majors: true,
    });
    expect(
      majors.kind === 'ok' && majors.finishes.map((finish) => finish.player.id)
    ).toEqual(['dee']);
  });
});
