// @vitest-environment happy-dom

import type { Deck, DeckCard } from '@ptcgsim/deck-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelAllDialogRequests } from '../../ui/dialog-requests.js';
import { OverlayHost } from '../../ui/OverlayHost.js';
import {
  LegacyDeckBuilderWorkspace,
  type DeckClearConfirmation,
} from './LegacyDeckBuilderWorkspace.js';
import type { DeckCsvFileImportResult } from './deck-browser-io.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type {
  CardCatalogSearchResult,
  TcgdexCardCatalog,
} from './tcgdex-catalog-contract.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const card = (
  name: string,
  image: string,
  extra: Partial<DeckCard> = {}
): DeckCard => ({
  id: name.toLowerCase(),
  name,
  supertype: 'Pokémon',
  image,
  set: { name: `${name} Set`, releaseDate: '2020-01-01' },
  ...extra,
});

const deckWith = (entry: DeckCard, count = 1): Deck => ({
  [entry.name ?? 'Card']: {
    cards: [{ data: entry, count }],
    totalCount: count,
  },
});

const result = (
  results: readonly DeckCard[],
  overrides: Partial<CardCatalogSearchResult> = {}
): CardCatalogSearchResult => ({
  results,
  totalSummaries: results.length,
  term: 'query',
  isHugeResultSet: false,
  ...overrides,
});

class FakeCatalog implements TcgdexCardCatalog {
  readonly queryCardsByName = vi.fn(
    async (
      _term: string,
      _options?: { readonly signal?: AbortSignal }
    ): Promise<CardCatalogSearchResult> => result([])
  );
  readonly clearCache = vi.fn();
}

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
});

const mount = async (
  options: {
    readonly store?: DeckBuilderStore;
    readonly catalog?: FakeCatalog;
    readonly open?: boolean;
    readonly onPlay?: () => void;
    readonly confirmClear?: DeckClearConfirmation;
    readonly downloadDeck?: (deck: Deck) => boolean;
    readonly importDeckFile?: (
      file: { readonly size: number; text(): Promise<string> },
      options?: { readonly signal?: AbortSignal }
    ) => Promise<DeckCsvFileImportResult>;
  } = {}
) => {
  const store = options.store ?? new DeckBuilderStore();
  const catalog = options.catalog ?? new FakeCatalog();
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <LegacyDeckBuilderWorkspace
        store={store}
        catalog={catalog}
        open={options.open ?? true}
        {...(options.onPlay ? { onPlay: options.onPlay } : {})}
        {...(options.confirmClear
          ? { confirmClear: options.confirmClear }
          : {})}
        {...(options.downloadDeck
          ? { downloadDeck: options.downloadDeck }
          : {})}
        {...(options.importDeckFile
          ? { importDeckFile: options.importDeckFile }
          : {})}
      />
    );
  });
  return { store, catalog };
};

