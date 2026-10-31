// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CURTAIN_COVER_MS,
  CURTAIN_MAX_COVER_MS,
  CURTAIN_REVEAL_MS,
  TABLE_CURTAIN_ID,
  createTableCurtain,
  tableCurtain,
} from './table-curtain.js';

const pageCurtain = (state: 'covering' | 'gone' = 'covering') => {
  const element = document.createElement('div');
  element.id = TABLE_CURTAIN_ID;
  element.dataset.state = state;
  element.hidden = state === 'gone';
  document.body.append(element);
  return element;
};

const shown = (element: HTMLElement) => ({
  state: element.dataset.state,
  hidden: element.hidden,
  fade: element.style.getPropertyValue('--table-curtain-fade'),
});

describe('the loading screen over the table', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute('data-motion');
    document.documentElement.style.removeProperty('--motion-scale');
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('stays over the loading page, then fades away once when the table is ready', () => {
    const element = pageCurtain();
    const curtain = createTableCurtain(element);
    expect(curtain.state()).toBe('covering');

    curtain.reveal();
    expect(shown(element)).toEqual({
      state: 'leaving',
      hidden: false,
      fade: `${CURTAIN_REVEAL_MS}ms`,
    });
    // A second report (another board settling) changes nothing.
    curtain.reveal();
    vi.advanceTimersByTime(CURTAIN_REVEAL_MS);
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });
    curtain.reveal();
    expect(curtain.state()).toBe('gone');
  });

  it('scales its fade with the animation speed and goes at once without motion', () => {
    const element = pageCurtain();
    document.documentElement.style.setProperty('--motion-scale', '0.5');
    const slow = createTableCurtain(element);
    slow.reveal();
    expect(shown(element).fade).toBe(`${CURTAIN_REVEAL_MS / 2}ms`);

    const reduced = pageCurtain();
    document.documentElement.dataset.motion = 'reduced';
    createTableCurtain(reduced).reveal();
    expect(shown(reduced)).toMatchObject({ state: 'gone', hidden: true });

    const instant = pageCurtain();
    document.documentElement.dataset.motion = 'full';
    document.documentElement.style.setProperty('--motion-scale', '0');
    createTableCurtain(instant).reveal();
    expect(shown(instant)).toMatchObject({ state: 'gone', hidden: true });
  });

  it('covers the old table before a swap and keeps covering until the new one is ready', () => {
    const element = pageCurtain('gone');
    const curtain = createTableCurtain(element);
    const swap = vi.fn();

    curtain.handOff(swap);
    expect(shown(element)).toEqual({
      state: 'arriving',
      hidden: false,
      fade: `${CURTAIN_COVER_MS}ms`,
    });
    expect(swap).not.toHaveBeenCalled();
    // The old table settling again cannot lift it before the swap.
    curtain.reveal();
    expect(curtain.state()).toBe('arriving');

    vi.advanceTimersByTime(CURTAIN_COVER_MS);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(curtain.state()).toBe('covering');

    curtain.reveal();
    vi.advanceTimersByTime(CURTAIN_REVEAL_MS);
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });
  });

  it('swaps at once under a curtain that is already down, and without motion', () => {
    const covering = createTableCurtain(pageCurtain());
    const underCurtain = vi.fn();
    covering.handOff(underCurtain);
    expect(underCurtain).toHaveBeenCalledTimes(1);
    expect(covering.state()).toBe('covering');

    document.documentElement.dataset.motion = 'reduced';
    const element = pageCurtain('gone');
    const still = createTableCurtain(element);
    const atOnce = vi.fn();
    still.handOff(atOnce);
    expect(atOnce).toHaveBeenCalledTimes(1);
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });
  });

  it('turns back over a table it was still lifting from', () => {
    const element = pageCurtain();
    const curtain = createTableCurtain(element);
    curtain.reveal();
    vi.advanceTimersByTime(CURTAIN_REVEAL_MS / 2);
    const swap = vi.fn();
    curtain.handOff(swap);
    expect(curtain.state()).toBe('arriving');
    // Its fade out was called off: it does not vanish under the swap.
    vi.advanceTimersByTime(CURTAIN_REVEAL_MS);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(shown(element)).toMatchObject({ state: 'covering', hidden: false });
  });

  it('runs every swap asked for while it is still arriving, in order', () => {
    const curtain = createTableCurtain(pageCurtain('gone'));
    const order: string[] = [];
    curtain.handOff(() => order.push('first'));
    curtain.handOff(() => order.push('second'));
    expect(order).toEqual([]);
    vi.advanceTimersByTime(CURTAIN_COVER_MS);
    expect(order).toEqual(['first', 'second']);
  });

  it('never keeps the page behind it for longer than its ceiling', () => {
    const element = pageCurtain();
    createTableCurtain(element);
    vi.advanceTimersByTime(CURTAIN_MAX_COVER_MS - 1);
    expect(element.dataset.state).toBe('covering');
    vi.advanceTimersByTime(1);
    expect(element.dataset.state).toBe('leaving');
    vi.advanceTimersByTime(CURTAIN_REVEAL_MS);
    expect(element.hidden).toBe(true);
  });

  it('drops at once for pages that are not the table, running any swap it held', () => {
    const element = pageCurtain('gone');
    const curtain = createTableCurtain(element);
    const swap = vi.fn();
    curtain.handOff(swap);
    curtain.drop();
    expect(swap).toHaveBeenCalledTimes(1);
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });
    vi.advanceTimersByTime(CURTAIN_MAX_COVER_MS);
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it('is the page curtain when there is one, and does nothing when there is none', () => {
    const none = tableCurtain(document);
    const swap = vi.fn();
    none.handOff(swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(() => none.reveal()).not.toThrow();

    pageCurtain();
    expect(tableCurtain(document)).toBe(tableCurtain(document));
    expect(tableCurtain(document).state()).toBe('covering');
  });
});
