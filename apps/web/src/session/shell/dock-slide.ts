import {
  SPRING_PRESETS,
  springSettleTime,
  springStateAt,
} from '@ptcgsim/renderer-contract';
import { useLayoutEffect, type RefObject } from 'react';

import { stripGhost } from '../../board/overlays/overlayMotion.js';
import { motionSettings } from '../../motion/motion-settings.js';

/**
 * How far the docked activity log has slid in beside the table (ADR-030):
 * 0 is put away, 1 is in its column. The log and the table read the same
 * value every frame, so the table makes room exactly as the log comes in
 * and takes the room back as it goes. A critically damped spring drives it,
 * so a press mid-slide turns it round from where it is, at its speed.
 */
export interface DockSlide {
  readonly value: () => number;
  /** Where it is heading: 1 while the log is open, 0 once it is put away. */
  readonly target: () => 0 | 1;
  /**
   * Calls `listener` on every frame the value changes, and once when it is
   * put somewhere at once. `inFrame` is true only inside an animation
   * frame, where a listener may paint synchronously; a jump can come from a
   * React effect, where it must not.
   */
  readonly subscribe: (listener: (inFrame: boolean) => void) => () => void;
  /** Slides there; `jump` (or reduced motion) puts it there at once. */
  readonly to: (target: 0 | 1, options?: { readonly jump?: boolean }) => void;
  /** Stops a slide where it would end. */
  readonly stop: () => void;
}

const SPRING = SPRING_PRESETS.settle;
/** Within this of the end, in panel widths, the slide is over. */
const PRECISION = 0.002;

export const createDockSlide = (
  initial: 0 | 1,
  speed: () => number = () => {
    const motion = motionSettings().getSnapshot();
    return motion.reduced ? 0 : motion.durationScale;
  }
): DockSlide => {
  const listeners = new Set<(inFrame: boolean) => void>();
  let target: 0 | 1 = initial;
  let value: number = initial;
  // The current leg: where it started, how fast, when, and how long it runs.
  let leg:
    | {
        readonly from: number;
        readonly velocity: number;
        readonly startedAt: number;
        readonly seconds: number;
        readonly scale: number;
      }
    | undefined;
  let frame: number | undefined;

  const notify = (inFrame: boolean): void => {
    for (const listener of [...listeners]) listener(inFrame);
  };
  const stateAt = (now: number) => {
    if (!leg) return { value, velocity: 0, done: true };
    const elapsed = (now - leg.startedAt) / 1000 / leg.scale;
    if (elapsed >= leg.seconds)
      return { value: target, velocity: 0, done: true };
    const state = springStateAt(
      SPRING,
      leg.from - target,
      leg.velocity,
      elapsed
    );
    return {
      value: Math.min(1, Math.max(0, target + state.displacement)),
      velocity: state.velocity,
      done: false,
    };
  };
  const tick = (now: number): void => {
    frame = undefined;
    const state = stateAt(now);
    value = state.value;
    if (state.done) leg = undefined;
    else frame = requestAnimationFrame(tick);
    notify(true);
  };
  const stop = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    leg = undefined;
    value = target;
  };

  return {
    value: () => value,
    target: () => target,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    to: (next, options) => {
      if (next === target && (leg || value === next)) return;
      const scale = options?.jump ? 0 : speed();
      const now = performance.now();
      // Turning round mid-slide carries on from where it is, at its speed.
      const current = stateAt(now);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      target = next;
      if (!(scale > 0)) {
        leg = undefined;
        value = next;
        notify(false);
        return;
      }
      const from = current.value;
      const velocity = current.done ? 0 : current.velocity;
      leg = {
        from,
        velocity,
        startedAt: now,
        seconds: springSettleTime(SPRING, from - next, velocity, PRECISION),
        scale,
      };
      value = from;
      frame = requestAnimationFrame(tick);
    },
    stop,
  };
};

const rightToLeft = (element: HTMLElement): boolean =>
  element.closest('[dir]')?.getAttribute('dir') === 'rtl';

/**
 * The log's offset from its column, as a share of its own width: out to
 * the right, or to the left where a right-to-left page docks it.
 */
const offset = (slide: DockSlide, element: HTMLElement): string =>
  `${String((1 - slide.value()) * (rightToLeft(element) ? -100 : 100))}% 0`;

/**
 * Moves the docked log with `slide`. When the log is put away it leaves at
 * once -- focus, tests and the next press never wait for it -- and an
 * inert copy of its last frame slides out in its place, the way the board
 * overlays leave (overlayMotion.ts).
 */
export const useDockSlide = (
  ref: RefObject<HTMLElement | null>,
  slide: DockSlide | undefined
): void => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !slide) return;
    const paint = (): void => {
      element.style.translate = offset(slide, element);
    };
    paint();
    const unsubscribe = slide.subscribe(paint);
    return () => {
      unsubscribe();
      const parent = element.parentElement;
      if (!parent) return;
      const nextSibling = element.nextSibling;
      const ghost = element.cloneNode(true) as HTMLElement;
      const scrolled = [element, ...element.querySelectorAll('*')].flatMap(
        (node, index) =>
          node.scrollTop !== 0 ? [{ index, top: node.scrollTop }] : []
      );
      // StrictMode's replay keeps the element: only a real removal leaves.
      // By now the commit that removed it has turned the slide round.
      queueMicrotask(() => {
        if (element.isConnected || !parent.isConnected) return;
        if (slide.target() !== 0 || slide.value() === 0) return;
        stripGhost(ghost);
        parent.insertBefore(
          ghost,
          nextSibling?.parentNode === parent ? nextSibling : null
        );
        const copies = [ghost, ...ghost.querySelectorAll('*')];
        for (const { index, top } of scrolled) {
          const copy = copies[index];
          if (copy) copy.scrollTop = top;
        }
        const move = (): void => {
          if (slide.target() !== 0 || slide.value() === 0) {
            stopMoving();
            ghost.remove();
            return;
          }
          ghost.style.translate = offset(slide, ghost);
        };
        const stopMoving = slide.subscribe(move);
        move();
      });
    };
  }, [ref, slide]);
};
