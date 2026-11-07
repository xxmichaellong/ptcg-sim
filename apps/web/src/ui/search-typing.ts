import { useEffect, type RefObject } from 'react';

/**
 * How long a press may take to end in its click; a press that never clicks
 * (a scroll, a drag) lets the layout come back after this.
 */
const PRESS_SETTLE_MS = 600;

/** A field whose typing makes room for what it finds. */
const searchFieldOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof HTMLElement &&
  ((target instanceof HTMLInputElement && target.type === 'search') ||
    target.id === 'deckPasteInput')
    ? target
    : null;

/**
 * Marks `data-search-typing` on an element while one of its search fields
 * is being typed into: `card` for the deck editor's card search, `other`
 * for the rest. Its stylesheet steps trays and headers aside meanwhile.
 *
 * The mark leaves as the field lets go of the focus, but not under a press
 * still going: a tap on a result takes the focus between the press and its
 * click, and a layout put back then moves the result from under the finger,
 * so the click lands elsewhere (the first tap would add nothing). It leaves
 * once the click is through.
 */
export const useSearchTyping = (ref: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let pressing = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let deferred = false;
    const mark = (field: HTMLElement | null): void => {
      if (field && element.contains(field))
        element.dataset.searchTyping = field.closest('.card-search')
          ? 'card'
          : 'other';
      else delete element.dataset.searchTyping;
    };
    const settle = (): void => {
      pressing = false;
      clearTimeout(settleTimer);
      if (!deferred) return;
      deferred = false;
      // After the click's own handlers.
      setTimeout(() => mark(searchFieldOf(document.activeElement)), 0);
    };
    const focusIn = (event: FocusEvent): void => {
      const field = searchFieldOf(event.target);
      if (!field) return;
      deferred = false;
      mark(field);
    };
    const focusOut = (event: FocusEvent): void => {
      if (!searchFieldOf(event.target)) return;
      if (searchFieldOf(event.relatedTarget)) return;
      if (pressing) {
        deferred = true;
        return;
      }
      mark(null);
    };
    const pressStart = (): void => {
      pressing = true;
      clearTimeout(settleTimer);
    };
    const pressEnd = (): void => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, PRESS_SETTLE_MS);
    };
    element.addEventListener('focusin', focusIn);
    element.addEventListener('focusout', focusOut);
    document.addEventListener('pointerdown', pressStart, true);
    document.addEventListener('pointerup', pressEnd, true);
    document.addEventListener('pointercancel', settle, true);
    document.addEventListener('click', settle, true);
    return () => {
      clearTimeout(settleTimer);
      element.removeEventListener('focusin', focusIn);
      element.removeEventListener('focusout', focusOut);
      document.removeEventListener('pointerdown', pressStart, true);
      document.removeEventListener('pointerup', pressEnd, true);
      document.removeEventListener('pointercancel', settle, true);
      document.removeEventListener('click', settle, true);
      delete element.dataset.searchTyping;
    };
  }, [ref]);
};
