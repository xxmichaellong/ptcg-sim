/**
 * Card art comes from other people's servers, which sometimes drop a
 * request or go down for a while. A card image that fails tries again by
 * itself, a little later each time and then once a minute for as long as it
 * is on the page, and at once when the browser comes back online or the
 * player comes back to the tab. This replaces v1's Refresh images button
 * (and its R), which re-assigned every image's address by hand.
 */

/** Waits before each retry; after the last, LATER_RETRY_MS each time. */
const RETRY_DELAYS_MS = [1_500, 4_000, 10_000, 30_000] as const;
const LATER_RETRY_MS = 60_000;
const RETRY_PARAMETER = 'ptcgsim-retry';

interface RetryState {
  /** The address the card asked for, without a retry marker. */
  readonly original: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const states = new WeakMap<HTMLImageElement, RetryState>();

const retryable = (url: string): boolean =>
  url.startsWith('http://') ||
  url.startsWith('https://') ||
  url.startsWith('/');

const withoutRetryMarker = (url: string): string => {
  if (!retryable(url)) return url;
  try {
    const parsed = new URL(url, globalThis.location?.href);
    if (!parsed.searchParams.has(RETRY_PARAMETER)) return url;
    parsed.searchParams.delete(RETRY_PARAMETER);
    return parsed.href;
  } catch {
    return url;
  }
};

/**
 * The same address with a marker, so a cached failure is not reused. One
 * with a query of its own (a signed link, say) is asked for again exactly:
 * a parameter added to it could break its signature.
 */
const withRetryMarker = (url: string, attempt: number): string => {
  try {
    const parsed = new URL(url, globalThis.location?.href);
    if (parsed.search !== '') return url;
    parsed.searchParams.set(RETRY_PARAMETER, String(attempt));
    return parsed.href;
  } catch {
    return url;
  }
};

const stateFor = (image: HTMLImageElement): RetryState | undefined => {
  const current = image.getAttribute('src') ?? '';
  if (!retryable(current)) return undefined;
  const original = withoutRetryMarker(current);
  let state = states.get(image);
  // The card now shows a different card: start over for it.
  if (!state || state.original !== original) {
    if (state?.timer !== undefined) clearTimeout(state.timer);
    state = { original, attempt: 0, timer: undefined };
    states.set(image, state);
  }
  return state;
};

const retry = (image: HTMLImageElement, state: RetryState): void => {
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.timer = undefined;
  if (!image.isConnected) return;
  // React changed the card's address since; that load is its own.
  if (withoutRetryMarker(image.getAttribute('src') ?? '') !== state.original)
    return;
  state.attempt += 1;
  image.dataset.cardImageState = 'loading';
  image.src = withRetryMarker(state.original, state.attempt);
};

/** Call from the image's error handler: schedules its next attempt. */
export const scheduleCardImageRetry = (image: HTMLImageElement): void => {
  const state = stateFor(image);
  if (!state) return;
  if (state.timer !== undefined) clearTimeout(state.timer);
  const delay = RETRY_DELAYS_MS[state.attempt] ?? LATER_RETRY_MS;
  // Held weakly: a card taken off the table is not kept, with its whole
  // detached subtree, until its next attempt is due.
  const held = new WeakRef(image);
  state.timer = setTimeout(() => {
    const target = held.deref();
    if (target) retry(target, state);
  }, delay);
};

/**
 * Addresses that failed and what was shown instead, so a copy of the card
 * made later (a card flying off the table) asks for what loaded. Bounded:
 * the oldest are forgotten first.
 */
const fallenBack = new Map<string, string>();
const KEPT_FALLBACKS = 500;

/**
 * Call from a card image's error handler before anything else: when the
 * card has an address to fall back to (its deck's own scan, for one asked
 * for in the player's language that may not exist), the image asks for
 * that instead and this returns true. Retries then belong to the fallback.
 */
export const fallBackCardImage = (
  image: HTMLImageElement,
  fallbackUrl: string | undefined
): boolean => {
  if (!fallbackUrl) return false;
  const current = withoutRetryMarker(image.getAttribute('src') ?? '');
  if (current === fallbackUrl) return false;
  fallenBack.delete(current);
  fallenBack.set(current, fallbackUrl);
  for (const stale of fallenBack.keys()) {
    if (fallenBack.size <= KEPT_FALLBACKS) break;
    fallenBack.delete(stale);
  }
  image.dataset.cardImageState = 'loading';
  image.src = fallbackUrl;
  return true;
};

/** The address to paint a card image at: what it fell back to, if it did. */
export const shownCardImage = (url: string): string =>
  fallenBack.get(url) ?? url;

/** Call from the image's load handler. */
export const settleCardImage = (image: HTMLImageElement): void => {
  const state = states.get(image);
  if (state?.timer !== undefined) clearTimeout(state.timer);
  states.delete(image);
};

/** Retries now every failed card image under `root`; returns how many. */
export const retryFailedCardImages = (root: ParentNode): number => {
  const failed = root.querySelectorAll<HTMLImageElement>(
    'img[data-card-image-state="failed"]'
  );
  let count = 0;
  for (const image of Array.from(failed)) {
    const state = stateFor(image);
    if (!state) continue;
    // Asked for, so the backoff starts again from its shortest wait.
    state.attempt = 0;
    retry(image, state);
    count += 1;
  }
  return count;
};

/**
 * Retries a board surface's failed images at once when the browser comes
 * back online and when the player comes back to the tab (a host that was
 * down may be back). Returns the cleanup.
 */
export const watchCardImageRetries = (root: HTMLElement): (() => void) => {
  const retryAll = (): void => {
    retryFailedCardImages(root);
  };
  const document = root.ownerDocument;
  const window = document.defaultView;
  const shown = (): void => {
    if (document.visibilityState === 'visible') retryAll();
  };
  document.addEventListener('visibilitychange', shown);
  window?.addEventListener('online', retryAll);
  return () => {
    document.removeEventListener('visibilitychange', shown);
    window?.removeEventListener('online', retryAll);
  };
};
