import { resolveCardPresentation } from '@ptcgsim/game-core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { readingImageStyle } from '../../ui/card-artwork.js';
import { CardImage } from './CardImage.js';

/** Large enough to read rules text; kept inside the screen. */
const ZOOM_MAX_HEIGHT = 560;
const ZOOM_GAP = 14;
const ZOOM_MARGIN = 8;
const ZOOM_DELAY_MS = 140;

export interface ZoomCard {
  readonly name: string;
  readonly image: string;
  readonly imageSmall?: string;
  readonly presentation?: unknown;
}

interface ZoomPlacement {
  readonly small: string;
  readonly large: string;
  readonly turns: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the zoom's left edge goes: beside the card on the side the line
 * reads towards -- its right, or its left in a right-to-left language --
 * else the other side when that one has no room; never off the screen's
 * left.
 */
const zoomLeft = (
  card: { readonly left: number; readonly right: number },
  width: number,
  right: number,
  rightToLeft: boolean
): number => {
  const toRight = card.right + ZOOM_GAP;
  const toLeft = card.left - ZOOM_GAP - width;
  const fitsRight = toRight + width <= right - ZOOM_MARGIN;
  const fitsLeft = toLeft >= ZOOM_MARGIN;
  const left = rightToLeft
    ? fitsLeft || !fitsRight
      ? toLeft
      : toRight
    : fitsRight
      ? toRight
      : toLeft;
  return Math.max(ZOOM_MARGIN, left);
};

/**
 * A card shown large beside the one the mouse rests on (or keyboard focus
 * reaches), so its text can be read without opening it. Moving from card
 * to card swaps the zoom without closing it; a fresh hover waits a beat so
 * sweeping across a grid doesn't flash.
 */
export const useHoverZoom = (bounds: RefObject<HTMLElement | null>) => {
  const [zoom, setZoom] = useState<ZoomPlacement>();
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shown = useRef(false);

  const clear = (): void => {
    if (showTimer.current !== undefined) clearTimeout(showTimer.current);
    if (hideTimer.current !== undefined) clearTimeout(hideTimer.current);
    showTimer.current = undefined;
    hideTimer.current = undefined;
  };

  useEffect(() => clear, []);

  const hide = useCallback(() => {
    clear();
    shown.current = false;
    setZoom(undefined);
  }, []);

  const release = useCallback(() => {
    if (showTimer.current !== undefined) clearTimeout(showTimer.current);
    showTimer.current = undefined;
    if (hideTimer.current !== undefined) return;
    hideTimer.current = setTimeout(() => {
      hideTimer.current = undefined;
      shown.current = false;
      setZoom(undefined);
    }, ZOOM_DELAY_MS);
  }, []);

  const show = useCallback(
    (card: ZoomCard, element: HTMLElement) => {
      const large = card.image;
      const small = card.imageSmall ?? large;
      if (!large) return;
      const turns =
        resolveCardPresentation({
          name: card.name,
          imageUrl: large,
          presentation: card.presentation as never,
        })?.readingQuarterTurns ?? 0;
      const aspect = turns % 2 ? 88 / 63 : 63 / 88;
      const place = (): void => {
        showTimer.current = undefined;
        const rect = element.getBoundingClientRect();
        const box = bounds.current?.getBoundingClientRect();
        const right = box?.right ?? globalThis.innerWidth;
        const bottom = box?.bottom ?? globalThis.innerHeight;
        const height = Math.min(
          ZOOM_MAX_HEIGHT,
          bottom * 0.7,
          (right - 2 * ZOOM_MARGIN) / aspect
        );
        const width = height * aspect;
        const left = zoomLeft(
          rect,
          width,
          right,
          getComputedStyle(element).direction === 'rtl'
        );
        const top = Math.min(
          Math.max(ZOOM_MARGIN, rect.top + rect.height / 2 - height / 2),
          Math.max(ZOOM_MARGIN, bottom - height - ZOOM_MARGIN)
        );
        shown.current = true;
        setZoom({ small, large, turns, left, top, width, height });
      };
      clear();
      if (shown.current) place();
      else showTimer.current = setTimeout(place, ZOOM_DELAY_MS);
    },
    [bounds]
  );

  const element = zoom ? (
    <div
      className="deck-zoom"
      aria-hidden="true"
      style={{
        left: zoom.left,
        top: zoom.top,
        width: zoom.width,
        height: zoom.height,
      }}
    >
      <CardImage
        src={zoom.small}
        fallback={undefined}
        alt=""
        className="deck-zoom__placeholder"
        style={readingImageStyle(zoom.turns)}
      />
      <CardImage
        src={zoom.large}
        fallback={undefined}
        alt=""
        style={readingImageStyle(zoom.turns)}
      />
    </div>
  ) : null;

  return { show, release, hide, element };
};
