// @vitest-environment happy-dom

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
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
  vi.unstubAllGlobals();
});

/** The screen, open or put away, around one library and store. */
const screen = (
  onClose = vi.fn(),
  library = new DeckLibrary({ backend: null }),
  source: CardCatalogSource = catalog
) => {
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
            catalog={source}
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

const render = async (
  onClose = vi.fn(),
  library = new DeckLibrary({ backend: null })
) => {
  await screen(onClose, library).draw(true);
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

  it('takes a deck name pasted over a tournament to the decks’ finder', async () => {
    await render();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-open-tournament="cup"]')!
        .click()
    );
    await paste('Dragapult ex');
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host.querySelector('#deckSubviewBackButton')).toBeNull();
    expect(finder().value).toBe('Dragapult ex');
    expect(document.activeElement).toBe(finder());
    expect(toast).not.toHaveBeenCalled();
  });

  it('hears Esc with the focus fallen to the page: back to the decks, then away', async () => {
    const onClose = await render();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[data-open-tournament="cup"]')!
        .click()
    );
    // The control that had the focus went away under it.
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement).toBe(document.body);
    await press('Escape');
    expect(host.querySelector('#deckSubviewBackButton')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await press('Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('gives the focus back to what opened a tournament on Esc from the page', async () => {
    await render();
    const opener = host.querySelector<HTMLButtonElement>(
      '[data-open-tournament="cup"]'
    )!;
    opener.focus();
    await openCup();
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await press('Escape');
    await frames();
    expect(host.querySelector('#deckSubviewBackButton')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('takes a name pasted onto the deck editor as lines for the deck, staying in it', async () => {
    const library = new DeckLibrary({ backend: null });
    await render(vi.fn(), library);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckNewButton')!.click()
    );
    host.querySelector<HTMLElement>('#deckEditorBackButton')!.focus();
    await paste('Dragapult ex');
    await frames();
    expect(host.querySelector('#deckEditorBackButton')).not.toBeNull();
    expect(finder()).toBeNull();
    // Leaving by Back still puts the empty new deck away.
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckEditorBackButton')!.click()
    );
    expect(library.getSnapshot().decks).toEqual([]);
  });

  it('puts away a new deck left as it started when a list pasted onto it opens its own', async () => {
    const library = new DeckLibrary({ backend: null });
    // No catalog to wait for, or network, so the list's unknown lines come
    // back at once.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const FAILED = { status: 'failed' } as const;
    const failed = {
      getSnapshot: () => FAILED,
      subscribe: () => () => undefined,
      load: vi.fn(),
      retry: vi.fn(),
    } as unknown as CardCatalogSource;
    await screen(vi.fn(), library, failed).draw(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckNewButton')!.click()
    );
    expect(library.getSnapshot().decks.map((deck) => deck.name)).toEqual([
      'Untitled deck',
    ]);
    host.querySelector<HTMLElement>('#deckEditorBackButton')!.focus();
    await paste('4 Zzzzz XYZ 1\n4 Yyyyy ABC 2');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    // The list opened in the editor (its lines not found), in its place.
    expect(host.querySelector('#deckEditorBackButton')).not.toBeNull();
    expect(library.getSnapshot().decks.map((deck) => deck.name)).not.toContain(
      'Untitled deck'
    );
  });

  it('puts away a new deck left as it started when the screen goes with it open', async () => {
    const library = new DeckLibrary({ backend: null });
    await render(vi.fn(), library);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckNewButton')!.click()
    );
    expect(library.getSnapshot().decks).toHaveLength(1);
    // A new table or room: this screen goes, and another comes.
    await act(async () => root.render(<div />));
    expect(library.getSnapshot().decks).toEqual([]);
  });

  it('keeps a name typed into a new deck just before the screen goes, and the deck with it', async () => {
    const library = new DeckLibrary({ backend: null });
    await render(vi.fn(), library);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#deckNewButton')!.click()
    );
    const name = host.querySelector<HTMLInputElement>('#deckNameInput')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!;
      set.call(name, 'Charizard ex');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Gone before the name's pause was over.
    await act(async () => root.render(<div />));
    expect(library.getSnapshot().decks.map((deck) => deck.name)).toEqual([
      'Charizard ex',
    ]);
  });

  it('clears what was typed in Find a deck on Esc before it leaves', async () => {
    const library = new DeckLibrary({ backend: null });
    for (let n = 0; n < 9; n += 1) {
      library.create({
        name: `Deck ${String(n)}`,
        format: 'standard',
        cards: [],
        source: { kind: 'new' },
      });
    }
    const onClose = await render(vi.fn(), library);
    const filter = host.querySelector<HTMLInputElement>(
      'input[type="search"][placeholder="Find a deck"]'
    )!;
    filter.focus();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!;
      setValue.call(filter, 'Deck 3');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('Escape');
    expect(filter.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets go of what was typed in Find a deck once too few decks show it', async () => {
    const library = new DeckLibrary({ backend: null });
    const decks = Array.from({ length: 9 }, (_, n) =>
      library.create({
        name: `Deck ${String(n)}`,
        format: 'standard',
        cards: [],
        source: { kind: 'new' },
      })
    );
    await render(vi.fn(), library);
    const filter = host.querySelector<HTMLInputElement>(
      'input[type="search"][placeholder="Find a deck"]'
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(filter, 'Deck 3');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const names = () =>
      [...host.querySelectorAll('.deck-tile__name')].map(
        (tile) => tile.textContent
      );
    expect(names()).toEqual(['Deck 3']);
    // A deck goes (another tab, its menu): the field with it, and the
    // filter, which nothing left on screen could clear.
    await act(async () => {
      library.remove(decks[0]!.id);
    });
    expect(host.querySelector('input[placeholder="Find a deck"]')).toBeNull();
    expect(names()).toHaveLength(8);
    // A ninth again: the field is back empty, every deck shown.
    await act(async () => {
      library.create({
        name: 'Deck 9',
        format: 'standard',
        cards: [],
        source: { kind: 'new' },
      });
    });
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="Find a deck"]')
        ?.value
    ).toBe('');
    expect(names()).toHaveLength(9);
  });

  it('says a saved deck’s finish in the page’s language', async () => {
    const locale = i18n.locale;
    const finish = msg({
      comment:
        "A deck's best finish in a tournament: its place among the players, as 1st of 285",
      message: `{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} of {players}`,
    });
    i18n.load('xx', { [finish.id!]: '{place}. von {players}' });
    i18n.activate('xx');
    try {
      const library = new DeckLibrary({ backend: null });
      library.create({
        name: 'Dragapult — 1st of 67',
        format: 'standard',
        cards: [],
        source: { kind: 'new' },
      });
      for (let n = 0; n < 8; n += 1) {
        library.create({
          name: `Deck ${String(n)}`,
          format: 'standard',
          cards: [],
          source: { kind: 'new' },
        });
      }
      await render(vi.fn(), library);
      const shown = () =>
        [...host.querySelectorAll('.deck-tile__name')].map(
          (tile) => tile.textContent
        );
      expect(shown()).toContain('Dragapult — 1. von 67');
      // Found by what the tile shows, too.
      const filter = host.querySelector<HTMLInputElement>(
        'input[type="search"][placeholder="Find a deck"]'
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(filter, '1. von');
        filter.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(shown()).toEqual(['Dragapult — 1. von 67']);
      // The language changes back: what the filter matches is asked again.
      await act(async () => {
        i18n.activate(locale);
      });
      expect(shown()).toEqual([]);
      // Kept as it came.
      expect(
        library
          .getSnapshot()
          .decks.some((deck) => deck.name === 'Dragapult — 1st of 67')
      ).toBe(true);
    } finally {
      i18n.activate(locale);
    }
  });
});
