// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOverlayKeyTarget } from '../../ui/overlay-surface.js';
import { DeckLayer } from './DeckLayer.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Answers the deck screen's one-at-a-time query. */
const mockNarrow = (narrow: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query.includes('max-width: 899px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

const render = async (open: boolean, onClose: () => void = vi.fn()) => {
  await act(async () =>
    root.render(
      <DeckLayer open={open} onClose={onClose}>
        <section id="deckImport">
          <textarea id="mainDeckImportInput" />
          <div role="menu" id="decklistsContextMenu">
            <button type="button" id="sampleDeck">
              Sample
            </button>
          </div>
          <div className="deck-review" id="review" hidden>
            <button type="button" id="confirmButton">
              Confirm
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
  mockNarrow(false);
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
  vi.unstubAllGlobals();
});

describe('DeckLayer', () => {
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

  it('goes back to the table from its button and from Esc', async () => {
    const onClose = vi.fn();
    await render(true, onClose);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckBackButton')!.click()
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(host.querySelector('#deckBackButton')?.textContent).toBe('Table');

    const event = await escapeFrom(host.querySelector('#mainDeckImportInput')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Esc to whatever inside it is open', async () => {
    const onClose = vi.fn();
    await render(true, onClose);
    await escapeFrom(host.querySelector('#customCardName')!);
    await escapeFrom(host.querySelector('#sampleDeck')!);
    const review = host.querySelector<HTMLElement>('#review')!;
    review.hidden = false;
    await escapeFrom(host.querySelector('#confirmButton')!);
    expect(onClose).not.toHaveBeenCalled();

    // A closed review no longer owns it.
    review.hidden = true;
    await escapeFrom(host.querySelector('#confirmButton')!);
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

  it('shows the decklist and the builder one at a time on a small screen', async () => {
    await render(true);
    // Side by side where there is room: no switch.
    expect(layer().dataset.deckView).toBeUndefined();
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();

    mockNarrow(true);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(true);
    expect(layer().dataset.deckView).toBe('list');
    const choices = [
      ...host.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'Decklist',
      'Builder',
    ]);
    expect(
      choices.map((choice) => choice.getAttribute('aria-checked'))
    ).toEqual(['true', 'false']);
    await act(async () => choices[1]!.click());
    expect(layer().dataset.deckView).toBe('build');
    expect(choices[1]!.getAttribute('aria-checked')).toBe('true');
    await act(async () => choices[0]!.click());
    expect(layer().dataset.deckView).toBe('list');
  });
});
