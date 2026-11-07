// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeckLayer } from '../../session/shell/DeckLayer.js';
import { TournamentsShelf } from './TournamentDecks.js';

// No server here: the shelf's events wait.
vi.mock('./tournament-decks-hooks.js', async (original) => ({
  ...(await original<typeof import('./tournament-decks-hooks.js')>()),
  usePaged: () => ({
    state: { status: 'loading' },
    hasMore: false,
    loadingMore: false,
    more: () => undefined,
    retry: () => undefined,
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('the tournaments shelf from the keyboard', () => {
  it('clears what was typed in its filter on Esc before the screen hears it', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <DeckLayer open onClose={onClose}>
          <TournamentsShelf open onOpen={() => undefined} />
        </DeckLayer>
      )
    );
    const input = host.querySelector<HTMLInputElement>(
      '#deckTournamentFilter'
    )!;
    input.focus();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!;
    await act(async () => {
      setValue.call(input, 'regional');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const escape = () =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        );
      });
    await escape();
    expect(input.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    // Empty, it gives Esc to the screen.
    await escape();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
