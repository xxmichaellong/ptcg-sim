import type { CardImageLanguage } from '@ptcgsim/deck-core';

import {
  cardImageAddresses,
  cardImageLanguage,
  noteCardImageFailure,
} from '../../i18n/card-image-language.js';

/** A card image as CardImage shows it: its scan, and where else to look. */
export interface WarmCardImage {
  readonly src: string;
  readonly fallback: string | undefined;
}

/** How many images load at once: the rest wait their turn, in order. */
const AT_ONCE = 6;
/** How many loaded images are held, most recently asked for first. */
const KEPT_IMAGES = 400;

/**
 * Images loaded and decoded ahead, by the first address CardImage would ask
 * for. Holding them keeps them in the page's image cache: an <img> made
 * later with the same address paints at once, already decoded, instead of
 * asking the network and showing blank meanwhile.
 */
const held = new Map<string, HTMLImageElement>();
const queued = new Map<string, readonly string[]>();
let loading = 0;
const idle = new Set<() => void>();

const hold = (key: string, image: HTMLImageElement): void => {
  held.delete(key);
  held.set(key, image);
  for (const stale of held.keys()) {
    if (held.size <= KEPT_IMAGES) break;
    held.delete(stale);
  }
};

/** Loads and decodes one address: true when it can be shown. */
const loadImage = (url: string): Promise<HTMLImageElement | undefined> =>
  new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    // Behind anything the page needs now.
    image.fetchPriority = 'low';
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok ? image : undefined);
    };
    image.onerror = () => done(false);
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        done(true);
        return;
      }
      image.decode().then(
        () => done(true),
        // Loaded but not decodable ahead (a browser that declines): it is
        // still in the cache.
        () => done(image.naturalWidth > 0)
      );
    };
    image.src = url;
  });

/** The first address that loads, as CardImage would try them. */
const warmOne = async (addresses: readonly string[]): Promise<void> => {
  for (const [index, url] of addresses.entries()) {
    const image = await loadImage(url);
    if (image) {
      hold(addresses[0]!, image);
      return;
    }
    // A translation that doesn't exist is not asked for again this visit:
    // the screen goes straight to the scan that loads.
    if (index < addresses.length - 1) noteCardImageFailure(url);
  }
};

const pump = (): void => {
  while (loading < AT_ONCE && queued.size > 0) {
    const [key, addresses] = queued.entries().next().value!;
    queued.delete(key);
    loading += 1;
    void warmOne(addresses).finally(() => {
      loading -= 1;
      pump();
    });
  }
  if (loading === 0 && queued.size === 0) {
    for (const resolve of [...idle]) resolve();
    idle.clear();
  }
};

/**
 * Loads and decodes card images ahead, in the player's card language, so
 * they show the moment a screen draws them. Images already held, or
 * waiting, are not asked for twice. Resolves when nothing is left to load.
 */
export const warmCardImages = (
  images: readonly WarmCardImage[],
  language: CardImageLanguage = cardImageLanguage()
): Promise<void> => {
  if (typeof Image !== 'function') return Promise.resolve();
  for (const { src, fallback } of images) {
    if (!src) continue;
    const addresses = cardImageAddresses(src, fallback, language);
    const key = addresses[0];
    if (key === undefined || queued.has(key)) continue;
    const image = held.get(key);
    if (image) hold(key, image);
    else queued.set(key, addresses);
  }
  const done = new Promise<void>((resolve) => idle.add(resolve));
  pump();
  return done;
};

/** Whether an image is held loaded for this first address (tests). */
export const isCardImageWarm = (url: string): boolean => held.has(url);

/** Lets every held image go (tests). */
export const forgetWarmCardImages = (): void => {
  held.clear();
  queued.clear();
};
