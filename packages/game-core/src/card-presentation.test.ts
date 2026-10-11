import { describe, expect, it } from 'vitest';
import {
  isCardPresentation,
  resolveCardPresentation,
} from './card-presentation.js';

describe('card artwork metadata', () => {
  it('recognizes documented printings without guessing positions from card names', () => {
    expect(
      resolveCardPresentation({
        name: 'Mewtwo V-UNION',
        imageUrl: 'https://images.pokemontcg.io/swshp/SWSH162_hires.png',
      })?.join
    ).toMatchObject({ part: 3, rows: 2, columns: 2 });
    expect(
      resolveCardPresentation({
        name: 'Lugia LEGEND',
        imageUrl: 'https://assets.tcgdex.net/en/hgss/hgss1/114/high.webp',
      })
    ).toMatchObject({
      readingQuarterTurns: 1,
      join: { part: 1, columns: 1, rows: 2 },
    });
    expect(resolveCardPresentation({ name: 'Greninja BREAK' })).toEqual({
      readingQuarterTurns: 1,
      overlay: 'upper-half',
    });
    expect(
      resolveCardPresentation({
        name: 'Mewtwo V-UNION',
        imageUrl: '/unknown-print.png',
      })
    ).toBeUndefined();
    expect(resolveCardPresentation({ name: 'Legend Box' })).toBeUndefined();
  });
  it('bounds custom layouts, rejects conflicting descriptors, and permits three pieces', () => {
    expect(
      isCardPresentation({
        readingQuarterTurns: 0,
        join: { key: 'custom', columns: 3, rows: 1, part: 2 },
      })
    ).toBe(true);
    for (const join of [
      { key: ' ', columns: 2, rows: 2, part: 0 },
      { key: 'x', columns: 2, rows: 2, part: 4 },
      { key: 'x', columns: 4, rows: 4, part: 0 },
    ])
      expect(isCardPresentation({ readingQuarterTurns: 0, join })).toBe(false);
    expect(
      isCardPresentation({
        readingQuarterTurns: 0,
        overlay: 'upper-half',
        join: { key: 'x', columns: 2, rows: 1, part: 0 },
      })
    ).toBe(false);
    expect(
      resolveCardPresentation({
        name: 'Greninja BREAK',
        presentation: { readingQuarterTurns: 0 },
      })
    ).toEqual({ readingQuarterTurns: 0 });
  });
});
