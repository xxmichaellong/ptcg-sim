// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CURTAIN_COMPLETE_MS,
  CURTAIN_COVER_MS,
  CURTAIN_MAX_COVER_MS,
  CURTAIN_REVEAL_MS,
  TABLE_CURTAIN_ID,
  createTableCurtain,
  markTableLoad,
  tableCurtain,
} from './table-curtain.js';

/** As index.html paints it: the bar and its line at the foot. */
const pageCurtain = (state: 'covering' | 'gone' = 'covering') => {
  const element = document.createElement('div');
  element.id = TABLE_CURTAIN_ID;
  element.dataset.state = state;
  if (state === 'covering') element.dataset.mode = 'boot';
  element.hidden = state === 'gone';
  element.innerHTML = `
    <div class="table-curtain__footer">
      <div role="progressbar" aria-valuenow="40"></div>
      <span class="table-curtain__label">Setting up the table…</span>
    </div>`;
  document.body.append(element);
  return element;
};

const shown = (element: HTMLElement) => ({
  state: element.dataset.state,
  hidden: element.hidden,
  fade: element.style.getPropertyValue('--table-curtain-fade'),
});

/** What its bar says: how far, and whether the load is done. */
const bar = (element: HTMLElement) => ({
  mode: element.dataset.mode,
  valueNow:
    element
      .querySelector('[role="progressbar"]')
      ?.getAttribute('aria-valuenow') ?? null,
  progress: element.style.getPropertyValue('--table-curtain-progress'),
  complete: element.hasAttribute('data-complete'),
  delay: element.style.getPropertyValue('--table-curtain-delay'),
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

  it('stays over the loading page, then fills its bar and fades away once when the table is ready', () => {
    const element = pageCurtain();
    const curtain = createTableCurtain(element);
    expect(curtain.state()).toBe('covering');
    expect(bar(element)).toMatchObject({ mode: 'boot', complete: false });

    curtain.reveal();
    expect(shown(element)).toEqual({
      state: 'leaving',
      hidden: false,
      fade: `${CURTAIN_REVEAL_MS}ms`,
    });
    // The bar is seen to fill before the fade begins.
    expect(bar(element)).toEqual({
      mode: 'boot',
      valueNow: '100',
      progress: '1',
      complete: true,
      delay: `${CURTAIN_COMPLETE_MS}ms`,
    });
    // A second report (another board settling) changes nothing.
    curtain.reveal();
    vi.advanceTimersByTime(CURTAIN_COMPLETE_MS + CURTAIN_REVEAL_MS - 1);
    expect(curtain.state()).toBe('leaving');
    vi.advanceTimersByTime(1);
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });
    curtain.reveal();
    expect(curtain.state()).toBe('gone');
  });

  it('covers a later trade of tables as travel: no load to measure, the bar only sweeping', () => {
    const element = pageCurtain();
    const curtain = createTableCurtain(element);
    curtain.reveal();
    vi.advanceTimersByTime(CURTAIN_COMPLETE_MS + CURTAIN_REVEAL_MS);
    // The page's load is over: what covers next is a trade of tables.
    expect(bar(element)).toEqual({
      mode: 'travel',
      valueNow: null,
      progress: '',
      complete: false,
      delay: '0ms',
    });

    curtain.handOff(() => undefined);
    vi.advanceTimersByTime(CURTAIN_COVER_MS);
    expect(bar(element)).toMatchObject({ mode: 'travel', valueNow: null });
    // Lifted from the new table at once: no bar to fill first.
    curtain.reveal();
    expect(bar(element)).toMatchObject({ complete: false, delay: '0ms' });
    vi.advanceTimersByTime(CURTAIN_REVEAL_MS);
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });

    // A page that opens on no curtain only ever trades tables under it.
    expect(bar(pageCurtain('gone'))).toMatchObject({ valueNow: '40' });
    const opensOnNone = pageCurtain('gone');
    createTableCurtain(opensOnNone);
    expect(bar(opensOnNone)).toMatchObject({ mode: 'travel', valueNow: null });
  });

  it('fills the bar and goes at once without motion', () => {
    document.documentElement.dataset.motion = 'reduced';
    const element = pageCurtain();
    createTableCurtain(element).reveal();
    expect(shown(element)).toMatchObject({ state: 'gone', hidden: true });
  });

  it('marks each step of the page load once, for the bar to pace by', () => {
    // The page's own clock: fake timers stand in for `performance` too.
    vi.useRealTimers();
    performance.clearMarks();
    markTableLoad('app');
    markTableLoad('app');
    markTableLoad('room');
    expect(
      performance.getEntriesByName('ptcgsim:load:app', 'mark')
    ).toHaveLength(1);
    expect(
      performance.getEntriesByName('ptcgsim:load:room', 'mark')
    ).toHaveLength(1);
    expect(
      performance.getEntriesByName('ptcgsim:load:lobby', 'mark')
    ).toHaveLength(0);
    performance.clearMarks();
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
    vi.advanceTimersByTime(CURTAIN_COMPLETE_MS + CURTAIN_REVEAL_MS);
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
