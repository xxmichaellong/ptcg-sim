// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { IDBDatabase as FakeIDBDatabase, IDBFactory } from 'fake-indexeddb';
import {
  checkDeck,
  deckCardFromCatalog,
  deckListOf,
  withCatalogFacts,
  type CatalogCard,
  type DeckCard,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeckLibrary,
  decodeSavedDeck,
  openIndexedDbDeckBackend,
  type DeckLibraryBackend,
  type DeckPatch,
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
  describe('automatic facts writes with delayed cross-tab messages', () => {
    const sharedDeck: SavedDeck = {
      id: 'shared',
      name: 'Original',
      format: 'standard',
      cards,
      createdAt: 1,
      updatedAt: 1,
    };
    const stamp = '1/2026-10-25T00:00:00Z';
    const upToDate = (deck: SavedDeck) => ({
      cards: deckListOf(
        deck.cards.map((entry) => ({
          ...entry,
          card: {
            ...entry.card,
            facts: {
              ...entry.card.facts,
              legal: { standard: false, expanded: true },
            },
          },
        }))
      ),
      factsFrom: stamp,
    });
    const tabs = async () => {
      const backend = (await openIndexedDbDeckBackend(new IDBFactory()))!;
      await backend.write([sharedDeck]);
      let receive: ((event: Event) => void) | undefined;
      const messages: unknown[] = [];
      const channel = {
        postMessage: vi.fn(),
        addEventListener: (_type: string, listener: (event: Event) => void) => {
          receive = listener;
        },
        removeEventListener: vi.fn(),
        close: vi.fn(),
      };
      const background = new DeckLibrary({
        backend,
        channel,
        writeDelayMs: 60_000,
      });
      const foreground = new DeckLibrary({
        backend,
        // Two edits can have the same timestamp. The automatic write must
        // compare the contents it started from, not just updatedAt.
        now: () => sharedDeck.updatedAt,
        channel: {
          ...channel,
          postMessage: (message: unknown) => messages.push(message),
          addEventListener: vi.fn(),
        },
        writeDelayMs: 60_000,
      });
      await vi.waitFor(() => {
        expect(background.getSnapshot().status).toBe('ready');
        expect(foreground.getSnapshot().status).toBe('ready');
      });
      return {
        backend,
        background,
        foreground,
        deliver: () => {
          for (const data of messages.splice(0)) {
            receive?.(new MessageEvent('message', { data }));
          }
        },
      };
    };

    const changes: readonly { field: string; patch: DeckPatch }[] = [
      { field: 'name', patch: { name: 'Newer name' } },
      { field: 'cards', patch: { cards: deckListOf([{ card, count: 2 }]) } },
      { field: 'format', patch: { format: 'expanded' } },
    ];
    it.each(changes)(
      'keeps a newer $field before its notification arrives, then refreshes facts from that deck',
      async ({ patch }) => {
        const { backend, background, foreground, deliver } = await tabs();
        try {
          background.update('shared', upToDate(background.get('shared')!), {
            touch: false,
          });
          const newer = foreground.update('shared', patch)!;
          await foreground.flush();
          // The background tab's timer runs before its queued channel event.
          await background.flush();
          expect(await backend.read('shared')).toEqual(newer);
          expect(background.get('shared')).toEqual(newer);
          deliver();
          await settle();
          background.update('shared', upToDate(background.get('shared')!), {
            touch: false,
          });
          await background.flush();
          expect(await backend.read('shared')).toEqual({
            ...newer,
            ...upToDate(newer),
          });
          expect(background.getSnapshot().status).toBe('ready');
        } finally {
          background.dispose();
          foreground.dispose();
        }
      }
    );

    it('never brings back a deck deleted before its notification arrives', async () => {
      const { backend, background, foreground, deliver } = await tabs();
      try {
        background.update('shared', upToDate(background.get('shared')!), {
          touch: false,
        });
        foreground.remove('shared');
        await foreground.flush();
        expect(await backend.read('shared')).toBeUndefined();
        await background.flush();
        expect(await backend.read('shared')).toBeUndefined();
        expect(background.get('shared')).toBeUndefined();
        deliver();
        await settle();
        expect(background.get('shared')).toBeUndefined();
      } finally {
        background.dispose();
        foreground.dispose();
      }
    });

    it('writes automatic facts when the stored deck is unchanged', async () => {
      const { backend, background, foreground } = await tabs();
      try {
        background.update('shared', upToDate(background.get('shared')!), {
          touch: false,
        });
        // A second automatic change still comes from the original stored
        // deck, not the first automatic update that has not been written.
        background.update('shared', { factsFrom: stamp }, { touch: false });
        await background.flush();
        expect(await backend.read('shared')).toMatchObject({
          name: 'Original',
          factsFrom: stamp,
          cards: [
            { count: 3, card: { facts: { legal: { standard: false } } } },
          ],
        });
      } finally {
        background.dispose();
        foreground.dispose();
      }
    });

    it('keeps deliberate edits on the ordinary write path', async () => {
      const { backend, background, foreground } = await tabs();
      try {
        foreground.update('shared', { name: 'From the other tab' });
        await foreground.flush();
        background.update('shared', { name: 'Chosen here' });
        await background.flush();
        expect(await backend.read('shared')).toMatchObject({
          name: 'Chosen here',
        });
      } finally {
        background.dispose();
        foreground.dispose();
      }
    });

    it('keeps the original condition through a failed automatic write', async () => {
      const { backend, background, foreground } = await tabs();
      const write = backend.write;
      try {
        background.update('shared', upToDate(background.get('shared')!), {
          touch: false,
        });
        backend.write = async () => {
          throw new Error('QuotaExceededError');
        };
        await background.flush();
        expect(background.getSnapshot().status).toBe('memory');
        backend.write = write;
        const newer = foreground.update('shared', { name: 'Newer name' })!;
        await foreground.flush();
        await background.flush();
        expect(await backend.read('shared')).toEqual(newer);
        expect(background.get('shared')).toEqual(newer);
        expect(background.getSnapshot().status).toBe('ready');
      } finally {
        backend.write = write;
        background.dispose();
        foreground.dispose();
      }
    });

    it('retains a player edit whose earlier write fails while an automatic write over it is in flight', async () => {
      const { backend, background, foreground } = await tabs();
      const write = backend.write;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let writes = 0;
      backend.write = async (...args) => {
        writes += 1;
        if (writes === 1) {
          await waiting;
          throw new Error('QuotaExceededError');
        }
        if (writes === 2) await waiting;
        return await write(...args);
      };
      try {
        background.update('shared', { name: 'Chosen here' });
        const playerWrite = background.flush();
        background.update('shared', upToDate(background.get('shared')!), {
          touch: false,
        });
        const automaticWrite = background.flush();
        release();
        await Promise.all([playerWrite, automaticWrite]);
        expect(background.get('shared')?.name).toBe('Chosen here');
        expect(background.getSnapshot().status).toBe('memory');
        await background.flush();
        expect(await backend.read('shared')).toMatchObject({
          name: 'Chosen here',
          factsFrom: stamp,
        });
        expect(background.getSnapshot().status).toBe('ready');
      } finally {
        backend.write = write;
        background.dispose();
        foreground.dispose();
      }
    });

    it('keeps a failed player write when a foreign notification discarded its pending automatic successor', async () => {
      const { backend, background, foreground, deliver } = await tabs();
      foreground.update('shared', { notes: 'From the other tab' });
      await foreground.flush();
      const transaction = FakeIDBDatabase.prototype.transaction;
      let abortNext = true;
      const abort = vi
        .spyOn(FakeIDBDatabase.prototype, 'transaction')
        .mockImplementation(function (this: IDBDatabase, ...args) {
          const active = transaction.apply(this, args);
          if (abortNext && args[1] === 'readwrite') {
            abortNext = false;
            active
              .objectStore('decks')
              .get('shared')
              .addEventListener('success', () => active.abort());
          }
          return active;
        });
      const read = backend.read;
      let readBack: Promise<unknown> | undefined;
      backend.read = (id) => {
        readBack = read(id);
        return readBack;
      };
      try {
        background.update('shared', { name: 'Chosen here' });
        const playerWrite = background.flush();
        background.update('shared', upToDate(background.get('shared')!), {
          touch: false,
        });
        // A foreign notification arrives before the player's abort has
        // settled. A storage read could otherwise replace its automatic
        // successor before that failure reaches the library.
        deliver();
        await playerWrite;
        await readBack;
        expect(background.get('shared')?.name).toBe('Chosen here');
        expect(background.getSnapshot().status).toBe('memory');
        await background.flush();
        expect(await backend.read('shared')).toMatchObject({
          name: 'Chosen here',
          factsFrom: stamp,
        });
        expect(background.getSnapshot().status).toBe('ready');
      } finally {
        abort.mockRestore();
        backend.read = read;
        background.dispose();
        foreground.dispose();
      }
    });

    it('settles a newer successful player write without retrying it after an earlier one fails', async () => {
      const { backend, background, foreground } = await tabs();
      const write = backend.write;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let writes = 0;
      backend.write = async (...args) => {
        writes += 1;
        if (writes === 1) {
          await waiting;
          throw new Error('QuotaExceededError');
        }
        await waiting;
        return await write(...args);
      };
      try {
        background.update('shared', { name: 'First choice' });
        const earlier = background.flush();
        background.update('shared', { name: 'Chosen here' });
        const newer = background.flush();
        release();
        await Promise.all([earlier, newer]);
        await background.flush();
        expect(writes).toBe(2);
        expect(await backend.read('shared')).toMatchObject({
          name: 'Chosen here',
        });
        expect(background.getSnapshot().status).toBe('ready');
      } finally {
        backend.write = write;
        background.dispose();
        foreground.dispose();
      }
    });

    it.each([false, true])(
      'shows a foreign edit after an earlier write succeeds, with a pending automatic successor: %s',
      async (automatic) => {
        const { backend, background, foreground, deliver } = await tabs();
        const write = backend.write;
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        let committed!: () => void;
        const atCommit = new Promise<void>((resolve) => {
          committed = resolve;
        });
        let first = true;
        backend.write = async (...args) => {
          const hold = first;
          first = false;
          const result = await write(...args);
          if (hold) {
            // The transaction has committed, but its caller has not settled
            // the result yet. Another tab can already commit its own edit.
            committed();
            await waiting;
          }
          return result;
        };
        try {
          background.update('shared', { name: 'Chosen here' });
          const earlier = background.flush();
          await atCommit;
          if (automatic) {
            background.update('shared', upToDate(background.get('shared')!), {
              touch: false,
            });
          }
          const foreign = foreground.update('shared', {
            name: 'From the other tab',
          })!;
          await foreground.flush();
          deliver();
          if (!automatic) {
            // Without queued automatic work the ordinary read-back policy
            // still shows the other tab's later commit at once.
            await vi.waitFor(() =>
              expect(background.get('shared')).toEqual(foreign)
            );
          }
          release();
          await earlier;
          // A retained automatic successor still has its original condition;
          // the earlier success must not make this overwrite the foreign edit.
          await background.flush();
          expect(await backend.read('shared')).toEqual(foreign);
          expect(background.get('shared')).toEqual(foreign);
          expect(background.getSnapshot().status).toBe('ready');
        } finally {
          release();
          backend.write = write;
          background.dispose();
          foreground.dispose();
        }
      }
    );
  });

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

  it('tries a removal that failed again, and only then says decks are kept', async () => {
    const { backend, records } = memoryBackend();
    const remove = backend.remove;
    let blocked = true;
    backend.remove = async (id) => {
      if (blocked) throw new Error('blocked');
      await remove(id);
    };
    let ids = 0;
    const library = new DeckLibrary({
      backend,
      writeDelayMs: 0,
      createId: () => `deck-${++ids}`,
    });
    await settle();
    library.create({ name: 'Gone', format: 'standard', cards });
    await settle();
    library.remove('deck-1');
    await settle();
    expect(library.getSnapshot().status).toBe('memory');

    // Another deck saves, but the removal still fails: still memory.
    library.create({ name: 'Other', format: 'standard', cards });
    await settle();
    expect(records.has('deck-1')).toBe(true);
    expect(library.getSnapshot().status).toBe('memory');

    blocked = false;
    await library.flush();
    expect(records.has('deck-1')).toBe(false);
    expect(library.getSnapshot().status).toBe('ready');
  });

  it('never brings back a deck whose removal is still on its way', async () => {
    const { backend, records } = memoryBackend();
    let receive: ((event: Event) => void) | undefined;
    const channel = {
      postMessage: vi.fn(),
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        receive = listener;
      },
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };
    let ids = 0;
    const library = new DeckLibrary({
      backend,
      channel,
      writeDelayMs: 0,
      createId: () => `deck-${++ids}`,
    });
    await settle();
    library.create({ name: 'Removed', format: 'standard', cards });
    library.create({ name: 'Edited', format: 'standard', cards });
    await settle();

    // A slow write holds the flush that carries the removal.
    const write = backend.write;
    let finishWrite!: () => void;
    backend.write = async (decks) => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      await write(decks);
    };
    library.update('deck-2', { name: 'Edited again' });
    library.remove('deck-1');
    await settle();
    // Another tab announces deck-1 meanwhile.
    receive?.(new MessageEvent('message', { data: { id: 'deck-1' } }));
    await settle();
    finishWrite();
    await settle();
    await settle();
    expect(library.get('deck-1')).toBeUndefined();
    expect(records.has('deck-1')).toBe(false);

    // Put back while a removal waits: the deck stays.
    backend.write = write;
    const removed = library.remove('deck-2')!;
    library.restore(removed);
    await settle();
    await settle();
    expect(records.has('deck-2')).toBe(true);
    expect(library.get('deck-2')?.name).toBe('Edited again');
  });

  it('reads back any deck it saved, however many different cards', async () => {
    const { backend } = memoryBackend();
    const library = new DeckLibrary({
      backend,
      writeDelayMs: 0,
      createId: () => 'huge',
    });
    await settle();
    const many = deckListOf(
      Array.from({ length: 401 }, (_, index) => ({
        card: {
          ...card,
          id: `X ${String(index)}`,
          name: `Card ${String(index)}`,
        },
        count: 1,
      }))
    );
    library.create({ name: 'Huge', format: 'unlimited', cards: many });
    await settle();
    const reloaded = new DeckLibrary({ backend });
    await settle();
    expect(reloaded.get('huge')?.cards).toHaveLength(401);
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

  it("drops a stored card's malformed rule facts, so the deck still checks", () => {
    const deck = decodeSavedDeck({
      id: 'a',
      name: 'Fine',
      format: 'standard',
      cards: [
        {
          card: {
            ...card,
            facts: { stage: 'Basic', tags: {}, legal: { standard: 'yes' } },
          },
          count: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(deck?.cards[0]?.card.facts).toEqual({ stage: 'Basic' });
    expect(() => checkDeck(deck!.cards, deck!.format)).not.toThrow();
  });

  it('reads back a deck as up to date with the catalog it was made from, so it is never saved again for it', () => {
    const set = {
      id: 'sv',
      code: 'SVX',
      name: 'X',
      series: 'Scarlet & Violet',
      released: '2024-01-01',
    };
    const print = {
      set,
      image: 'https://assets/high.webp',
      imageSmall: 'https://assets/low.webp',
      types: [],
      abilities: [],
      attacks: [],
      dex: [],
      legal: { standard: true, expanded: true },
    };
    // An ACE SPEC, a Radiant Pokémon, a marked Special Energy: facts whose
    // keys storage writes back in another order.
    const prints: CatalogCard[] = [
      {
        ...print,
        id: 'SVX 1',
        number: '1',
        name: 'Prime Catcher',
        printGroup: 'Prime Catcher',
        category: 'Trainer',
        trainerType: 'Item',
        tags: ['ACE SPEC'],
        regulationMark: 'H',
      },
      {
        ...print,
        id: 'SVX 2',
        number: '2',
        name: 'Radiant Greninja',
        printGroup: 'Radiant Greninja',
        category: 'Pokémon',
        stage: 'Basic',
        tags: ['Radiant'],
        regulationMark: 'F',
      },
      {
        ...print,
        id: 'SVX 3',
        number: '3',
        name: 'Jet Energy',
        printGroup: 'Jet Energy',
        category: 'Energy',
        energyType: 'Special',
        tags: [],
        regulationMark: 'G',
      },
    ];
    const catalog: LoadedCatalog = {
      builtAt: '2026-10-01T00:00:00Z',
      cards: prints,
      sets: [set],
      byId: new Map(prints.map((print) => [print.id, print])),
      byName: new Map(),
    };
    for (const print of prints) {
      const read = decodeSavedDeck(
        structuredClone({
          id: print.id,
          name: print.name,
          format: 'standard',
          cards: deckListOf([
            { card: deckCardFromCatalog(print, { catalog }), count: 1 },
          ]),
          createdAt: 1,
          updatedAt: 1,
        })
      )!;
      expect(withCatalogFacts(read.cards, catalog), print.name).toBe(
        read.cards
      );
    }
  });

  describe('with storage that runs one change after another, as IndexedDB does', () => {
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const inOrder = () => {
      const stored = new Map<string, unknown>();
      let chain: Promise<unknown> = Promise.resolve();
      const queue = <T>(change: () => T): Promise<T> => {
        const done = chain.then(async () => {
          await wait(10);
          return change();
        });
        chain = done.catch(() => undefined);
        return done;
      };
      return { stored, queue };
    };
    const record = (id: string, name = id) => ({
      id,
      name,
      format: 'standard',
      cards: [],
      createdAt: 1,
      updatedAt: 1,
    });

    it('says decks are kept again when a removal tried twice goes through once', async () => {
      const { stored, queue } = inOrder();
      for (const id of ['d1', 'd2']) stored.set(id, record(id));
      let removals = 0;
      const library = new DeckLibrary({
        backend: {
          readAll: () => queue(() => [...stored.values()]),
          read: (id) => queue(() => stored.get(id)),
          write: (decks) =>
            queue(() => {
              for (const deck of decks)
                stored.set(deck.id, structuredClone(deck));
            }),
          // Its second try at the first deck fails, the first went through.
          remove: (id) =>
            queue(() => {
              removals += 1;
              if (id === 'd1' && removals === 2) throw new Error('aborted');
              stored.delete(id);
            }),
        },
        writeDelayMs: 20,
      });
      await wait(30);
      library.remove('d1');
      await wait(2);
      // Its write tries the first removal again: marked until storage has it.
      library.remove('d2');
      await wait(200);
      library.create({
        name: 'New',
        format: 'standard',
        cards: deckListOf([]),
      });
      await wait(200);
      library.dispose();
      expect(stored.has('d1')).toBe(false);
      expect(library.getSnapshot().status).toBe('ready');
    });

    it("keeps this tab's write that failed and goes again over another tab's read back meanwhile", async () => {
      const { stored, queue } = inOrder();
      stored.set('d1', record('d1', 'Deck'));
      let failA = 1;
      let afterFailure: () => void = () => undefined;
      const backend = (tab: string): DeckLibraryBackend => ({
        readAll: () => queue(() => [...stored.values()]),
        read: (id) => queue(() => structuredClone(stored.get(id))),
        write: (decks) => {
          const copies = decks.map((deck) => structuredClone(deck));
          return queue(() => {
            if (tab === 'A' && failA > 0) {
              failA -= 1;
              setTimeout(() => afterFailure(), 0);
              throw new Error('aborted');
            }
            for (const deck of copies) stored.set(deck.id, deck);
          });
        },
        remove: (id) =>
          queue(() => {
            stored.delete(id);
          }),
      });
      const a = new DeckLibrary({
        backend: backend('A'),
        channel: new BroadcastChannel('library-in-order'),
        writeDelayMs: 50,
      });
      const b = new DeckLibrary({
        backend: backend('B'),
        channel: new BroadcastChannel('library-in-order'),
        writeDelayMs: 1,
      });
      await wait(40);
      a.update('d1', { name: 'Mine' });
      await wait(45);
      // Written before A's (which fails); A reads it back after.
      b.update('d1', { name: 'Theirs' });
      // A writes again at once (another deck made), its failed change with it.
      afterFailure = () => {
        a.create({ name: 'Other', format: 'standard', cards: deckListOf([]) });
      };
      await wait(300);
      a.dispose();
      b.dispose();
      expect(a.get('d1')?.name).toBe(
        (stored.get('d1') as { name: string }).name
      );
    });
  });
});
