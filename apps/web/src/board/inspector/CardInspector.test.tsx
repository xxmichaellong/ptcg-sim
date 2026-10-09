// @vitest-environment happy-dom

import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardHoverStore, CardInspector } from './CardInspector.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const view = createRendererSpikeView();
const scene = createBoardSceneForViewport(view, {
  viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
  bottomPlayerId: view.playerOrder[0]!,
  splitRatio: 0.5,
  geometryVersion: 1,
});
const handCards = scene.cards
  .filter((card) => card.parentId === 'zone:spike-blue:hand')
  .sort((left, right) => left.bounds.x - right.bounds.x);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const mount = async () => {
  const store = new CardHoverStore();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CardInspector
        store={store}
        view={view}
        scene={scene}
        reducedMotion={false}
      />
    )
  );
  const inspector = host.querySelector<HTMLElement>('[data-card-inspector]')!;
  return { store, host, root, inspector };
};

describe('CardInspector', () => {
  it('opens after the pointer rests on a readable card and follows it from card to card', async () => {
    const { store, root, inspector } = await mount();
    expect(inspector.dataset.open).toBe('false');
    expect(inspector.getAttribute('aria-hidden')).toBe('true');

    const first = handCards[0]!;
    await act(async () => store.set({ cardId: first.id, x: 0.1, y: -0.2 }));
    // Sweeping across cards does not flash the inspector open.
    expect(inspector.dataset.open).toBe('false');
    await act(async () => vi.advanceTimersByTime(150));
    expect(inspector.dataset.open).toBe('true');
    // The leftmost hand card sits left of centre: the inspector docks right.
    expect(inspector.dataset.side).toBe('right');
    const image = inspector.querySelector<HTMLImageElement>('img')!;
    expect(image.getAttribute('src')).toBe(
      view.definitions[
        (
          view.zones['zone:spike-blue:hand']!.cards.find(
            (card) => card.id === first.id
          ) as { definitionId: string }
        ).definitionId
      ]!.imageUrl
    );
    const card = inspector.querySelector<HTMLElement>('.card-inspector__card')!;
    expect(card.style.getPropertyValue('--inspector-tilt-y')).toBe('2.20deg');

    // Already open: the next card shows at once.
    const second = handCards[1]!;
    await act(async () => store.set({ cardId: second.id, x: 0, y: 0 }));
    expect(
      inspector
        .querySelector('.card-inspector__card')
        ?.getAttribute('data-finish')
    ).toBeTruthy();
    expect(inspector.dataset.open).toBe('true');

    // A concealed card closes it after a short grace period.
    const hidden = scene.cards.find((candidate) => candidate.concealed)!;
    await act(async () => store.set({ cardId: hidden.id, x: 0, y: 0 }));
    await act(async () => vi.advanceTimersByTime(200));
    expect(inspector.dataset.open).toBe('false');

    await act(async () => store.set(null));
    await act(async () => root.unmount());
  });
});
