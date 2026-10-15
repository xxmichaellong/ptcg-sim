import { CARD_IMAGE_RETRY_EVENT } from '@ptcgsim/renderer-contract';

/**
 * Card art comes from other people's servers, which sometimes drop a
 * request. A card image that fails tries again by itself, a little later
 * each time, and at once when the browser comes back online or the player
 * asks (`CARD_IMAGE_RETRY_EVENT`). This replaces v1's Refresh images
 * button, which re-assigned every image's address by hand.
 */

/** Waits before each retry; after the last the image waits to be asked. */
const RETRY_DELAYS_MS = [1_500, 4_000, 10_000, 30_000] as const;
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
  const delay = RETRY_DELAYS_MS[state.attempt];
  if (delay === undefined) return;
  // Held weakly: a card taken off the table is not kept, with its whole
  // detached subtree, until its next attempt is due.
  const held = new WeakRef(image);
  state.timer = setTimeout(() => {
    const target = held.deref();
    if (target) retry(target, state);
  }, delay);
};

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
 * Retries a board surface's failed images when the player asks (the event
 * on its document) and when the browser comes back online. Returns the
 * cleanup.
 */
export const watchCardImageRetries = (root: HTMLElement): (() => void) => {
  const retryAll = (): void => {
    retryFailedCardImages(root);
  };
  const document = root.ownerDocument;
  const window = document.defaultView;
  document.addEventListener(CARD_IMAGE_RETRY_EVENT, retryAll);
  window?.addEventListener('online', retryAll);
  return () => {
    document.removeEventListener(CARD_IMAGE_RETRY_EVENT, retryAll);
    window?.removeEventListener('online', retryAll);
  };
};
