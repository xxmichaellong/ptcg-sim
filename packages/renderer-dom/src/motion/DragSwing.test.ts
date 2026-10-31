// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DragSwing } from './DragSwing.js';

afterEach(() => vi.unstubAllGlobals());

const frames = () => {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  let time = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  return {
    pending,
    step: (count: number) => {
      for (let index = 0; index < count; index++) {
        time += 1000 / 60;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(time);
      }
    },
  };
};

describe('DragSwing', () => {
  it('leans around the grip, settles without an idle loop, and releases every visual override', () => {
    const clock = frames();
    const swing = new DragSwing();
    const body = document.createElement('span');
    swing.attach(body, { x: 0.2, y: 0.8 });
    expect(body.style.transformOrigin).toBe('20% 80%');
    swing.lean(1500, 100, -900, 140);
    clock.step(8);
    expect(Number.parseFloat(body.style.rotate)).toBeGreaterThan(0);
    expect(
      Number.parseFloat(body.style.getPropertyValue('--ptcgsim-drag-pitch'))
    ).toBeGreaterThan(0);
    clock.step(180);
    expect(clock.pending.size).toBe(0);
    expect(body.style.getPropertyValue('--ptcgsim-drag-light')).toBe('0');
    // The grip stays attached while held; letting go releases it as well.
    expect(body.dataset.swing).toBe('');
    swing.release();
    clock.step(1);
    expect(body.dataset.swing).toBeUndefined();
    expect(body.style.transformOrigin).toBe('');
  });

  it('cancels immediately when motion is disabled or the renderer is removed', () => {
    const clock = frames();
    const swing = new DragSwing();
    const body = document.createElement('span');
    swing.attach(body);
    swing.lean(1500, 100);
    clock.step(3);
    swing.setEnabled(false);
    expect(clock.pending.size).toBe(0);
    expect(body.style.rotate).toBe('');
    expect(body.dataset.swing).toBeUndefined();
    swing.lean(1500, 100);
    expect(clock.pending.size).toBe(0);
    swing.setEnabled(true);
    swing.attach(body);
    swing.lean(1500, 100);
    swing.stop();
    expect(clock.pending.size).toBe(0);
    expect(body.style.transformOrigin).toBe('');
  });
});
