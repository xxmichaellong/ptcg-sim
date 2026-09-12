import { describe, expect, it } from 'vitest';

import {
  applyLocalControls,
  normalizeSearchQuery,
  prepareCardSearchTerm,
  resolveSearchPlan,
} from './card-search.js';

describe('legacy search-term normalization parity', () => {
  it.each([
    ['Pikachu', 'Pikachu'],
    ['E4', '4'],
    ['e4', '4'],
    ['Infernape E4', 'Infernape 4'],
    ['Infernape E4 LV.X', 'Infernape 4'],
    ['Infernape E4 LV. X', 'Infernape 4'],
    ['Torterra LV.X', 'Torterra LV. X'],
    ['Torterra LV. X', 'Torterra LV. X'],
    ['LV.X', 'LV. X'],
    ['prism star', '◇'],
    ['Prism Star', '◇'],
    ['◇', '◇'],
    ['{*}', '◇'],
    ['Mewtwo prism star', 'Mewtwo ◇'],
    ['Mewtwo {*}', 'Mewtwo ◇'],
    ['gold star', 'Star'],
    ['Gold Star', 'Star'],
    ['*', 'Star'],
    ['☆', 'Star'],
    ['Pikachu gold star', 'Pikachu Star'],
    ['Pikachu *', 'Pikachu Star'],
    ['Pikachu ☆', 'Pikachu Star'],
    ['delta', 'δ'],
    ['Delta', 'δ'],
    ['DELTA', 'δ'],
    ['δ', 'δ'],
    ['Charizard delta', 'Charizard δ'],
    ['Pikachu Delta', 'Pikachu δ'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSearchQuery(input)).toBe(expected);
  });
});

describe('legacy search-plan parity', () => {
  it('normalizes aliases before stripping surrounding API wildcards', () => {
    expect(prepareCardSearchTerm('*Pikachu*')).toBe('Pikachu');
    expect(prepareCardSearchTerm('*')).toBe('Star');
  });

  it('uses one name query for a plain name', () => {
    expect(resolveSearchPlan('Pikachu')).toEqual({
      type: 'name',
      queries: ['Pikachu'],
    });
  });

  it('uses the LEVEL-UP stage for an LV. X suffix', () => {
    expect(resolveSearchPlan('Torterra LV. X')).toEqual({
      type: 'stage',
      stage: 'LEVEL-UP',
      baseName: 'Torterra',
    });
  });

  it('supports standalone LV. X', () => {
    expect(resolveSearchPlan('LV. X')).toEqual({
      type: 'stage',
      stage: 'LEVEL-UP',
      baseName: '',
    });
  });

  it.each([
    ['Charizard EX', 'Charizard-EX'],
    ['Charizard-EX', 'Charizard EX'],
    ['Charizard GX', 'Charizard-GX'],
    ['Charizard-GX', 'Charizard GX'],
  ])('searches both database spellings for %s', (input, counterpart) => {
    const plan = resolveSearchPlan(input);
    expect(plan.type).toBe('name');
    if (plan.type === 'name') {
      expect(plan.queries).toContain(input);
      expect(plan.queries).toContain(counterpart);
    }
  });
});

describe('legacy local search controls parity', () => {
  const cards = [
    {
      id: 'b',
      name: 'Bulbasaur',
      image: 'https://example.com/tcg/bulba.png',
      set: { releaseDate: '2023-01-01', name: 'Set B' },
    },
    {
      id: 'a',
      name: 'Abra',
      image: 'https://example.com/tcg/abra.png',
      set: { releaseDate: '2024-01-01', name: 'Set A' },
    },
    {
      id: 'c',
      name: 'Charmander',
      image: 'https://example.com/tcgp/charmander.png',
      set: { releaseDate: '2022-01-01', name: 'Set C' },
    },
  ];

  it.each([
    ['name', 'asc', ['Abra', 'Bulbasaur', 'Charmander']],
    ['name', 'desc', ['Charmander', 'Bulbasaur', 'Abra']],
    ['releaseDate', 'desc', ['Abra', 'Bulbasaur', 'Charmander']],
    ['releaseDate', 'asc', ['Charmander', 'Bulbasaur', 'Abra']],
  ] as const)('sorts by %s %s', (sortBy, sortDirection, expected) => {
    expect(
      applyLocalControls(cards, {
        sortBy,
        sortDirection,
        cardType: 'all',
      }).map((card) => card.name)
    ).toEqual(expected);
  });

  it('filters TCG and Pocket cards locally', () => {
    expect(
      applyLocalControls(cards, {
        sortBy: 'name',
        sortDirection: 'asc',
        cardType: 'tcg',
      }).map((card) => card.name)
    ).toEqual(['Abra', 'Bulbasaur']);
    expect(
      applyLocalControls(cards, {
        sortBy: 'name',
        sortDirection: 'asc',
        cardType: 'pocket',
      }).map((card) => card.name)
    ).toEqual(['Charmander']);
  });

  it.each([
    ['asc', ['pikachu-old', 'pikachu-mid', 'pikachu-new']],
    ['desc', ['pikachu-new', 'pikachu-mid', 'pikachu-old']],
  ] as const)(
    'uses release date as the name-%s tie break',
    (direction, expected) => {
      const sameName = [
        {
          id: 'pikachu-old',
          name: 'Pikachu',
          image: 'old',
          set: { releaseDate: '2021-01-01' },
        },
        {
          id: 'pikachu-new',
          name: 'Pikachu',
          image: 'new',
          set: { releaseDate: '2024-01-01' },
        },
        {
          id: 'pikachu-mid',
          name: 'Pikachu',
          image: 'mid',
          set: { releaseDate: '2023-01-01' },
        },
      ];
      expect(
        applyLocalControls(sameName, {
          sortBy: 'name',
          sortDirection: direction,
        }).map((card) => card.id)
      ).toEqual(expected);
    }
  );

  it('does not mutate or truncate the source results', () => {
    const source = [...cards];
    expect(applyLocalControls(source, { sortBy: 'name' })).toHaveLength(3);
    expect(source.map((card) => card.name)).toEqual([
      'Bulbasaur',
      'Abra',
      'Charmander',
    ]);
  });
});
