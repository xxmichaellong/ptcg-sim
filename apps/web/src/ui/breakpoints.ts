import { useSyncExternalStore } from 'react';

/**
 * The app's three sizes, by the space actually available (ADR-030):
 *
 * - **compact**: a phone. Narrower than 600px, or shorter than 500px (a
 *   phone held sideways). Sheets rise from the bottom; targets are 44px.
 * - **medium**: a tablet or a small window, up to 1024px wide.
 * - **expanded**: everything wider.
 *
 * Stylesheets repeat these numbers in their media queries (CSS has no
 * shared custom media without a build step); keep the two in step.
 */
export const COMPACT_MAX_WIDTH_PX = 599;
export const COMPACT_MAX_HEIGHT_PX = 499;
export const MEDIUM_MAX_WIDTH_PX = 1024;

export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH_PX}px), (max-height: ${COMPACT_MAX_HEIGHT_PX}px)`;
export const MEDIUM_QUERY = `(max-width: ${MEDIUM_MAX_WIDTH_PX}px)`;
/** A finger, not a mouse: targets grow and hover-only cues need another way in. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
/** Only a finger, with nothing that hovers: a phone, a tablet without a trackpad. */
export const TOUCH_ONLY_QUERY = '(pointer: coarse) and (hover: none)';

const subscribeTo =
  (query: string) =>
  (listener: () => void): (() => void) => {
    if (typeof globalThis.matchMedia !== 'function') return () => undefined;
    const list = globalThis.matchMedia(query);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  };

const subscriptions = new Map<string, (listener: () => void) => () => void>();

/** Whether a media query matches now; re-renders when it changes. */
export const useMediaQuery = (query: string): boolean => {
  let subscribe = subscriptions.get(query);
  if (!subscribe) {
    subscribe = subscribeTo(query);
    subscriptions.set(query, subscribe);
  }
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia(query).matches,
    () => false
  );
};

export const useCompactLayout = (): boolean => useMediaQuery(COMPACT_QUERY);
