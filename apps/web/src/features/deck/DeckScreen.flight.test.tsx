// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as motion from '../../motion/motion-settings.js';
import { DeckLayer } from '../../session/shell/DeckLayer.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { DeckBuilderSession } from './DeckBuilderSession.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type { DeckDefinitionDigest } from './deck-install-adapter.js';
import { DeckLibrary } from './deck-library.js';
import type { PopularDecklistSource } from './popular-decklists.js';

vi.mock('../../ui/toast.js', () => ({ toast: vi.fn(() => 'toast') }));
vi.mock('./tournament-decks-hooks.js', async (original) => ({
  ...(await original<typeof import('./tournament-decks-hooks.js')>()),
  useDeckSearch: () => ({ status: 'idle' }),
  useRemote: () => ({ state: { status: 'loading' }, retry: () => undefined }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The catalog can't be reached: a pasted list imports as it is.
const UNREACHABLE = { status: 'failed' } as const;
const catalog = {
  getSnapshot: () => UNREACHABLE,
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
const animate = HTMLElement.prototype.animate;
const measure = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(motion, 'motionSettings').mockReturnValue({
    getSnapshot: () => ({ reduced: false, durationScale: 1 }),
  } as unknown as ReturnType<typeof motion.motionSettings>);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    })
  );
  // Boxes take room, and their flights never end by themselves here.
  HTMLElement.prototype.animate = () => new EventTarget() as Animation;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains('deck-box')
      ? ({ left: 10, top: 10, width: 50, height: 70 } as DOMRect)
      : measure.call(this);
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLElement.prototype.animate = animate;
  HTMLElement.prototype.getBoundingClientRect = measure;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frames = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

describe('a deck box flying to its seat', () => {
  it('flies for the deck picked, not later for a list pasted after a pick that changed nothing', async () => {
    const library = new DeckLibrary({ backend: null });
    library.create({
      name: 'Dreepy',
      format: 'standard',
      cards: [
        {
          card: {
            id: 'twm-128',
            name: 'Dreepy',
            category: 'Pokémon',
            image: 'https://example.test/twm-128.png',
          },
          count: 4,
        },
      ],
    });
    const store = new DeckBuilderStore();
    await act(async () =>
      root.render(
        <DeckLayer open onClose={vi.fn()}>
          <DeckBuilderSession
            open
            alternateEnabled
            installOnSessionAttach={false}
            onRequestClose={vi.fn()}
            catalog={catalog}
            library={library}
            samples={samples}
            digest={digest}
            store={store}
          />
        </DeckLayer>
      )
    );
    const ghosts = () => document.querySelectorAll('[data-lifted]').length;
    const tile = () =>
      host.querySelector<HTMLButtonElement>(
        'button.deck-tile__choose[aria-label^="Dreepy:"]'
      )!;
    await act(async () => tile().click());
    await frames();
    expect(ghosts()).toBe(1);
    document.querySelector('[data-lifted]')!.remove();
    // Pressed again: already on the seat, nothing lands and nothing flies.
    await act(async () => tile().click());
    await frames();
    expect(ghosts()).toBe(0);
    // A list pasted a moment later lands on the seat without that box.
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => '4 Pikachu SVI 1\n4 Raichu SVI 2' },
    });
    await act(async () => {
      document.body.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await frames();
    expect(store.getSnapshot().slots.main.deck.length).toBeGreaterThan(0);
    expect(store.getSnapshot().slots.main.label?.name).not.toBe('Dreepy');
    expect(ghosts()).toBe(0);
  });

  it("flies a list's box when it lands, with a deck's name pasted while it loaded", async () => {
    // The catalog still loading: a list tried waits for it.
    let status: { readonly status: string } = { status: 'loading' };
    const listeners = new Set<() => void>();
    const loading = {
      getSnapshot: () => status,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      load: vi.fn(),
      retry: vi.fn(),
    } as unknown as CardCatalogSource;
    const classics = {
      load: vi.fn(async () => ({
        groups: [
          {
            name: 'Classics',
            decks: [
              {
                name: 'Dreepy deck',
                decklist: '4 Dreepy TWM 128\n4 Drakloak TWM 129',
              },
            ],
          },
        ],
        deckCount: 1,
        totalDecklistCodeUnits: 34,
      })),
      selectRandom: vi.fn(),
    } as unknown as PopularDecklistSource;
    const store = new DeckBuilderStore();
    await act(async () =>
      root.render(
        <DeckLayer open onClose={vi.fn()}>
          <DeckBuilderSession
            open
            alternateEnabled
            installOnSessionAttach={false}
            onRequestClose={vi.fn()}
            catalog={loading}
            library={new DeckLibrary({ backend: null })}
            samples={classics}
            digest={digest}
            store={store}
          />
        </DeckLayer>
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const ghosts = () => document.querySelectorAll('[data-lifted]').length;
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button.deck-tile__choose[aria-label^="Dreepy deck"]'
        )!
        .click()
    );
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'Dragapult' },
    });
    await act(async () => {
      document.body.dispatchEvent(paste);
    });
    // The catalog gives up: the list lands as it is, its box with it.
    status = { status: 'failed' };
    await act(async () => {
      for (const listener of listeners) listener();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await frames();
    expect(store.getSnapshot().slots.main.deck.length).toBeGreaterThan(0);
    expect(ghosts()).toBe(1);
  });
});
