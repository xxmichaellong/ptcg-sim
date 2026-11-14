// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type {
  CardCatalogSource,
  CardCatalogState,
} from '../features/deck/card-catalog-contract.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let state: CardCatalogState = { status: 'failed' };
const source: CardCatalogSource = {
  getSnapshot: () => state,
  subscribe: () => () => undefined,
  load: vi.fn(),
  retry: vi.fn(() => {
    state = { status: 'loading' };
  }),
};

vi.mock('../features/deck/LazyDeckBuilderSession.js', () => ({
  loadedTableCardCatalog: () => source,
  tableCardCatalog: async () => source,
}));

const { useTableCardCatalog } = await import('./card-text.js');

describe('the table’s catalog (ADR-043)', () => {
  it('tries a load that failed again for the next window that wants it', async () => {
    const seen: string[] = [];
    const Probe = () => {
      seen.push(useTableCardCatalog(true).status);
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(source.load).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
