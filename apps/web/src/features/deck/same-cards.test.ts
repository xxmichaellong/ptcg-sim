import type { DeckList } from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import { sameCards } from './same-cards.js';

const list = (...entries: [string, number][]): DeckList =>
  entries.map(([id, count]) => ({
    card: { id, name: id, category: 'Pokémon' },
    count,
  })) as unknown as DeckList;

describe('the same list of cards', () => {
  it('is the same cards in the same counts, in any order or split', () => {
    expect(sameCards(list(['a', 4], ['b', 2]), list(['b', 2], ['a', 4]))).toBe(
      true
    );
    expect(sameCards(list(['a', 4]), list(['a', 1], ['a', 3]))).toBe(true);
  });

  it('is not another list of the same name: a count or a card apart', () => {
    expect(sameCards(list(['a', 4], ['b', 2]), list(['a', 4], ['b', 1]))).toBe(
      false
    );
    expect(sameCards(list(['a', 4]), list(['a', 4], ['c', 1]))).toBe(false);
    expect(sameCards(list(['a', 4], ['c', 1]), list(['a', 4]))).toBe(false);
  });
});
