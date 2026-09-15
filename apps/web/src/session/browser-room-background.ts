export const ROOM_BACKGROUND_PROMPT =
  "Paste your image URL, or type 'blank' or 'theme':";
export const INVALID_ROOM_BACKGROUND_MESSAGE =
  'Please enter a valid image URL.';

const THEME_BACKGROUND_URLS = Object.freeze([
  'https://ptcgsim.online/src/assets/background1.jpg',
  'https://ptcgsim.online/src/assets/background2.webp',
] as const);

export type RoomBackground =
  { readonly kind: 'blank' } | { readonly kind: 'image'; readonly url: string };

type BackgroundImageLoader = Pick<
  HTMLImageElement,
  'onload' | 'onerror' | 'src'
>;

export interface BrowserRoomBackgroundRequestOptions {
  readonly signal?: AbortSignal;
  readonly prompt?: (message: string) => string | null;
  readonly alert?: (message: string) => void;
  readonly random?: () => number;
  readonly createImage?: () => BackgroundImageLoader;
}

export type BrowserRoomBackgroundRequest = (
  options?: BrowserRoomBackgroundRequestOptions
) => Promise<RoomBackground | undefined>;

const reportInvalidBackground = (
  alertUser: ((message: string) => void) | undefined
): void => {
  try {
    alertUser?.(INVALID_ROOM_BACKGROUND_MESSAGE);
  } catch {
    // A blocked alert must not turn a local visual preference into a failure.
  }
};

/**
 * Runs the source prompt in the foreground click boundary and preloads the
 * selected image before publishing it. The browser performs any third-party
 * request directly; no URL enters the room protocol or server.
 */
export const requestBrowserRoomBackground: BrowserRoomBackgroundRequest =
  async (options = {}) => {
    if (options.signal?.aborted) return undefined;
    const promptUser =
      options.prompt ??
      (typeof globalThis.prompt === 'function'
        ? globalThis.prompt.bind(globalThis)
        : undefined);
    if (!promptUser) return undefined;

    let input: string | null;
    try {
      input = promptUser(ROOM_BACKGROUND_PROMPT);
    } catch {
      return undefined;
    }
    if (input === null) return undefined;
    const normalized = input.trim();
    if (normalized === '') return undefined;
    if (normalized.toLowerCase() === 'blank') return { kind: 'blank' };

    const random = options.random ?? Math.random;
    const requestedUrl =
      normalized.toLowerCase() === 'theme'
        ? (THEME_BACKGROUND_URLS[random() < 0.5 ? 0 : 1] ??
          THEME_BACKGROUND_URLS[0])
        : normalized;
    const alertUser =
      options.alert ??
      (typeof globalThis.alert === 'function'
        ? globalThis.alert.bind(globalThis)
        : undefined);
    const createImage =
      options.createImage ??
      (typeof globalThis.Image === 'function'
        ? () => new globalThis.Image()
        : undefined);
    if (!createImage) {
      reportInvalidBackground(alertUser);
      return undefined;
    }

    return await new Promise<RoomBackground | undefined>((resolve) => {
      let image: BackgroundImageLoader;
      try {
        image = createImage();
      } catch {
        reportInvalidBackground(alertUser);
        resolve(undefined);
        return;
      }
      let settled = false;
      const cleanup = (): void => {
        image.onload = null;
        image.onerror = null;
        options.signal?.removeEventListener('abort', handleAbort);
      };
      const finish = (result: RoomBackground | undefined): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const handleAbort = (): void => finish(undefined);
      image.onload = () => {
        const loadedUrl = image.src || requestedUrl;
        finish({ kind: 'image', url: loadedUrl });
      };
      image.onerror = () => {
        reportInvalidBackground(alertUser);
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
        reportInvalidBackground(alertUser);
        finish(undefined);
      }
    });
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
