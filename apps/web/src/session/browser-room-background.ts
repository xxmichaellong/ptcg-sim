import { promptValue } from '../ui/dialog-requests.js';
import type { BrowserTextPrompt } from './browser-card-back.js';
import {
  browserImageFactory,
  preloadBrowserImage,
  type BrowserImageLoader,
} from './browser-image-preload.js';

export const ROOM_BACKGROUND_PROMPT =
  "Paste your image URL, or type 'blank' or 'theme':";
export const INVALID_ROOM_BACKGROUND_MESSAGE =
  'Please enter a valid image URL.';

const THEME_BACKGROUND_URLS = Object.freeze([
  '/v2/assets/background1.jpg',
  '/v2/assets/background2.webp',
] as const);

export type RoomBackground =
  { readonly kind: 'blank' } | { readonly kind: 'image'; readonly url: string };

export interface BrowserRoomBackgroundRequestOptions {
  readonly signal?: AbortSignal;
  readonly prompt?: BrowserTextPrompt;
  readonly random?: () => number;
  readonly createImage?: () => BrowserImageLoader;
}

export type BrowserRoomBackgroundRequest = (
  options?: BrowserRoomBackgroundRequestOptions
) => Promise<RoomBackground | undefined>;

/**
 * Asks for the source's background choice and preloads the selected image
 * before publishing it. An image that does not load keeps the dialog open
 * with the source's message. The browser performs any third-party request
 * directly; no URL enters the room protocol or server.
 */
export const requestBrowserRoomBackground: BrowserRoomBackgroundRequest =
  async (options = {}) => {
    if (options.signal?.aborted) return undefined;
    const ask = options.prompt ?? promptValue;
    const random = options.random ?? Math.random;
    const createImage = options.createImage ?? browserImageFactory();
    // What the last successful check produced; the dialog accepts only then.
    let accepted: RoomBackground | undefined;

    let answer: string | null;
    try {
      answer = await ask({
        title: 'Change background',
        body: ROOM_BACKGROUND_PROMPT,
        label: 'Image URL',
        placeholder: 'https://…, blank or theme',
        submitLabel: 'Use background',
        validate: async (value, { signal }) => {
          accepted = undefined;
          const normalized = value.trim();
          if (normalized === '') return null;
          if (normalized.toLowerCase() === 'blank') {
            accepted = { kind: 'blank' };
            return null;
          }
          const requestedUrl =
            normalized.toLowerCase() === 'theme'
              ? (THEME_BACKGROUND_URLS[random() < 0.5 ? 0 : 1] ??
                THEME_BACKGROUND_URLS[0])
              : normalized;
          if (!createImage) return INVALID_ROOM_BACKGROUND_MESSAGE;
          const preload = await preloadBrowserImage(
            createImage,
            requestedUrl,
            signal
          );
          if (preload.kind === 'failed') return INVALID_ROOM_BACKGROUND_MESSAGE;
          if (preload.kind === 'loaded') {
            accepted = { kind: 'image', url: preload.src || requestedUrl };
          }
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

const escapeCssString = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll(/\r\n|[\n\r\f]/gu, '\\a ');

/** Returns one CSS background-image value without permitting extra layers. */
export const roomBackgroundCssImage = (
  background: RoomBackground | undefined
): string | undefined => {
  if (!background) return undefined;
  if (background.kind === 'blank') return 'none';
  return `url("${escapeCssString(background.url)}")`;
};
