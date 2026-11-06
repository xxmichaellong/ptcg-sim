import { useLayoutEffect, type RefObject } from 'react';

import {
  listenForGhostExit,
  noExitPlays,
  stripGhost,
} from '../../board/overlays/overlayMotion.js';

/** A ghost outlives the start of its exit by at most this long. */
const GHOST_LIFETIME_MS = 600;
/** However late its exit starts, a ghost is gone by then. */
const GHOST_MAX_LIFETIME_MS = 1500;

/**
 * Where an element is drawn, as its own style says: what a ghost keeps in
 * its inline style, since its attributes (`data-area`, `data-placement`,
 * which may place it) are stripped.
 */
const FROZEN_PROPERTIES = [
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'align-items',
  'justify-items',
  'align-content',
  'justify-content',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
] as const;

/**
 * Copies `element`'s placement onto `ghost` (computed while `element` is
 * still on the page), so the copy leaves from exactly where it was.
 */
export const freezeGhostPlacement = (
  element: HTMLElement,
  ghost: HTMLElement
): void => {
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  const style = view.getComputedStyle(element);
  for (const property of FROZEN_PROPERTIES) {
    const value = style.getPropertyValue(property);
    if (value) ghost.style.setProperty(property, value);
  }
};

/**
 * When the element holding `ref` leaves the page, an inert copy of its last
 * frame (class `is-leaving`, and `leavingClass` if given) plays the exit its
 * stylesheet gives it and removes itself once that exit -- on the copy or a
 * child of it, never a deeper part's own animation -- has ended, the way the
 * board overlays leave (overlayMotion.ts). The element itself goes at once:
 * focus, tests and the next press never wait for an animation.
 */
export const useExitGhost = (
  ref: RefObject<HTMLElement | null>,
  leavingClass?: string
): void => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return () => {
      const parent = element.parentElement;
      if (!parent) return;
      const nextSibling = element.nextSibling;
      const ghost = element.cloneNode(true) as HTMLElement;
      // Measured now, while the element is still drawn.
      if (element.isConnected) freezeGhostPlacement(element, ghost);
      // StrictMode's replay keeps the element: only a real removal leaves.
      queueMicrotask(() => {
        if (element.isConnected || !parent.isConnected) return;
        stripGhost(ghost);
        ghost.classList.add('is-leaving');
        if (leavingClass) ghost.classList.add(leavingClass);
        parent.insertBefore(
          ghost,
          nextSibling?.parentNode === parent ? nextSibling : null
        );
        const view = ghost.ownerDocument.defaultView;
        let lifetime: number | undefined;
        let maximumLifetime: number | undefined;
        const remove = (): void => {
          view?.clearTimeout(lifetime);
          view?.clearTimeout(maximumLifetime);
          lifetime = undefined;
          maximumLifetime = undefined;
          ghost.remove();
        };
        // Nothing to play -- no exit styled, or nothing drawn where it
        // landed: gone at once.
        if (noExitPlays(ghost, [ghost, ...ghost.children])) {
          remove();
          return;
        }
        listenForGhostExit(ghost, [ghost, ...ghost.children], remove);
        // Timed from when its exit starts, not when it was made: a busy
        // page's first frame can come late, and the copy would go before it
        // ever played. Gone in any case before long.
        const onStart = (event: AnimationEvent): void => {
          if (
            event.target === ghost ||
            (event.target instanceof Element &&
              event.target.parentElement === ghost)
          ) {
            ghost.removeEventListener('animationstart', onStart);
            lifetime = view?.setTimeout(remove, GHOST_LIFETIME_MS);
          }
        };
        ghost.addEventListener('animationstart', onStart);
        maximumLifetime = view?.setTimeout(remove, GHOST_MAX_LIFETIME_MS);
      });
    };
  }, [ref, leavingClass]);
};
