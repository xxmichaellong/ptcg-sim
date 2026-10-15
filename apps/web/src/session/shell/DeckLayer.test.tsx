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
});
