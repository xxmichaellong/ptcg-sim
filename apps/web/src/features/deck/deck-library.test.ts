// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { deckListOf, type DeckCard } from '@ptcgsim/deck-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeckLibrary,
  decodeSavedDeck,
  openIndexedDbDeckBackend,
  type DeckLibraryBackend,
  type SavedDeck,
} from './deck-library.js';

const card: DeckCard = {
  id: 'TWM 130',
  name: 'Dragapult ex',
  category: 'Pokémon',
  image: 'https://assets/sv06/130/high.webp',
  facts: { stage: 'Stage 2', legal: { standard: true, expanded: true } },
};
const cards = deckListOf([{ card, count: 3 }]);

/** A backend in memory, with the writes it was asked for. */
const memoryBackend = (initial: readonly unknown[] = []) => {
  const records = new Map<string, unknown>(
    initial.map((record) => [(record as { id: string }).id, record])
  );
  const writes: (readonly string[])[] = [];
  const backend: DeckLibraryBackend = {
    readAll: async () => [...records.values()],
    read: async (id) => records.get(id),
    write: async (decks) => {
      writes.push(decks.map((deck) => deck.id));
      for (const deck of decks) records.set(deck.id, structuredClone(deck));
    },
    remove: async (id) => {
      records.delete(id);
    },
  };
  return { backend, records, writes };
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the deck library', () => {
  it('creates, renames, edits and lists decks newest first', async () => {
    let now = 1_000;
    let ids = 0;
    const library = new DeckLibrary({
      backend: null,
      now: () => now,
      createId: () => `deck-${++ids}`,
    });
    expect(library.getSnapshot().status).toBe('memory');
    const first = library.create({
      name: '  Dragapult   ex  ',
      format: 'standard',
      cards,
    });
    now = 2_000;
    library.create({ name: '', format: 'expanded', cards: [] });
    expect(first.name).toBe('Dragapult ex');
    expect(library.getSnapshot().decks.map((deck) => deck.name)).toEqual([
      'Untitled deck',
      'Dragapult ex',
    ]);

    now = 3_000;
    const renamed = library.update('deck-1', {
      name: 'Ghosts',
      coverId: 'TWM 130',
    });
    expect(renamed).toMatchObject({
      name: 'Ghosts',
      coverId: 'TWM 130',
      updatedAt: 3_000,
      createdAt: 1_000,
    });
    expect(library.getSnapshot().decks[0]!.id).toBe('deck-1');
    expect(
      library.update('deck-1', { coverId: undefined })?.coverId
    ).toBeUndefined();
    expect(library.update('missing', { name: 'x' })).toBeUndefined();
    // A blank name keeps the old one.
    expect(library.update('deck-1', { name: '   ' })?.name).toBe('Ghosts');
  });

  it('duplicates, removes and restores', () => {
    let ids = 0;
    const library = new DeckLibrary({
      backend: null,
      createId: () => `deck-${++ids}`,
    });
    library.create({ name: 'Original', format: 'standard', cards });
    const copy = library.duplicate('deck-1');
    expect(copy).toMatchObject({
      name: 'Original (copy)',
      source: { kind: 'copy', label: 'Original' },
    });
    const removed = library.remove('deck-1');
    expect(library.get('deck-1')).toBeUndefined();
    library.restore(removed!);
    expect(library.get('deck-1')).toEqual(removed);
  });

  it('loads what storage holds, skipping records it cannot read', async () => {
    const good: SavedDeck = {
      id: 'kept',
      name: 'Kept',
      format: 'standard',
      cards,
      createdAt: 1,
      updatedAt: 2,
    };
    const { backend } = memoryBackend([
      good,
      {
        id: 'bad-format',
        name: 'x',
        format: 'vintage',
        cards: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'bad-card',
        name: 'x',
        format: 'standard',
        cards: [{ card: { id: 'a' }, count: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'bad-count',
        name: 'x',
        format: 'standard',
        cards: [{ card, count: 0 }],
        createdAt: 1,
        updatedAt: 1,
      },
      'not even an object',
    ]);
    const library = new DeckLibrary({ backend });
    expect(library.getSnapshot().status).toBe('loading');
    await settle();
    expect(library.getSnapshot()).toMatchObject({ status: 'ready' });
    expect(library.getSnapshot().decks.map((deck) => deck.id)).toEqual([
      'kept',
    ]);
    expect(library.get('kept')?.cards[0]?.card).toMatchObject({
      name: 'Dragapult ex',
      facts: { stage: 'Stage 2' },
    });
  });

  it('batches writes per deck and writes what is pending when the page hides', async () => {
    vi.useFakeTimers();
    const { backend, writes } = memoryBackend();
    const listeners = new Map<string, () => void>();
    const page = {
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      removeEventListener: vi.fn(),
    };
    let ids = 0;
    const library = new DeckLibrary({
      backend,
      createId: () => `deck-${++ids}`,
      writeDelayMs: 300,
      window: page as unknown as Window,
    });
    await vi.runOnlyPendingTimersAsync();
    library.create({ name: 'A', format: 'standard', cards });
    // A new deck is written at once.
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([['deck-1']]);
    library.update('deck-1', { name: 'B' });
    library.update('deck-1', { name: 'C' });
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(writes).toEqual([['deck-1'], ['deck-1']]);

    library.update('deck-1', { name: 'D' });
    listeners.get('pagehide')?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(3);
  });

  it('tells other tabs, and reads back what another tab changed', async () => {
    const { backend, records } = memoryBackend();
    const sent: unknown[] = [];
    let receive: ((event: Event) => void) | undefined;
    const channel = {
      postMessage: (message: unknown) => sent.push(message),
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        receive = listener;
      },
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };
    const library = new DeckLibrary({
      backend,
      channel,
      writeDelayMs: 0,
      createId: () => 'shared',
    });
    await settle();
    library.create({ name: 'Mine', format: 'standard', cards });
    await settle();
    await settle();
    expect(sent).toEqual([{ id: 'shared' }]);

    records.set('shared', {
      ...(records.get('shared') as object),
      name: 'Renamed elsewhere',
    });
    receive?.(new MessageEvent('message', { data: { id: 'shared' } }));
    await settle();
    expect(library.get('shared')?.name).toBe('Renamed elsewhere');

    records.delete('shared');
    receive?.(new MessageEvent('message', { data: { id: 'shared' } }));
    await settle();
    expect(library.get('shared')).toBeUndefined();
    library.dispose();
    expect(channel.close).toHaveBeenCalled();
  });

  it('keeps a change made here while another tab’s is read back', async () => {
    const { backend, records, writes } = memoryBackend();
    let receive: ((event: Event) => void) | undefined;
    const channel = {
      postMessage: vi.fn(),
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        receive = listener;
      },
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };
    const library = new DeckLibrary({
      backend,
      channel,
      writeDelayMs: 0,
      createId: () => 'shared',
    });
    await settle();
    library.create({ name: 'Mine', format: 'standard', cards });
    await settle();

    // The other tab's write lands, and the read of it is slow.
    records.set('shared', {
      ...(records.get('shared') as object),
      name: 'Older, from elsewhere',
    });
    let finishRead!: () => void;
    const read = backend.read;
    backend.read = async (id) => {
      const record = await read(id);
      await new Promise<void>((resolve) => {
        finishRead = resolve;
      });
      return record;
    };
    receive?.(new MessageEvent('message', { data: { id: 'shared' } }));
    await settle();
    // Changed here before the read comes back, and written.
    library.update('shared', { name: 'Newer, from here' });
    await settle();
    finishRead();
    await settle();
    expect(library.get('shared')?.name).toBe('Newer, from here');
    expect((records.get('shared') as SavedDeck).name).toBe('Newer, from here');
    expect(writes.at(-1)).toEqual(['shared']);
  });

  it('says so when a write fails after loading, and tries it again', async () => {
    const { backend, records } = memoryBackend();
    const write = backend.write;
    let full = true;
    backend.write = async (decks) => {
      if (full) throw new Error('QuotaExceededError');
      await write(decks);
    };
    const library = new DeckLibrary({
      backend,
      writeDelayMs: 0,
      createId: () => 'kept',
    });
    await settle();
    expect(library.getSnapshot().status).toBe('ready');
    library.create({ name: 'Not stored', format: 'standard', cards });
    await settle();
    expect(library.getSnapshot().status).toBe('memory');
    expect(library.get('kept')?.name).toBe('Not stored');

    // Room again: the next write takes the failed deck along.
    full = false;
    await library.flush();
    expect(library.getSnapshot().status).toBe('ready');
    expect((records.get('kept') as SavedDeck).name).toBe('Not stored');
  });

  it('keeps working for the visit when storage fails', async () => {
    const backend: DeckLibraryBackend = {
      readAll: async () => {
        throw new Error('blocked');
      },
      read: async () => undefined,
      write: async () => {
        throw new Error('full');
      },
      remove: async () => undefined,
    };
    const library = new DeckLibrary({ backend, writeDelayMs: 0 });
    await settle();
    expect(library.getSnapshot().status).toBe('memory');
    const deck = library.create({
      name: 'Still here',
      format: 'standard',
      cards,
    });
    await settle();
    expect(library.get(deck.id)?.name).toBe('Still here');
  });

  it('round trips through IndexedDB', async () => {
    const backend = await openIndexedDbDeckBackend(indexedDB);
    expect(backend).not.toBeNull();
    let ids = 0;
    const library = new DeckLibrary({
      backend,
      writeDelayMs: 0,
      createId: () => `idb-${++ids}`,
    });
    await settle();
    library.create({ name: 'Stored', format: 'expanded', cards });
    await library.flush();
    const reopened = new DeckLibrary({ backend });
    await settle();
    await settle();
    expect(reopened.get('idb-1')).toMatchObject({
      name: 'Stored',
      format: 'expanded',
      cards,
    });
  });

  it('decodes defensively', () => {
    expect(decodeSavedDeck(null)).toBeUndefined();
    expect(
      decodeSavedDeck({
        id: 'a',
        name: 'x'.repeat(81),
        format: 'standard',
        cards: [],
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined();
    expect(
      decodeSavedDeck({
        id: 'a',
        name: 'Fine',
        format: 'pocket',
        cards: [{ card: { ...card, category: 'Item' }, count: 1 }],
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBeUndefined();
  });
});
