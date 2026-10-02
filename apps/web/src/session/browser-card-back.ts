import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

export const CARD_BACK_PROMPT = "Paste your image URL or type 'default':";
export const INVALID_CARD_BACK_MESSAGE = 'Please enter a valid image URL.';
export const DEFAULT_CARD_BACK_URL = '/v2/assets/cardback.png';

type CardBackImageLoader = Pick<HTMLImageElement, 'onload' | 'onerror' | 'src'>;

export interface BrowserCardBackRequestOptions {
  readonly signal?: AbortSignal;
  readonly prompt?: (message: string) => string | null;
  readonly alert?: (message: string) => void;
  readonly createImage?: () => CardBackImageLoader;
}

export type BrowserCardBackRequest = (
  options?: BrowserCardBackRequestOptions
) => Promise<string | undefined>;

const reportInvalidCardBack = (
  alertUser: ((message: string) => void) | undefined
): void => {
  try {
    alertUser?.(INVALID_CARD_BACK_MESSAGE);
  } catch {
    // A blocked alert must not turn a foreground visual choice into a failure.
  }
};

/**
 * Preserves V1's foreground prompt and image-load check. The browser contacts
 * the selected host directly; this helper never proxies, rewrites, or fetches
 * the value through application code.
 */
export const requestBrowserCardBack: BrowserCardBackRequest = async (
  options = {}
) => {
  if (options.signal?.aborted) return undefined;
  const promptUser =
    options.prompt ??
    (typeof globalThis.prompt === 'function'
      ? globalThis.prompt.bind(globalThis)
      : undefined);
  if (!promptUser) return undefined;

  let input: string | null;
  try {
    input = promptUser(CARD_BACK_PROMPT);
  } catch {
    return undefined;
  }
  if (input === null) return undefined;
  const normalized = input.trim();
  if (normalized === '') return undefined;

  const alertUser =
    options.alert ??
    (typeof globalThis.alert === 'function'
      ? globalThis.alert.bind(globalThis)
      : undefined);
  if (normalized.length > MAX_IMAGE_URL_CODE_UNITS) {
    reportInvalidCardBack(alertUser);
    return undefined;
  }
  const requestedUrl =
    normalized.toLowerCase() === 'default' ? DEFAULT_CARD_BACK_URL : normalized;
  const createImage =
    options.createImage ??
    (typeof globalThis.Image === 'function'
      ? () => new globalThis.Image()
      : undefined);
  if (!createImage) {
    reportInvalidCardBack(alertUser);
    return undefined;
  }

  return await new Promise<string | undefined>((resolve) => {
    let image: CardBackImageLoader;
    try {
      image = createImage();
    } catch {
      reportInvalidCardBack(alertUser);
      resolve(undefined);
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      image.onload = null;
      image.onerror = null;
      options.signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (result: string | undefined): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const handleAbort = (): void => finish(undefined);
    image.onload = () => finish(requestedUrl);
    image.onerror = () => {
      reportInvalidCardBack(alertUser);
      finish(undefined);
    };
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      image.src = requestedUrl;
    } catch {
      reportInvalidCardBack(alertUser);
      finish(undefined);
    }
  });
};
