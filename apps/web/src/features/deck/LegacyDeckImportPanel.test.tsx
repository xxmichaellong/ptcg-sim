// @vitest-environment happy-dom

import type { PastedDecklistRow } from '@ptcgsim/deck-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LegacyDeckImportPanel,
  type PastedDecklistImporter,
} from './LegacyDeckImportPanel.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type {
  PopularDecklistCollection,
  PopularDecklistSource,
} from './popular-decklists.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const CSV_HEADER_FOR_TEST = 'QTY,Name,Type,URL';

const rows = (
  values: readonly Partial<PastedDecklistRow>[]
): readonly PastedDecklistRow[] =>
  values.map((value, index) => ({
    quantity: value.quantity ?? 1,
    name: value.name ?? `Card ${index + 1}`,
    cardType: value.cardType ?? 'Pokémon',
    ...(value.imageUrl ? { imageUrl: value.imageUrl } : {}),
  }));

const collection: PopularDecklistCollection = Object.freeze({
  groups: Object.freeze([
    Object.freeze({
      name: 'Era One',
      decks: Object.freeze([
        Object.freeze({ name: 'Alpha Deck', decklist: '1 Alpha BRS 1' }),
      ]),
    }),
  ]),
  deckCount: 1,
  totalDecklistCodeUnits: 13,
});

