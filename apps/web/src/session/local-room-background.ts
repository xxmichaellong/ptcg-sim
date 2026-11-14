import { useEffect, useSyncExternalStore } from 'react';

/**
 * The player's own background picture (ADR-013), kept on this device only:
 * re-encoded here to a desktop's size and stored in IndexedDB, so it comes
 * back after a reload. It never leaves the page -- no upload, no server, no
 * other player sees it. The table preference records only that it is
 * chosen (`{ kind: 'local' }`).
 */

/** A picture larger than this is refused before it is read. */
export const BACKGROUND_SOURCE_BYTES = 25 * 1024 * 1024;
/** Drawn no larger than a large desktop screen. */
export const BACKGROUND_MAX_WIDTH = 2560;
export const BACKGROUND_MAX_HEIGHT = 1600;
/** What is kept, at most; the encoder steps its quality down to fit. */
export const BACKGROUND_STORED_BYTES = 3 * 1024 * 1024;
const QUALITIES = [0.86, 0.76, 0.66, 0.56] as const;

const DATABASE = 'ptcgsim-backgrounds';
const STORE = 'pictures';
const KEY = 'custom';

export type BackgroundEncoder = (picture: Blob) => Promise<Blob | null>;

interface StoredPicture {
  readonly type: string;
  readonly bytes: ArrayBuffer;
}

const canvasBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const decodePicture = async (
  picture: Blob
): Promise<CanvasImageSource & { width: number; height: number }> => {
  if (typeof createImageBitmap === 'function')
    return await createImageBitmap(picture);
  const url = URL.createObjectURL(picture);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** The size a picture is drawn at: within a desktop screen, never enlarged. */
export const backgroundSize = (
  width: number,
  height: number
): { readonly width: number; readonly height: number } => {
  const scale = Math.min(
    1,
    BACKGROUND_MAX_WIDTH / width,
    BACKGROUND_MAX_HEIGHT / height
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * The picture whole, at most a desktop screen's size, as WebP where the
 * browser can encode it (Safari can't) and JPEG otherwise, within the
 * stored limit. Null for what is not a picture, or too large.
 */
export const encodeBackgroundImage: BackgroundEncoder = async (picture) => {
  if (picture.size > BACKGROUND_SOURCE_BYTES) return null;
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await decodePicture(picture);
  } catch {
    return null;
  }
  if (source.width < 1 || source.height < 1) return null;
  const size = backgroundSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  // A canvas in memory, never the GPU's: encoding reads it back whole, and
  // where the GPU is emulated a GPU canvas stalls the page for seconds.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of QUALITIES) {
      const blob = await canvasBlob(canvas, type, quality);
      // A browser that can't encode the type hands back a PNG instead.
      if (!blob || blob.type !== type) break;
      if (blob.size <= BACKGROUND_STORED_BYTES) return blob;
    }
  }
  return null;
};

const request = <T>(operation: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    operation.addEventListener('success', () => resolve(operation.result));
    operation.addEventListener('error', () => reject(operation.error));
  });

let opening: Promise<IDBDatabase | null> | undefined;

const database = (
  factory: IDBFactory | undefined = globalThis.indexedDB
): Promise<IDBDatabase | null> => {
  opening ??= (async () => {
    if (!factory) return null;
    try {
      const open = factory.open(DATABASE, 1);
      open.addEventListener('upgradeneeded', () => {
        if (!open.result.objectStoreNames.contains(STORE)) {
          open.result.createObjectStore(STORE);
        }
      });
      const opened = await request(open);
      // Another tab upgrading the database asks this one to let go.
      opened.addEventListener('versionchange', () => {
        opened.close();
        opening = undefined;
      });
      return opened;
    } catch {
      return null;
    }
  })();
  return opening;
};

// The picture as this page has it, and its address here.
let current: { readonly blob: Blob; readonly url: string } | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

const publish = (blob: Blob | undefined): void => {
  if (current) URL.revokeObjectURL(current.url);
  current = blob ? { blob, url: URL.createObjectURL(blob) } : undefined;
  for (const listener of listeners) listener();
};

// Saves begun, so only the latest writes: an earlier picture read slower
// than a newer one would otherwise be the one the next page brings back.
let saves = 0;

/**
 * Keeps the picture as the player's background: on this device where
 * IndexedDB opens, for this visit otherwise. False if nothing was kept
 * (or a newer picture is kept instead).
 */
export const saveLocalBackground = async (picture: Blob): Promise<boolean> => {
  const save = ++saves;
  publish(picture);
  loading = Promise.resolve();
  const db = await database();
  if (!db) return false;
  try {
    // Its bytes, not the Blob: they read back the same in every browser.
    const stored: StoredPicture = {
      type: picture.type,
      bytes: await picture.arrayBuffer(),
    };
    if (save !== saves) return false;
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(stored, KEY);
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve());
      transaction.addEventListener('error', () => reject(transaction.error));
      transaction.addEventListener('abort', () => reject(transaction.error));
    });
    return true;
  } catch {
    return false;
  }
};

/** Reads the kept picture once, for the first page that shows it. */
const loadLocalBackground = (): Promise<void> => {
  loading ??= (async () => {
    const db = await database();
    if (!db) return;
    try {
      const stored: unknown = await request(
        db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      );
      const type: unknown =
        typeof stored === 'object' && stored !== null
          ? Reflect.get(stored, 'type')
          : undefined;
      const bytes: unknown =
        typeof stored === 'object' && stored !== null
          ? Reflect.get(stored, 'bytes')
          : undefined;
      if (
        typeof type === 'string' &&
        type.startsWith('image/') &&
        bytes instanceof ArrayBuffer &&
        !current
      ) {
        publish(new Blob([bytes], { type }));
      }
    } catch {
      // Unreadable: the desk shows instead.
    }
  })();
  return loading;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The kept picture's address on this page, once read; for its preview. */
export const useLocalBackgroundUrl = (enabled = true): string | undefined => {
  useEffect(() => {
    if (enabled) void loadLocalBackground();
  }, [enabled]);
  const url = useSyncExternalStore(
    subscribe,
    () => current?.url,
    () => undefined
  );
  return enabled ? url : undefined;
};

/** Forgets what this page holds (tests; another tab's picture). */
export const resetLocalBackgroundForTests = (): void => {
  publish(undefined);
  loading = undefined;
  opening = undefined;
};
