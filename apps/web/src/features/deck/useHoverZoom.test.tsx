// @vitest-environment happy-dom

import { decodeCatalog } from '@ptcgsim/deck-core';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import { CardSearchPanel } from './CardSearchPanel.js';
import type {
  CardCatalogSource,
  CardCatalogState,
} from './card-catalog-contract.js';
import { useHoverZoom } from './useHoverZoom.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let catalogState: CardCatalogState;
const listeners = new Set<() => void>();
const catalog: CardCatalogSource = {
  getSnapshot: () => catalogState,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  load: () => undefined,
  retry: () => undefined,
};

const Harness = () => {
  const bounds = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const zoom = useHoverZoom(bounds);
  return (
    <div ref={bounds}>
      <CardSearchPanel
        catalog={catalog}
        deck={[]}
        format="standard"
        searchRef={search}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onInspect={() => undefined}
        onCustomCard={() => undefined}
        onZoom={zoom.show}
        onZoomEnd={zoom.release}
        onZoomSourceGone={zoom.invalidate}
        onScroll={zoom.hide}
      />
      {zoom.element}
    </div>
  );
};

const searchFor = async (value: string): Promise<void> => {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderSearchInput'
    )!;
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const hover = async (card: HTMLElement): Promise<void> => {
  await act(async () => {
    card.dispatchEvent(
      new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })
    );
  });
};
const advance = async (milliseconds = 200): Promise<void> => {
  await act(async () => vi.advanceTimersByTime(milliseconds));
};
const zoomImage = (): string | undefined =>
  host.querySelector<HTMLImageElement>('.deck-zoom img:last-child')?.src;

beforeEach(async () => {
  vi.useFakeTimers();
  catalogState = { status: 'ready', catalog: decodeCatalog(fixture) };
  listeners.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('hover zoom source lifecycle', () => {
  it.each([false, true])(
    'clears a removed result with shown=%s while keyboard search leaves the mouse still',
    async (shown) => {
      await searchFor('t:dragon');
      const source = host.querySelector<HTMLButtonElement>('.card-result')!;
      await hover(source);
      if (shown) {
        await advance();
        expect(zoomImage()).toContain('/sv06/130/');
      }
      await searchFor('zzzz');
      expect(source.isConnected).toBe(false);
      await advance();
      expect(host.querySelector('.deck-zoom')).toBeNull();
    }
  );

  it('invalidates an old scan when the same result receives refreshed catalog data', async () => {
    await searchFor('judge');
    const source = host.querySelector<HTMLButtonElement>('.card-result')!;
    await hover(source);
    await advance();
    expect(zoomImage()).toContain('/me03/076/');
    const updated = structuredClone(fixture);
    updated.sets[0]!.img = 'https://catalog-refresh.example/';
    await act(async () => {
      catalogState = { status: 'ready', catalog: decodeCatalog(updated) };
      for (const listener of listeners) listener();
    });
    expect(host.querySelector('.card-result')).toBe(source);
    expect(source.querySelector('img')?.src).toContain(
      'catalog-refresh.example'
    );
    await advance();
    expect(host.querySelector('.deck-zoom')).toBeNull();
  });

  it('keeps the new active zoom when another hovered result is removed', async () => {
    await searchFor('t:dragon');
    const [first, second] =
      host.querySelectorAll<HTMLButtonElement>('.card-result');
    await hover(first!);
    await advance();
    await hover(second!);
    const image = zoomImage();
    expect(image).toBeDefined();
    const name = second!.querySelector('.card-result__name')!.textContent!;
    await searchFor(name);
    expect(first!.isConnected).toBe(false);
    expect(second!.isConnected).toBe(true);
    await advance();
    expect(zoomImage()).toBe(image);
  });

  it('allows a fresh hover after a source has disappeared', async () => {
    await searchFor('t:dragon');
    await hover(host.querySelector<HTMLButtonElement>('.card-result')!);
    await searchFor('zzzz');
    await advance();
    await searchFor('judge');
    await hover(host.querySelector<HTMLButtonElement>('.card-result')!);
    await advance();
    expect(zoomImage()).toContain('/me03/076/');
  });

  it('keeps the ordinary pointer-leave delay, then releases its timer', async () => {
    await searchFor('t:dragon');
    const card = host.querySelector<HTMLButtonElement>('.card-result')!;
    await hover(card);
    await advance();
    await act(async () => {
      card.dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })
      );
    });
    await advance(100);
    expect(zoomImage()).toBeDefined();
    await advance(100);
    expect(host.querySelector('.deck-zoom')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    'cancels timers on surface unmount with shown=%s',
    async (shown) => {
      await searchFor('t:dragon');
      const card = host.querySelector<HTMLButtonElement>('.card-result')!;
      await hover(card);
      if (shown) {
        await advance();
        await act(async () => {
          card.dispatchEvent(
            new PointerEvent('pointerout', {
              bubbles: true,
              pointerType: 'mouse',
            })
          );
        });
      }
      await act(async () => root.render(<div />));
      expect(vi.getTimerCount()).toBe(0);
      await advance();
      expect(host.querySelector('.deck-zoom')).toBeNull();
    }
  );
});
