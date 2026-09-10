// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Deck, DeckCard } from '@ptcgsim/deck-core';

import {
  DECK_CSV_FILENAME,
  MAX_DECK_CSV_FILE_BYTES,
  downloadDeckCsv,
  downloadDeckCsvText,
  importDeckCsvFile,
  installDeckBeforeUnloadGuard,
} from './deck-browser-io.js';
import { DeckBuilderStore } from './deck-builder-store.js';

const card: DeckCard = {
  name: 'Pikachu',
  supertype: 'Pokémon',
  image: 'custom+unsafe://player-host/card.png?exact=yes',
};

const deck: Deck = {
  Pikachu: { cards: [{ data: card, count: 2 }], totalCount: 2 },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('deck browser I/O', () => {
  it('imports legacy CSV without applying a URL scheme or host policy', async () => {
    const source =
      'QTY,Name,Type,URL\n2,Pikachu,Pokémon,custom+unsafe://player-host/card.png?exact=yes';
    const result = await importDeckCsvFile({
      size: new Blob([source]).size,
      text: async () => source,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.deck.Pikachu?.cards[0]?.data.image).toBe(
      'custom+unsafe://player-host/card.png?exact=yes'
    );
  });

  it('rejects oversized metadata before reading and parser failures atomically', async () => {
    const text = vi.fn(async () => 'unreachable');
    expect(
      await importDeckCsvFile({ size: MAX_DECK_CSV_FILE_BYTES + 1, text })
    ).toEqual({ ok: false, reason: 'file_too_large' });
    expect(text).not.toHaveBeenCalled();

    const invalid = await importDeckCsvFile({
      size: 10,
      text: async () => 'not a deck',
    });
    expect(invalid).toMatchObject({
      ok: false,
      reason: 'invalid_csv',
      issues: [{ code: 'invalid_header' }],
    });
  });

  it('contains read rejection and cancellation before and after the read', async () => {
    const failed = await importDeckCsvFile({
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
      await importDeckCsvFile(
        { size: 0, text: unread },
        { signal: before.signal }
      )
    ).toEqual({ ok: false, reason: 'aborted' });
    expect(unread).not.toHaveBeenCalled();

    const after = new AbortController();
    const cancelled = importDeckCsvFile(
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

  it('downloads exact simulator CSV and revokes the temporary URL', async () => {
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
      downloadDeckCsv(deck, {
        document,
        url: { createObjectURL, revokeObjectURL },
      })
    ).toBe(true);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(DECK_CSV_FILENAME);
    expect(link.href).toBe('blob:deck');
    expect(link.isConnected).toBe(false);
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    expect(await blob?.text()).toBe(
      'QTY,Name,Type,URL\n2,Pikachu,Pokémon,custom+unsafe://player-host/card.png?exact=yes'
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:deck');

    expect(
      downloadDeckCsvText('QTY,Name,Type,URL\n1,Editable,,,', {
        document,
        url: { createObjectURL, revokeObjectURL },
      })
    ).toBe(true);
    expect(await blob?.text()).toBe('QTY,Name,Type,URL\n1,Editable,,,');
  });

  it('contains unavailable and throwing download APIs while still cleaning up', () => {
    expect(downloadDeckCsv(deck, { document, url: {} as typeof URL })).toBe(
      false
    );

    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(
      downloadDeckCsv(deck, {
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
