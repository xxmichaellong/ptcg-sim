import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDockSlide } from './dock-slide.js';

/** Frames run by hand: each step runs the frame callbacks queued so far. */
const frames = () => {
  let queue: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    step: (ms: number) => {
      now += ms;
      const due = queue;
      queue = [];
      for (const callback of due) callback(now);
    },
    pending: () => queue.length,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the docked log slide', () => {
  it('tells listeners a change is in an animation frame only when it is', () => {
    const clock = frames();
    const slide = createDockSlide(0, () => 1);
    const heard: boolean[] = [];
    slide.subscribe((inFrame) => heard.push(inFrame));

    slide.to(1);
    expect(heard).toEqual([]);
    clock.step(16);
    expect(heard).toEqual([true]);
    while (clock.pending() > 0) clock.step(16);
    expect(slide.value()).toBe(1);
    expect(heard.every((inFrame) => inFrame)).toBe(true);

    // A jump (instant motion) can come from a React effect: never a frame.
    heard.length = 0;
    slide.to(0, { jump: true });
    expect(heard).toEqual([false]);
    expect(slide.value()).toBe(0);
  });
});
