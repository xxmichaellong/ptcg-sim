// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOverlayKeyTarget } from '../../ui/overlay-surface.js';
import { DeckLayer } from './DeckLayer.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

const render = async (open: boolean, onClose: () => void = vi.fn()) => {
  await act(async () =>
    root.render(
      <DeckLayer open={open} onClose={onClose}>
        <section id="deckScreen">
          <textarea id="mainDeckImportInput" />
          <input id="cardSearch" type="search" placeholder="Search" />
          <div role="menu" id="deckActions">
            <button type="button" id="sampleDeck">
              Duplicate
            </button>
          </div>
        </section>
        <div role="dialog" id="customCardDialog">
          <input id="customCardName" />
        </div>
      </DeckLayer>
    )
  );
};

const layer = (): HTMLElement =>
  host.querySelector<HTMLElement>('.ptcgsim-deck-layer')!;

const escapeFrom = async (target: Element): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(() => {
  opener = document.createElement('button');
  opener.id = 'opener';
  document.body.append(opener);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('DeckLayer', () => {
  it.each(['list', 'images'])(
    'uses the checked %s radio as the final Tab stop',
    async (selected) => {
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
        new DOMRect(0, 0, 10, 10),
      ] as unknown as DOMRectList);
      await act(async () =>
        root.render(
          <DeckLayer open onClose={vi.fn()}>
            <button id="first">First</button>
            <input
              type="radio"
              name="view"
              id="list"
              defaultChecked={selected === 'list'}
            />
            <input
              type="radio"
              name="view"
              id="images"
              defaultChecked={selected === 'images'}
            />
          </DeckLayer>
        )
      );
      const radio = host.querySelector<HTMLInputElement>(`#${selected}`)!;
      const first = host.querySelector<HTMLButtonElement>('#first')!;
      await act(async () => radio.focus());
      const forward = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        radio.dispatchEvent(forward);
      });
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);
      const backward = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        first.dispatchEvent(backward);
      });
      expect(document.activeElement).toBe(radio);
    }
  );

  it('keeps same-named radio groups in different forms separate', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 10, 10),
    ] as unknown as DOMRectList);
    await act(async () =>
      root.render(
        <DeckLayer open onClose={vi.fn()}>
          <button id="first">First</button>
          <form>
            <input type="radio" name="same" defaultChecked />
            <input type="radio" name="same" />
          </form>
          <form>
            <input id="last" type="radio" name="same" defaultChecked />
            <input type="radio" name="same" />
          </form>
        </DeckLayer>
      )
    );
    const last = host.querySelector<HTMLInputElement>('#last')!;
    await act(async () => last.focus());
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      last.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('#first'));
  });

  it('keeps the builder mounted but out of reach while closed', async () => {
    await render(false);
    expect(layer().dataset.open).toBe('false');
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    expect(layer().hasAttribute('inert')).toBe(true);
    // The builder keeps its state across openings.
    expect(host.querySelector('#mainDeckImportInput')).not.toBeNull();
  });

  it('takes the keyboard on opening and hands it back on closing', async () => {
    opener.focus();
    await render(false);
    await render(true);
    expect(layer().dataset.open).toBe('true');
    expect(layer().getAttribute('aria-hidden')).toBe('false');
    expect(layer().hasAttribute('inert')).toBe(false);
    expect(layer().getAttribute('aria-label')).toBe('Deck');
    expect(document.activeElement).toBe(layer());
    // Keys pressed on the deck screen belong to it, never to the table.
    expect(isOverlayKeyTarget(host.querySelector('#mainDeckImportInput'))).toBe(
      true
    );

    await render(false);
    expect(document.activeElement).toBe(opener);
  });

  it('goes back to the table from Esc', async () => {
    const onClose = vi.fn();
    await render(true, onClose);
    const event = await escapeFrom(host.querySelector('#mainDeckImportInput')!);
    expect(onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Esc to whatever inside it is open', async () => {
    const onClose = vi.fn();
    await render(true, onClose);
    await escapeFrom(host.querySelector('#customCardName')!);
    await escapeFrom(host.querySelector('#sampleDeck')!);
    expect(onClose).not.toHaveBeenCalled();
    await escapeFrom(host.querySelector('#cardSearch')!);
    expect(onClose).toHaveBeenCalledOnce();

    // Nor does a key something else already handled.
    const handled = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    await act(async () => {
      host.querySelector('#mainDeckImportInput')!.dispatchEvent(handled);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the keyboard off the table it covers, but not off overlays', async () => {
    const after = document.createElement('button');
    after.id = 'tableAfter';
    document.body.append(after);
    const overlay = document.createElement('button');
    overlay.setAttribute('data-ptcgsim-overlay', 'menu');
    document.body.append(overlay);
    await render(true);
    // Shift+Tab or Tab out of the deck screen onto the table's buttons.
    for (const outside of [opener, after]) {
      await act(async () => outside.focus());
      expect(layer().contains(document.activeElement)).toBe(true);
    }
    // A menu the deck screen opened elsewhere keeps its focus.
    await act(async () => overlay.focus());
    expect(document.activeElement).toBe(overlay);

    await render(false);
    await act(async () => after.focus());
    expect(document.activeElement).toBe(after);
  });
});
