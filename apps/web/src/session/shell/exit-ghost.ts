import { useLayoutEffect, type RefObject } from 'react';

import { stripGhost } from '../../board/overlays/overlayMotion.js';

/** A ghost outlives its animation by at most this long. */
const GHOST_LIFETIME_MS = 600;

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
 * Whether an exit is still playing on the ghost or a child of it (a scrim
 * and its panel leave together but end apart).
 */
const stillLeaving = (ghost: HTMLElement): boolean =>
  typeof ghost.getAnimations === 'function' &&
  [ghost, ...ghost.children].some((node) =>
    node.getAnimations().some((animation) => animation.playState === 'running')
  );

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
        const remove = (): void => ghost.remove();
        ghost.addEventListener('animationend', (event) => {
          if (
            (event.target === ghost ||
              (event.target instanceof Element &&
                event.target.parentElement === ghost)) &&
            !stillLeaving(ghost)
          ) {
            remove();
          }
        });
        ghost.ownerDocument.defaultView?.setTimeout(remove, GHOST_LIFETIME_MS);
      });
    };
  }, [ref, leavingClass]);
};
