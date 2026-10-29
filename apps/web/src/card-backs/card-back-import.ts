import { parseCardBack } from '@ptcgsim/game-core';

/**
 * An outside picture made a card back of our own (ADR-041): fetched once
 * through the Worker (which checks where it comes from), re-encoded here at
 * card size, and uploaded to the image store, which names it by its hash.
 * Opponents then load our copy, never the outside host.
 */

/** A card at the size it is drawn largest, 63:88. */
export const CARD_BACK_IMAGE_WIDTH = 600;
export const CARD_BACK_IMAGE_HEIGHT = 838;
/** The store's limit; the encoder steps its quality down to fit. */
export const CARD_BACK_UPLOAD_BYTES = 200 * 1024;
const QUALITIES = [0.86, 0.76, 0.66, 0.56] as const;

/**
 * Where a crop of a card's shape sits in a picture of another shape: 0 at
 * one edge, 1 at the other, 0.5 about its middle (CSS's object-position).
 */
export interface CardBackCropFocus {
  readonly x: number;
  readonly y: number;
}

export const CENTRED_CROP: CardBackCropFocus = Object.freeze({
  x: 0.5,
  y: 0.5,
});

export type CardBackEncoder = (
  picture: Blob,
  focus?: CardBackCropFocus
) => Promise<Blob | null>;

export interface CardBackImportOptions {
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
  readonly encode?: CardBackEncoder;
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

/** A number held within 0 and 1 (a stray NaN is the middle). */
const unit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

/**
 * The picture cropped to a card's shape where `focus` puts the crop (about
 * its middle by default) and drawn at card size, as WebP where the browser
 * can encode it (Safari can't) and JPEG otherwise, within the store's limit.
 */
export const encodeCardBackImage: CardBackEncoder = async (
  picture,
  focus = CENTRED_CROP
) => {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await decodePicture(picture);
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = CARD_BACK_IMAGE_WIDTH;
  canvas.height = CARD_BACK_IMAGE_HEIGHT;
  // A canvas in memory, never the GPU's: encoding reads it back whole, and
  // where the GPU is emulated (a machine without one) a GPU canvas stalled
  // the page for seconds before its first picture (CI run 40848329715).
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || source.width < 1 || source.height < 1) return null;
  const target = CARD_BACK_IMAGE_WIDTH / CARD_BACK_IMAGE_HEIGHT;
  const width = Math.min(source.width, source.height * target);
  const height = width / target;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (source.width - width) * unit(focus.x),
    (source.height - height) * unit(focus.y),
    width,
    height,
    0,
    0,
    CARD_BACK_IMAGE_WIDTH,
    CARD_BACK_IMAGE_HEIGHT
  );
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of QUALITIES) {
      const blob = await canvasBlob(canvas, type, quality);
      // A browser that can't encode the type hands back a PNG instead.
      if (!blob || blob.type !== type) break;
      if (blob.size <= CARD_BACK_UPLOAD_BYTES) return blob;
    }
  }
  return null;
};

/** Uploads a card-sized picture; its `img:` reference, or null. */
export const uploadCardBackImage = async (
  picture: Blob,
  options: Pick<CardBackImportOptions, 'signal' | 'fetch'> = {}
): Promise<string | null> => {
  const send = options.fetch ?? fetch;
  try {
    const response = await send('/v2/images', {
      method: 'POST',
      headers: { 'Content-Type': picture.type },
      body: picture,
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.status !== 201) return null;
    const body: unknown = await response.json();
    const ref =
      typeof body === 'object' && body !== null
        ? Reflect.get(body, 'ref')
        : undefined;
    return typeof ref === 'string' && parseCardBack(ref)?.kind === 'image'
      ? ref
      : null;
  } catch {
    return null;
  }
};

/**
 * An outside picture fetched once through the Worker (ADR-041: the page
 * never asks its host), as it is, for a preview before it is made a back;
 * null if the Worker couldn't fetch it or it isn't a picture.
 */
export const fetchImportedPicture = async (
  url: string,
  options: Pick<CardBackImportOptions, 'signal' | 'fetch'> = {}
): Promise<Blob | null> => {
  const send = options.fetch ?? fetch;
  try {
    const response = await send('/v2/images/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return null;
    const picture = await response.blob();
    return picture.type.startsWith('image/') ? picture : null;
  } catch {
    return null;
  }
};

/**
 * An outside picture's URL made into an `img:` reference of our own, or
 * null if any step fails (the caller keeps what it had).
 */
export const importCardBackFromUrl = async (
  url: string,
  options: CardBackImportOptions = {}
): Promise<string | null> => {
  const picture = await fetchImportedPicture(url, options);
  if (!picture || options.signal?.aborted) return null;
  const encoded = await (options.encode ?? encodeCardBackImage)(picture);
  if (!encoded || options.signal?.aborted) return null;
  return await uploadCardBackImage(encoded, options);
};