const input = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const select = async (element: HTMLSelectElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const summary = (root: ParentNode) => {
  const panel = root.querySelector('#nativeDeckBuilderSummaryPanel')!;
  const count = (group: string) =>
    panel.querySelector(`[data-group="${group}"] strong`)?.textContent;
  return {
    total: panel
      .querySelector('.native-deck-builder-summary-total')
      ?.textContent?.replace(/\s+/gu, ' '),
    pokemon: count('pokemon'),
    trainer: count('trainer'),
    energy: count('energy'),
    progress: panel
      .querySelector('[role="progressbar"]')
      ?.getAttribute('aria-valuenow'),
  };
};

describe('LegacyDeckBuilderWorkspace', () => {
  it('retains the source IDs, labels, defaults, closed inert state, and empty presentation', async () => {
    await mount({ open: false });
    const workspace = host.querySelector<HTMLElement>(
      '#nativeDeckBuilderWorkspace'
    )!;

    expect(workspace.className).toBe('native-deck-builder-workspace');
    expect(workspace.getAttribute('aria-hidden')).toBe('true');
    expect(workspace.inert).toBe(true);
    expect(host.textContent).toContain('Deck Builder');
    expect(host.textContent).toContain(
      'Search cards, build decks, and load them directly into the simulator.'
    );
    expect(
      host.querySelector<HTMLSelectElement>('#nativeDeckBuilderCardTypeFilter')
        ?.value
    ).toBe('all');
    expect(
      host.querySelector<HTMLSelectElement>('#nativeDeckBuilderSortBy')?.value
    ).toBe('releaseDate');
    expect(
      host.querySelector<HTMLSelectElement>('#nativeDeckBuilderSortDirection')
        ?.value
    ).toBe('desc');
    expect(
      host.querySelector<HTMLButtonElement>('#nativeDeckBuilderPlayButton')
        ?.disabled
    ).toBe(true);
    expect(summary(host)).toEqual({
      total: 'Total: 0 / 60 cards',
      pokemon: '0',
      trainer: '0',
      energy: '0',
      progress: '0',
    });
    expect(
      host.querySelector('#nativeDeckBuilderCardsPanel')?.textContent
    ).toBe('No cards added yet.');
    expect(
      host.querySelector<HTMLElement>('#nativeDeckBuilderEdgeToggle')?.hidden
    ).toBe(true);
    expect(host.querySelector('#nativeCustomCardPreviewImage')).not.toBeNull();
    expect(
      host.querySelector('#nativeDeckBuilderCardPreviewImage')
    ).not.toBeNull();
    expect(
      host
        .querySelector('#nativeDeckBuilderCustomCardModal')
        ?.hasAttribute('hidden')
    ).toBe(true);
  });

  it('searches on Enter, applies local controls, adds a result, and previews on contextmenu', async () => {
    const catalog = new FakeCatalog();
    const tcg = card('Alpha', 'custom+unsafe://tcg/alpha');
    const pocket = card('Beta', 'custom+unsafe://host/tcgp/beta', {
      images: {
        small: 'custom+unsafe://host/tcgp/beta-small',
        large: 'custom+unsafe://host/tcgp/beta-large',
      },
      set: { name: 'Pocket Set', releaseDate: '2024-01-01' },
    });
    catalog.queryCardsByName.mockResolvedValue(result([tcg, pocket]));
    const { store } = await mount({ catalog });
    const search = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderSearchInput'
    )!;

    await input(search, '  Alpha  ');
    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await vi.waitFor(() =>
      expect(host.querySelectorAll('[data-result-index]')).toHaveLength(2)
    );
    expect(catalog.queryCardsByName).toHaveBeenCalledWith('Alpha', {
      signal: expect.any(AbortSignal),
    });
    expect(
      host.querySelector('#nativeDeckBuilderSearchStatus')?.textContent
    ).toBe('Showing all 2 result(s). Click a card to add it.');

    const pool = host.querySelector<HTMLSelectElement>(
      '#nativeDeckBuilderCardTypeFilter'
    )!;
    await select(pool, 'pocket');
    expect(host.querySelectorAll('[data-result-index]')).toHaveLength(1);
    const resultButton = host.querySelector<HTMLButtonElement>(
      '[data-result-index]'
    )!;
    expect(resultButton.title).toBe('Beta · Pocket Set');
    expect(resultButton.querySelector('img')?.getAttribute('src')).toBe(
      'custom+unsafe://host/tcgp/beta-small'
    );

    await act(async () => {
      resultButton.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
    });
    expect(
      host
        .querySelector('#nativeDeckBuilderCardPreviewImage')
        ?.getAttribute('src')
    ).toBe('custom+unsafe://host/tcgp/beta-large');
    expect(
      host
        .querySelector('#nativeDeckBuilderCardPreviewScrim')
        ?.hasAttribute('hidden')
    ).toBe(false);

    await click(resultButton);
    expect(store.getSnapshot().slots.main.deck.Beta?.totalCount).toBe(1);
    // A Pocket card makes this a 20-card Pocket deck.
    expect(summary(host)).toEqual({
      total: 'Total: 1 / 20 cards',
      pokemon: '1',
      trainer: '0',
      energy: '0',
      progress: '1',
    });
    // The result now says how many of that name the deck holds.
    expect(
      resultButton.querySelector('.native-deck-builder-result-count')
        ?.textContent
    ).toBe('1 in deck');
  });

  it('cancels an obsolete search and ignores its late result', async () => {
    const catalog = new FakeCatalog();
    let resolveFirst: ((value: CardCatalogSearchResult) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    catalog.queryCardsByName
      .mockImplementationOnce(
        async (_term, options) =>
          await new Promise<CardCatalogSearchResult>((resolve) => {
            firstSignal = options?.signal;
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(result([card('New', 'new-image')]));
    await mount({ catalog });
    const search = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderSearchInput'
    )!;
    const button = host.querySelector('#nativeDeckBuilderSearchButton')!;

    await input(search, 'Old');
    await click(button);
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
    await input(search, 'New');
    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst?.(result([card('Old', 'old-image')]));

    await vi.waitFor(() =>
      expect(host.querySelector('[data-result-index]')?.textContent).toContain(
        'New'
      )
    );
    expect(host.textContent).not.toContain('Old Set');
  });

  it('captures the import target, exports that target, clears with confirmation, and plays', async () => {
    const main = card('Main', 'main-image');
    const alternate = card('Alternate', 'alternate-image');
    const imported = card('Imported', 'arbitrary:imported-image');
    const store = new DeckBuilderStore({
      mainDeck: deckWith(main),
      alternateDeck: deckWith(alternate),
    });
    const downloadDeck = vi.fn(() => true);
    const confirmClear = vi.fn(() => true);
    const onPlay = vi.fn();
    let finishImport: ((value: DeckCsvFileImportResult) => void) | undefined;
    const importDeckFile = vi.fn(
      async () =>
        await new Promise<DeckCsvFileImportResult>((resolve) => {
          finishImport = resolve;
        })
    );
    await mount({
      store,
      downloadDeck,
      confirmClear,
      onPlay,
      importDeckFile,
    });

    await click(host.querySelector('#nativeDeckBuilderTargetAlt')!);
    expect(store.getSnapshot().target).toBe('alternate');
    expect(
      host
        .querySelector('#nativeDeckBuilderImportCsvLabel')
        ?.getAttribute('data-seat')
    ).toBe('opponent');
    await click(host.querySelector('#nativeDeckBuilderExportCsv')!);
    expect(downloadDeck).toHaveBeenCalledWith(
      store.getSnapshot().slots.alternate.deck
    );

    const fileInput = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderCsvImport'
    )!;
    const file = new File(['csv'], 'deck.csv', { type: 'text/csv' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(finishImport).toBeTypeOf('function'));
    await click(host.querySelector('#nativeDeckBuilderTargetMain')!);
    await act(async () => {
      finishImport?.({ ok: true, deck: deckWith(imported) });
      await Promise.resolve();
    });
    expect(store.getSnapshot().slots.alternate.deck.Imported?.totalCount).toBe(
      1
    );
    expect(store.getSnapshot().slots.main.deck.Main?.totalCount).toBe(1);
    expect(fileInput.value).toBe('');

    await click(host.querySelector('#nativeDeckBuilderClear')!);
    expect(confirmClear).toHaveBeenCalledWith(
      'Are you sure you want to delete your deck?',
      { signal: expect.any(AbortSignal) }
    );
    expect(store.getSnapshot().slots.main.deck).toEqual({});
    expect(
      host.querySelector<HTMLButtonElement>('#nativeDeckBuilderPlayButton')
        ?.disabled
    ).toBe(true);

    await act(async () => {
      store.addCard(main);
    });
    await click(host.querySelector('#nativeDeckBuilderPlayButton')!);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('asks before Clear in a danger confirm dialog and keeps the deck on Cancel', async () => {
    const main = card('Main', 'main-image');
    const store = new DeckBuilderStore({ mainDeck: deckWith(main) });
    const overlayElement = document.createElement('div');
    document.body.append(overlayElement);
    const overlayRoot = createRoot(overlayElement);
    await act(async () => overlayRoot.render(<OverlayHost />));
    const settle = async () => {
      for (let round = 0; round < 4; round += 1) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      }
    };
    const dialogButton = (action: string) =>
      document.querySelector<HTMLButtonElement>(
        `[data-dialog-action="${action}"]`
      )!;
    try {
      await mount({ store });

      await click(host.querySelector('#nativeDeckBuilderClear')!);
      await settle();
      const question = document.querySelector('[role="alertdialog"]');
      expect(question?.textContent).toContain(
        'Are you sure you want to delete your deck?'
      );
      expect(dialogButton('confirm').dataset.variant).toBe('danger');
      expect(document.activeElement).toBe(dialogButton('cancel'));
      await click(dialogButton('cancel'));
      await settle();
      expect(store.getSnapshot().slots.main.deck.Main?.totalCount).toBe(1);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();

      await click(host.querySelector('#nativeDeckBuilderClear')!);
      await settle();
      await click(dialogButton('confirm'));
      await settle();
      expect(store.getSnapshot().slots.main.deck).toEqual({});
    } finally {
      await act(async () => {
        cancelAllDialogRequests();
        overlayRoot.unmount();
      });
      overlayElement.remove();
    }
  });

  it('keeps the solo-only target unavailable in multiplayer', async () => {
    const store = new DeckBuilderStore({ alternateEnabled: false });
    await mount({ store });
    const alternate = host.querySelector<HTMLButtonElement>(
      '#nativeDeckBuilderTargetAlt'
    )!;

    expect(alternate.getAttribute('aria-disabled')).toBe('true');
    await click(alternate);
    expect(store.getSnapshot().target).toBe('main');
  });

  it('hands any bounded custom URL directly to img and accepts it only after native load', async () => {
    const { store } = await mount();
    await click(host.querySelector('#nativeDeckBuilderAddCustomCard')!);
    const modal = host.querySelector<HTMLElement>(
      '#nativeDeckBuilderCustomCardModal'
    )!;
    expect(modal.hasAttribute('hidden')).toBe(false);
    const quantity = host.querySelector<HTMLInputElement>(
      '#nativeCustomCardQty'
    )!;
    const name = host.querySelector<HTMLInputElement>('#nativeCustomCardName')!;
    const image = host.querySelector<HTMLInputElement>(
      '#nativeCustomCardImageUrl'
    )!;
    const arbitraryUrl = 'custom+unsafe://player-host/card?keep=this';
    await input(quantity, '2');
    await input(name, 'Custom Card');
    await input(image, `  ${arbitraryUrl}  `);

    const preview = host.querySelector<HTMLImageElement>(
      '#nativeCustomCardPreviewImage'
    )!;
    expect(preview.getAttribute('src')).toBe(arbitraryUrl);
    expect(preview.hasAttribute('crossorigin')).toBe(false);
    await click(host.querySelector('#nativeCustomCardSubmit')!);
    expect(host.querySelector('#nativeCustomCardError')?.textContent).toBe(
      'Image URL must point to a loadable image.'
    );

    await act(async () => {
      preview.dispatchEvent(new Event('load'));
    });
    await click(host.querySelector('#nativeCustomCardSubmit')!);
    expect(modal.hasAttribute('hidden')).toBe(true);
    const variant =
      store.getSnapshot().slots.main.deck['Custom Card']?.cards[0];
    expect(variant?.count).toBe(2);
    expect(variant?.data.id).toBe(`custom:Custom Card:Pokémon:${arbitraryUrl}`);
    expect(variant?.data.image).toBe(arbitraryUrl);
    expect(variant?.data.images).toEqual({
      small: arbitraryUrl,
      large: arbitraryUrl,
    });
  });

  it('closes the custom dialog with Escape and returns focus to its trigger', async () => {
    await mount();
    const trigger = host.querySelector<HTMLButtonElement>(
      '#nativeDeckBuilderAddCustomCard'
    )!;
    await click(trigger);
    const modal = host.querySelector<HTMLElement>(
      '#nativeDeckBuilderCustomCardModal'
    )!;

    expect(document.activeElement?.id).toBe('nativeCustomCardName');
    await act(async () => {
      modal.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(modal.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps deck-row buttons from opening preview and opens exact art from the row', async () => {
    const deckCard = card('Pikachu', 'arbitrary:deck-art');
    const store = new DeckBuilderStore({ mainDeck: deckWith(deckCard) });
    await mount({ store });
    const row = host.querySelector<HTMLElement>('[data-deck-index]')!;
    const plus = row.querySelector<HTMLButtonElement>('[data-add-index]')!;

    await click(plus);
    expect(store.getSnapshot().slots.main.deck.Pikachu?.totalCount).toBe(2);
    expect(
      host
        .querySelector('#nativeDeckBuilderCardPreviewScrim')
        ?.hasAttribute('hidden')
    ).toBe(true);

    await click(row);
    expect(
      host
        .querySelector('#nativeDeckBuilderCardPreviewImage')
        ?.getAttribute('src')
    ).toBe('arbitrary:deck-art');
    await click(host.querySelector('#nativeDeckBuilderCardPreviewScrim')!);
    expect(
      host
        .querySelector('#nativeDeckBuilderCardPreviewScrim')
        ?.hasAttribute('hidden')
    ).toBe(true);
  });

  it('opens the CSV picker from a real Import Deck button', async () => {
    await mount();
    const button = host.querySelector<HTMLButtonElement>(
      '#nativeDeckBuilderImportCsvLabel'
    )!;
    const fileInput = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderCsvImport'
    )!;
    const picker = vi.fn();
    fileInput.addEventListener('click', picker);

    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toBe('Import Deck');
    await click(button);
    expect(picker).toHaveBeenCalledOnce();
  });

  it('closes the card preview with Escape and returns focus to the card', async () => {
    const deckCard = card('Pikachu', 'arbitrary:deck-art');
    const store = new DeckBuilderStore({ mainDeck: deckWith(deckCard, 3) });
    await mount({ store });
    const row = host.querySelector<HTMLElement>('[data-deck-index]')!;
    // The row reads as one sentence; the badge and name repeat it visually.
    expect(row.querySelector('.ds-visually-hidden')?.textContent).toBe(
      'x3 — Pikachu (Pokémon)'
    );
    const preview = row.querySelector<HTMLButtonElement>(
      '.native-deck-builder-deck-card'
    )!;
    preview.focus();
    await click(preview);
    const scrim = host.querySelector<HTMLElement>(
      '#nativeDeckBuilderCardPreviewScrim'
    )!;
    expect(scrim.hidden).toBe(false);
    expect(scrim.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(scrim);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(scrim.hidden).toBe(true);
    expect(document.activeElement).toBe(preview);
  });

  it('groups the deck by supertype and pops a count only when it changes', async () => {
    const pokemon = card('Pikachu', 'arbitrary:pikachu');
    const energy = card('Fire Energy', 'arbitrary:fire', {
      supertype: 'Energy',
    });
    const store = new DeckBuilderStore({
      mainDeck: { ...deckWith(pokemon, 2), ...deckWith(energy, 4) },
    });
    await mount({ store });
    const groups = [
      ...host.querySelectorAll('.native-deck-builder-deck-group'),
    ].map((group) => group.getAttribute('aria-label'));
    expect(groups).toEqual(['Pokémon cards', 'Energy cards']);
    const badge = () =>
      host.querySelector(
        '[data-deck-index="0"] .native-deck-builder-deck-count'
      )!;
    expect(badge().textContent).toBe('2');
    expect(badge().classList.contains('is-bumped')).toBe(false);

    await click(host.querySelector('[data-deck-index="0"] [data-add-index]')!);
    expect(badge().textContent).toBe('3');
    expect(badge().classList.contains('is-bumped')).toBe(true);
  });

  it('aborts pending catalog and file work on teardown', async () => {
    const catalog = new FakeCatalog();
    let searchSignal: AbortSignal | undefined;
    catalog.queryCardsByName.mockImplementation(
      async (_term, options) =>
        await new Promise<CardCatalogSearchResult>(() => {
          searchSignal = options?.signal;
        })
    );
    let importSignal: AbortSignal | undefined;
    const importDeckFile = vi.fn(
      async (
        _file: { readonly size: number; text(): Promise<string> },
        options?: { readonly signal?: AbortSignal }
      ) =>
        await new Promise<DeckCsvFileImportResult>(() => {
          importSignal = options?.signal;
        })
    );
    await mount({ catalog, importDeckFile });
    const search = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderSearchInput'
    )!;
    await input(search, 'Pending');
    await click(host.querySelector('#nativeDeckBuilderSearchButton')!);
    const fileInput = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderCsvImport'
    )!;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['csv'], 'deck.csv')],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(searchSignal).toBeDefined();
      expect(importSignal).toBeDefined();
    });

    await act(async () => root?.unmount());
    root = undefined;
    expect(searchSignal?.aborted).toBe(true);
    expect(importSignal?.aborted).toBe(true);
  });
});
