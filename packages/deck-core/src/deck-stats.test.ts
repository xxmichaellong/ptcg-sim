import { describe, expect, it } from 'vitest';

import { deckListOf, type DeckCard } from './deck-list.js';
import { deckStats, handChance, sampleOpening } from './deck-stats.js';

const card = (
  id: string,
  category: DeckCard['category'],
  facts: DeckCard['facts']
): DeckCard => ({
  id,
  name: id,
  category,
  image: 'x',
  ...(facts ? { facts } : {}),
});

describe('deck stats', () => {
  it('works out opening-hand odds', () => {
    // 10 Basics in 60: C(50,7)/C(60,7) of hands have none.
    expect(handChance(60, 10, 7, 0)).toBeCloseTo(0.2586, 3);
    expect(handChance(60, 4, 7, 0)).toBeCloseTo(0.6005, 3);
    expect(handChance(60, 0, 7, 0)).toBe(1);
    expect(handChance(5, 1, 7, 0)).toBe(0);
  });

  it('counts a deck by kind', () => {
    const stats = deckStats(
      deckListOf([
        { card: card('a', 'Pokémon', { stage: 'Basic' }), count: 10 },
        { card: card('b', 'Pokémon', { stage: 'Stage 1' }), count: 4 },
        { card: card('c', 'Pokémon', undefined), count: 2 },
        { card: card('d', 'Trainer', { trainerType: 'Supporter' }), count: 12 },
        { card: card('e', 'Trainer', { trainerType: 'Item' }), count: 20 },
        {
          card: card('Fire Energy', 'Energy', { energyType: 'Basic' }),
          count: 10,
        },
        { card: card('f', 'Energy', { energyType: 'Special' }), count: 2 },
      ])
    );
    expect(stats).toMatchObject({
      total: 60,
      pokemon: 16,
      trainer: 32,
      energy: 12,
      basics: 10,
      unknownPokemon: 2,
      byTrainerType: { Supporter: 12, Item: 20 },
      basicEnergy: 10,
      specialEnergy: 2,
    });
    expect(stats.mulligan).toBeCloseTo(0.2586, 3);
    expect(stats.oneBasic).toBeGreaterThan(0.3);
    expect(deckStats([]).mulligan).toBe(0);
  });
});

describe('a sample opening', () => {
  it('deals seven and six Prizes from a shuffled deck', () => {
    const list = deckListOf([
      { card: card('a', 'Pokémon', { stage: 'Basic' }), count: 10 },
      { card: card('b', 'Trainer', { trainerType: 'Item' }), count: 50 },
    ]);
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const opening = sampleOpening(list, random);
    expect(opening.hand).toHaveLength(7);
    expect(opening.prizes).toHaveLength(6);
    const drawn = [...opening.hand, ...opening.prizes];
    expect(
      drawn.filter((entry) => entry.id === 'a').length
    ).toBeLessThanOrEqual(10);
    // A short deck deals what it has.
    expect(
      sampleOpening(deckListOf([{ card: card('a', 'Pokémon', {}), count: 3 }]))
        .hand
    ).toHaveLength(3);
  });
});
