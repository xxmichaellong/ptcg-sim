import {
  useLayoutEffect,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/**
 * Motion for the board overlays. Entrances are CSS (keyframes on insertion);
 * this module covers what CSS cannot do alone:
 *
 * - Exits. The controller removes an overlay from its state at once, and the
 *   overlay unmounts at once, so focus, tests and the next action never wait
 *   for an animation. What the player sees leave is a *ghost*: an inert,
 *   `aria-hidden` copy of the overlay's last frame, stripped of every `data-*`
 *   attribute, id and role (so no selector, query or assistive technology can
 *   find it), that plays its exit animation and removes itself.
 * - The card preview's zoom from the card it shows (a FLIP on the Web
 *   Animations API).
 * - The preview's pointer-tracked tilt and glare.
 *
 * Reduced motion and the animation speed come from the page root
 * (`data-motion`, `--motion-scale`), which the route sets from the player's
 * motion settings.
 */

export type OverlayExitVariant = 'menu' | 'panel' | 'preview' | 'scrim';

/** Presentational attributes a ghost keeps; every other `data-*` goes. */
const GHOST_KEPT_ATTRIBUTES = new Set(['data-menu-hint']);
const GHOST_STRIPPED_ATTRIBUTES = new Set([
  'id',
  'role',
  'tabindex',
  'contenteditable',
  'draggable',
  'name',
  'for',
  'autofocus',
  'inert',
]);
/** A ghost outlives its animation by at most this long. */
const GHOST_LIFETIME_MS = 450;

const stripGhost = (ghost: Element): void => {
  for (const element of [ghost, ...ghost.querySelectorAll('*')]) {
    for (const name of element.getAttributeNames()) {
      if (GHOST_KEPT_ATTRIBUTES.has(name)) continue;
      if (
        name.startsWith('data-') ||
        name.startsWith('aria-') ||
        GHOST_STRIPPED_ATTRIBUTES.has(name)
      ) {
        element.removeAttribute(name);
      }
    }
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
};

/**
 * Leaves an exit ghost behind when the overlay holding `ref` unmounts. React
 * StrictMode's effect replay keeps the element connected, so a ghost is only
 * made once the element has really left the document.
 */
export const useOverlayExit = (
  ref: RefObject<HTMLElement | null>,
  variant: OverlayExitVariant
): void => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return () => {
      const parent = element.parentElement;
      if (!parent) return;
      const nextSibling = element.nextSibling;
      const ghost = element.cloneNode(true) as HTMLElement;
      // Freeze the last frame: the ghost must not reflow when it loses the
      // attributes its styles or content depended on.
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const originals = [element, ...element.querySelectorAll('*')];
      const scrolled = originals.flatMap((node, index) =>
        node.scrollTop !== 0 || node.scrollLeft !== 0
          ? [{ index, top: node.scrollTop, left: node.scrollLeft }]
          : []
      );
      queueMicrotask(() => {
        if (element.isConnected || !parent.isConnected) return;
        stripGhost(ghost);
        ghost.classList.add('ptcgsim-overlay-ghost', `is-exit-${variant}`);
        if (width > 0 && height > 0) {
          ghost.style.width = `${String(width)}px`;
          ghost.style.height = `${String(height)}px`;
        }
        parent.insertBefore(
          ghost,
          nextSibling?.parentNode === parent ? nextSibling : null
        );
        if (scrolled.length > 0) {
          const copies = [ghost, ...ghost.querySelectorAll('*')];
          for (const { index, top, left } of scrolled) {
            const copy = copies[index];
            if (!copy) continue;
            copy.scrollTop = top;
            copy.scrollLeft = left;
          }
        }
        const remove = (): void => ghost.remove();
        ghost.addEventListener('animationend', (event) => {
          if (event.target === ghost) remove();
        });
        ghost.ownerDocument.defaultView?.setTimeout(remove, GHOST_LIFETIME_MS);
      });
    };
  }, [ref, variant]);
};

export interface OverlayMotionPreference {
  /** Opacity only, at most 120ms. */
  readonly reduced: boolean;
  /** Duration multiplier; 0 means no animation at all. */
  readonly scale: number;
}

/** Reads the page root's motion choice, as the route publishes it. */
export const readOverlayMotion = (
  element: Element
): OverlayMotionPreference => {
  const document = element.ownerDocument;
  const root = document.documentElement;
  const view = document.defaultView;
  const choice = root.dataset.motion;
  const systemReduced =
    typeof view?.matchMedia === 'function' &&
    view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = choice === 'reduced' || (choice !== 'full' && systemReduced);
  const rawScale = view
    ? Number.parseFloat(
        view.getComputedStyle(root).getPropertyValue('--motion-scale')
      )
    : Number.NaN;
  return {
    reduced,
    scale: Number.isFinite(rawScale) && rawScale >= 0 ? rawScale : 1,
  };
};

