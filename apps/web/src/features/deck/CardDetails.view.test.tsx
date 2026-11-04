// @vitest-environment happy-dom

import {
  decodeCatalog,
  deckListOf,
  localizeCardImageUrl,
  type DeckCard,
} from '@ptcgsim/deck-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import { CardDetails, cardDetailsFacts } from './CardDetails.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const catalog = decodeCatalog(fixture);
const scan = (language: string): DeckCard => ({
  id: `custom:${language}`,
  name: 'Dragapult ex',
  category: 'Pokémon',
  image: `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_130_R_${language}.png`,
  set: 'TWM',
  number: '130',
});

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

describe('card details controls', () => {
  it('count and change the entry inspected, not another scan of its printing', async () => {
    // An English and a German scan of one printing: two entries.
    const english = scan('EN');
    const german = scan('DE');
    const deck = deckListOf([
      { card: english, count: 1 },
      { card: german, count: 3 },
    ]);
    const inspected = { kind: 'deck', card: german } as const;
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <CardDetails
          inspected={inspected}
          facts={cardDetailsFacts(catalog, inspected, deck)}
          deck={deck}
          coverId={undefined}
          onClose={vi.fn()}
          onShow={vi.fn()}
          onAdd={onAdd}
          onRemove={onRemove}
          onSwapPrint={vi.fn()}
          onSetCover={vi.fn()}
        />
      )
    );
    expect(document.querySelector('[aria-label="3 in deck"]')).not.toBeNull();
    const remove = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove one Dragapult ex"]'
    )!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click());
    expect(onRemove).toHaveBeenCalledWith(german);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Add one Dragapult ex"]'
        )!
        .click()
    );
    expect(onAdd).toHaveBeenCalledWith(german);
    // Its own scan, not the catalog's, in the language this player sees
    // cards in (English here).
    expect(
      document.querySelector<HTMLImageElement>(
        '#nativeDeckBuilderCardPreviewImage'
      )?.src
    ).toBe(localizeCardImageUrl(german.image, 'en'));
  });

  it('offers another print for every scan of the one the deck has', async () => {
    const english = scan('EN');
    const german = scan('DE');
    const deck = deckListOf([
      { card: english, count: 1 },
      { card: german, count: 3 },
    ]);
    const other = catalog.byId.get('TWM 200')!;
    const inspected = { kind: 'catalog', card: other } as const;
    const onSwapPrint = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <CardDetails
          inspected={inspected}
          facts={cardDetailsFacts(catalog, inspected, deck)}
          deck={deck}
          coverId={undefined}
          onClose={vi.fn()}
          onShow={vi.fn()}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onSwapPrint={onSwapPrint}
          onSetCover={vi.fn()}
        />
      )
    );
    const use = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Use this print')
    );
    expect(use?.textContent).toBe('Use this print for the 4 in the deck');
    await act(async () => use!.click());
    expect(onSwapPrint).toHaveBeenCalledWith(['custom:EN', 'custom:DE'], other);
  });
});

describe('a card’s own text in the sheet (ADR-043)', () => {
  const charizard = catalog.byId.get('OBF 125')!;
  const deckCard: DeckCard = {
    id: 'OBF 125',
    name: 'Charizard ex',
    category: 'Pokémon',
    image: charizard.image,
    set: 'OBF',
    number: '125',
  };

  const render = async (card: DeckCard, onEditText = vi.fn()) => {
    const deck = deckListOf([{ card, count: 2 }]);
    const inspected = { kind: 'deck', card } as const;
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <CardDetails
          inspected={inspected}
          facts={cardDetailsFacts(catalog, inspected, deck)}
          deck={deck}
          coverId={undefined}
          onClose={vi.fn()}
          onShow={vi.fn()}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onSwapPrint={vi.fn()}
          onSetCover={vi.fn()}
          onEditText={onEditText}
        />
      )
    );
    return onEditText;
  };
  const setValue = async (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('edits the printed text into the deck’s own, and saves it for every copy', async () => {
    const onEditText = await render(deckCard);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-card-text-edit]')!
        .click()
    );
    const hp = document.querySelector<HTMLInputElement>(
      '.card-text-editor input[type="number"]'
    )!;
    expect(hp.value).toBe('330');
    await setValue(hp, '340');
    await act(async () =>
      document
        .querySelector<HTMLFormElement>('.deck-card-details__editor')!
        .requestSubmit()
    );
    expect(onEditText).toHaveBeenCalledWith(
      ['OBF 125'],
      expect.objectContaining({
        hp: 340,
        abilities: [expect.objectContaining({ name: 'Infernal Reign' })],
      })
    );
  });

  it('saves text written back to the print’s as none, and shows a card’s own as edited', async () => {
    const onEditText = await render(deckCard);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-card-text-edit]')!
        .click()
    );
    await act(async () =>
      document
        .querySelector<HTMLFormElement>('.deck-card-details__editor')!
        .requestSubmit()
    );
    expect(onEditText).toHaveBeenCalledWith(['OBF 125'], undefined);
    await act(async () => root?.unmount());
    document.body.innerHTML = '';
    await render({ ...deckCard, text: { hp: 340, rules: 'House rule.' } });
    const shown = document.querySelector('.deck-card-details__text')!;
    expect(shown.textContent).toContain('340 HP');
    expect(shown.textContent).toContain('House rule.');
    expect(shown.textContent).toContain('Edited');
  });
});
