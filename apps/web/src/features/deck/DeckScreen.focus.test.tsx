// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeckLayer } from '../../session/shell/DeckLayer.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { DeckBuilderSession } from './DeckBuilderSession.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type { DeckDefinitionDigest } from './deck-install-adapter.js';
import { DeckLibrary } from './deck-library.js';
import type {
  PopularDecklistCollection,
  PopularDecklistSource,
} from './popular-decklists.js';

vi.mock('../../ui/toast.js', () => ({ toast: vi.fn(() => 'toast') }));
// A deck's deletion, asked about, goes ahead.
vi.mock('../../ui/dialog-requests.js', async (original) => ({
  ...(await original<typeof import('../../ui/dialog-requests.js')>()),
  confirmAction: vi.fn(async () => true),
}));
// No server here: the finder's search and the tournaments wait.
vi.mock('./tournament-decks-hooks.js', async (original) => ({
  ...(await original<typeof import('./tournament-decks-hooks.js')>()),
  useDeckSearch: () => ({ status: 'idle' }),
  useRemote: () => ({ state: { status: 'loading' }, retry: () => undefined }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = { status: 'idle' } as const;
const catalog = {
  getSnapshot: () => IDLE,
  subscribe: () => () => undefined,
  load: vi.fn(),
  retry: vi.fn(),
} as unknown as CardCatalogSource;
// Fifteen winning lists: twelve show before "Show all".
const lists: PopularDecklistCollection = {
  groups: [
    {
      name: 'Winning now',
      source: {
        name: 'Limitless',
        url: 'https://limitlesstcg.com',
        fetchedAt: '2026-10-20T00:00:00.000Z',
      },
      decks: Array.from({ length: 15 }, (_, index) => ({
        name: `List ${String(index + 1)}`,
        decklist: `4 Pidgey MEW ${String(index + 1)}`,
      })),
    },
  ],
  deckCount: 15,
  totalDecklistCodeUnits: 0,
};
const samples = {
  peek: () => lists,
  load: vi.fn(async () => lists),
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
});

/** A library of saved decks, newest first as the shelf shows them. */
const libraryOf = (...names: string[]): DeckLibrary => {
  let now = 1_000;
  const library = new DeckLibrary({ backend: null, now: () => (now += 1) });
  for (const name of [...names].reverse()) {
    library.create({ name, format: 'standard', cards: [] });
  }
  return library;
};

/** The deck screen asked to close, by its layer or itself. */
const closed = vi.fn();

const render = (library: DeckLibrary) =>
  act(async () =>
    root.render(
      <DeckLayer open onClose={closed}>
        <DeckBuilderSession
          open
          alternateEnabled
          installOnSessionAttach={false}
          onRequestClose={closed}
          catalog={catalog}
          library={library}
          samples={samples}
          digest={digest}
          store={new DeckBuilderStore()}
        />
      </DeckLayer>
    )
  );

const button = (selector: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(selector)!;

/** Pressed from the keyboard: the button has the focus as it is pressed. */
const press = async (target: HTMLElement): Promise<void> => {
  await act(async () => {
    target.focus();
    target.click();
  });
};

const tileOf = (name: string): HTMLElement =>
  button(`button[aria-label="Edit ${name}"]`).closest('li')!;

/**
 * One Esc where the focus landed leaves the screen: no tooltip opened on
 * the focus, for the Esc to close first.
 */
const escapeLeaves = async (): Promise<void> => {
  closed.mockClear();
  // Past a tooltip's delay: one the focus opened would be up.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  });
  expect(closed).toHaveBeenCalledTimes(1);
};

describe('the deck screen keeps the focus on the screen', () => {
  it('opens the editor on itself, and closes it back to the deck’s tile, one Esc away from leaving', async () => {
    const library = libraryOf('Abra', 'Bulbasaur');
    await render(library);
    await press(button('button[aria-label="Edit Bulbasaur"]'));
    const editor = host.querySelector<HTMLElement>('.deck-editor')!;
    expect(document.activeElement).toBe(editor);
    expect(editor.getAttribute('aria-label')).toBe('Bulbasaur');
    await escapeLeaves();

    await press(button('#deckEditorBackButton'));
    expect(document.activeElement).toBe(tileOf('Bulbasaur'));
    await escapeLeaves();

    // A new deck put away untouched: back to New deck, which made it.
    await press(button('#deckNewButton'));
    expect(document.activeElement).toBe(
      host.querySelector<HTMLElement>('.deck-editor')
    );
    await press(button('#deckEditorBackButton'));
    expect(library.getSnapshot().decks).toHaveLength(2);
    expect(document.activeElement).toBe(button('#deckNewButton'));

    // A deck deleted in its editor: back to the shelf's New deck.
    await press(button('button[aria-label="Edit Abra"]'));
    await press(button('#nativeDeckBuilderExportCsv'));
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('.ptcgsim-action-menu__item')]
        .find((item) => item.textContent?.includes('Delete deck'))!
        .click()
    );
    expect(library.getSnapshot().decks.map((deck) => deck.name)).toEqual([
      'Bulbasaur',
    ]);
    expect(document.activeElement).toBe(button('#deckNewButton'));
  });

  it('hands the focus to the next deck when one is deleted from the shelf, else the one before, else New deck', async () => {
    const library = libraryOf('Abra', 'Bulbasaur', 'Charmander');
    await render(library);
    const remove = async (name: string): Promise<void> => {
      await press(button(`button[aria-label="More for ${name}"]`));
      await act(async () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.ptcgsim-action-menu__item'
          ),
        ]
          .find((item) => item.textContent?.includes('Delete'))!
          .click()
      );
    };
    const charmander = tileOf('Charmander');
    await remove('Bulbasaur');
    expect(document.activeElement).toBe(charmander);
    const abra = tileOf('Abra');
    await remove('Charmander');
    expect(document.activeElement).toBe(abra);
    await remove('Abra');
    expect(library.getSnapshot().decks).toEqual([]);
    expect(document.activeElement).toBe(button('#deckNewButton'));
  });

  it('deletes a deck at once, and the notice’s Undo puts it back as it was, on its seat', async () => {
    const { toast } = await import('../../ui/toast.js');
    const { confirmAction } = await import('../../ui/dialog-requests.js');
    vi.mocked(toast).mockClear();
    vi.mocked(confirmAction).mockClear();
    const library = libraryOf('Abra', 'Bulbasaur');
    const abra = library
      .getSnapshot()
      .decks.find((deck) => deck.name === 'Abra')!;
    const store = new DeckBuilderStore();
    await act(async () =>
      root.render(
        <DeckLayer open onClose={closed}>
          <DeckBuilderSession
            open
            alternateEnabled
            installOnSessionAttach={false}
            onRequestClose={closed}
            catalog={catalog}
            library={library}
            samples={samples}
            digest={digest}
            store={store}
          />
        </DeckLayer>
      )
    );
    // On P1's seat first.
    await press(button('button[aria-label="Abra: put on P1"]'));
    expect(store.getSnapshot().slots.main.label?.deckId).toBe(abra.id);

    await press(button('button[aria-label="More for Abra"]'));
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('.ptcgsim-action-menu__item')]
        .find((item) => item.textContent?.includes('Delete'))!
        .click()
    );
    // Gone at once, nothing asked; the seat keeps its cards, unsaved.
    expect(confirmAction).not.toHaveBeenCalled();
    expect(library.get(abra.id)).toBeUndefined();
    expect(store.getSnapshot().slots.main.label?.deckId).toBeUndefined();
    const notice = vi.mocked(toast).mock.calls.at(-1)![0];
    expect(notice.title).toBe('Abra deleted');
    expect(notice.action?.label).toBe('Undo');

    await act(async () => notice.action!.onAction());
    expect(library.get(abra.id)).toEqual(abra);
    expect(store.getSnapshot().slots.main.label?.deckId).toBe(abra.id);
    expect(tileOf('Abra')).not.toBeNull();
  });

  it('renames a deck on its tile: Enter keeps the name, Escape and an empty name keep the old one', async () => {
    const library = libraryOf('Abra');
    const id = library.getSnapshot().decks[0]!.id;
    await render(library);
    const rename = async (): Promise<HTMLInputElement> => {
      await press(button('button[aria-label^="More for "]'));
      await act(async () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.ptcgsim-action-menu__item'
          ),
        ]
          .find((item) => item.textContent?.includes('Rename'))!
          .click()
      );
      const field = host.querySelector<HTMLInputElement>('.deck-tile__rename')!;
      expect(field).not.toBeNull();
      // No dialog: the field over the name has the focus.
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(field);
      return field;
    };
    const type = async (
      field: HTMLInputElement,
      value: string,
      key: string
    ) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        );
      });
    };
    await type(await rename(), 'Alakazam', 'Enter');
    expect(library.get(id)?.name).toBe('Alakazam');
    expect(host.querySelector('.deck-tile__rename')).toBeNull();

    await type(await rename(), 'Kadabra', 'Escape');
    expect(library.get(id)?.name).toBe('Alakazam');

    await type(await rename(), '   ', 'Enter');
    expect(library.get(id)?.name).toBe('Alakazam');
  });

  it('hands the focus from Show all to the first list it showed', async () => {
    await render(libraryOf());
    const showAll = button('.deck-show-more');
    expect(showAll.textContent).toBe('Show all 15');
    await press(showAll);
    const shown = [
      ...host.querySelectorAll<HTMLElement>(
        'ul[aria-label="Winning now"] > li'
      ),
    ];
    expect(shown).toHaveLength(15);
    expect(document.activeElement).toBe(shown[12]);
    expect(document.activeElement?.textContent).toContain('List 13');
  });

  it('keeps the focus in the editor from Use on P1, the deck on P1’s tray', async () => {
    await render(libraryOf('Abra'));
    await press(button('button[aria-label="Edit Abra"]'));
    await press(button('#deckUseOnSeatButton'));
    expect(host.querySelector('#deckUseOnSeatButton')).toBeNull();
    const tray = button('#nativeDeckBuilderTargetMain');
    expect(tray.getAttribute('aria-label')).toBe('P1: Abra, 0 cards');
    expect(document.activeElement).toBe(
      host.querySelector<HTMLElement>('.deck-editor')
    );
    await escapeLeaves();
  });

  it.each(['Escape', 'submit'] as const)(
    'returns from the custom-card dialog by %s, then one Esc leaves the screen',
    async (closeWith) => {
      const library = libraryOf('Abra');
      await render(library);
      await press(button('button[aria-label="Edit Abra"]'));
      const custom = button('#nativeDeckBuilderAddCustomCard');
      await press(custom);
      expect(document.activeElement).toBe(button('#nativeCustomCardName'));
      closed.mockClear();
      if (closeWith === 'submit') {
        const fill = async (selector: string, value: string): Promise<void> => {
          await act(async () => {
            const input = host.querySelector<HTMLInputElement>(selector)!;
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value'
            )!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
        };
        await fill('#nativeCustomCardName', 'Proxy');
        await fill(
          '#nativeCustomCardImageUrl',
          'https://example.test/proxy.png'
        );
        await act(async () => {
          host
            .querySelector('#nativeCustomCardPreviewImage')!
            .dispatchEvent(new Event('load'));
        });
        await press(button('#nativeCustomCardSubmit'));
        expect(library.getSnapshot().decks[0]!.cards[0]!.card.name).toBe(
          'Proxy'
        );
      } else {
        await act(async () => {
          document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            })
          );
        });
      }
      expect(
        host.querySelector<HTMLElement>('#nativeDeckBuilderCustomCardModal')!
          .hidden
      ).toBe(true);
      expect(document.activeElement).toBe(custom);
      expect(closed).not.toHaveBeenCalled();
      await escapeLeaves();
    }
  );
});
