// @vitest-environment happy-dom

import { deckListOf, type DeckCard } from '@ptcgsim/deck-core';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DeckBuilderStore } from './deck-builder-store.js';
import { useSeatDeckMemory } from './DeckBuilderSession.js';
import { recallSeatDecks, rememberSeatDeck } from './seat-deck-memory.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 'ABCDEFGH2345';
const card = (name: string): DeckCard => ({
  id: 'TWM 130',
  name,
  category: 'Pokémon',
  image: 'https://assets/sv06/130/high.webp',
  facts: { stage: 'Basic', legal: { standard: true, expanded: true } },
});
const deck = (name: string) => deckListOf([{ card: card(name), count: 4 }]);

const Probe = ({ store }: { readonly store: DeckBuilderStore }) => {
  useSeatDeckMemory(store, ROOM);
  return null;
};

const mount = async (store: DeckBuilderStore) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Probe, { store })));
  return root;
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.replaceChildren();
});

describe('the Solo room’s seats, kept with it', () => {
  it('keeps only a deck the room took, never an edit a kept table set aside', async () => {
    const store = new DeckBuilderStore({ alternateEnabled: true });
    const root = await mount(store);
    // An edit waiting when the page sits down at a game it keeps: counted
    // as on the table, nothing sent. Not kept.
    store.replaceDeck('main', deck('Edited'), { name: 'Edited' });
    await act(async () => store.forgetInstalls());
    expect(recallSeatDecks(ROOM).main).toBeUndefined();
    // A deck installed and taken: kept.
    store.replaceDeck('main', deck('Ember'), { name: 'Ember ex' });
    const receipt = store.beginNextDirtyInstall()!;
    expect(recallSeatDecks(ROOM).main).toBeUndefined();
    await act(async () => store.settleInstall(receipt, 'installed'));
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember ex');
    // Failed: what was kept stays.
    store.replaceDeck('main', deck('Frost'), { name: 'Frost ex' });
    const refused = store.beginNextDirtyInstall()!;
    await act(async () => store.settleInstall(refused, 'failed'));
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember ex');
    await act(async () => root.unmount());
  });

  it('keeps the deck that went once the room takes it, though the seat was edited since', async () => {
    const store = new DeckBuilderStore({ alternateEnabled: true });
    const root = await mount(store);
    store.replaceDeck('main', deck('Ember'), { name: 'Ember ex' });
    const sent = store.beginNextDirtyInstall()!;
    // Edited while it is on its way.
    store.replaceDeck('main', deck('Frost'), { name: 'Frost ex' });
    await act(async () => store.settleInstall(sent, 'installed'));
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember ex');
    expect(recallSeatDecks(ROOM).main?.deck[0]?.card.name).toBe('Ember');
    // The edit refused: the table still plays the deck kept.
    const refused = store.beginNextDirtyInstall()!;
    await act(async () => store.settleInstall(refused, 'failed'));
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember ex');
    // Taken: kept.
    const again = store.beginNextDirtyInstall()!;
    await act(async () => store.settleInstall(again, 'installed'));
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Frost ex');
    await act(async () => root.unmount());
  });

  it('keeps the deck the room takes after the screen has gone, and nothing after it', async () => {
    const store = new DeckBuilderStore({ alternateEnabled: true });
    const root = await mount(store);
    store.replaceDeck('main', deck('Ember'), { name: 'Ember ex' });
    const sent = store.beginNextDirtyInstall()!;
    // The tutorial opens while the room has yet to answer.
    await act(async () => root.unmount());
    store.settleInstall(sent, 'installed');
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember ex');
    // The practice table's decks are not this room's.
    store.replaceDeck('main', deck('Practice'), { name: 'Practice' });
    store.settleInstall(store.beginNextDirtyInstall()!, 'installed');
    store.replaceDeck('alternate', deck('Practice'), { name: 'Practice' });
    store.settleInstall(store.beginNextDirtyInstall()!, 'installed');
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember ex');
    expect(recallSeatDecks(ROOM).alternate).toBeUndefined();
    // Nothing on its way when the screen goes: nothing is kept after.
    const again = await mount(store);
    await act(async () => again.unmount());
    store.replaceDeck('alternate', deck('Later'), { name: 'Later' });
    store.settleInstall(store.beginNextDirtyInstall()!, 'installed');
    expect(recallSeatDecks(ROOM).alternate).toBeUndefined();
  });

  it('keeps a new name for the deck on the table, saved or renamed, but not for another deck', async () => {
    const store = new DeckBuilderStore({ alternateEnabled: true });
    const root = await mount(store);
    store.replaceDeck('main', deck('Ember'));
    const receipt = store.beginNextDirtyInstall()!;
    await act(async () => store.settleInstall(receipt, 'installed'));
    expect(recallSeatDecks(ROOM).main?.label).toBeUndefined();
    // Saved: the same cards, now the saved deck, nothing sent.
    await act(async () => {
      store.replaceDeck('main', deck('Ember'), {
        name: 'Ember ex',
        deckId: 'saved-1',
      });
    });
    expect(store.getSnapshot().slots.main.dirty).toBe(false);
    expect(recallSeatDecks(ROOM).main?.label).toEqual({
      name: 'Ember ex',
      deckId: 'saved-1',
    });
    // Renamed in the library: followed.
    await act(async () => {
      store.replaceDeck('main', deck('Ember'), {
        name: 'Ember 2',
        deckId: 'saved-1',
      });
    });
    expect(recallSeatDecks(ROOM).main?.label?.name).toBe('Ember 2');
    // A deck set aside as on the table, never sent: its name is not kept
    // over the deck the room took.
    store.replaceDeck('alternate', deck('Edited'));
    await act(async () => store.forgetInstalls());
    await act(async () => {
      store.replaceDeck('alternate', deck('Edited'), { name: 'Edited ex' });
    });
    expect(recallSeatDecks(ROOM).alternate).toBeUndefined();
    await act(async () => root.unmount());
  });

  it('puts the kept decks back on seats not being edited, as on the table', async () => {
    rememberSeatDeck(ROOM, 'alternate', {
      deck: deck('Frost'),
      label: { name: 'Frost ex' },
    });
    const store = new DeckBuilderStore({ alternateEnabled: true });
    const root = await mount(store);
    const alternate = store.getSnapshot().slots.alternate;
    expect(alternate.label?.name).toBe('Frost ex');
    // Already on the table: nothing to send.
    expect(alternate.dirty).toBe(false);
    await act(async () => root.unmount());
  });
});