const fakeSamples = (): PopularDecklistSource => ({
  load: vi.fn(async () => collection),
  selectRandom: vi.fn(async () => ({
    name: 'Random Deck',
    decklist: '1 Random BRS 2',
  })),
});

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
    readonly open?: boolean;
    readonly samples?: PopularDecklistSource;
    readonly importDecklist?: PastedDecklistImporter;
    readonly downloadCsv?: (source: string) => boolean;
    readonly onChangeCardBack?: (target: 'main' | 'alternate') => void;
  } = {}
) => {
  const store = options.store ?? new DeckBuilderStore();
  const samples = options.samples ?? fakeSamples();
  const importDecklist =
    options.importDecklist ??
    vi.fn<PastedDecklistImporter>(async () => ({
      ok: true,
      format: 'legacy',
      rows: rows([{ imageUrl: 'arbitrary:default' }]),
    }));
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <LegacyDeckImportPanel
        store={store}
        open={options.open ?? true}
        samples={samples}
        importDecklist={importDecklist}
        {...(options.downloadCsv ? { downloadCsv: options.downloadCsv } : {})}
        {...(options.onChangeCardBack
          ? { onChangeCardBack: options.onChangeCardBack }
          : {})}
      />
    );
  });
  return { store, samples, importDecklist };
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const inputTextarea = async (element: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
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

const editCell = async (element: HTMLTableCellElement, value: string) => {
  await act(async () => {
    element.innerText = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
};

const buttonWithText = (text: string): HTMLButtonElement => {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
};

describe('LegacyDeckImportPanel', () => {
  it('retains source IDs, labels, placeholders, target behavior, and closed inertness', async () => {
    const onChangeCardBack = vi.fn();
    const store = new DeckBuilderStore();
    await mount({ store, open: false, onChangeCardBack });
    const panel = host.querySelector<HTMLElement>('#deckImport')!;

    expect(panel.hidden).toBe(true);
    expect(panel.inert).toBe(true);
    expect(host.querySelector('#mainImportHeaderButton')?.textContent).toBe(
      'P1'
    );
    expect(host.querySelector('#altImportHeaderButton')?.textContent).toBe(
      'P2 (Solo only)'
    );
    expect(
      host.querySelector<HTMLTextAreaElement>('#mainDeckImportInput')
        ?.placeholder
    ).toContain('Paste your decklist here or use the deck builder.');
    expect(host.querySelector('#changeLanguageButton')?.textContent).toContain(
      'Language: English'
    );
    expect(host.querySelector('#changeCardBackButton')?.textContent).toBe(
      'Change Card Back'
    );

    await click(host.querySelector('#altImportHeaderButton')!);
    expect(store.getSnapshot().target).toBe('alternate');
    expect(
      host.querySelector<HTMLTextAreaElement>('#altDeckImportInput')?.hidden
    ).toBe(false);
    await click(host.querySelector('#changeCardBackButton')!);
    expect(onChangeCardBack).toHaveBeenCalledWith('alternate');
  });

  it('keeps the alternate target disabled in multiplayer and shows the source notice', async () => {
    const store = new DeckBuilderStore({ alternateEnabled: false });
    await mount({ store });

    await click(host.querySelector('#altImportHeaderButton')!);
    expect(store.getSnapshot().target).toBe('main');
    expect(host.querySelector<HTMLElement>('#invalidText')?.hidden).toBe(false);
    expect(host.querySelector('#invalidText')?.textContent).toBe('Solo only!');
  });

  it('loads the book lazily and preserves separate target text for book and random choices', async () => {
    const samples = fakeSamples();
    await mount({ samples });
    expect(samples.load).not.toHaveBeenCalled();

    await click(host.querySelector('#decklistsButton')!);
    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLElement>('#decklistsContextMenu')?.hidden
      ).toBe(false)
    );
    expect(samples.load).toHaveBeenCalledOnce();
    await click(buttonWithText('Alpha Deck'));
    expect(
      host.querySelector<HTMLTextAreaElement>('#mainDeckImportInput')?.value
    ).toBe('1 Alpha BRS 1');

    await click(host.querySelector('#altImportHeaderButton')!);
    await click(host.querySelector('#randomButton')!);
    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLTextAreaElement>('#altDeckImportInput')?.value
      ).toBe('1 Random BRS 2')
    );
    expect(
      host.querySelector<HTMLTextAreaElement>('#mainDeckImportInput')?.value
    ).toBe('1 Alpha BRS 1');
    expect(samples.selectRandom).toHaveBeenCalledOnce();
  });

  it('deduplicates a pending book load and aborts all sample work on teardown', async () => {
    let loadSignal: AbortSignal | undefined;
    let randomSignal: AbortSignal | undefined;
    const samples: PopularDecklistSource = {
      load: vi.fn(
        async (options) =>
          await new Promise<PopularDecklistCollection>(() => {
            loadSignal = options?.signal;
          })
      ),
      selectRandom: vi.fn(
        async (options) =>
          await new Promise(() => {
            randomSignal = options?.signal;
          })
      ),
    };
    await mount({ samples });

    await click(host.querySelector('#decklistsButton')!);
    await click(host.querySelector('#decklistsButton')!);
    await click(host.querySelector('#randomButton')!);
    await vi.waitFor(() => {
      expect(loadSignal).toBeDefined();
      expect(randomSignal).toBeDefined();
    });
    expect(samples.load).toHaveBeenCalledOnce();

    await act(async () => root?.unmount());
    root = undefined;
    expect(loadSignal?.aborted).toBe(true);
    expect(randomSignal?.aborted).toBe(true);
  });

  it('captures target and language through async import, then confirms exact image text', async () => {
    let finish:
      | ((value: Awaited<ReturnType<PastedDecklistImporter>>) => void)
      | undefined;
    const importDecklist = vi.fn<PastedDecklistImporter>(
      async () =>
        await new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { store } = await mount({ importDecklist });
    await click(host.querySelector('#changeLanguageButton')!);
    await click(buttonWithText('French'));
    await click(host.querySelector('#altImportHeaderButton')!);
    const textarea = host.querySelector<HTMLTextAreaElement>(
      '#altDeckImportInput'
    )!;
    await inputTextarea(textarea, '1 Custom Card');
    await click(host.querySelector('#importButton')!);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const call = importDecklist.mock.calls[0];
    expect(call?.[0]).toBe('1 Custom Card');
    expect(call?.[1]).toMatchObject({
      language: 'French',
      signal: expect.any(AbortSignal),
    });

    await click(host.querySelector('#mainImportHeaderButton')!);
    await act(async () => {
      finish?.({
        ok: true,
        format: 'unknown',
        rows: rows([
          {
            quantity: 2,
            name: 'Custom Card',
            cardType: 'Trainer',
            imageUrl: 'custom+unsafe://player-host/exact?yes=1',
          },
        ]),
      });
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLTableElement>('#decklistTable')?.hidden).toBe(
      false
    );
    await click(host.querySelector('#confirmButton')!);

    expect(store.getSnapshot().slots.main.deck).toEqual({});
    const variant =
      store.getSnapshot().slots.alternate.deck['Custom Card']?.cards[0];
    expect(variant?.count).toBe(2);
    expect(variant?.data.image).toBe('custom+unsafe://player-host/exact?yes=1');
  });

  it('keeps unresolved rows editable and downloadable without publishing until Confirm', async () => {
    const downloadCsv = vi.fn(() => true);
    const importDecklist = vi.fn<PastedDecklistImporter>(async () => ({
      ok: false,
      reason: 'incomplete_metadata',
      rowNumbers: [1],
      draftRows: rows([
        { quantity: 3, name: 'Handmade Card', cardType: 'Unknown' },
      ]),
    }));
    const { store } = await mount({ importDecklist, downloadCsv });
    await inputTextarea(
      host.querySelector<HTMLTextAreaElement>('#mainDeckImportInput')!,
      '3 Handmade Card'
    );
    await click(host.querySelector('#importButton')!);
    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLTableElement>('#decklistTable')?.hidden
      ).toBe(false)
    );
    expect(host.querySelector<HTMLElement>('#failedText')?.hidden).toBe(false);
    expect(store.getSnapshot().slots.main.deck).toEqual({});

    const row = host.querySelector<HTMLTableRowElement>(
      '#decklistTable tbody tr'
    )!;
    const cells = row.querySelectorAll<HTMLTableCellElement>('td');
    const arbitraryUrl = 'custom+unsafe://any-player-host/card?exact=yes';
    await select(row.querySelector('select')!, 'Trainer');
    await editCell(cells[3]!, `  ${arbitraryUrl}  `);
    await click(host.querySelector('#saveButton')!);
    expect(downloadCsv).toHaveBeenCalledWith(
      `${CSV_HEADER_FOR_TEST}\n3,Handmade Card,Trainer,  ${arbitraryUrl}  `
    );
    expect(store.getSnapshot().slots.main.deck).toEqual({});

    await click(host.querySelector('#confirmButton')!);
    const variant =
      store.getSnapshot().slots.main.deck['Handmade Card']?.cards[0];
    expect(variant?.count).toBe(3);
    expect(variant?.data.supertype).toBe('Trainer');
    expect(variant?.data.image).toBe(arbitraryUrl);
  });

  it('cancels review without publication and aborts pending import on teardown', async () => {
    const importDecklist = vi.fn<PastedDecklistImporter>(async () => ({
      ok: true,
      format: 'legacy',
      rows: rows([{ imageUrl: 'arbitrary:review' }]),
    }));
    const { store } = await mount({ importDecklist });
    await click(host.querySelector('#importButton')!);
    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLTableElement>('#decklistTable')?.hidden
      ).toBe(false)
    );
    await click(host.querySelector('#cancelButton')!);
    expect(store.getSnapshot().slots.main.deck).toEqual({});
    expect(host.querySelector<HTMLTableElement>('#decklistTable')?.hidden).toBe(
      true
    );

    let signal: AbortSignal | undefined;
    importDecklist.mockImplementation(
      async (_source, options) =>
        await new Promise(() => {
          signal = options?.signal;
        })
    );
    await click(host.querySelector('#importButton')!);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await act(async () => root?.unmount());
    root = undefined;
    expect(signal?.aborted).toBe(true);
  });
});
