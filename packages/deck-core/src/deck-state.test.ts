import { describe, expect, it } from 'vitest';

import {
  addCard,
  createEmptyDeck,
  detectImportFormat,
  filterDeck,
  getDeckCounts,
  removeCard,
} from './deck-state.js';
import type { DeckCard } from './types.js';

const card = (overrides: DeckCard = {}): DeckCard => ({
  id: 'sv1-25',
  name: 'Pikachu',
  supertype: 'Pokémon',
  images: { large: 'https://example.com/pikachu.png' },
  set: { id: 'sv1', name: 'Scarlet & Violet' },
  ...overrides,
});

describe('legacy immutable deck-state parity', () => {
  it('creates an empty plain deck', () => {
    expect(createEmptyDeck()).toEqual({});
  });

  it('creates a grouped entry for the first card', () => {
    const deck = addCard(createEmptyDeck(), card());
    expect(deck.Pikachu?.totalCount).toBe(1);
    expect(deck.Pikachu?.cards).toHaveLength(1);
    expect(deck.Pikachu?.cards[0]?.count).toBe(1);
  });

  it('increments an equivalent variant while ignoring count and image', () => {
    const original = card();
    let deck = addCard({}, original);
    deck = addCard(deck, { ...original, count: 99, image: 'ignored' });
    expect(deck.Pikachu?.totalCount).toBe(2);
    expect(deck.Pikachu?.cards).toHaveLength(1);
    expect(deck.Pikachu?.cards[0]?.count).toBe(2);
  });

  it('creates a second meaningfully different variant', () => {
    let deck = addCard({}, card());
    deck = addCard(deck, card({ id: 'sv1-26', image: 'variant' }));
    expect(deck.Pikachu?.totalCount).toBe(2);
    expect(deck.Pikachu?.cards).toHaveLength(2);
  });

  it('decrements an existing card without mutating the prior deck', () => {
    const original = card();
    const one = addCard({}, original);
    const two = addCard(one, original);
    const result = removeCard(two, original);
    expect(result.Pikachu?.totalCount).toBe(1);
    expect(result.Pikachu?.cards[0]?.count).toBe(1);
    expect(two.Pikachu?.totalCount).toBe(2);
  });

  it('deletes the group when the last copy is removed', () => {
    const original = card();
    expect(removeCard(addCard({}, original), original).Pikachu).toBeUndefined();
  });

  it('does not retain a caller-owned card reference', () => {
    const mutable = {
      id: '1',
      name: 'Pikachu',
      supertype: 'Pokémon',
      set: { name: 'Original' },
    };
    const deck = addCard({}, mutable);
    mutable.set.name = 'Changed';
    expect(deck.Pikachu?.cards[0]?.data.set?.name).toBe('Original');
  });

  it('counts Pokémon, Trainer, Energy, and the total', () => {
    let deck = addCard({}, card({ name: 'Pikachu', id: '1' }));
    deck = addCard(
      deck,
      card({ name: 'Switch', supertype: 'Trainer', id: '2' })
    );
    deck = addCard(
      deck,
      card({ name: 'Lightning Energy', supertype: 'Energy', id: '3' })
    );
    deck = addCard(
      deck,
      card({ name: 'Lightning Energy', supertype: 'Energy', id: '3' })
    );
    expect(getDeckCounts(deck)).toEqual({
      pokemon: 1,
      trainer: 1,
      energy: 2,
      total: 4,
    });
  });

  it('filters requested supertypes', () => {
    let deck = addCard({}, card({ name: 'Pikachu', id: '1' }));
    deck = addCard(
      deck,
      card({ name: 'Switch', supertype: 'Trainer', id: '2' })
    );
    deck = addCard(
      deck,
      card({ name: 'Lightning Energy', supertype: 'Energy', id: '3' })
    );
    const filtered = filterDeck(deck, {
      pokemon: true,
      trainer: false,
      energy: false,
    });
    expect(Object.keys(filtered)).toEqual(['Pikachu']);
    expect(filtered.Pikachu?.cards[0]?.data.supertype).toBe('Pokémon');
  });

  it('safely supports card names that are object prototype keys', () => {
    const deck = addCard({}, card({ name: '__proto__' }));
    expect(Object.keys(deck)).toEqual(['__proto__']);
    expect(deck.__proto__?.totalCount).toBe(1);
    expect(Object.getPrototypeOf(deck)).toBe(Object.prototype);
  });
});

describe('deck import detection', () => {
  it('recognizes the simulator CSV header', () => {
    expect(detectImportFormat('QTY,Name,Type,URL\n1,Pikachu,Pokémon,url')).toBe(
      'ptcg-sim-csv'
    );
  });

  it('recognizes a UTF-8 BOM and rejects unknown formats', () => {
    expect(detectImportFormat('\uFEFFQTY,Name,Type,URL\r\n')).toBe(
      'ptcg-sim-csv'
    );
    expect(detectImportFormat('4 Pikachu')).toBe('unknown');
  });
});
