// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOARD_HINT_DELAY_MS,
  BoardHintTimer,
  boardHintAt,
  placeBoardHint,
  type BoardHintShowing,
} from './board-hints.js';

const viewport = { width: 800, height: 600 };
const size = { width: 120, height: 24 };

describe('placeBoardHint', () => {
  it('sits centred above its anchor', () => {
    expect(
      placeBoardHint(
        { left: 300, top: 200, right: 340, bottom: 220 },
        size,
        viewport
      )
    ).toEqual({ left: 260, top: 200 - 8 - 24, side: 'top' });
  });

  it('goes below near the top edge and stays inside the sides', () => {
    expect(
      placeBoardHint(
        { left: 0, top: 10, right: 20, bottom: 30 },
        size,
        viewport
      )
    ).toEqual({ left: 8, top: 38, side: 'bottom' });
    expect(
      placeBoardHint(
        { left: 780, top: 300, right: 800, bottom: 320 },
        size,
        viewport
      ).left
    ).toBe(800 - 8 - 120);
  });
});

describe('BoardHintTimer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const timer = () => {
    let now = 0;
    const shown: (BoardHintShowing | null)[] = [];
    const hints = new BoardHintTimer(
      (showing) => shown.push(showing),
      () => now
    );
    return {
      hints,
      shown,
      advance: (ms: number) => {
        now += ms;
        vi.advanceTimersByTime(ms);
      },
    };
  };

  it('shows after a rest, at once while warm, and hides as the pointer leaves', () => {
    vi.useFakeTimers();
    const { hints, shown, advance } = timer();
    const deck = document.createElement('span');
    const discard = document.createElement('span');
    hints.hover(deck);
    expect(shown).toEqual([]);
    advance(BOARD_HINT_DELAY_MS);
    expect(shown).toEqual([{ element: deck, tapped: false }]);
    hints.hover(discard);
    expect(shown.at(-1)).toEqual({ element: discard, tapped: false });
    hints.hover(null);
    expect(shown.at(-1)).toBeNull();
    // Just after one went, the next shows without waiting.
    advance(100);
    hints.hover(deck);
    expect(shown.at(-1)).toEqual({ element: deck, tapped: false });
  });

  it('never shows for a pointer that only passed over', () => {
    vi.useFakeTimers();
    const { hints, shown, advance } = timer();
    hints.hover(document.createElement('span'));
    advance(BOARD_HINT_DELAY_MS / 2);
    hints.hover(null);
    advance(BOARD_HINT_DELAY_MS);
    expect(shown).toEqual([]);
  });

  it('toggles on a tap and hides on any other press', () => {
    vi.useFakeTimers();
    const { hints, shown } = timer();
    const deck = document.createElement('span');
    hints.tap(deck);
    expect(shown.at(-1)).toEqual({ element: deck, tapped: true });
    hints.tap(deck);
    expect(shown.at(-1)).toBeNull();
    hints.tap(deck);
    hints.hide();
    expect(shown.at(-1)).toBeNull();
  });
});

describe('boardHintAt', () => {
  const at = (
    element: HTMLElement,
    rect: { left: number; top: number; width: number; height: number }
  ) => {
    element.getBoundingClientRect = () =>
      ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => rect,
      }) as DOMRect;
    return element;
  };

  it('prefers a marker over a badge it lies on, and names it', () => {
    const root = document.createElement('div');
    const badge = at(document.createElement('div'), {
      left: 0,
      top: 0,
      width: 40,
      height: 40,
    });
    badge.dataset.boardHint = '47 cards in your deck';
    const marker = at(document.createElement('span'), {
      left: 10,
      top: 10,
      width: 20,
      height: 20,
    });
    marker.dataset.boardHint = '60 damage';
    marker.dataset.markerHintId = 'card:damage';
    root.append(marker, badge);
    expect(boardHintAt(root, 15, 15)).toEqual({
      element: marker,
      markerId: 'card:damage',
    });
    expect(boardHintAt(root, 35, 35)).toEqual({
      element: badge,
      markerId: null,
    });
    expect(boardHintAt(root, 60, 60)).toBeNull();
  });
});
