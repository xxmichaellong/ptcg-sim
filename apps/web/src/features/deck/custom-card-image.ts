import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

import {
  CARD_BACK_IMAGE_HEIGHT,
  CARD_BACK_IMAGE_WIDTH,
  CARD_BACK_UPLOAD_BYTES,
  importCardBackFromUrl,
  uploadCardBackImage,
} from '../../card-backs/card-back-import.js';

/**
 * A custom card's picture kept in the app's image store (ADR-041), as card
 * backs are: a file re-encoded here and uploaded, a link fetched through
 * the Worker and re-encoded the same way. Opponents load our copy, never
 * the outside host -- except for a link the store couldn't take that still
 * loads as a picture, which is used as it is (as v1 used every link).
 */

const QUALITIES = [0.86, 0.76, 0.66, 0.56] as const;

const decode = async (
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

/**
 * The picture whole (never cropped: a sideways scan stays sideways), no
 * larger than a card drawn largest, as WebP or else JPEG within the store's
 * limit; and whether it is wider than tall.
 */
export const encodeCardImage = async (
  picture: Blob
): Promise<{ readonly blob: Blob; readonly wide: boolean } | null> => {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await decode(picture);
  } catch {
    return null;
  }
  if (source.width < 1 || source.height < 1) return null;
  const wide = source.width > source.height;
  const scale = Math.min(
    1,
    (wide ? CARD_BACK_IMAGE_HEIGHT : CARD_BACK_IMAGE_WIDTH) / source.width,
    (wide ? CARD_BACK_IMAGE_WIDTH : CARD_BACK_IMAGE_HEIGHT) / source.height
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  // In memory, never the GPU's: see encodeCardBackImage.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality)
      );
      // A browser that can't encode the type hands back a PNG instead.
      if (!blob || blob.type !== type) break;
      if (blob.size <= CARD_BACK_UPLOAD_BYTES) return { blob, wide };
    }
  }
  return null;
};

/** Where the store serves an `img:` reference. */
export const storedImageUrl = (ref: string): string =>
  `/v2/images/${ref.slice('img:'.length)}`;

/** Whether a link loads as a picture, and if so whether it is wide. */
const pictureAt = (url: string): Promise<{ readonly wide: boolean } | null> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ wide: image.naturalWidth > image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });

export type CardImageFailure = 'not_a_picture' | 'too_long' | 'failed';

export type CardImageResult =
  | { readonly url: string; readonly wide: boolean }
  | { readonly failure: CardImageFailure };

/**
 * A file or a link as a picture for a custom card: the address to give the
 * card (and whether the picture is wider than tall), or why there is none.
 */
export const uploadCardImage = async (
  source: Blob | string,
  signal?: AbortSignal
): Promise<CardImageResult> => {
  const options = signal ? { signal } : {};
  if (typeof source !== 'string') {
    if (!source.type.startsWith('image/')) return { failure: 'not_a_picture' };
    const encoded = await encodeCardImage(source);
    if (!encoded) return { failure: 'not_a_picture' };
    if (signal?.aborted) return { failure: 'failed' };
    const ref = await uploadCardBackImage(encoded.blob, options);
    return ref
      ? { url: storedImageUrl(ref), wide: encoded.wide }
      : { failure: 'failed' };
  }
  const link = source.trim();
  if (link.length > MAX_IMAGE_URL_CODE_UNITS) return { failure: 'too_long' };
  let wide = false;
  const ref = /^https:[/][/]/iu.test(link)
    ? await importCardBackFromUrl(link, {
        ...options,
        encode: async (picture) => {
          const encoded = await encodeCardImage(picture);
          wide = encoded?.wide ?? false;
          return encoded?.blob ?? null;
        },
      })
    : null;
  if (ref) return { url: storedImageUrl(ref), wide };
  if (signal?.aborted) return { failure: 'failed' };
  const picture = await pictureAt(link);
  return picture ? { url: link, wide: picture.wide } : { failure: 'failed' };
};
