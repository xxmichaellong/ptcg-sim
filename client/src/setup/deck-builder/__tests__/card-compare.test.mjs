import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDatabaseCard,
  isFormattedDeckCard,
  determineCardType,
  areCardsEqual,
} from '../core/card-compare.mjs';

test('isDatabaseCard identifies cards with id and images', () => {
  const card = { id: 'sv1-1', images: { large: 'x' } };
  assert.equal(isDatabaseCard(card), true);
  assert.equal(determineCardType(card), 'DatabaseCard');
});

test('isFormattedDeckCard identifies cards with image', () => {
  const card = { image: 'https://example.com/card.png' };
  assert.equal(isFormattedDeckCard(card), true);
  assert.equal(determineCardType(card), 'FormattedDeckCard');
});

test('determineCardType returns Unknown for unsupported shapes', () => {
  assert.equal(determineCardType({ name: 'Pikachu' }), 'Unknown');
});

test('areCardsEqual ignores image and count differences', () => {
  const a = {
    id: 'sv1-25',
    name: 'Pikachu',
    count: 1,
    image: 'https://example.com/a.png',
    set: { id: 'sv1', name: 'Scarlet & Violet' },
  };
  const b = {
    id: 'sv1-25',
    name: 'Pikachu',
    count: 4,
    image: 'https://example.com/b.png',
    set: { id: 'sv1', name: 'Scarlet & Violet' },
  };

  assert.equal(areCardsEqual(a, b), true);
});

test('areCardsEqual compares nested objects recursively', () => {
  const a = {
    id: 'sv1-25',
    set: { id: 'sv1', releaseDate: '2023-03-31' },
    attacks: [{ name: 'Thunder Jolt', damage: '30' }],
  };
  const b = {
    id: 'sv1-25',
    set: { id: 'sv1', releaseDate: '2023-03-31' },
    attacks: [{ name: 'Thunder Jolt', damage: '30' }],
  };

  assert.equal(areCardsEqual(a, b), true);
});

test('areCardsEqual returns false for meaningful differences', () => {
  const a = {
    id: 'sv1-25',
    name: 'Pikachu',
    set: { id: 'sv1' },
  };
  const b = {
    id: 'sv1-26',
    name: 'Raichu',
    set: { id: 'sv1' },
  };

  assert.equal(areCardsEqual(a, b), false);
});

test('areCardsEqual returns false when required keys are missing', () => {
  const a = { id: 'sv1-25', name: 'Pikachu', set: { id: 'sv1' } };
  const b = { id: 'sv1-25', set: { id: 'sv1' } };

  assert.equal(areCardsEqual(a, b), false);
});
