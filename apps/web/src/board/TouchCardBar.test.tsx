// @vitest-environment happy-dom

import { asViewCardId } from '@ptcgsim/game-core';
import type { BoardScene, Rect } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TouchCardBar, TouchGroupBar } from './TouchCardBar.js';

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

  it("gives a player's bar Select, 280px wide, which a 320px phone holds", async () => {
    const onSelect = vi.fn();
    const card = { x: 300, y: 300, width: 60, height: 84 };
    await act(async () =>
      root.render(
        <TouchCardBar
          scene={sceneWith(card)}
          cardId={asViewCardId('tapped')}
          viewport={VIEWPORT}
          {...actions}
          onSelect={onSelect}
        />
      )
    );
    const bar = host.querySelector<HTMLElement>('[data-touch-card-bar]')!;
    expect(px(bar.style.width)).toBe(280);
    expect(px(bar.style.left)).toBe(card.x + card.width / 2 - 280 / 2);
    const select = host.querySelector<HTMLButtonElement>(
      '#touchSelectCardButton'
    )!;
    expect(select.getAttribute('aria-label')).toBe('Select');
    await act(async () => select.click());
    expect(onSelect).toHaveBeenCalledOnce();
    // On a 320px phone it keeps 8px from each side.
    await act(async () =>
      root.render(
        <TouchCardBar
          scene={sceneWith({ x: 0, y: 300, width: 40, height: 56 })}
          cardId={asViewCardId('tapped')}
          viewport={{ width: 320, height: 640, devicePixelRatio: 3 }}
          {...actions}
          onSelect={onSelect}
        />
      )
    );
    const narrow = host.querySelector<HTMLElement>('[data-touch-card-bar]')!;
    expect(px(narrow.style.left)).toBe(BAR.gap);
    expect(px(narrow.style.left) + px(narrow.style.width)).toBeLessThanOrEqual(
      320 - BAR.gap
    );
  });

  it('plays a piece with its others as one card, Read giving up its word for the room', async () => {
    const onPlayAsOne = vi.fn();
    await act(async () =>
      root.render(
        <TouchCardBar
          scene={sceneWith({ x: 300, y: 300, width: 60, height: 84 })}
          cardId={asViewCardId('tapped')}
          viewport={VIEWPORT}
          {...actions}
          onSelect={vi.fn()}
          onPlayAsOne={onPlayAsOne}
        />
      )
    );
    const bar = host.querySelector<HTMLElement>('[data-touch-card-bar]')!;
    expect(px(bar.style.width)).toBe(280);
    expect(bar.querySelectorAll('button')).toHaveLength(5);
    const read = host.querySelector<HTMLButtonElement>('#touchReadCardButton')!;
    expect(read.textContent).toBe('');
    expect(read.getAttribute('aria-label')).toBe('Read');
    const play = host.querySelector<HTMLButtonElement>(
      '#touchPlayAsOneButton'
    )!;
    expect(play.getAttribute('aria-label')).toBe('Play as one card');
    await act(async () => play.click());
    expect(onPlayAsOne).toHaveBeenCalledOnce();
  });
});

describe('TouchGroupBar', () => {
  const groupScene = sceneWith({ x: 300, y: 300, width: 60, height: 84 });
  const renderGroup = async (
    props: Partial<Parameters<typeof TouchGroupBar>[0]> = {}
  ) => {
    const handlers = {
      onMove: vi.fn(),
      onDone: vi.fn(),
    };
    await act(async () =>
      root.render(
        <TouchGroupBar
          scene={groupScene}
          cardId={asViewCardId('tapped')}
          count={3}
          viewport={VIEWPORT}
          {...handlers}
          {...props}
        />
      )
    );
    return {
      handlers,
      bar: host.querySelector<HTMLElement>('[data-touch-group-bar]')!,
    };
  };

  it('says how many, moves them through the group menu, and lets them go', async () => {
    const onDamage = vi.fn();
    const { handlers, bar } = await renderGroup({ onDamage });
    expect(bar.getAttribute('aria-label')).toBe('3 selected: actions');
    expect(bar.querySelector('[data-touch-group-count]')?.textContent).toBe(
      '3'
    );
    // "3 · Move… · Damage… · ✕": at most four, 44px each at the least.
    const buttons = [...bar.querySelectorAll('button')];
    expect(buttons.map((button) => button.id)).toEqual([
      'touchGroupMoveButton',
      'touchGroupDamageButton',
      'touchGroupDoneButton',
    ]);
    expect(px(bar.style.width)).toBe(280);
    await act(async () => buttons[0]!.click());
    expect(handlers.onMove).toHaveBeenCalledWith(
      expect.objectContaining({ width: expect.any(Number) })
    );
    await act(async () => buttons[1]!.click());
    expect(onDamage).toHaveBeenCalledOnce();
    await act(async () => buttons[2]!.click());
    expect(handlers.onDone).toHaveBeenCalledOnce();
    expect(buttons[2]!.getAttribute('aria-label')).toBe('Deselect all');
  });

  it('is narrower with one worded button, and offers Play as one card for pieces', async () => {
    const plain = await renderGroup();
    expect(px(plain.bar.style.width)).toBe(190);
    expect(plain.bar.querySelectorAll('button')).toHaveLength(2);
    const onPlayAsOne = vi.fn();
    const pieces = await renderGroup({ onPlayAsOne });
    const play = pieces.bar.querySelector<HTMLButtonElement>(
      '#touchGroupPlayAsOneButton'
    )!;
    expect(play.getAttribute('aria-label')).toBe('Play as one card');
    await act(async () => play.click());
    expect(onPlayAsOne).toHaveBeenCalledOnce();
  });
});
