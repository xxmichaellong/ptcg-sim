// @vitest-environment happy-dom

import { asViewCardId } from '@ptcgsim/game-core';
import type { BoardScene, Rect } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TouchCardBar } from './TouchCardBar.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { width: 844, height: 390, devicePixelRatio: 3 };
const BAR = { width: 236, height: 52, gap: 8 };

/** Only the card the bar looks up matters to it. */
const sceneWith = (bounds: Rect, label = 'Pikachu'): BoardScene =>
  ({
    cards: [{ id: asViewCardId('tapped'), bounds, label }],
  }) as unknown as BoardScene;

let host: HTMLDivElement;
let root: Root;
const actions = {
  onRead: vi.fn(),
  onActions: vi.fn(),
  onDismiss: vi.fn(),
};

const render = async (
  bounds: Rect,
  cardId = asViewCardId('tapped')
): Promise<HTMLElement | null> => {
  await act(async () =>
    root.render(
      <TouchCardBar
        scene={sceneWith(bounds)}
        cardId={cardId}
        viewport={VIEWPORT}
        {...actions}
      />
    )
  );
  return host.querySelector<HTMLElement>('[data-touch-card-bar]');
};

const px = (value: string): number => Number.parseFloat(value);

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  for (const action of Object.values(actions)) action.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe('TouchCardBar', () => {
  it('sits above a card with room over it, centred on the card', async () => {
    const card = { x: 300, y: 300, width: 60, height: 84 };
    const bar = (await render(card))!;
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.getAttribute('aria-label')).toBe('Pikachu: actions');
    expect(bar.dataset.placement).toBe('above');
    expect(px(bar.style.top)).toBe(card.y - BAR.gap - BAR.height);
    expect(px(bar.style.left)).toBe(card.x + card.width / 2 - BAR.width / 2);
    expect(px(bar.style.width)).toBe(BAR.width);
  });

  it('drops below a card near the top, never past the bottom edge', async () => {
    const near = { x: 300, y: 20, width: 60, height: 84 };
    const bar = (await render(near))!;
    expect(bar.dataset.placement).toBe('below');
    expect(px(bar.style.top)).toBe(near.y + near.height + BAR.gap);

    // A card filling the window's height: the bar stays inside it.
    const tall = { x: 300, y: 10, width: 60, height: 400 };
    const clamped = (await render(tall))!;
    expect(px(clamped.style.top)).toBe(VIEWPORT.height - BAR.height - BAR.gap);
  });

  it("keeps clear of the window's sides", async () => {
    const left = (await render({ x: 0, y: 300, width: 40, height: 56 }))!;
    expect(px(left.style.left)).toBe(BAR.gap);
    const right = (await render({
      x: VIEWPORT.width - 40,
      y: 300,
      width: 40,
      height: 56,
    }))!;
    expect(px(right.style.left)).toBe(VIEWPORT.width - BAR.width - BAR.gap);
  });

  it('reads the card, opens its actions, or lets it go', async () => {
    await render({ x: 300, y: 300, width: 60, height: 84 });
    const read = host.querySelector<HTMLButtonElement>('#touchReadCardButton')!;
    const open = host.querySelector<HTMLButtonElement>(
      '#touchCardActionsButton'
    )!;
    const deselect = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Deselect"]'
    )!;
    expect(read.textContent).toBe('Read');
    expect(open.textContent).toBe('Actions');
    expect(open.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => read.click());
    expect(actions.onRead).toHaveBeenCalledOnce();
    await act(async () => open.click());
    expect(actions.onActions).toHaveBeenCalledOnce();
    await act(async () => deselect.click());
    expect(actions.onDismiss).toHaveBeenCalledOnce();
  });

  it('shows nothing for a card no longer on the table', async () => {
    expect(
      await render({ x: 0, y: 0, width: 1, height: 1 }, asViewCardId('gone'))
    ).toBeNull();
  });
});
