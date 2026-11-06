import type { BoardScene } from '@ptcgsim/renderer-contract';

import { shownCardImage } from '../card-image-retry.js';

/**
 * A copy of a card picture that paints in the frame it is put on the page.
 *
 * The table often draws a picture somewhere new for a moment: the face a
 * card had, shown over it while it turns over; the card that was on top of
 * a pile, standing in for the pile while the new top lands; a copy flying
 * off the table. A new `<img>` -- or one given a new `src`, or a clone --
 * paints nothing for a frame or two, even for a picture already on screen,
 * whenever the browser checks it again first (Chromium does, for anything
 * not cached forever). That was a blank, or see-through, card at the start
 * of every turn, and the card under a pile showing through it.
 *
 * So these are canvases, drawn from a picture already on screen: an image
 * that is showing it now, or one copied off the screen just before the
 * table was drawn without it (`keepPicturesLeaving`). Drawing a loaded
 * image is synchronous. Where no copy can be had, the caller falls back to
 * an `<img>`.
 */

/** Widest copy kept: a card is drawn at most about 250px wide, at 2x. */
const MAX_WIDTH = 512;
/** Copies kept at once (each up to about 1.4 MB). */
const MAX_KEPT = 12;
/** How long a copy taken off the screen is kept for the frames after. */
const KEEP_MS = 4_000;

interface Kept {
  readonly canvas: HTMLCanvasElement;
  readonly at: number;
}

const kept = new Map<string, Kept>();

const timestamp = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

type Source = HTMLImageElement | HTMLCanvasElement;

const sizeOf = (source: Source): { width: number; height: number } =>
  source instanceof HTMLCanvasElement
    ? { width: source.width, height: source.height }
    : { width: source.naturalWidth, height: source.naturalHeight };

/** Loaded and showing a picture (not still loading, not failed). */
const painted = (image: HTMLImageElement): boolean =>
  image.complete &&
  image.naturalWidth > 0 &&
  image.style.visibility !== 'hidden' &&
  image.dataset.cardImageState !== 'loading' &&
  image.dataset.cardImageState !== 'failed';

/** A canvas holding `source`, or null where the page can't draw one. */
const copyOf = (source: Source, url: string): HTMLCanvasElement | null => {
  const { width, height } = sizeOf(source);
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!context) return null;
  try {
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  canvas.dataset.cardPicture = url;
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
};

const forget = (now: number): void => {
  for (const [url, entry] of kept)
    if (now - entry.at > KEEP_MS) kept.delete(url);
  while (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
};

/** Keeps a copy of what `image` shows, for after it shows something else. */
export const keepPicture = (image: HTMLImageElement): void => {
  const url = image.getAttribute('src');
  if (!url || !painted(image)) return;
  const canvas = copyOf(image, url);
  if (!canvas) return;
  const now = timestamp();
  kept.delete(url);
  kept.set(url, { canvas, at: now });
  forget(now);
};

/** The picture a scene card is drawn with. */
const pictureUrl = (card: BoardScene['cards'][number]): string =>
  card.tableImageUrl ?? card.imageUrl;

/**
 * Before `next` is drawn over what `root` shows now (`previous`): keeps a
 * copy of every card picture about to leave its place on the screen -- a
 * card that goes, that another node will draw (a pile's top taking the
 * card put on it, a card into the hand), or that will be drawn with another
 * picture (a card turned over). The node that draws it next can show the
 * copy at once. Cheap: only those are copied.
 */
export const keepPicturesLeaving = (
  root: ParentNode | null,
  previous: BoardScene | null,
  next: BoardScene
): void => {
  if (!root) return;
  const where = new Map<string, string>();
  for (const card of previous?.cards ?? [])
    if (card.renderKey !== null) where.set(String(card.id), card.renderKey);
  const staying = new Map<string, readonly [string, string]>();
  for (const card of next.cards)
    if (card.renderKey !== null)
      staying.set(String(card.id), [card.renderKey, pictureUrl(card)]);
  for (const element of Array.from(
    root.querySelectorAll<HTMLElement>('.ptcgsim-card[data-card-id]')
  )) {
    const image = element.querySelector<HTMLImageElement>(
      ':scope .ptcgsim-card__face > img:not(.ptcgsim-card__turn)'
    );
    if (!image) continue;
    const url = image.getAttribute('src');
    const id = element.dataset.cardId;
    if (!url || id === undefined) continue;
    const after = staying.get(id);
    if (after && after[1] === url && after[0] === where.get(id)) continue;
    keepPicture(image);
  }
};

/**
 * A fresh copy of the picture at `url` that paints at once: drawn from an
 * image showing it on the page under `root`, else from one kept off the
 * screen. Null when there is none (the caller shows an `<img>`).
 */
export const pictureOf = (
  url: string,
  root: ParentNode | null
): HTMLCanvasElement | null => {
  if (root) {
    // Compared, not selected: an address needs no escaping this way.
    for (const image of Array.from(root.querySelectorAll('img'))) {
      if (image.getAttribute('src') !== url || !painted(image)) continue;
      const canvas = copyOf(image, url);
      if (canvas) return canvas;
    }
  }
  const entry = kept.get(url);
  if (!entry) return null;
  forget(timestamp());
  return kept.has(url) ? copyOf(entry.canvas, url) : null;
};

/**
 * The picture at `url` as an element that paints at once where it can: a
 * copy of it from the screen, else an `<img>` (a card's face as shown: the
 * deck's own scan where its translation was missing).
 */
export const pictureElement = (url: string): HTMLElement => {
  const shown = shownCardImage(url);
  const root = typeof document === 'undefined' ? null : document;
  const copy =
    pictureOf(shown, root) ?? (shown === url ? null : pictureOf(url, root));
  if (copy) return copy;
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  image.src = shown;
  return image;
};

/**
 * While `image` loads a picture that was on screen a moment ago, a copy of
 * it lies over the image in its place (`.ptcgsim-card__picture-copy`), so
 * the card shows it at once, not blank. Returns what takes the copy away
 * (it also goes once the image is in, or fails).
 */
export const showCopyWhileLoading = (image: HTMLImageElement): (() => void) => {
  if (image.complete) return () => undefined;
  const copy = pictureOf(image.getAttribute('src') ?? '', image.ownerDocument);
  if (!copy) return () => undefined;
  copy.classList.add('ptcgsim-card__picture-copy');
  image.after(copy);
  const done = () => copy.remove();
  image.addEventListener('load', done, { once: true });
  image.addEventListener('error', done, { once: true });
  return () => {
    image.removeEventListener('load', done);
    image.removeEventListener('error', done);
    copy.remove();
  };
};

/** Tests: forgets every copy kept. */
export const forgetPicturesForTests = (): void => {
  kept.clear();
};
