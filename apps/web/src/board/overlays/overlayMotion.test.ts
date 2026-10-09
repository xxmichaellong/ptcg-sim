// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTiltHandlers,
  readOverlayMotion,
  sceneRectToClient,
  zoomFromRect,
} from './overlayMotion.js';

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }) as DOMRect;

const sized = (bounds: DOMRect, offsetWidth = bounds.width): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
  Object.defineProperty(element, 'offsetWidth', { value: offsetWidth });
  return element;
};

describe('overlay motion', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.motion;
    document.documentElement.style.removeProperty('--motion-scale');
    vi.restoreAllMocks();
  });

  it('reads the page root motion choice', () => {
    const element = sized(rect(0, 0, 10, 10));
    expect(readOverlayMotion(element)).toEqual({ reduced: false, scale: 1 });
    document.documentElement.dataset.motion = 'reduced';
    document.documentElement.style.setProperty('--motion-scale', '0');
    expect(readOverlayMotion(element)).toEqual({ reduced: true, scale: 0 });
    document.documentElement.dataset.motion = 'full';
    document.documentElement.style.setProperty('--motion-scale', '1.35');
    expect(readOverlayMotion(element)).toEqual({
      reduced: false,
      scale: 1.35,
    });
  });

  it('zooms an element out of its source on the compositor', () => {
    const element = sized(rect(400, 100, 500, 700));
    const animation = { cancel: vi.fn() } as unknown as Animation;
    const animate = vi.fn(() => animation);
    element.animate = animate;

    expect(zoomFromRect(element, rect(50, 600, 100, 140))).toBe(animation);
    expect(element.style.animation).toBe('none');
    const [keyframes, options] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    // From the source's centre (100, 670) to the element's (650, 450), at
    // the source's size.
    expect(keyframes[0]).toMatchObject({
      translate: '-550px 220px',
      scale: String(140 / 700),
    });
    expect(keyframes[1]).toMatchObject({ translate: '0px 0px', scale: '1' });
    expect(options.fill).toBe('backwards');
    expect(options.duration).toBeGreaterThan(0);
  });

  it('leaves the CSS entrance alone when it cannot or should not zoom', () => {
    const element = sized(rect(400, 100, 500, 700));
    const animate = vi.fn();
    element.animate = animate;
    expect(zoomFromRect(element, null)).toBeNull();
    expect(zoomFromRect(element, rect(0, 0, 0, 0))).toBeNull();
    document.documentElement.dataset.motion = 'reduced';
    expect(zoomFromRect(element, rect(50, 600, 100, 140))).toBeNull();
    delete document.documentElement.dataset.motion;
    document.documentElement.style.setProperty('--motion-scale', '0');
    expect(zoomFromRect(element, rect(50, 600, 100, 140))).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    expect(element.style.animation).toBe('');
  });

  it('maps scene rectangles through a scaled board to client space', () => {
    const root = sized(rect(100, 50, 640, 360), 1280);
    expect(
      sceneRectToClient(
        root,
        { width: 1280, height: 720 },
        { x: 640, y: 360, width: 128, height: 72 }
      )
    ).toEqual({ left: 420, top: 230, width: 64, height: 36 });
    expect(
      sceneRectToClient(
        sized(rect(0, 0, 0, 0)),
        { width: 1280, height: 720 },
        { x: 0, y: 0, width: 1, height: 1 }
      )
    ).toBeNull();
  });

  it('tilts toward the pointer, at most 8 degrees, and settles when it leaves', async () => {
    const stage = sized(rect(0, 0, 200, 280));
    const target = { current: document.createElement('span') };
    const handlers = createTiltHandlers(target);
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        })
      );

    handlers.onPointerMove({
      currentTarget: stage,
      clientX: 0,
      clientY: 0,
    } as never);
    await frame();
    const style = target.current.style;
    expect(style.getPropertyValue('--ptcgsim-tilt-x')).toBe('8.00deg');
    expect(style.getPropertyValue('--ptcgsim-tilt-y')).toBe('-8.00deg');
    expect(style.getPropertyValue('--ptcgsim-glare-x')).toBe('0.0%');
    expect(style.getPropertyValue('--ptcgsim-glare-opacity')).toBe('1');

    handlers.onPointerMove({
      currentTarget: stage,
      clientX: 150,
      clientY: 140,
    } as never);
    await frame();
    expect(style.getPropertyValue('--ptcgsim-tilt-x')).toBe('0.00deg');
    expect(style.getPropertyValue('--ptcgsim-tilt-y')).toBe('4.00deg');

    handlers.onPointerLeave();
    await frame();
    expect(style.getPropertyValue('--ptcgsim-tilt-x')).toBe('0deg');
    expect(style.getPropertyValue('--ptcgsim-tilt-y')).toBe('0deg');
    expect(style.getPropertyValue('--ptcgsim-glare-opacity')).toBe('0');
  });
});
