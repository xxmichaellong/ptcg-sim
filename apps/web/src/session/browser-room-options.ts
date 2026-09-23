import type { ActivityFeedItem } from '../presentation/ActivityFeedModel.js';

export const serializeBattleLog = (
  items: readonly Pick<ActivityFeedItem, 'message'>[]
): string =>
  items
    .map((item, index) => `${index + 1}: ${item.message.trim()}\n\n`)
    .join('');

/** Downloads recipient-safe presentation text without retaining an object URL. */
export const downloadBrowserTextFile = (
  filename: string,
  contents: string
): boolean => {
  const urlApi = globalThis.URL;
  const createObjectURL = urlApi?.createObjectURL;
  const revokeObjectURL = urlApi?.revokeObjectURL;
  if (
    !globalThis.document ||
    typeof createObjectURL !== 'function' ||
    typeof revokeObjectURL !== 'function'
  ) {
    return false;
  }

  let objectUrl: string | undefined;
  try {
    objectUrl = createObjectURL.call(
      urlApi,
      new Blob([contents], { type: 'text/plain' })
    );
    const link = globalThis.document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.click();
    return true;
  } catch {
    return false;
  } finally {
    if (objectUrl !== undefined) revokeObjectURL.call(urlApi, objectUrl);
  }
};

interface VendorFullscreenElement {
  readonly requestFullscreen?: () => Promise<void> | void;
  readonly mozRequestFullScreen?: () => Promise<void> | void;
  readonly webkitRequestFullScreen?: () => Promise<void> | void;
  readonly msRequestFullscreen?: () => Promise<void> | void;
}

/** Starts the legacy document-level fullscreen request from its click gesture. */
export const requestBrowserFullscreen = (
  element: VendorFullscreenElement = globalThis.document?.documentElement ?? {}
): boolean => {
  const request =
    element.requestFullscreen ??
    element.mozRequestFullScreen ??
    element.webkitRequestFullScreen ??
    element.msRequestFullscreen;
  if (!request) return false;
  try {
    const result = request.call(element);
    if (result) void result.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};
