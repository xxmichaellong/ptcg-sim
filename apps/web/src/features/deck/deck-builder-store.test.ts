import { describe, expect, it, vi } from 'vitest';

import {
  deckListOf,
  deckTotals,
  type DeckCard,
  type DeckList,
} from '@ptcgsim/deck-core';

import {
  DeckBuilderStore,
  type DeckInstallReceipt,
} from './deck-builder-store.js';

const card = (name: string, id = name.toLowerCase()): DeckCard => ({
  id,
  name,
  category: 'Pokémon',
  image: `https://cards.invalid/${id}.png`,
});

const deckWith = (entry: DeckCard, count = 1): DeckList =>
  deckListOf([{ card: entry, count }]);

const slotCount = (
  store: DeckBuilderStore,
  target: 'main' | 'alternate'
): number => deckTotals(store.getSnapshot().slots[target].deck).total;

describe('DeckBuilderStore', () => {
  it('starts with clean decks and a stable frozen snapshot', () => {
    const main = deckWith(card('Pikachu'));
    const alternate = deckWith(card('Eevee'), 2);
    const store = new DeckBuilderStore({
      mainDeck: main,
      alternateDeck: alternate,
    });
    const snapshot = store.getSnapshot();

    expect(store.getSnapshot()).toBe(snapshot);
    expect(snapshot).toMatchObject({
      target: 'main',
      alternateEnabled: true,
      hasDirtyDecks: false,
      slots: {
        main: { revision: 0, installedRevision: 0, dirty: false },
        alternate: { revision: 0, installedRevision: 0, dirty: false },
      },
    });
    expect(slotCount(store, 'main')).toBe(1);
    expect(slotCount(store, 'alternate')).toBe(2);
    expect(Object.isFrozen(snapshot.slots.main.deck)).toBe(true);
    expect(Object.isFrozen(snapshot.slots.main.deck[0])).toBe(true);
  });

  it('switches targets without losing either deck or conflating dirty state', () => {
    const store = new DeckBuilderStore();

    expect(store.addCard(card('Pikachu'))).toBe(true);
    expect(store.selectTarget('alternate')).toBe(true);
    expect(store.addCard(card('Eevee'))).toBe(true);
    expect(store.selectTarget('main')).toBe(true);

    expect(slotCount(store, 'main')).toBe(1);
    expect(slotCount(store, 'alternate')).toBe(1);
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    expect(store.getSnapshot().slots.alternate.dirty).toBe(true);
  });

  it('rejects alternate selection and mutation when the room disables it', () => {
    const alternate = deckWith(card('Eevee'));
    const store = new DeckBuilderStore({
      alternateEnabled: false,
      initialTarget: 'alternate',
      alternateDeck: alternate,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot().target).toBe('main');
    expect(store.selectTarget('alternate')).toBe(false);
    expect(store.addCard(card('Ditto'), 'alternate')).toBe(false);
    expect(store.replaceDeck('alternate', deckWith(card('Mew')))).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(slotCount(store, 'alternate')).toBe(1);
  });

  it('dynamically revokes alternate ownership without losing its retained deck', () => {
    const store = new DeckBuilderStore({
      alternateDeck: deckWith(card('Eevee')),
    });
    store.selectTarget('alternate');
    store.addCard(card('Ditto'));
    const receipt = store.beginNextDirtyInstall();

    expect(receipt?.target).toBe('alternate');
    expect(store.setAlternateEnabled(false)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      target: 'main',
      alternateEnabled: false,
      hasDirtyDecks: true,
      slots: {
        alternate: {
          revision: 1,
          installedRevision: 0,
          dirty: true,
        },
      },
    });
    expect(
      store.getSnapshot().slots.alternate.installingRevision
    ).toBeUndefined();
    expect(slotCount(store, 'alternate')).toBe(2);
    expect(store.settleInstall(receipt!, 'installed')).toBe(false);
    expect(store.addCard(card('Mew'), 'alternate')).toBe(false);
    expect(store.setAlternateEnabled(false)).toBe(false);

    expect(store.setAlternateEnabled(true)).toBe(true);
    expect(store.selectTarget('alternate')).toBe(true);
    expect(store.addCard(card('Mew'))).toBe(true);
    expect(slotCount(store, 'alternate')).toBe(3);
  });

  it('queues clean nonempty custody once for each fresh authority session', () => {
    const store = new DeckBuilderStore({
      mainDeck: deckWith(card('Pikachu')),
      alternateDeck: deckWith(card('Eevee')),
    });

    expect(store.prepareForNewSession()).toBe(true);
    expect(store.getSnapshot().slots).toMatchObject({
      main: { revision: 1, installedRevision: 0, dirty: true },
      alternate: { revision: 1, installedRevision: 0, dirty: true },
    });
    const prepared = store.getSnapshot();
    expect(store.prepareForNewSession()).toBe(false);
    expect(store.getSnapshot()).toBe(prepared);

    const receipt = store.beginNextDirtyInstall();
    expect(receipt?.target).toBe('main');
    expect(store.prepareForNewSession()).toBe(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 1,
      installedRevision: 0,
      dirty: true,
    });
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
    expect(store.settleInstall(receipt!, 'installed')).toBe(false);
  });

  it("installs a chosen deck in a restored game, even the last room's", () => {
    const deck = deckWith(card('Pikachu'));
    const store = new DeckBuilderStore({ mainDeck: deck });
    // Installed in the last room: choosing it again changes nothing.
    expect(store.replaceDeck('main', deck)).toBe(false);
    // A restored game keeps its table: nothing becomes dirty by itself...
    store.forgetInstalls();
    expect(store.getSnapshot().slots.main.dirty).toBe(false);
    // ...but the deck chosen for the seat goes on it.
    expect(store.replaceDeck('main', deck)).toBe(true);
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
  });

  it('does not invent installs for clean empty or disabled alternate custody', () => {
    const empty = new DeckBuilderStore();
    expect(empty.prepareForNewSession()).toBe(false);

    const explicitlyCleared = new DeckBuilderStore({
      mainDeck: deckWith(card('Pikachu')),
    });
    explicitlyCleared.clearDeck('main');
    const dirtyEmpty = explicitlyCleared.getSnapshot();
    expect(explicitlyCleared.prepareForNewSession()).toBe(false);
    expect(explicitlyCleared.getSnapshot()).toBe(dirtyEmpty);

    const multiplayer = new DeckBuilderStore({
      alternateEnabled: false,
      alternateDeck: deckWith(card('Eevee')),
    });
    expect(multiplayer.prepareForNewSession()).toBe(false);
    expect(multiplayer.getSnapshot().slots.alternate).toMatchObject({
      revision: 0,
      installedRevision: 0,
      dirty: false,
    });
    multiplayer.setAlternateEnabled(true);
    expect(multiplayer.prepareForNewSession()).toBe(true);
    expect(multiplayer.getSnapshot().slots.alternate.dirty).toBe(true);
  });

  it('does not dirty or publish for invalid additions and missing removals', () => {
    const store = new DeckBuilderStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(
      store.addCard({
        id: 'x',
        name: '',
        category: 'Pokémon',
        image: '/missing-name.png',
      })
    ).toBe(false);
    expect(store.removeCard(card('Missing'))).toBe(false);

    expect(store.getSnapshot().hasDirtyDecks).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('adds, removes, and clears the selected deck immutably', () => {
    const pikachu = card('Pikachu');
    const store = new DeckBuilderStore({ mainDeck: deckWith(pikachu, 2) });
    const original = store.getSnapshot().slots.main.deck;

    expect(store.addCard(pikachu)).toBe(true);
    expect(store.removeCard(pikachu)).toBe(true);
    expect(store.clearDeck()).toBe(true);
    expect(store.clearDeck()).toBe(false);

    expect(deckTotals(original).total).toBe(2);
    expect(slotCount(store, 'main')).toBe(0);
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 3,
      installedRevision: 0,
      dirty: true,
    });
  });

  it('relabels a seat without dirtying it when the cards are the same', () => {
    const pikachu = deckWith(card('Pikachu'));
    const store = new DeckBuilderStore({ mainDeck: pikachu });
    expect(
      store.replaceDeck('main', pikachu, { deckId: 'a', name: 'Mine' })
    ).toBe(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      label: { deckId: 'a', name: 'Mine' },
      revision: 0,
      dirty: false,
    });
    // The same cards read back from storage are a new object, not a new deck.
    expect(
      store.replaceDeck('main', deckListOf([...pikachu]), {
        deckId: 'a',
        name: 'Mine',
      })
    ).toBe(false);
    expect(store.replaceDeck('main', deckWith(card('Pikachu'), 2))).toBe(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      label: { deckId: 'a', name: 'Mine' },
      revision: 1,
      dirty: true,
    });
    expect(
      store.replaceDeck('main', store.getSnapshot().slots.main.deck, null)
    ).toBe(true);
    expect(store.getSnapshot().slots.main.label).toBeUndefined();
    expect(store.getSnapshot().slots.main.revision).toBe(1);
  });

  it('lets go of a saved deck when its seat is cleared or given other cards unlabelled', () => {
    const store = new DeckBuilderStore();
    store.replaceDeck('main', deckWith(card('Pikachu')), {
      deckId: 'saved',
      name: 'Saved',
    });
    expect(store.clearDeck('main')).toBe(true);
    expect(store.getSnapshot().slots.main.label).toBeUndefined();

    store.replaceDeck('main', deckWith(card('Pikachu')), {
      deckId: 'saved',
      name: 'Saved',
    });
    expect(store.replaceDeck('main', deckWith(card('Eevee')), null)).toBe(true);
    expect(store.getSnapshot().slots.main.label).toBeUndefined();
    // Adding a card keeps the seat's deck what it was.
    store.replaceDeck('main', deckWith(card('Pikachu')), {
      deckId: 'saved',
      name: 'Saved',
    });
    store.addCard(card('Eevee'));
    expect(store.getSnapshot().slots.main.label?.deckId).toBe('saved');
  });

  it('synchronizes an externally installed deck as clean without switching targets', () => {
    const store = new DeckBuilderStore();
    store.selectTarget('alternate');
    store.addCard(card('Draft'));

    const loaded = deckWith(card('Loaded'), 3);
    store.synchronizeDeck('main', loaded);

    expect(store.getSnapshot().target).toBe('alternate');
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 1,
      installedRevision: 1,
      dirty: false,
    });
    expect(slotCount(store, 'main')).toBe(3);
    expect(store.getSnapshot().slots.alternate.dirty).toBe(true);
  });

  it('serializes dirty installs in deterministic order, including an empty deck', () => {
    const store = new DeckBuilderStore({
      mainDeck: deckWith(card('Pikachu')),
      alternateDeck: deckWith(card('Eevee')),
    });
    store.clearDeck('main');
    store.addCard(card('Ditto'), 'alternate');

    const main = store.beginNextDirtyInstall();

    expect(main?.target).toBe('main');
    expect(main!.deck).toEqual([]);
    expect(Object.isFrozen(main)).toBe(true);
    expect(store.getSnapshot().slots.main.installingRevision).toBe(1);
    expect(
      store.getSnapshot().slots.alternate.installingRevision
    ).toBeUndefined();
    expect(store.beginNextDirtyInstall()).toBeUndefined();

    expect(store.settleInstall(main!, 'installed')).toBe(true);
    const alternate = store.beginNextDirtyInstall();
    expect(alternate?.target).toBe('alternate');
    expect(store.getSnapshot().slots.alternate.installingRevision).toBe(1);
  });

  it('marks a successful matching revision clean and leaves a failure retryable', () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'), 'main');
    store.addCard(card('Eevee'), 'alternate');
    const main = store.beginNextDirtyInstall();

    expect(store.settleInstall(main!, 'installed')).toBe(true);
    const alternate = store.beginNextDirtyInstall();
    expect(store.settleInstall(alternate!, 'failed')).toBe(true);

    expect(store.getSnapshot().slots.main.dirty).toBe(false);
    expect(store.getSnapshot().slots.alternate).toMatchObject({
      dirty: true,
    });
    expect(
      store.getSnapshot().slots.alternate.installingRevision
    ).toBeUndefined();
    expect(store.beginNextDirtyInstall()?.target).toBe('alternate');
  });

  it('keeps edits made during an install dirty after the older revision succeeds', () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const receipt = store.beginNextDirtyInstall();
    store.addCard(card('Eevee'));

    expect(store.settleInstall(receipt!, 'installed')).toBe(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 2,
      installedRevision: 1,
      dirty: true,
    });
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();

    const next = store.beginNextDirtyInstall();
    expect(next).toMatchObject({ target: 'main', revision: 2 });
    expect(slotCount(store, 'main')).toBe(2);
  });

  it('invalidates an in-flight receipt when an external synchronization wins', () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Draft'));
    const receipt = store.beginNextDirtyInstall();

    store.synchronizeDeck('main', deckWith(card('Authority')));

    expect(store.settleInstall(receipt!, 'installed')).toBe(false);
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 2,
      installedRevision: 2,
      dirty: false,
    });
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
    expect(
      store.getSnapshot().slots.main.deck.map((entry) => entry.card.name)
    ).toEqual(['Authority']);
  });

  it('rejects copied or foreign receipts without changing the pending install', () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const receipt = store.beginNextDirtyInstall();
    const copied: DeckInstallReceipt = { ...receipt! };
    const foreign = new DeckBuilderStore();

    expect(store.settleInstall(copied, 'installed')).toBe(false);
    expect(foreign.settleInstall(receipt!, 'installed')).toBe(false);
    expect(store.getSnapshot().slots.main.installingRevision).toBe(1);
    expect(store.settleInstall(receipt!, 'installed')).toBe(true);
  });

  it('notifies a snapshot-safe listener once per transition and unsubscribes idempotently', () => {
    const store = new DeckBuilderStore();
    const snapshots: unknown[] = [];
    const unsubscribe = store.subscribe(() =>
      snapshots.push(store.getSnapshot())
    );

    expect(store.selectTarget('main')).toBe(false);
    store.addCard(card('Pikachu'));
    store.selectTarget('alternate');
    unsubscribe();
    unsubscribe();
    store.addCard(card('Eevee'));

    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots).size).toBe(2);
  });
});
