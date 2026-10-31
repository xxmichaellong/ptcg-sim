export type BrowserImageLoader = Pick<
  HTMLImageElement,
  'onload' | 'onerror' | 'src'
>;

export type BrowserImagePreload =
  | { readonly kind: 'loaded'; readonly src: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'aborted' };

/** The browser's own image loader, when there is one. */
export const browserImageFactory = ():
  (() => BrowserImageLoader) | undefined =>
  typeof globalThis.Image === 'function'
    ? () => new globalThis.Image()
    : undefined;

/**
 * Loads one image the way the page will show it, so a bad URL is caught
 * before anything changes. The browser contacts the host directly; nothing
 * is proxied, rewritten or fetched through application code. Aborting stops
 * listening (a late load or error is ignored).
 */
export const preloadBrowserImage = (
  createImage: () => BrowserImageLoader,
  url: string,
  signal?: AbortSignal
): Promise<BrowserImagePreload> =>
  new Promise<BrowserImagePreload>((resolve) => {
    if (signal?.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }
    let image: BrowserImageLoader;
    try {
      image = createImage();
    } catch {
      resolve({ kind: 'failed' });
      return;
    }
    let settled = false;
    const finish = (result: BrowserImagePreload): void => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', handleAbort);
      resolve(result);
    };
    const handleAbort = (): void => finish({ kind: 'aborted' });
    image.onload = () => finish({ kind: 'loaded', src: image.src });
    image.onerror = () => finish({ kind: 'failed' });
    signal?.addEventListener('abort', handleAbort, { once: true });
    try {
      image.src = url;
    } catch {
      finish({ kind: 'failed' });
    }
  });
