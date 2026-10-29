// @vitest-environment happy-dom

import type { DeckCard } from '@ptcgsim/deck-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomCardDialog } from './CustomCardDialog.js';
import { uploadCardImage } from './custom-card-image.js';

// The image store: each file gets an address of its own; a link that
// isn't a picture fails.
vi.mock('./custom-card-image.js', () => ({
  uploadCardImage: vi.fn(async (source: Blob | string) => {
    if (typeof source === 'string')
      return source.includes('broken')
        ? { failure: 'failed' }
        : { url: source, wide: false };
    const name = (source as File).name;
    return { url: `/v2/images/${name}`, wide: name.includes('wide') };
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const onAdd = vi.fn<(cards: readonly DeckCard[], quantity: number) => void>();
const onClose = vi.fn();

beforeEach(async () => {
  onAdd.mockClear();
  onClose.mockClear();
  vi.mocked(uploadCardImage).mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<CustomCardDialog open onClose={onClose} onAdd={onAdd} />)
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const $ = <Element extends HTMLElement = HTMLElement>(selector: string) =>
  host.querySelector<Element>(selector)!;
const fill = async (selector: string, value: string): Promise<void> => {
  await act(async () => {
    const input = $<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const choose = async (selector: string, value: string): Promise<void> => {
  await act(async () => {
    const select = $<HTMLSelectElement>(selector);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const picture = (name: string): File =>
  new File(['picture'], name, { type: 'image/png' });
const pickFile = async (index: number, file: File): Promise<void> => {
  await act(async () => {
    const input = $<HTMLInputElement>(`#nativeCustomCardImageFile-${index}`);
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const pasteFile = async (target: Element, file: File): Promise<void> => {
  await act(async () => {
    const event = new Event('paste', {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };
    event.clipboardData = {
      files: [file],
      getData: () => '',
    };
    target.dispatchEvent(event);
  });
};
const click = async (selector: string): Promise<void> => {
  await act(async () => $(selector).click());
};

describe('custom card pictures', () => {
  it('takes a file, uploads it, and gives the card its stored address', async () => {
    await fill('#nativeCustomCardName', 'Proxy');
    await pickFile(0, picture('proxy.png'));
    expect(uploadCardImage).toHaveBeenCalledTimes(1);
    expect($<HTMLImageElement>('#nativeCustomCardPreviewImage').src).toContain(
      '/v2/images/proxy.png'
    );
    await click('#nativeCustomCardSubmit');
    const [cards, quantity] = onAdd.mock.calls[0]!;
    expect(quantity).toBe(1);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      name: 'Proxy',
      image: '/v2/images/proxy.png',
    });
    expect(cards[0]!.presentation).toBeUndefined();
  });

  it('reads a wide picture sideways, and says when a link is no picture', async () => {
    await fill('#nativeCustomCardName', 'Scan');
    await fill('#nativeCustomCardImageUrl', 'https://example.test/broken');
    await act(async () => {
      $('#nativeCustomCardImageUrl').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(host.textContent).toContain("That picture didn't load.");
    await click('#nativeCustomCardSubmit');
    expect(onAdd).not.toHaveBeenCalled();
    expect($('#nativeCustomCardError').textContent).toBe('Add a picture.');

    // A picture pasted anywhere in the window goes into the slot.
    await pasteFile($('#nativeCustomCardName'), picture('wide.png'));
    await click('#nativeCustomCardSubmit');
    expect(onAdd.mock.calls[0]![0][0]!.presentation).toEqual({
      readingQuarterTurns: 1,
    });
  });

  it('adds a V-UNION as four pieces at once, one picture each', async () => {
    await fill('#nativeCustomCardName', 'Mewtwo V-UNION');
    await fill('#nativeCustomCardQty', '2');
    await click('#nativeCustomCardMultiPiece');
    expect(host.querySelectorAll('.custom-card-slot')).toHaveLength(4);
    expect(
      [...host.querySelectorAll('.custom-card-slot')].map((slot) =>
        slot.getAttribute('aria-label')
      )
    ).toEqual(['Top left', 'Top right', 'Bottom left', 'Bottom right']);
    // No typed group: the pieces join by themselves.
    expect(host.textContent).not.toContain('Artwork group');

    await pickFile(0, picture('a.png'));
    await pickFile(1, picture('b.png'));
    await pickFile(2, picture('c.png'));
    await click('#nativeCustomCardSubmit');
    expect(onAdd).not.toHaveBeenCalled();
    expect($('#nativeCustomCardError').textContent).toBe(
      'Add a picture for each piece.'
    );
    // Pasted onto the last piece, the picture goes there.
    await pasteFile(
      host.querySelectorAll('.custom-card-slot')[3]!,
      picture('d.png')
    );
    await click('#nativeCustomCardSubmit');

    const [cards, quantity] = onAdd.mock.calls[0]!;
    expect(quantity).toBe(2);
    expect(cards.map((card) => card.image)).toEqual([
      '/v2/images/a.png',
      '/v2/images/b.png',
      '/v2/images/c.png',
      '/v2/images/d.png',
    ]);
    const joins = cards.map((card) => card.presentation?.join);
    expect(joins.map((join) => join?.part)).toEqual([0, 1, 2, 3]);
    expect(new Set(joins.map((join) => join?.key)).size).toBe(1);
    expect(joins[0]).toMatchObject({ columns: 2, rows: 2 });
    expect(new Set(cards.map((card) => card.id)).size).toBe(4);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the pictures given when the kind of card changes', async () => {
    await fill('#nativeCustomCardName', 'Ho-Oh & Lugia LEGEND');
    await click('#nativeCustomCardMultiPiece');
    await pickFile(0, picture('top.png'));
    await choose('#nativeCustomCardPieces', 'legend');
    expect(host.querySelectorAll('.custom-card-slot')).toHaveLength(2);
    await pickFile(1, picture('bottom.png'));
    await click('#nativeCustomCardSubmit');
    const [cards] = onAdd.mock.calls[0]!;
    expect(cards.map((card) => card.presentation)).toEqual([
      expect.objectContaining({
        readingQuarterTurns: 1,
        join: expect.objectContaining({ columns: 1, rows: 2, part: 0 }),
      }),
      expect.objectContaining({
        join: expect.objectContaining({ part: 1 }),
      }),
    ]);
    expect(cards[0]!.image).toBe('/v2/images/top.png');
  });
});
