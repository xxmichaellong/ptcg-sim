import { describe, expect, it } from 'vitest';

import {
  DECK_FORMATS,
  detectDeckFormat,
  isPocketCard,
  validateDeck,
} from './deck-validation.js';
import type { Deck, DeckCardGroup } from './types.js';

const group = ({
  name,
  count,
  supertype = 'Pokémon',
  pocket = false,
}: {
  name: string;
  count: number;
  supertype?: string;
  pocket?: boolean;
}): Deck => ({
  [name]: {
    totalCount: count,
    cards: [
      {
        count,
        data: {
          id: `${name}-1`,
          name,
          supertype,
          image: `https://example.com/${pocket ? 'tcgp' : 'tcg'}/${name}.png`,
        },
      },
    ],
  },
});

const deck = (...groups: readonly Deck[]): Deck => Object.assign({}, ...groups);

describe('legacy deck validation parity', () => {
  it('detects both TCGdex and Limitless Pocket image paths', () => {
    expect(isPocketCard({ image: 'https://example.com/tcgp/card.png' })).toBe(
      true
    );
    expect(isPocketCard({ image: 'https://example.com/pocket/card.png' })).toBe(
      true
    );
    expect(isPocketCard({ image: 'https://example.com/tcg/card.png' })).toBe(
      false
    );
  });

  it('accepts a valid 60-card TCG deck', () => {
    const result = validateDeck(
      deck(
        group({ name: 'Pikachu', count: 4 }),
        group({ name: 'Switch', count: 4, supertype: 'Trainer' }),
        group({ name: 'Lightning Energy', count: 52, supertype: 'Energy' })
      ),
      DECK_FORMATS.TCG
    );
    expect(result).toMatchObject({ isValid: true, totalCards: 60, errors: [] });
  });

  it('accepts a valid 20-card Pocket deck', () => {
    const result = validateDeck(
      deck(
        group({ name: 'Pikachu', count: 2, pocket: true }),
        group({ name: 'Potion', count: 2, supertype: 'Trainer', pocket: true }),
        group({
          name: 'Lightning Energy',
          count: 16,
          supertype: 'Energy',
          pocket: true,
        })
      ),
      DECK_FORMATS.POCKET
    );
    expect(result).toMatchObject({ isValid: true, totalCards: 20, errors: [] });
  });

  it('requires the exact format deck size', () => {
    expect(
      validateDeck(
        deck(
          group({ name: 'Pikachu', count: 4 }),
          group({ name: 'Lightning Energy', count: 10, supertype: 'Energy' })
        ),
        DECK_FORMATS.TCG
      ).errors[0]
    ).toMatch(/Deck must contain exactly 60 cards/u);
  });

  it.each([
    [DECK_FORMATS.POCKET, 3, 17, 2],
    [DECK_FORMATS.TCG, 5, 55, 4],
  ] as const)(
    'enforces the %s non-energy copy limit',
    (format, copies, energy, limit) => {
      const result = validateDeck(
        deck(
          group({
            name: 'Pikachu',
            count: copies,
            pocket: format === DECK_FORMATS.POCKET,
          }),
          group({
            name: 'Energy',
            count: energy,
            supertype: 'Energy',
            pocket: format === DECK_FORMATS.POCKET,
          })
        ),
        format
      );
      expect(result.errors).toContain(
        `Pikachu has ${copies} copies (max ${limit}).`
      );
    }
  );

  it('exempts Energy cards from copy limits', () => {
    expect(
      validateDeck(
        deck(
          group({ name: 'Pikachu', count: 4 }),
          group({ name: 'Lightning Energy', count: 56, supertype: 'Energy' })
        ),
        DECK_FORMATS.TCG
      ).isValid
    ).toBe(true);
  });

  it('rejects mixed pools', () => {
    const result = validateDeck(
      deck(
        group({ name: 'Pikachu', count: 2, pocket: true }),
        group({ name: 'Switch', count: 18, supertype: 'Trainer' })
      ),
      DECK_FORMATS.POCKET
    );
    expect(
      result.errors.some((error) =>
        error.includes('mix of TCG and Pocket cards')
      )
    ).toBe(true);
  });

  it('detects mixed pools within variants of the same named group', () => {
    const mixed: DeckCardGroup = {
      totalCount: 20,
      cards: [
        {
          count: 10,
          data: { name: 'Pikachu', supertype: 'Energy', image: '/tcgp/a.png' },
        },
        {
          count: 10,
          data: { name: 'Pikachu', supertype: 'Energy', image: '/tcg/a.png' },
        },
      ],
    };
    expect(
      validateDeck({ Pikachu: mixed }, DECK_FORMATS.POCKET).errors.some(
        (error) => error.includes('mix of TCG and Pocket cards')
      )
    ).toBe(true);
  });

  it.each([
    [
      DECK_FORMATS.POCKET,
      false,
      'Pocket format selected, but deck contains TCG cards.',
    ],
    [
      DECK_FORMATS.TCG,
      true,
      'TCG format selected, but deck contains Pocket cards.',
    ],
  ] as const)('rejects the wrong pool for %s', (format, pocket, error) => {
    const count = format === DECK_FORMATS.POCKET ? 20 : 60;
    expect(
      validateDeck(
        group({ name: 'Energy', count, supertype: 'Energy', pocket }),
        format
      ).errors
    ).toContain(error);
  });
});

describe('legacy automatic format detection parity', () => {
  it.each([
    [10, 0, DECK_FORMATS.POCKET],
    [0, 10, DECK_FORMATS.TCG],
    [11, 9, DECK_FORMATS.POCKET],
    [9, 11, DECK_FORMATS.TCG],
    [10, 10, DECK_FORMATS.TCG],
  ] as const)('detects %i Pocket and %i TCG cards', (pocket, tcg, expected) => {
    const groups: Deck[] = [];
    if (pocket > 0)
      groups.push(group({ name: 'Pikachu', count: pocket, pocket: true }));
    if (tcg > 0) groups.push(group({ name: 'Charizard', count: tcg }));
    expect(detectDeckFormat(deck(...groups))).toBe(expected);
  });

  it('defaults an empty deck to TCG', () => {
    expect(detectDeckFormat({})).toBe(DECK_FORMATS.TCG);
  });
});
