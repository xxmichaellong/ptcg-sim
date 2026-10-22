import type { DeckCard, DeckList } from '@ptcgsim/deck-core';
import { describe, expect, it } from 'vitest';

import { deckBoxToneOf } from './DeckBox.js';
import { finderMode } from './DeckHome.js';
import { finishName } from './TournamentDecks.js';

const card = (
  name: string,
  category: DeckCard['category'],
  id = name
): DeckCard => ({ id, name, category, image: `/${id}.png` });

describe('a deck box', () => {
  it('wears the colour of the basic Energy its deck plays most of', () => {
    const deck: DeckList = [
      { card: card('Dreepy', 'Pokémon'), count: 4 },
      { card: card('Psychic Energy', 'Energy'), count: 4 },
      { card: card('Fire Energy', 'Energy', 'SVE 2'), count: 3 },
      { card: card('Fire Energy', 'Energy', 'MEE 2'), count: 3 },
      { card: card('Jet Energy', 'Energy'), count: 4 },
    ];
    expect(deckBoxToneOf(deck)).toBe('Fire');
  });

  it('is plain for a deck with no basic Energy, or one not read yet', () => {
    expect(
      deckBoxToneOf([{ card: card('Double Turbo Energy', 'Energy'), count: 4 }])
    ).toBeUndefined();
    expect(deckBoxToneOf(undefined)).toBeUndefined();
  });
});

describe('the finder', () => {
  it("takes one line of words as a deck's name, and a list as a list", () => {
    expect(finderMode('')).toBe('empty');
    expect(finderMode('   ')).toBe('empty');
    expect(finderMode('Charizard')).toBe('search');
    expect(finderMode("N's Zoroark")).toBe('search');
    expect(finderMode('4 Dreepy TWM 128')).toBe('list');
    expect(finderMode('Pokémon: 12')).toBe('list');
    expect(finderMode('Pokemon (12)')).toBe('list');
    expect(finderMode('QTY,Name,Type,URL')).toBe('list');
    expect(finderMode('Charizard\nPidgeot')).toBe('list');
  });
});

describe("a tournament list's name", () => {
  it('reads as the current decks do: the deck, then its finish', () => {
    expect(finishName('Dragapult', 1, 285)).toBe('Dragapult — 1st of 285');
    expect(finishName('Gardevoir', 2, 67)).toBe('Gardevoir — 2nd of 67');
    expect(finishName('Lugia', 3, 40)).toBe('Lugia — 3rd of 40');
    expect(finishName('Lugia', 11, 40)).toBe('Lugia — 11th of 40');
    expect(finishName('Lugia', 22, 40)).toBe('Lugia — 22nd of 40');
    expect(finishName('Lugia', null, 40)).toBe('Lugia');
  });
});
