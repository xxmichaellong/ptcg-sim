import { describe, expect, it } from 'vitest';

import { deckCardFromCatalog, withCatalogFacts } from './catalog-deck.js';
import { decodeCatalog } from './catalog-wire.js';
import { sameDeckList } from './deck-list.js';

/** Cards printed to be played as another kind, as the server builds them. */
const catalog = decodeCatalog({
  v: 1,
  builtAt: '2026-10-30T00:00:00.000Z',
  source: 'TCGdex',
  sets: [
    {
      id: 'sm6',
      code: 'FLI',
      name: 'Forbidden Light',
      series: 'Sun & Moon',
      released: '2018-05-04',
      img: 'https://assets.tcgdex.net/en/sm/sm6/',
      cards: [
        {
          n: '116',
          nm: 'Unidentified Fossil',
          c: 'T',
          tt: 'Item',
          tx: 'Play this card as if it were a 60-HP Colorless Basic Pokémon. At any time during your turn (before your attack), you may discard this card from play.',
        },
        {
          n: '117',
          nm: 'Jaw Fossil',
          c: 'T',
          tt: 'Item',
          // A Fossil that only fetches a Pokémon: still a Trainer.
          tx: 'Look at the bottom 7 cards of your deck. You may reveal a Tyrunt you find there and put it onto your Bench.',
        },
        { n: '118', nm: 'Pikachu', c: 'P', st: 'Basic', hp: 60, ty: 'L' },
      ],
    },
    {
      id: 'ex13',
      code: 'HP',
      name: 'Holon Phantoms',
      series: 'EX',
      released: '2006-05-03',
      img: 'https://assets.tcgdex.net/en/ex/ex13/',
      cards: [
        {
          n: '44',
          nm: "Holon's Castform",
          c: 'P',
          st: 'Basic',
          hp: 50,
          ty: 'C',
        },
      ],
    },
    {
      id: 'base1',
      code: 'BS',
      name: 'Base Set',
      series: 'Base',
      released: '1999-01-09',
      img: 'https://assets.tcgdex.net/en/base/base1/',
      cards: [
        {
          n: '70',
          nm: 'Clefairy Doll',
          c: 'T',
          tt: 'Item',
          tx: 'Play Clefairy Doll as if it were a Basic Pokémon. While in play, Clefairy Doll counts as a Pokémon (instead of a Trainer card).',
        },
        {
          n: '21',
          nm: 'Electrode',
          c: 'P',
          st: 'Stage 1',
          hp: 80,
          ty: 'L',
          ab: [
            [
              'Pokémon Power',
              'Buzzap',
              // Verbatim from TCGdex (base1-21).
              "At any time during your turn (before your attack) you may Knock Out Electrode and attach it to 1 of your other Pokémon. If you do, chose a type of Energy. Electrode is now an Energy card (instead of a Pokémon) that provides 2 energy of that type. This power can't be used if Electrode is Asleep, Confused, or Paralyzed.",
            ],
          ],
        },
      ],
    },
  ],
});

const print = (id: string) => catalog.byId.get(id)!;

describe('cards played as another kind, from the catalog', () => {
  it('finds a Trainer played as a Basic Pokémon and a Pokémon attached as an Energy', () => {
    expect(deckCardFromCatalog(print('FLI 116')).playsAs).toBe('Pokémon');
    expect(deckCardFromCatalog(print('BS 70')).playsAs).toBe('Pokémon');
    expect(deckCardFromCatalog(print('HP 44')).playsAs).toBe('Energy');
    expect(deckCardFromCatalog(print('BS 21')).playsAs).toBe('Energy');
    // An ordinary Trainer, and an ordinary Pokémon, are only themselves.
    expect(deckCardFromCatalog(print('FLI 117')).playsAs).toBeUndefined();
    expect(deckCardFromCatalog(print('FLI 118')).playsAs).toBeUndefined();
  });

  it('gives a saved deck the fact once, then leaves it as it is', () => {
    const { playsAs: _, ...saved } = deckCardFromCatalog(print('FLI 116'));
    const list = [{ card: saved, count: 2 }];
    const upgraded = withCatalogFacts(list, catalog);
    expect(upgraded).not.toBe(list);
    expect(upgraded[0]!.card.playsAs).toBe('Pokémon');
    expect(upgraded[0]!.count).toBe(2);
    // Up to date: the same list back.
    const again = [{ card: upgraded[0]!.card, count: 2 }];
    expect(withCatalogFacts(again, catalog)).toBe(again);
    // And no longer the deck a seat holds without it: the seat takes the
    // upgrade to the table.
    expect(sameDeckList(list, upgraded)).toBe(false);
  });
});
