import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyDeck,
  addCard,
  removeCard,
  getDeckCounts,
  filterDeck,
  detectImportFormat,
} from '../core/deck-state.mjs';

function makeCard(overrides = {}) {
  return {
    id: 'sv1-25',
    name: 'Pikachu',
    supertype: 'Pokémon',
    images: { large: 'https://example.com/pikachu.png' },
    set: { id: 'sv1', name: 'Scarlet & Violet' },
    ...overrides,
  };
}

test('createEmptyDeck returns an empty object', () => {
  assert.deepEqual(createEmptyDeck(), {});
});

test('addCard creates a new grouped entry for the first card', () => {
  const deck = addCard(createEmptyDeck(), makeCard());

  assert.equal(deck.Pikachu.totalCount, 1);
  assert.equal(deck.Pikachu.cards.length, 1);
  assert.equal(deck.Pikachu.cards[0].count, 1);
});

test('addCard increments count for equivalent card variants', () => {
  const card = makeCard();
  let deck = addCard(createEmptyDeck(), card);
  deck = addCard(deck, { ...card, count: 99, image: 'ignored-difference' });

  assert.equal(deck.Pikachu.totalCount, 2);
  assert.equal(deck.Pikachu.cards.length, 1);
  assert.equal(deck.Pikachu.cards[0].count, 2);
});

test('addCard creates a second variant when cards are meaningfully different', () => {
  let deck = addCard(createEmptyDeck(), makeCard());
  deck = addCard(deck, makeCard({ id: 'sv1-26', image: 'https://example.com/variant.png' }));

  assert.equal(deck.Pikachu.totalCount, 2);
  assert.equal(deck.Pikachu.cards.length, 2);
});

test('removeCard decrements count for an existing card', () => {
  const card = makeCard();
  let deck = addCard(createEmptyDeck(), card);
  deck = addCard(deck, card);
  deck = removeCard(deck, card);

  assert.equal(deck.Pikachu.totalCount, 1);
  assert.equal(deck.Pikachu.cards[0].count, 1);
});

test('removeCard deletes the group when the last copy is removed', () => {
  const card = makeCard();
  let deck = addCard(createEmptyDeck(), card);
  deck = removeCard(deck, card);

  assert.equal(deck.Pikachu, undefined);
});

test('getDeckCounts returns pokemon, trainer, energy, and total counts', () => {
  let deck = createEmptyDeck();
  deck = addCard(deck, makeCard({ name: 'Pikachu', supertype: 'Pokémon', id: '1' }));
  deck = addCard(deck, makeCard({ name: 'Switch', supertype: 'Trainer', id: '2' }));
  deck = addCard(deck, makeCard({ name: 'Lightning Energy', supertype: 'Energy', id: '3' }));
  deck = addCard(deck, makeCard({ name: 'Lightning Energy', supertype: 'Energy', id: '3' }));

  assert.deepEqual(getDeckCounts(deck), {
    pokemon: 1,
    trainer: 1,
    energy: 2,
    total: 4,
  });
});

test('filterDeck returns only requested supertypes', () => {
  let deck = createEmptyDeck();
  deck = addCard(deck, makeCard({ name: 'Pikachu', supertype: 'Pokémon', id: '1' }));
  deck = addCard(deck, makeCard({ name: 'Switch', supertype: 'Trainer', id: '2' }));
  deck = addCard(deck, makeCard({ name: 'Lightning Energy', supertype: 'Energy', id: '3' }));

  const filtered = filterDeck(deck, { pokemon: true, trainer: false, energy: false });

  assert.deepEqual(Object.keys(filtered), ['Pikachu']);
  assert.equal(filtered.Pikachu.cards[0].data.supertype, 'Pokémon');
});

test('detectImportFormat recognizes simulator CSV header', () => {
  assert.equal(detectImportFormat('QTY,Name,Type,URL\n1,Pikachu,Pokémon,url'), 'ptcg-sim-csv');
  assert.equal(detectImportFormat('4 Pikachu'), 'unknown');
});
