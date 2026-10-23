/**
 * A card turning over shows its old face (a card back, mostly) until it is
 * on its edge, and its own face after. That face is often an image the page
 * has never loaded -- a card the player has only just learned -- and a card
 * hides its image while it loads, so turning before it is ready shows an
 * empty card. The turn waits for the face instead, holding the old one up.
 */

/** Longest a turn waits for its face before turning regardless. */
export const FACE_WAIT_LIMIT_MS = 2500;

/** The card's own face image under any turn overlay, if it has one. */
export const faceImageOf = (face: HTMLElement): HTMLImageElement | null =>
  face.querySelector<HTMLImageElement>(':scope > img:not(.ptcgsim-card__turn)');

/** Loaded, or failed for good: either way, waiting longer shows nothing. */
export const isFaceReady = (image: HTMLImageElement | null): boolean =>
  !image || image.complete;

/**
 * Calls `ready` once the face can be shown -- at once if it already can --
 * and returns a function that stops waiting.
 */
export const whenFaceReady = (
  image: HTMLImageElement | null,
  ready: () => void,
  limitMs = FACE_WAIT_LIMIT_MS
): (() => void) => {
  if (!image || isFaceReady(image)) {
    ready();
    return () => undefined;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    image.removeEventListener('load', loaded);
    image.removeEventListener('error', finish);
    clearTimeout(timer);
    ready();
  };
  // Decoded too, so the first frame of the face is never a blank one.
  const loaded = () => {
    if (typeof image.decode === 'function')
      void image.decode().then(finish, finish);
    else finish();
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', finish);
  const timer = setTimeout(finish, limitMs);
  return () => {
    if (done) return;
    done = true;
    image.removeEventListener('load', loaded);
    image.removeEventListener('error', finish);
    clearTimeout(timer);
  };
};
