import { useLayoutEffect, useRef, type RefObject } from 'react';
import { readOverlayMotion } from '../../board/overlays/overlayMotion.js';

type SwitchMode = 'solo' | 'online';

/**
 * The switch last shown and when: going Solo to Online (or back) usually
 * changes the page, which mounts a new bar, and that bar slides from it.
 */
let lastShown:
  { readonly current: SwitchMode; readonly at: number } | undefined;
/** How soon a new bar must follow the last for it to slide from it. */
const CARRY_MS = 1500;
const SLIDE_MS = 240;
const FADE_MS = 120;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const now = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

/**
 * Slides the switch's two sides past each other into where they now are:
 * the side in play first, the other after it (2026-11-06, the owner:
 * "whichever is active should be on the left side, and it should animate
 * to it"). A FLIP on `translate`, so layout never sees the frames between;
 * under reduced motion they fade in place instead.
 */
const slideSwapped = (group: HTMLElement): void => {
  const options = group.querySelectorAll<HTMLElement>(
    '.ptcgsim-app-bar__switch-option'
  );
  const first = options[0];
  const second = options[1];
  if (options.length !== 2 || !first || !second) return;
  if (typeof first.animate !== 'function') return;
  const motion = readOverlayMotion(group);
  if (motion.scale <= 0) return;
  if (motion.reduced) {
    for (const option of [first, second]) {
      option.animate([{ opacity: 0.4 }, { opacity: 1 }], {
        duration: FADE_MS,
        easing: 'linear',
      });
    }
    return;
  }
  const a = first.getBoundingClientRect();
  const b = second.getBoundingClientRect();
  if (a.width <= 0 || b.width <= 0) return;
  // The first side starts where the other side's start now is plus its
  // width (the order it had), whichever way the bar runs.
  const forward = a.left <= b.left;
  const gap = forward ? b.left - a.right : a.left - b.right;
  const scale =
    group.offsetWidth > 0
      ? group.getBoundingClientRect().width / group.offsetWidth
      : 1;
  const sign = forward ? 1 : -1;
  const from = [
    (sign * (b.width + gap)) / scale,
    (-sign * (a.width + gap)) / scale,
  ];
  [first, second].forEach((option, index) => {
    option.animate(
      [{ translate: `${String(from[index])}px 0px` }, { translate: '0px 0px' }],
      { duration: SLIDE_MS * motion.scale, easing: EASE }
    );
  });
};

/** Slides the Solo | Online switch when the side in play changes. */
export const useModeSwitchSlide = (
  group: RefObject<HTMLElement | null>,
  current: SwitchMode
): void => {
  const previous = useRef<SwitchMode | undefined>(undefined);
  useLayoutEffect(() => {
    const element = group.current;
    const at = now();
    const before =
      previous.current ??
      (lastShown && at - lastShown.at < CARRY_MS
        ? lastShown.current
        : undefined);
    previous.current = current;
    lastShown = { current, at: Number.NEGATIVE_INFINITY };
    if (element && before !== undefined && before !== current) {
      slideSwapped(element);
    }
  }, [group, current]);
  // A bar going away leaves its side for the next one, from now.
  useLayoutEffect(
    () => () => {
      if (previous.current !== undefined) {
        lastShown = { current: previous.current, at: now() };
      }
    },
    []
  );
};

/** Tests only: forgets the last switch shown. */
export const resetModeSwitchSlide = (): void => {
  lastShown = undefined;
};
