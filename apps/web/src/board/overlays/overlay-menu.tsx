import type { Icon } from '@phosphor-icons/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';

import { isOverlaySurfaceTarget } from '../../ui/overlay-surface.js';

/*
 * What the table's menus share (the card menu, the group menu): focus kept
 * inside while open and given back after, a press outside putting them
 * away, the arrow keys moving between rows, and a row's icon and label.
 */

/**
 * Takes the focus into `container` (its first `focusSelector`) as it opens,
 * and gives it back to whatever had it when it closes.
 */
export const useFocusBoundary = (
  container: RefObject<HTMLElement | null>,
  focusSelector: string,
  identity: string
): RefObject<HTMLElement | null> => {
  const opener = useRef<HTMLElement | null>(null);
  const focusCycle = useRef(0);
  useLayoutEffect(() => {
    const cycle = focusCycle.current + 1;
    focusCycle.current = cycle;
    const element = container.current;
    if (!element) return;
    const active = element.ownerDocument.activeElement;
    // Keep the external opener captured by the first setup. React StrictMode
    // immediately replays layout effects while focus is already inside the
    // overlay; replacing the opener in that replay would leave us trying to
    // restore focus to a button that disappears with the overlay.
    if (active instanceof HTMLElement && !element.contains(active)) {
      opener.current = active;
    }
    const first = element.querySelector<HTMLElement>(focusSelector) ?? element;
    first.focus();
    // A previous overlay's queued focus restoration (see the cleanup below)
    // can land after this setup on a slow frame and pull focus back to the
    // table; claim it again once that microtask has run.
    const reclaim = element.ownerDocument.defaultView?.requestAnimationFrame(
      () => {
        if (
          focusCycle.current === cycle &&
          element.isConnected &&
          !element.contains(element.ownerDocument.activeElement)
        ) {
          first.focus();
        }
      }
    );
    return () => {
      if (reclaim !== undefined) {
        element.ownerDocument.defaultView?.cancelAnimationFrame(reclaim);
      }
      const previous = opener.current;
      const current = element.ownerDocument.activeElement;
      if (!previous?.isConnected || !element.contains(current)) return;
      queueMicrotask(() => {
        // React StrictMode replays layout effects without unmounting the DOM.
        // A replacement setup cancels the first cleanup's queued restoration;
        // a genuine overlay removal has no replacement cycle and still returns
        // focus to the opener.
        const activeNow = element.ownerDocument.activeElement;
        const replacementClaimedFocus =
          activeNow instanceof HTMLElement &&
          activeNow !== element.ownerDocument.body &&
          activeNow !== current &&
          !element.contains(activeNow);
        if (
          focusCycle.current === cycle &&
          previous.isConnected &&
          !replacementClaimedFocus
        ) {
          previous.focus();
        }
      });
    };
  }, [container, focusSelector, identity]);
  // The element focus returns to when the overlay goes away.
  return opener;
};

/** Puts `container` away on a press anywhere outside it. */
export const useOutsideDismiss = (
  container: RefObject<HTMLElement | null>,
  dismiss: () => void,
  ignoreClosest?: string,
  /**
   * A press outside that leaves it open all the same: a card added to the
   * selection with a modifier, or a tap in touch's selection mode, while
   * the pile viewer is open (ADR-042 §2).
   */
  letThrough?: (event: PointerEvent) => boolean
): void => {
  const letThroughRef = useRef(letThrough);
  letThroughRef.current = letThrough;
  useEffect(() => {
    const element = container.current;
    const document = element?.ownerDocument;
    if (!element || !document) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (element.contains(target as Node)) return;
      // A press inside a dialog raised over the table (a confirmation, a
      // prompt) answers that dialog; it is not a press on the table.
      if (isOverlaySurfaceTarget(target)) return;
      if (
        ignoreClosest &&
        target instanceof Element &&
        target.closest(ignoreClosest)
      ) {
        return;
      }
      if (letThroughRef.current?.(event)) return;
      dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [container, dismiss, ignoreClosest]);
};

/** The arrow keys, Home and End move the focus between a menu's rows. */
export const moveMenuFocus = (
  event: ReactKeyboardEvent<HTMLElement>,
  direction: 'first' | 'last' | 'next' | 'previous',
  selector = ':scope > ul > li > [role="menuitem"]'
): void => {
  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  const current = items.indexOf(
    menu.ownerDocument.activeElement as HTMLElement
  );
  const index =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? items.length - 1
        : direction === 'next'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
  items[index]?.focus();
  event.preventDefault();
};

/**
 * A menu row's icon and label. The keyboard hint is drawn by the stylesheet
 * from `data-menu-hint`, so a row's text -- and its accessible name -- stay
 * exactly its label.
 */
export const MenuItemContent = ({
  icon: ItemIcon,
  label,
}: {
  readonly icon: Icon;
  readonly label: string;
}) => (
  <>
    <ItemIcon className="ptcgsim-menu-icon" aria-hidden="true" />
    <span className="ptcgsim-menu-label">{label}</span>
  </>
);
