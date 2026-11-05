import { describe, expect, it } from 'vitest';

import {
  customCardIdOf,
  deckListOf,
  EMPTY_DECK_LIST,
  MAX_ENTRY_COUNT,
  sameDeckList,
  setCardText,
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

describe('a hand-made card’s own text (ADR-043)', () => {
  const made = {
    name: 'Homebrew',
    category: 'Pokémon' as const,
    image: '/a.png',
  };

  it('is the same card whatever order its text’s fields come in', () => {
    const one = customCardIdOf({
      ...made,
      text: {
        hp: 120,
        retreat: 1,
        attacks: [{ name: 'Splash', cost: ['Water'], damage: '30' }],
      },
    });
    const other = customCardIdOf({
      ...made,
      text: {
        attacks: [{ damage: '30', cost: ['Water'], name: 'Splash' }],
        retreat: 1,
        hp: 120,
      },
    });
    expect(other).toBe(one);
    expect(customCardIdOf({ ...made, text: { hp: 130, retreat: 1 } })).not.toBe(
      customCardIdOf({ ...made, text: { hp: 120, retreat: 1 } })
    );
  });

  it('is no change when saved again in another order', () => {
    const text = { hp: 120, retreat: 1 };
    const id = customCardIdOf({ ...made, text });
    const list = deckListOf([{ card: { ...made, id, text }, count: 2 }]);
    expect(setCardText(list, [id], { retreat: 1, hp: 120 })).toBe(list);
    const reordered = deckListOf([
      { card: { ...made, id, text: { retreat: 1, hp: 120 } }, count: 2 },
    ]);
    expect(sameDeckList(list, reordered)).toBe(true);
  });
});
