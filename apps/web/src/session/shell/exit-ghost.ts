import { useLayoutEffect, type RefObject } from 'react';

import { stripGhost } from '../../board/overlays/overlayMotion.js';

/** A ghost outlives its animation by at most this long. */
const GHOST_LIFETIME_MS = 600;

/**
 * When the element holding `ref` leaves the page, an inert copy of its last
 * frame (class `is-leaving`) plays the exit its stylesheet gives it and
 * removes itself, the way the board overlays leave (overlayMotion.ts). The
 * element itself goes at once: focus, tests and the next press never wait
 * for an animation.
 */
export const useExitGhost = (ref: RefObject<HTMLElement | null>): void => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return () => {
      const parent = element.parentElement;
      if (!parent) return;
      const nextSibling = element.nextSibling;
      const ghost = element.cloneNode(true) as HTMLElement;
      // StrictMode's replay keeps the element: only a real removal leaves.
      queueMicrotask(() => {
        if (element.isConnected || !parent.isConnected) return;
        stripGhost(ghost);
        ghost.classList.add('is-leaving');
        parent.insertBefore(
          ghost,
          nextSibling?.parentNode === parent ? nextSibling : null
        );
        const remove = (): void => ghost.remove();
        ghost.addEventListener('animationend', remove, { once: true });
        ghost.ownerDocument.defaultView?.setTimeout(remove, GHOST_LIFETIME_MS);
      });
    };
  }, [ref]);
};