const readDuration = (element: Element, token: string, fallback: number) => {
  const view = element.ownerDocument.defaultView;
  const raw = view
    ?.getComputedStyle(element.ownerDocument.documentElement)
    .getPropertyValue(token)
    .trim();
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value;
};

const readEasing = (element: Element, token: string, fallback: string) => {
  const raw = element.ownerDocument.defaultView
    ?.getComputedStyle(element.ownerDocument.documentElement)
    .getPropertyValue(token)
    .trim();
  return raw ? raw.replace(/\s+/gu, ' ') : fallback;
};

export interface ClientRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Zooms `element` from `source` (a client-space rectangle, usually the card
 * on the table or in a pile) to where it already is: a FLIP on the
 * compositor's `translate` and `scale`, so layout and hit-testing never see
 * the in-between frames. Reduced motion, instant speed, a missing source or
 * a browser without the Web Animations API skip it.
 */
export const zoomFromRect = (
  element: HTMLElement,
  source: ClientRectLike | null
): void => {
  if (!source || source.width <= 0 || source.height <= 0) return;
  if (typeof element.animate !== 'function') return;
  const motion = readOverlayMotion(element);
  if (motion.reduced || motion.scale <= 0) return;
  const target = element.getBoundingClientRect();
  if (target.width <= 0 || target.height <= 0) return;
  // Client pixels to the element's own pixels, should the board be scaled.
  const localScale =
    element.offsetWidth > 0 ? target.width / element.offsetWidth : 1;
  const dx =
    (source.left + source.width / 2 - (target.left + target.width / 2)) /
    localScale;
  const dy =
    (source.top + source.height / 2 - (target.top + target.height / 2)) /
    localScale;
  const scale = Math.max(0.05, Math.min(1, source.height / target.height));
  const keyframes: Keyframe[] = [
    {
      translate: `${String(dx)}px ${String(dy)}px`,
      scale: String(scale),
      opacity: 0.4,
    },
    { translate: '0px 0px', scale: '1', opacity: 1 },
  ];
  const duration = readDuration(element, '--duration-slow', 320) * motion.scale;
  const easing = readEasing(
    element,
    '--ease-snappy',
    'cubic-bezier(0.2, 0.8, 0.2, 1)'
  );
  try {
    element.animate(keyframes, { duration, easing, fill: 'backwards' });
  } catch {
    // An engine without `linear()` easings rejects the token.
    element.animate(keyframes, {
      duration,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'backwards',
    });
  }
};

/** Converts a scene-space rectangle on the overlay root to client space. */
export const sceneRectToClient = (
  root: Element,
  viewport: { readonly width: number; readonly height: number },
  rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }
): ClientRectLike | null => {
  const bounds = root.getBoundingClientRect();
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }
  const scaleX = bounds.width / viewport.width;
  const scaleY = bounds.height / viewport.height;
  return {
    left: bounds.left + rect.x * scaleX,
    top: bounds.top + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
};

/** The preview's largest tilt, in degrees. */
const MAX_TILT_DEG = 8;

/**
 * Tilts the card under the pointer and moves its glare with it, through CSS
 * custom properties on `target` (the stylesheet turns both off under reduced
 * motion). The pointer is measured against the untilted element the handlers
 * are attached to, so the tilt never feeds back into itself. Writes are
 * batched to one per frame.
 */
export const createTiltHandlers = (target: RefObject<HTMLElement | null>) => {
  let frame: number | null = null;
  let pending: { readonly x: number; readonly y: number } | null = null;
  const apply = (): void => {
    frame = null;
    const element = target.current;
    if (!element) return;
    if (!pending) {
      element.style.setProperty('--ptcgsim-tilt-x', '0deg');
      element.style.setProperty('--ptcgsim-tilt-y', '0deg');
      element.style.setProperty('--ptcgsim-glare-opacity', '0');
      return;
    }
    const { x, y } = pending;
    element.style.setProperty(
      '--ptcgsim-tilt-x',
      `${((0.5 - y) * 2 * MAX_TILT_DEG).toFixed(2)}deg`
    );
    element.style.setProperty(
      '--ptcgsim-tilt-y',
      `${((x - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`
    );
    element.style.setProperty('--ptcgsim-glare-x', `${(x * 100).toFixed(1)}%`);
    element.style.setProperty('--ptcgsim-glare-y', `${(y * 100).toFixed(1)}%`);
    element.style.setProperty('--ptcgsim-glare-opacity', '1');
  };
  const schedule = (element: HTMLElement): void => {
    if (frame !== null) return;
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    frame = view.requestAnimationFrame(apply);
  };
  return {
    onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
      const element = target.current;
      if (!element) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      pending = {
        x: Math.min(
          1,
          Math.max(0, (event.clientX - bounds.left) / bounds.width)
        ),
        y: Math.min(
          1,
          Math.max(0, (event.clientY - bounds.top) / bounds.height)
        ),
      };
      schedule(element);
    },
    onPointerLeave: (): void => {
      const element = target.current;
      pending = null;
      if (element) schedule(element);
    },
  };
};
