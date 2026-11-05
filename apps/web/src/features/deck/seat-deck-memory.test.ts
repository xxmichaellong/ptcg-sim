// @vitest-environment happy-dom

import { deckListOf, type DeckCard } from '@ptcgsim/deck-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recallSeatDecks, rememberSeatDeck } from './seat-deck-memory.js';

const ROOM = 'ABCDEFGH2345';
const OTHER = 'ZZZZZZZZ2345';

const card = (name: string): DeckCard => ({
  id: 'TWM 130',
  name,
  category: 'Pokémon',
  image: 'https://assets/sv06/130/high.webp',
  facts: { stage: 'Basic', legal: { standard: true, expanded: true } },
});

const deck = (name: string) => deckListOf([{ card: card(name), count: 4 }]);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('seat deck memory', () => {
  it('keeps each seat’s deck with its room, the other seat’s as it was', () => {
    rememberSeatDeck(ROOM, 'main', {
      deck: deck('Ember'),
      label: { name: 'Ember ex', deckId: 'saved-1', format: 'standard' },
    });
    rememberSeatDeck(ROOM, 'alternate', { deck: deck('Frost') });
    const kept = recallSeatDecks(ROOM);
    expect(kept.main?.label).toEqual({
      name: 'Ember ex',
      deckId: 'saved-1',
      format: 'standard',
    });
    expect(kept.main?.deck[0]?.card.name).toBe('Ember');
    expect(kept.alternate?.deck[0]?.card.name).toBe('Frost');
    expect(kept.alternate?.label).toBeUndefined();
    // Another room's table gets none of them.
    expect(recallSeatDecks(OTHER)).toEqual({});
  });

  it('reads this tab’s first, then the browser’s latest', () => {
    rememberSeatDeck(ROOM, 'main', { deck: deck('Ember') });
    // A new tab: nothing in its session, the browser's latest still there.
    sessionStorage.clear();
    expect(recallSeatDecks(ROOM).main?.deck[0]?.card.name).toBe('Ember');
  });

  it('drops what is damaged, seat by seat, and keeps no empty deck', () => {
    rememberSeatDeck(ROOM, 'main', { deck: deck('Ember') });
    rememberSeatDeck(ROOM, 'alternate', { deck: deck('Frost') });
    const stored = JSON.parse(sessionStorage.getItem('ptcgsim.solo-decks.v1')!);
    stored.seats.alternate.deck = [{ card: { nope: true }, count: 4 }];
    sessionStorage.setItem('ptcgsim.solo-decks.v1', JSON.stringify(stored));
    localStorage.setItem('ptcgsim.solo-decks.v1', JSON.stringify(stored));
    const kept = recallSeatDecks(ROOM);
    expect(kept.main?.deck[0]?.card.name).toBe('Ember');
    expect(kept.alternate).toBeUndefined();
    sessionStorage.setItem('ptcgsim.solo-decks.v1', '{not json');
    localStorage.setItem('ptcgsim.solo-decks.v1', '{not json');
    expect(recallSeatDecks(ROOM)).toEqual({});
    rememberSeatDeck(ROOM, 'main', { deck: deckListOf([]) });
    expect(recallSeatDecks(ROOM)).toEqual({});
    // Not a room code at all: nothing written or read.
    rememberSeatDeck('not a room', 'main', { deck: deck('Ember') });
    expect(recallSeatDecks('not a room')).toEqual({});
  });
});
