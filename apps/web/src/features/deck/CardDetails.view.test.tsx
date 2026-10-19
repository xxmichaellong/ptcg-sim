// @vitest-environment happy-dom

import { decodeCatalog, deckListOf, type DeckCard } from '@ptcgsim/deck-core';
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
          facts={cardDetailsFacts(catalog, inspected)}
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
  });
});
