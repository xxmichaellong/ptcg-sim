// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverTilt, localPointer } from './HoverTilt.js';

const card = (): {
  readonly button: HTMLElement;
  readonly body: HTMLElement;
} => {
  const button = document.createElement('button');
  const body = document.createElement('span');
  body.className = 'ptcgsim-card__body';
  button.append(body);
  document.body.append(button);
  return { button, body };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('HoverTilt', () => {
  it('measures the pointer in the card’s own frame', () => {
    const rect = { left: 0, top: 0, width: 100, height: 140 };
    expect(localPointer(rect, 100, 70, 0)).toEqual({ x: 0.5, y: 0 });
    // An opponent's card is turned half way round: it leans the other way.
    expect(localPointer(rect, 100, 70, 2)).toEqual({ x: -0.5, y: -0 });
  });

  it('relaxes every card the pointer sweeps across, not just the last', () => {
    const tilt = new HoverTilt();
    const first = card();
    const second = card();
    const third = card();
    tilt.track(first.button, 10, 10, 0);
    tilt.track(second.button, 10, 10, 0);
    tilt.track(third.button, 10, 10, 0);
    expect(first.body.dataset.tilt).toBe('');
    vi.advanceTimersByTime(300);
    expect(first.body.dataset.tilt).toBeUndefined();
    expect(first.body.style.getPropertyValue('--ptcgsim-tilt-x')).toBe('');
    expect(second.body.dataset.tilt).toBeUndefined();
    // The card under the pointer keeps leaning.
    expect(third.body.dataset.tilt).toBe('');
  });

  it('leans again when the pointer comes back before the card has relaxed', () => {
    const tilt = new HoverTilt();
    const first = card();
    const second = card();
    tilt.track(first.button, 10, 10, 0);
    tilt.track(second.button, 10, 10, 0);
    tilt.track(first.button, 10, 10, 0);
    vi.advanceTimersByTime(300);
    expect(first.body.dataset.tilt).toBe('');
    expect(second.body.dataset.tilt).toBeUndefined();
  });

  it('flattens everything at once when it is switched off', () => {
    const tilt = new HoverTilt();
    const first = card();
    const second = card();
    tilt.track(first.button, 10, 10, 0);
    tilt.track(second.button, 10, 10, 0);
    tilt.setEnabled(false);
    expect(first.body.dataset.tilt).toBeUndefined();
    expect(second.body.dataset.tilt).toBeUndefined();
    tilt.track(first.button, 10, 10, 0);
    expect(first.body.dataset.tilt).toBeUndefined();
  });
});
