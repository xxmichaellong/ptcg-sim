import { describe, expect, it } from 'vitest';

import {
  compareCardsBySupertype,
  flattenDeckToCardArray,
  getSortedDeckCardArray,
  sortCardsBySupertype,
} from './card-sort.js';
import type { DeckCard, DeckCardVariant } from './types.js';

const variant = (
  name: string,
  supertype: string,
  count: number,
  extra: DeckCard = {}
): DeckCardVariant => ({ data: { name, supertype, ...extra }, count });

describe('legacy deck sorting parity', () => {
  it('orders Pokémon before Trainer before Energy', () => {
    expect(
      compareCardsBySupertype(
        { supertype: 'Pokémon' },
        { supertype: 'Trainer' }
      )
    ).toBe(-1);
    expect(
      compareCardsBySupertype({ supertype: 'Trainer' }, { supertype: 'Energy' })
    ).toBe(-1);
    expect(
      compareCardsBySupertype({ supertype: 'Energy' }, { supertype: 'Pokémon' })
    ).toBe(1);
  });

  it('flattens grouped variants with their authoritative counts', () => {
    const cards = flattenDeckToCardArray({
      Pikachu: {
        totalCount: 2,
        cards: [variant('Pikachu', 'Pokémon', 2, { id: '1' })],
      },
      Switch: {
        totalCount: 1,
        cards: [variant('Switch', 'Trainer', 1, { id: '2' })],
      },
    });
    expect(cards.map((card) => card.count)).toEqual([2, 1]);
  });

  it('sorts cards in display priority order without mutating input', () => {
    const cards = [
      { name: 'Energy', supertype: 'Energy' },
      { name: 'Switch', supertype: 'Trainer' },
      { name: 'Pikachu', supertype: 'Pokémon' },
    ];
    expect(sortCardsBySupertype(cards).map((card) => card.supertype)).toEqual([
      'Pokémon',
      'Trainer',
      'Energy',
    ]);
    expect(cards[0]?.supertype).toBe('Energy');
  });

  it('sorts unknown supertypes last', () => {
    expect(
      sortCardsBySupertype([
        { name: 'Mystery', supertype: 'Unknown' },
        { name: 'Pikachu', supertype: 'Pokemon' },
      ]).map((card) => card.supertype)
    ).toEqual(['Pokemon', 'Unknown']);
  });

  it('flattens then sorts a grouped deck', () => {
    expect(
      getSortedDeckCardArray({
        Energy: {
          totalCount: 1,
          cards: [variant('Energy', 'Energy', 1, { id: '3' })],
        },
        Pikachu: {
          totalCount: 1,
          cards: [variant('Pikachu', 'Pokémon', 1, { id: '1' })],
        },
        Switch: {
          totalCount: 1,
          cards: [variant('Switch', 'Trainer', 1, { id: '2' })],
        },
      }).map((card) => card.supertype)
    ).toEqual(['Pokémon', 'Trainer', 'Energy']);
  });
});
