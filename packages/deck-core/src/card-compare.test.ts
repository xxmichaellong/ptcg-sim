import { describe, expect, it } from 'vitest';

import {
  areCardsEqual,
  determineCardType,
  isDatabaseCard,
  isFormattedDeckCard,
} from './card-compare.js';

describe('legacy card comparison parity', () => {
  it('identifies database cards with own id and images fields', () => {
    const card = { id: 'sv1-1', images: { large: 'x' } };
    expect(isDatabaseCard(card)).toBe(true);
    expect(determineCardType(card)).toBe('DatabaseCard');
  });

  it('identifies formatted cards with an own image field', () => {
    const card = { image: 'https://example.com/card.png' };
    expect(isFormattedDeckCard(card)).toBe(true);
    expect(determineCardType(card)).toBe('FormattedDeckCard');
  });

  it('rejects inherited shape markers', () => {
    expect(isFormattedDeckCard(Object.create({ image: 'inherited' }))).toBe(
      false
    );
  });

  it('returns Unknown for unsupported shapes', () => {
    expect(determineCardType({ name: 'Pikachu' })).toBe('Unknown');
  });

  it('ignores image and count differences at every object level', () => {
    expect(
      areCardsEqual(
        {
          id: 'sv1-25',
          name: 'Pikachu',
          count: 1,
          image: 'https://example.com/a.png',
          set: { id: 'sv1', image: 'a' },
        },
        {
          id: 'sv1-25',
          name: 'Pikachu',
          count: 4,
          image: 'https://example.com/b.png',
          set: { id: 'sv1', image: 'b' },
        }
      )
    ).toBe(true);
  });

  it('compares nested objects and arrays recursively', () => {
    const card = {
      id: 'sv1-25',
      set: { id: 'sv1', releaseDate: '2023-03-31' },
      attacks: [{ name: 'Thunder Jolt', damage: '30' }],
    };
    expect(areCardsEqual(card, structuredClone(card))).toBe(true);
  });

  it('returns false for meaningful differences', () => {
    expect(
      areCardsEqual(
        { id: 'sv1-25', name: 'Pikachu', set: { id: 'sv1' } },
        { id: 'sv1-26', name: 'Raichu', set: { id: 'sv1' } }
      )
    ).toBe(false);
  });

  it('returns false when required keys are missing', () => {
    expect(
      areCardsEqual(
        { id: 'sv1-25', name: 'Pikachu', set: { id: 'sv1' } },
        { id: 'sv1-25', set: { id: 'sv1' } }
      )
    ).toBe(false);
  });

  it('terminates for equivalent cyclic metadata', () => {
    const first: Record<string, unknown> = { id: 'a' };
    const second: Record<string, unknown> = { id: 'a' };
    first.self = first;
    second.self = second;
    expect(areCardsEqual(first, second)).toBe(true);
  });

  it('compares nested arrays by value', () => {
    expect(
      areCardsEqual(
        { matrix: [[1, 2], [{ value: 'same' }]] },
        { matrix: [[1, 2], [{ value: 'same' }]] }
      )
    ).toBe(true);
    expect(
      areCardsEqual(
        { matrix: [[1, 2], [{ value: 'first' }]] },
        { matrix: [[1, 2], [{ value: 'second' }]] }
      )
    ).toBe(false);
  });
});
