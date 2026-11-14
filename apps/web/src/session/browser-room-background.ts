import { t } from '@lingui/core/macro';
import { promptValue } from '../ui/dialog-requests.js';
import type { BrowserTextPrompt } from './browser-card-back.js';
import {
  browserImageFactory,
  preloadBrowserImage,
  type BrowserImageLoader,
} from './browser-image-preload.js';

export const invalidRoomBackgroundMessage = (): string =>
  t`Enter a valid image URL.`;

/** The wallpapers that ship with the app, offered beside the desk. */
export const ROOM_WALLPAPERS = Object.freeze([
  { id: 'wallpaper1', url: '/v2/assets/background1.jpg' },
  { id: 'wallpaper2', url: '/v2/assets/background2.webp' },
] as const);

/**
 * What lies around the table, chosen in Settings (ADR-013): nothing at all
 * (`blank`, a plain desk), a picture at an address (a wallpaper, or a link),
 * or the player's own picture kept on this device (`local`). No choice is
 * the desk of the table's style.
 */
export type RoomBackground =
  | { readonly kind: 'blank' }
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'local' };

/** The room's background as Settings and the palette change it. */
export interface BackgroundChoice {
  /** Nothing chosen: the desk of the table's style. */
  readonly current: RoomBackground | undefined;
  readonly onChange: (next: RoomBackground | undefined) => void;
  /** From a link…: asks for an image's address. */
  readonly onRequestLink: () => void;
}

export interface BrowserRoomBackgroundRequestOptions {
  readonly signal?: AbortSignal;
  readonly prompt?: BrowserTextPrompt;
  readonly createImage?: () => BrowserImageLoader;
}

export type BrowserRoomBackgroundRequest = (
  options?: BrowserRoomBackgroundRequestOptions
) => Promise<RoomBackground | undefined>;

/**
 * A background from a link (Settings, From a link…): asks for the image's
 * address and loads it before publishing it. An image that does not load
 * keeps the dialog open with a message. The browser performs any
 * third-party request directly; no URL enters the room protocol or server.
 */
export const requestBrowserRoomBackground: BrowserRoomBackgroundRequest =
  async (options = {}) => {
    if (options.signal?.aborted) return undefined;
    const ask = options.prompt ?? promptValue;
    const createImage = options.createImage ?? browserImageFactory();
    // What the last successful check produced; the dialog accepts only then.
    let accepted: RoomBackground | undefined;

    let answer: string | null;
    try {
      answer = await ask({
        title: t`Background from a link`,
        label: t`Image link`,
        placeholder: 'https://…',
        submitLabel: t`Use background`,
        validate: async (value, { signal }) => {
          accepted = undefined;
          const requestedUrl = value.trim();
          if (requestedUrl === '') return null;
          if (!createImage) return invalidRoomBackgroundMessage();
          const preload = await preloadBrowserImage(
            createImage,
            requestedUrl,
            signal
          );
          if (preload.kind === 'failed') return invalidRoomBackgroundMessage();
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

/**
 * One CSS background-image value without permitting extra layers. The
 * player's own picture needs its address on this page (`localUrl`); until
 * it is read there is none.
 */
export const roomBackgroundCssImage = (
  background: RoomBackground | undefined,
  localUrl?: string
): string | undefined => {
  if (!background) return undefined;
  if (background.kind === 'blank') return 'none';
  const url = background.kind === 'local' ? localUrl : background.url;
  return url === undefined ? undefined : `url("${escapeCssString(url)}")`;
};
