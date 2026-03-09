import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECK_FORMATS,
  isPocketCard,
  validateDeck,
} from '../core/deck-validation.mjs';

function makeGroup({ name, count, supertype = 'Pokémon', pocket = false }) {
  const image = pocket
    ? `https://example.com/tcgp/${name}.png`
    : `https://example.com/tcg/${name}.png`;

  return {
    [name]: {
      totalCount: count,
      cards: [
        {
          count,
          data: {
            id: `${name}-1`,
            name,
            supertype,
            image,
          },
        },
      ],
    },
  };
}

function buildDeck(groups) {
  return Object.assign({}, ...groups);
}

test('isPocketCard detects tcgp image paths', () => {
  assert.equal(isPocketCard({ image: 'https://example.com/tcgp/card.png' }), true);
  assert.equal(isPocketCard({ image: 'https://example.com/tcg/card.png' }), false);
});

test('valid 60-card TCG deck passes validation', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 4, supertype: 'Pokémon' }),
    makeGroup({ name: 'Switch', count: 4, supertype: 'Trainer' }),
    makeGroup({ name: 'Lightning Energy', count: 52, supertype: 'Energy' }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.TCG);
  assert.equal(result.isValid, true);
  assert.equal(result.totalCards, 60);
  assert.equal(result.errors.length, 0);
});

test('valid 20-card Pocket deck passes validation', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 2, supertype: 'Pokémon', pocket: true }),
    makeGroup({ name: 'Potion', count: 2, supertype: 'Trainer', pocket: true }),
    makeGroup({ name: 'Lightning Energy', count: 16, supertype: 'Energy', pocket: true }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.POCKET);
  assert.equal(result.isValid, true);
  assert.equal(result.totalCards, 20);
  assert.equal(result.errors.length, 0);
});

test('TCG deck fails when card count is not exactly 60', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 4, supertype: 'Pokémon' }),
    makeGroup({ name: 'Lightning Energy', count: 10, supertype: 'Energy' }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.TCG);
  assert.equal(result.isValid, false);
  assert.match(result.errors[0], /Deck must contain exactly 60 cards/);
});

test('Pocket deck fails when non-energy copies exceed 2', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 3, supertype: 'Pokémon', pocket: true }),
    makeGroup({ name: 'Lightning Energy', count: 17, supertype: 'Energy', pocket: true }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.POCKET);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('Pikachu has 3 copies (max 2).')));
});

test('TCG deck fails when non-energy copies exceed 4', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Switch', count: 5, supertype: 'Trainer' }),
    makeGroup({ name: 'Lightning Energy', count: 55, supertype: 'Energy' }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.TCG);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('Switch has 5 copies (max 4).')));
});

test('Energy cards are exempt from copy limits', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 4, supertype: 'Pokémon' }),
    makeGroup({ name: 'Lightning Energy', count: 56, supertype: 'Energy' }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.TCG);
  assert.equal(result.isValid, true);
});

test('mixed TCG and Pocket pools fail validation', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 2, supertype: 'Pokémon', pocket: true }),
    makeGroup({ name: 'Switch', count: 18, supertype: 'Trainer', pocket: false }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.POCKET);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('mix of TCG and Pocket cards')));
});

test('Pocket format rejects TCG cards', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 20, supertype: 'Energy', pocket: false }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.POCKET);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('Pocket format selected, but deck contains TCG cards.')));
});

test('TCG format rejects Pocket cards', () => {
  const deck = buildDeck([
    makeGroup({ name: 'Pikachu', count: 60, supertype: 'Energy', pocket: true }),
  ]);

  const result = validateDeck(deck, DECK_FORMATS.TCG);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('TCG format selected, but deck contains Pocket cards.')));
});
