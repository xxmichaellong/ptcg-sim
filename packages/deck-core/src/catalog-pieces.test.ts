import { describe, expect, it } from 'vitest';

import { deckCardFromCatalog, withCatalogFacts } from './catalog-deck.js';
import { decodeCatalog } from './catalog-wire.js';
import { deckListOf } from './deck-list.js';

const MEWTWO = 'swshp:159:Mewtwo V-UNION';

/** The SWSH promos with Mewtwo V-UNION's pieces, as the server builds them. */
const catalog = decodeCatalog({
  v: 1,
  builtAt: '2026-10-29T00:00:00.000Z',
  source: 'TCGdex',
  sets: [
    {
      id: 'swshp',
      code: 'SP',
      name: 'SWSH Black Star Promos',
      series: 'Sword & Shield',
      released: '2019-11-15',
      img: 'https://assets.tcgdex.net/en/swsh/swshp/',
      cards: [
        ...[0, 1, 2, 3].map((part) => ({
          n: String(159 + part),
          nm: 'Mewtwo V-UNION',
          c: 'P',
          st: 'V-UNION',
          hp: 310,
          ty: 'P',
          pz: { k: MEWTWO, c: 2, r: 2, p: part },
        })),
        {
          n: '163',
          nm: 'Zacian V-UNION',
          c: 'P',
          st: 'V-UNION',
          // Nothing that joins: a key too long, a part past the whole.
          pz: { k: 'x'.repeat(129), c: 2, r: 2, p: 0 },
        },
        {
          n: '164',
          nm: 'Zacian V-UNION',
          c: 'P',
          st: 'V-UNION',
          pz: { k: 'swshp:163:Zacian V-UNION', c: 2, r: 1, p: 2 },
        },
        { n: '165', nm: 'Pikachu', c: 'P', st: 'Basic' },
      ],
    },
  ],
});

const print = (id: string) => catalog.byId.get(id)!;

describe('cards printed in pieces, from the catalog', () => {
  it('reads where each piece sits in its whole, and leaves the rest without', () => {
    expect(print('SP 159').presentation).toEqual({
      readingQuarterTurns: 0,
      join: { key: MEWTWO, columns: 2, rows: 2, part: 0 },
    });
    expect(print('SP 162').presentation?.join.part).toBe(3);
    expect(print('SP 163').presentation).toBeUndefined();
    expect(print('SP 164').presentation).toBeUndefined();
    expect(print('SP 165').presentation).toBeUndefined();
  });

  it('gives a deck card its place in the whole', () => {
    expect(deckCardFromCatalog(print('SP 160')).presentation).toEqual({
      readingQuarterTurns: 0,
      join: { key: MEWTWO, columns: 2, rows: 2, part: 1 },
    });
    expect(deckCardFromCatalog(print('SP 165'))).not.toHaveProperty(
      'presentation'
    );
  });

  it('adds the place to a piece saved without it, and leaves a card laid out by hand', () => {
    const piece = deckCardFromCatalog(print('SP 161'));
    const { presentation: _place, ...saved } = piece;
    const handMade = {
      ...deckCardFromCatalog(print('SP 159')),
      id: 'custom:mewtwo',
      presentation: { readingQuarterTurns: 1 },
    };
    const list = deckListOf([
      { card: saved, count: 1 },
      { card: handMade, count: 1 },
    ]);
    const upgraded = withCatalogFacts(list, catalog);
    expect(upgraded[0]!.card.presentation).toEqual(piece.presentation);
    expect(upgraded[1]).toBe(list[1]);
    expect(withCatalogFacts(upgraded, catalog)).toBe(upgraded);
  });
});
