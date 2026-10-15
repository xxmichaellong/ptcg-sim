// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckCard } from '@ptcgsim/deck-core';

import {
  MAX_DECK_FILE_BYTES,
  deckFileName,
  downloadTextFile,
  installDeckBeforeUnloadGuard,
  readDeckFile,
} from './deck-browser-io.js';
import { DeckBuilderStore } from './deck-builder-store.js';

const card: DeckCard = {
  id: 'custom:pikachu',
  name: 'Pikachu',
  category: 'Pokémon',
  image: 'custom+unsafe://player-host/card.png?exact=yes',
};

const CSV = { name: 'deck.csv', type: 'text/csv;charset=utf-8' } as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('deck browser I/O', () => {
  it('reads a deck file as text, exactly', async () => {
    const source =
      'QTY,Name,Type,URL\n2,Pikachu,Pokémon,custom+unsafe://player-host/card.png?exact=yes';
    expect(
      await readDeckFile({
        size: new Blob([source]).size,
        text: async () => source,
      })
    ).toEqual({ ok: true, text: source });
  });

  it('refuses an oversized file before reading it', async () => {
    const text = vi.fn(async () => 'unreachable');
    expect(await readDeckFile({ size: MAX_DECK_FILE_BYTES + 1, text })).toEqual(
      {
        ok: false,
        reason: 'file_too_large',
      }
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('contains read rejection and cancellation before and after the read', async () => {
    const failed = await readDeckFile({
      size: 10,
      text: async () => {
        throw new Error('private path');
      },
    });
    expect(failed).toEqual({ ok: false, reason: 'read_failed' });

    const before = new AbortController();
    before.abort();
    const unread = vi.fn(async () => '');
    expect(
      await readDeckFile({ size: 0, text: unread }, { signal: before.signal })
    ).toEqual({ ok: false, reason: 'aborted' });
    expect(unread).not.toHaveBeenCalled();

    const after = new AbortController();
    const cancelled = readDeckFile(
      {
        size: 10,
        text: async () => {
          after.abort();
          return 'QTY,Name,Type,URL';
        },
      },
      { signal: after.signal }
    );
    expect(await cancelled).toEqual({ ok: false, reason: 'aborted' });
  });

  it('names files after the deck', () => {
    expect(deckFileName('Dragapult ex / Pidgeot ex', 'txt')).toBe(
      'Dragapult-ex-Pidgeot-ex.txt'
    );
    expect(deckFileName('Pokémon!!', 'csv')).toBe('Pokemon.csv');
    expect(deckFileName('???', 'csv')).toBe('deck.csv');
  });

  it('downloads exact text and revokes the temporary URL', async () => {
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return 'blob:deck';
    });
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    expect(
      downloadTextFile('QTY,Name,Type,URL\n1,Editable,,,', CSV, {
        document,
        url: { createObjectURL, revokeObjectURL },
      })
    ).toBe(true);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('deck.csv');
    expect(link.href).toBe('blob:deck');
    expect(link.isConnected).toBe(false);
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    expect(await blob?.text()).toBe('QTY,Name,Type,URL\n1,Editable,,,');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:deck');
  });

  it('contains unavailable and throwing download APIs while still cleaning up', () => {
    expect(
      downloadTextFile('x', CSV, { document, url: {} as typeof URL })
    ).toBe(false);

    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(
      downloadTextFile('x', CSV, {
        document,
        url: { createObjectURL: () => 'blob:blocked', revokeObjectURL },
      })
    ).toBe(false);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:blocked');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('requests unload confirmation only while a deck is dirty and detaches once', () => {
    const store = new DeckBuilderStore();
    let listener: ((event: BeforeUnloadEvent) => void) | undefined;
    const target = {
      addEventListener: vi.fn((_type, next) => {
        listener = next as (event: BeforeUnloadEvent) => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const remove = installDeckBeforeUnloadGuard(store, target);
    const clean = new Event('beforeunload', { cancelable: true });
    listener?.(clean as BeforeUnloadEvent);
    expect(clean.defaultPrevented).toBe(false);

    store.addCard(card);
    const dirty = new Event('beforeunload', { cancelable: true });
    listener?.(dirty as BeforeUnloadEvent);
    expect(dirty.defaultPrevented).toBe(true);

    remove();
    remove();
    expect(target.removeEventListener).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      'beforeunload',
      listener
    );
  });
});
