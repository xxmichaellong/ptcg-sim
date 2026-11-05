// @vitest-environment happy-dom

import { deckListOf, type DeckCard } from '@ptcgsim/deck-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recallSeatDecks, rememberSeatDeck } from './seat-deck-memory.js';

const ROOM = 'ABCDEFGH2345';
const OTHER = 'ZZZZZZZZ2345';
const KEY = 'ptcgsim.solo-decks.v2';

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

  it('keeps each room’s seats apart, so an older tab never writes over the latest room’s', () => {
    // Room B opened in a second tab after A: A's tab goes on writing.
    rememberSeatDeck(OTHER, 'main', { deck: deck('Frost') });
    rememberSeatDeck(ROOM, 'main', { deck: deck('Ember') });
    sessionStorage.clear();
    expect(recallSeatDecks(OTHER).main?.deck[0]?.card.name).toBe('Frost');
    expect(recallSeatDecks(ROOM).main?.deck[0]?.card.name).toBe('Ember');
    // The last few rooms are kept, the oldest dropped.
    const rooms = [
      'AAAAAAAA2345',
      'BBBBBBBB2345',
      'CCCCCCCC2345',
      'DDDDDDDD2345',
    ];
    for (const code of rooms)
      rememberSeatDeck(code, 'main', { deck: deck(code) });
    expect(recallSeatDecks(OTHER)).toEqual({});
    for (const code of rooms) {
      expect(recallSeatDecks(code).main?.deck[0]?.card.name).toBe(code);
    }
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
    const stored = JSON.parse(sessionStorage.getItem(KEY)!);
    stored.rooms[0].seats.alternate.deck = [{ card: { nope: true }, count: 4 }];
    sessionStorage.setItem(KEY, JSON.stringify(stored));
    localStorage.setItem(KEY, JSON.stringify(stored));
    const kept = recallSeatDecks(ROOM);
    expect(kept.main?.deck[0]?.card.name).toBe('Ember');
    expect(kept.alternate).toBeUndefined();
    sessionStorage.setItem(KEY, '{not json');
    localStorage.setItem(KEY, '{not json');
    expect(recallSeatDecks(ROOM)).toEqual({});
    rememberSeatDeck(ROOM, 'main', { deck: deckListOf([]) });
    expect(recallSeatDecks(ROOM)).toEqual({});
    // A seat cleared forgets its deck; the other seat's stays.
    rememberSeatDeck(ROOM, 'main', { deck: deck('Ember') });
    rememberSeatDeck(ROOM, 'alternate', { deck: deck('Frost') });
    rememberSeatDeck(ROOM, 'main', { deck: deckListOf([]) });
    const left = recallSeatDecks(ROOM);
    expect(left.main).toBeUndefined();
    expect(left.alternate?.deck[0]?.card.name).toBe('Frost');
    // Not a room code at all: nothing written or read.
    rememberSeatDeck('not a room', 'main', { deck: deck('Ember') });
    expect(recallSeatDecks('not a room')).toEqual({});
  });
});
