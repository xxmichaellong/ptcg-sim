// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DeckLayer } from '../../session/shell/DeckLayer.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { DeckBuilderSession } from './DeckBuilderSession.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type { DeckDefinitionDigest } from './deck-install-adapter.js';
import { DeckLibrary } from './deck-library.js';
import type { PopularDecklistSource } from './popular-decklists.js';

vi.mock('../../ui/toast.js', () => ({ toast: vi.fn(() => 'toast') }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FAILED = { status: 'failed' } as const;
const catalog = {
  getSnapshot: () => FAILED,
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
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

it('asks a deck search again on opening when it had failed', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const searches: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v2/decks/search')) {
        searches.push(String(input));
        return new Response('{}', { status: 500 });
      }
      // Nothing else here answers.
      return new Promise<Response>(() => undefined);
    })
  );
  const library = new DeckLibrary({ backend: null });
  const store = new DeckBuilderStore();
  const draw = (open: boolean) =>
    act(async () =>
      root.render(
        <DeckLayer open={open} onClose={() => undefined}>
          <DeckBuilderSession
            open={open}
            alternateEnabled
            installOnSessionAttach={false}
            onRequestClose={() => undefined}
            catalog={catalog}
            library={library}
            samples={samples}
            digest={digest}
            store={store}
          />
        </DeckLayer>
      )
    );
  await draw(true);
  const finder = host.querySelector<HTMLTextAreaElement>('#deckPasteInput')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(finder, 'Gardevoir');
    finder.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  expect(searches).toHaveLength(1);
  expect(host.textContent).toContain('Deck search is offline');
  // Put away and opened again: asked again, not left offline.
  await draw(false);
  await draw(true);
  await settle();
  expect(searches).toHaveLength(2);
});
