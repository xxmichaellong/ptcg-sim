import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

import { promptValue, type PromptOptions } from '../ui/dialog-requests.js';
import {
  browserImageFactory,
  preloadBrowserImage,
  type BrowserImageLoader,
} from './browser-image-preload.js';

export const CARD_BACK_PROMPT = "Paste your image URL or type 'default':";
export const INVALID_CARD_BACK_MESSAGE = 'Please enter a valid image URL.';
export const DEFAULT_CARD_BACK_URL = '/v2/assets/cardback.png';

/** Asks for one line of text: the overlay prompt dialog by default. */
export type BrowserTextPrompt = (
  options: PromptOptions
) => Promise<string | null>;

export interface BrowserCardBackRequestOptions {
  readonly signal?: AbortSignal;
  readonly prompt?: BrowserTextPrompt;
  readonly createImage?: () => BrowserImageLoader;
}

export type BrowserCardBackRequest = (
  options?: BrowserCardBackRequestOptions
) => Promise<string | undefined>;

/**
 * Asks for a card-back image and checks it loads before anything changes,
 * as v1 did. A URL that is too long or does not load keeps the dialog open
 * with the source's message; Cancel, an empty answer or an aborted request
 * changes nothing.
 */
export const requestBrowserCardBack: BrowserCardBackRequest = async (
  options = {}
) => {
  if (options.signal?.aborted) return undefined;
  const ask = options.prompt ?? promptValue;
  const createImage = options.createImage ?? browserImageFactory();
  // The URL the last successful check loaded; the dialog accepts only then.
  let accepted: string | undefined;

  let answer: string | null;
  try {
    answer = await ask({
      title: 'Change card back',
      body: CARD_BACK_PROMPT,
      label: 'Image URL',
      placeholder: 'https://… or default',
      submitLabel: 'Use image',
      validate: async (value, { signal }) => {
        accepted = undefined;
        const normalized = value.trim();
        if (normalized === '') return null;
        if (normalized.length > MAX_IMAGE_URL_CODE_UNITS) {
          return INVALID_CARD_BACK_MESSAGE;
        }
        const requestedUrl =
          normalized.toLowerCase() === 'default'
            ? DEFAULT_CARD_BACK_URL
            : normalized;
        if (!createImage) return INVALID_CARD_BACK_MESSAGE;
        const preload = await preloadBrowserImage(
          createImage,
          requestedUrl,
          signal
        );
        if (preload.kind === 'failed') return INVALID_CARD_BACK_MESSAGE;
        if (preload.kind === 'loaded') accepted = requestedUrl;
        return null;
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return undefined;
  }
  if (answer === null || options.signal?.aborted) return undefined;
  return accepted;
};
