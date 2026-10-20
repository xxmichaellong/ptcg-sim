import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import type { ActivityFeedItem } from '../presentation/ActivityFeedModel.js';
import type { ToastOptions } from '../ui/toast.js';

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

interface VendorFullscreenDocument {
  readonly fullscreenElement?: Element | null;
  readonly webkitFullscreenElement?: Element | null;
  readonly exitFullscreen?: () => Promise<void> | void;
  readonly webkitExitFullscreen?: () => Promise<void> | void;
}

const fullscreenDocument = (): VendorFullscreenDocument | undefined =>
  globalThis.document as VendorFullscreenDocument | undefined;

/** Whether the page is full screen now. */
export const isBrowserFullscreen = (
  document: VendorFullscreenDocument | undefined = fullscreenDocument()
): boolean =>
  Boolean(document?.fullscreenElement ?? document?.webkitFullscreenElement);

/** Leaves full screen, if the page is in it. */
export const exitBrowserFullscreen = (
  document: VendorFullscreenDocument | undefined = fullscreenDocument()
): void => {
  if (!document || !isBrowserFullscreen(document)) return;
  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  try {
    const result = exit?.call(document);
    if (result) void result.catch(() => undefined);
  } catch {
    // Already leaving.
  }
};

/** Said when the browser keeps the page in its window. */
export const fullscreenRefusedNotice = (): ToastOptions => ({
  id: 'fullscreen-refused',
  title: t`Full screen isn't available here`,
  body: t`This browser keeps the table in its window.`,
  tone: 'warning',
});

/**
 * Calls `refused` whenever the browser turns a full-screen request down
 * after accepting the call (it answers with `fullscreenerror`, not a throw).
 */
export const onFullscreenRefused = (refused: () => void): (() => void) => {
  const target = globalThis.document;
  if (!target) return () => undefined;
  target.addEventListener('fullscreenerror', refused);
  target.addEventListener('webkitfullscreenerror', refused);
  return () => {
    target.removeEventListener('fullscreenerror', refused);
    target.removeEventListener('webkitfullscreenerror', refused);
  };
};

const subscribeFullscreen = (listener: () => void): (() => void) => {
  const target = globalThis.document;
  if (!target) return () => undefined;
  target.addEventListener('fullscreenchange', listener);
  target.addEventListener('webkitfullscreenchange', listener);
  return () => {
    target.removeEventListener('fullscreenchange', listener);
    target.removeEventListener('webkitfullscreenchange', listener);
  };
};

/** Whether the page is full screen, kept current as it enters and leaves. */
export const useBrowserFullscreen = (): boolean =>
  useSyncExternalStore(
    subscribeFullscreen,
    () => isBrowserFullscreen(),
    () => false
  );
