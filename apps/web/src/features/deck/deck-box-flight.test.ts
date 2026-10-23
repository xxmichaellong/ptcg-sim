// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as motion from '../../motion/motion-settings.js';
import { flyDeckBox } from './deck-box-flight.js';

const animate = HTMLElement.prototype.animate;

afterEach(() => {
  HTMLElement.prototype.animate = animate;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('a deck box flying to its tray', () => {
  it('keeps the tray hidden for the last box sent to it, though an earlier one lands first', () => {
    vi.useFakeTimers();
    vi.spyOn(motion, 'motionSettings').mockReturnValue({
      getSnapshot: () => ({ reduced: false, durationScale: 1 }),
    } as unknown as ReturnType<typeof motion.motionSettings>);
    const box = () => {
      const element = document.createElement('span');
      element.getBoundingClientRect = () =>
        ({ left: 10, top: 10, width: 50, height: 70 }) as DOMRect;
      document.body.append(element);
      return element;
    };
    const flights: EventTarget[] = [];
    HTMLElement.prototype.animate = function () {
      const flight = new EventTarget();
      flights.push(flight);
      return flight as Animation;
    };
    const tray = box();
    flyDeckBox(box(), tray);
    vi.advanceTimersByTime(300);
    // Another deck put on the same seat while the first is in the air.
    flyDeckBox(box(), tray);
    flights[0]!.dispatchEvent(new Event('finish'));
    expect(tray.style.visibility).toBe('hidden');
    flights[1]!.dispatchEvent(new Event('finish'));
    expect(tray.style.visibility).toBe('');
    expect(document.querySelectorAll('[data-lifted]')).toHaveLength(0);
  });

  it('flies inside the deck screen, so it goes when the screen does', () => {
    vi.spyOn(motion, 'motionSettings').mockReturnValue({
      getSnapshot: () => ({ reduced: false, durationScale: 1 }),
    } as unknown as ReturnType<typeof motion.motionSettings>);
    HTMLElement.prototype.animate = () => new EventTarget() as Animation;
    const layer = document.createElement('div');
    layer.className = 'ptcgsim-deck-layer';
    document.body.append(layer);
    const box = (parent: HTMLElement) => {
      const element = document.createElement('span');
      element.getBoundingClientRect = () =>
        ({ left: 10, top: 10, width: 50, height: 70 }) as DOMRect;
      parent.append(element);
      return element;
    };
    flyDeckBox(box(layer), box(layer));
    expect(layer.querySelectorAll('[data-lifted]')).toHaveLength(1);
  });
});
