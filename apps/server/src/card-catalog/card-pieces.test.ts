import { describe, expect, it } from 'vitest';

import {
  wireSetJson,
  type TcgdexSetSummary,
  type WireCard,
} from './normalize.js';

const set = (id: string, series: string): TcgdexSetSummary => ({
  id,
  name: `Set ${id}`,
  released: '2021-01-01',
  seriesId: series,
  series,
  official: 300,
  total: 300,
});

/** A card as TCGdex's GraphQL API answers it, with what this needs. */
const tcgdex = (
  setId: string,
  localId: string,
  name: string,
  fields: Record<string, unknown> = {}
) => ({
  id: `${setId}-${localId}`,
  localId,
  name,
  category: 'Pokemon',
  hp: 310,
  types: ['Psychic'],
  image: `https://assets.tcgdex.net/en/x/${setId}/${localId}`,
  ...fields,
});

const built = (summary: TcgdexSetSummary, cards: readonly unknown[]) =>
  (
    JSON.parse(wireSetJson(summary, undefined, cards).json) as {
      readonly cards: readonly WireCard[];
    }
  ).cards;

const piecesOf = (cards: readonly WireCard[]) =>
  Object.fromEntries(cards.map((card) => [card.n, card.pz]));

describe('cards printed in pieces, from the catalog', () => {
  it('gives each V-UNION piece its quarter, in number order, by stage or by name', () => {
    // TCGdex's SWSH Black Star Promos (2026-10-29): Mewtwo's pieces have
    // the stage V-UNION, the first Morpeko's none.
    const promos = set('swshp', 'swsh');
    const union = (localId: string, name: string, stage: string | null) =>
      tcgdex('swshp', localId, name, { stage, suffix: 'V' });
    const cards = built(promos, [
      union('SWSH160', 'Mewtwo V-UNION', 'V-UNION'),
      union('SWSH159', 'Mewtwo V-UNION', 'V-UNION'),
      union('SWSH162', 'Mewtwo V-UNION', 'V-UNION'),
      union('SWSH161', 'Mewtwo V-UNION', 'V-UNION'),
      union('SWSH163', 'Zacian V-UNION', 'V-UNION'),
      union('SWSH164', 'Zacian V-UNION', 'V-UNION'),
      union('SWSH165', 'Zacian V-UNION', 'V-UNION'),
      union('SWSH166', 'Zacian V-UNION', 'V-UNION'),
      union('SWSH215', 'Morpeko V-UNION', null),
      union('SWSH216', 'Morpeko V-UNION', null),
      union('SWSH217', 'Morpeko V-UNION', null),
      union('SWSH218', 'Morpeko V-UNION', null),
      tcgdex('swshp', 'SWSH219', 'Pikachu', { stage: 'Basic' }),
    ]);
    const pieces = piecesOf(cards);
    expect(pieces['159']).toEqual({
      k: 'swshp:159:Mewtwo V-UNION',
      c: 2,
      r: 2,
      p: 0,
    });
    expect(['160', '161', '162'].map((number) => pieces[number])).toEqual(
      [1, 2, 3].map((p) => ({ k: 'swshp:159:Mewtwo V-UNION', c: 2, r: 2, p }))
    );
    expect(pieces['163']?.k).toBe('swshp:163:Zacian V-UNION');
    expect(pieces['166']?.p).toBe(3);
    expect(pieces['215']).toEqual({
      k: 'swshp:215:Morpeko V-UNION',
      c: 2,
      r: 2,
      p: 0,
    });
    expect(pieces['219']).toBeUndefined();
  });

  it("gives a LEGEND's halves top and bottom, read turned, the lower number on top", () => {
    // TCGdex's HeartGold & SoulSilver (2026-10-29): "Basic", suffix Legend.
    const hgss = set('hgss1', 'hgss');
    const half = (localId: string, name: string) =>
      tcgdex('hgss1', localId, name, { stage: 'Basic', suffix: 'Legend' });
    const pieces = piecesOf(
      built(hgss, [
        tcgdex('hgss1', '110', 'Typhlosion', {
          stage: 'Stage2',
          suffix: 'Prime',
        }),
        half('111', 'Ho-Oh LEGEND'),
        half('112', 'Ho-Oh LEGEND'),
        half('113', 'Lugia LEGEND'),
        half('114', 'Lugia LEGEND'),
      ])
    );
    expect(pieces['113']).toEqual({
      k: 'hgss1:113:Lugia LEGEND',
      c: 1,
      r: 2,
      p: 0,
      q: 1,
    });
    expect(pieces['114']?.p).toBe(1);
    expect(pieces['111']?.k).toBe('hgss1:111:Ho-Oh LEGEND');
    expect(pieces['110']).toBeUndefined();
  });

  it('gives a split Stadium its halves only where the split rule is printed', () => {
    // Mega Evolution—Delta Reign's Legendary Pyroduct, 94/95: not yet in
    // TCGdex, so made from the official preview and the rule printed on
    // the Japanese halves.
    const rule =
      "This card can't be played on its own. Combine the 2 kinds of this Stadium from your hand and play them as 1 Stadium.";
    const stadium = (localId: string, name: string, effect: string) =>
      tcgdex('me06', localId, name, {
        category: 'Trainer',
        trainerType: 'Stadium',
        effect,
        hp: null,
        types: null,
      });
    const pieces = piecesOf(
      built(set('me06', 'me'), [
        stadium(
          '094',
          'Legendary Pyroduct',
          `${rule} Each player's Fire Pokémon…`
        ),
        stadium(
          '095',
          'Legendary Pyroduct',
          `${rule} Each player's Fire Pokémon…`
        ),
        // Two printings of one ordinary Stadium side by side: not pieces.
        stadium('096', 'Ordinary Arena', 'Each Pokémon in play gets +10 HP.'),
        stadium('097', 'Ordinary Arena', 'Each Pokémon in play gets +10 HP.'),
      ])
    );
    expect(pieces['094']).toEqual({
      k: 'me06:94:Legendary Pyroduct',
      c: 2,
      r: 1,
      p: 0,
    });
    expect(pieces['095']?.p).toBe(1);
    expect(pieces['096']).toBeUndefined();
  });

  it('leaves a run short of a whole as it is', () => {
    const promos = set('swshp', 'swsh');
    const pieces = piecesOf(
      built(promos, [
        tcgdex('swshp', 'SWSH139', 'Pikachu V-UNION', { stage: 'V-UNION' }),
        tcgdex('swshp', 'SWSH140', 'Pikachu V-UNION', { stage: 'V-UNION' }),
        tcgdex('swshp', 'SWSH142', 'Pikachu V-UNION', { stage: 'V-UNION' }),
      ])
    );
    expect(Object.values(pieces).every((entry) => entry === undefined)).toBe(
      true
    );
  });
});
