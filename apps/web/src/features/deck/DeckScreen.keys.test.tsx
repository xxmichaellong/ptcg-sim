// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeckLayer } from '../../session/shell/DeckLayer.js';
import { toast } from '../../ui/toast.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { DeckBuilderSession } from './DeckBuilderSession.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type { DeckDefinitionDigest } from './deck-install-adapter.js';
import { DeckLibrary } from './deck-library.js';
import type { PopularDecklistSource } from './popular-decklists.js';
import type { TournamentSummary } from './tournament-decks-client.js';

vi.mock('../../ui/toast.js', () => ({ toast: vi.fn(() => 'toast') }));
// No server here: the finder's search and a tournament's standings wait.
vi.mock('./tournament-decks-hooks.js', async (original) => ({
  ...(await original<typeof import('./tournament-decks-hooks.js')>()),
  useDeckSearch: () => ({ status: 'idle' }),
  useRemote: () => ({ state: { status: 'loading' }, retry: () => undefined }),
}));
// The shelf as one event, opened by its button, and pages it has loaded.
vi.mock('./TournamentDecks.js', async (original) => {
  const { useState } = await import('react');
  return {
    ...(await original<typeof import('./TournamentDecks.js')>()),
    TournamentsShelf: ({
      onOpen,
    }: {
      readonly onOpen: (tournament: TournamentSummary) => void;
    }) => {
      const [pages, setPages] = useState(1);
      return (
        <>
          <button
            type="button"
            data-open-tournament="cup"
            onClick={() =>
              onOpen({
                id: 'cup',
                name: 'League Cup',
                date: '2026-10-21T19:00:00.000Z',
                format: 'STANDARD',
                players: 40,
                organizer: null,
                hasLists: true,
              })
            }
          >
            League Cup
          </button>
          <button
            type="button"
            data-shelf-more={pages}
            onClick={() => setPages((count) => count + 1)}
          >
            More
          </button>
        </>
      );
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = { status: 'idle' } as const;
const catalog = {
  getSnapshot: () => IDLE,
  subscribe: () => () => undefined,
  load: vi.fn(),
  retry: vi.fn(),
} as unknown as CardCatalogSource;
const samples = {
  load: vi.fn(async () => ({
    groups: [],
    deckCount: 0,
    totalDecklistCodeUnits: 0,
  })),
  selectRandom: vi.fn(),
} as unknown as PopularDecklistSource;
const digest: DeckDefinitionDigest = {
  digestIdentity: async () => '0'.repeat(64),
};

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
  vi.mocked(toast).mockClear();
});

/** The screen, open or put away, around one library and store. */
const screen = (onClose = vi.fn()) => {
  const library = new DeckLibrary({ backend: null });
  const store = new DeckBuilderStore();
  const draw = (open: boolean) =>
    act(async () =>
      root.render(
        <DeckLayer open={open} onClose={onClose}>
          <DeckBuilderSession
            open={open}
            alternateEnabled
            installOnSessionAttach={false}
            onRequestClose={onClose}
            catalog={catalog}
            library={library}
            samples={samples}
            digest={digest}
            store={store}
          />
        </DeckLayer>
      )
    );
  return { onClose, draw };
};

const render = async (onClose = vi.fn()) => {
  await screen(onClose).draw(true);
  return onClose;
};

const frames = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

const openCup = () =>
  act(async () =>
    host
      .querySelector<HTMLButtonElement>('[data-open-tournament="cup"]')!
      .click()
  );

const finder = (): HTMLTextAreaElement =>
  host.querySelector<HTMLTextAreaElement>('#deckPasteInput')!;

const paste = async (text: string): Promise<void> => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  await act(async () => {
    document.body.dispatchEvent(event);
  });
};

const press = async (key: string): Promise<void> => {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  });
};

describe('the deck screen from the keyboard', () => {
  it("takes a deck's name pasted onto the screen into the finder, and a list still as a list", async () => {
    await render();
    await paste('Dragapult ex');
    expect(finder().value).toBe('Dragapult ex');
    expect(document.activeElement).toBe(finder());
    expect(toast).not.toHaveBeenCalled();

    await act(async () => {
      finder().blur();
    });
    await paste('4 Dreepy TWM 128\n4 Drakloak TWM 129');
    // Not a name: the finder keeps what it had, and the list is imported.
    expect(finder().value).toBe('Dragapult ex');
  });

  it('keeps focus on the screen into a tournament and back, and Esc steps back before it leaves', async () => {
    const onClose = await render();
    const opener = host.querySelector<HTMLButtonElement>(
      '[data-open-tournament="cup"]'
    )!;
    opener.focus();
    await act(async () => opener.click());
    // The tournament's name, read first.
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('League Cup');

    // Esc goes back to the decks, to the event that opened it.
    await press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('#deckSubviewBackButton')).toBeNull();
    expect(document.activeElement).toBe(
      host.querySelector('[data-open-tournament="cup"]')
    );

    // So does the back button.
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-open-tournament="cup"]')!
        .click()
    );
    const back = host.querySelector<HTMLButtonElement>(
      '#deckSubviewBackButton'
    )!;
    back.focus();
    await act(async () => back.click());
    expect(document.activeElement).toBe(
      host.querySelector('[data-open-tournament="cup"]')
    );

    // From the decks, Esc leaves the screen.
    await press('Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('comes back from a tournament to the shelf as it was left', async () => {
    await render();
    const more = () =>
      host.querySelector<HTMLButtonElement>('[data-shelf-more]')!;
    await act(async () => more().click());
    await act(async () => more().click());
    expect(more().dataset.shelfMore).toBe('3');
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-open-tournament="cup"]')!
        .click()
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckSubviewBackButton')!.click()
    );
    // Its pages still loaded, as the player left them.
    expect(more().dataset.shelfMore).toBe('3');
  });

  it('steps back from a tournament on Esc wherever the focus is on the screen', async () => {
    const onClose = await render();
    await openCup();
    // A press on the standings' paper leaves the focus on the layer.
    const layer = host.querySelector<HTMLElement>('.ptcgsim-deck-layer')!;
    layer.focus();
    await press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('#deckSubviewBackButton')).toBeNull();
  });

  it('reopened on a tournament, reads its heading and steps back on Esc', async () => {
    const { onClose, draw } = screen();
    await draw(true);
    await openCup();
    await draw(false);
    await draw(true);
    await frames();
    expect(document.activeElement?.tagName).toBe('H2');
    await press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('#deckSubviewBackButton')).toBeNull();
  });

  it('brings the finder into view for a name pasted onto the screen', async () => {
    const scrolled = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrolled;
    try {
      await render();
      await paste('Gardevoir ex');
      expect(finder().value).toBe('Gardevoir ex');
      expect(scrolled.mock.contexts).toContain(finder());
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
