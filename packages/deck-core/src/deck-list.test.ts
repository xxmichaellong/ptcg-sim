import { describe, expect, it } from 'vitest';

import {
  deckListOf,
  EMPTY_DECK_LIST,
  MAX_ENTRY_COUNT,
  type DeckCard,
} from './deck-list.js';

const card = (id: string, name = id): DeckCard => ({
  id,
  name,
  category: 'Pokémon',
  image: `https://assets/${id}.png`,
});

describe('a deck list built from entries', () => {
  it('merges repeats into the first one, in its place, counts kept whole and capped', () => {
    const first = card('a', 'First');
    const list = deckListOf([
      { card: first, count: 2 },
      { card: card('b'), count: 1.9 },
      { card: card('a', 'Again'), count: 3 },
      { card: card('c'), count: 0 },
      { card: card('d'), count: Number.NaN },
      { card: card('e'), count: MAX_ENTRY_COUNT },
      { card: card('e'), count: 5 },
    ]);
    expect(list.map((entry) => [entry.card.id, entry.count])).toEqual([
      ['a', 5],
      ['b', 1],
      ['e', MAX_ENTRY_COUNT],
    ]);
    expect(list[0]!.card.name).toBe('First');
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(deckListOf([])).toBe(EMPTY_DECK_LIST);
  });

  it('builds a 10,000-card list at once, as a file that big imports and loads', () => {
    const entries = Array.from({ length: 10_000 }, (_, n) => ({
      card: card(`card-${String(n)}`),
      count: 1,
    }));
    const started = performance.now();
    const list = deckListOf(entries);
    expect(performance.now() - started).toBeLessThan(500);
    expect(list).toHaveLength(10_000);
  });
});
