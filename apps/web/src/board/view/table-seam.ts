import { useSyncExternalStore } from 'react';
import {
  tableHandsOutside,
  tableVerticalLayoutForBoards,
} from '@ptcgsim/renderer-contract';

/**
 * Where the seam between the halves lies, as a share of the window from
 * its top, for the player's Split (the boards' share, ADR-046 §5): the
 * frames lean toward the near half where the hands lie inside them.
 */
export const tableSeamShare = (
  split: number,
  tilted: boolean,
  viewport: { readonly width: number; readonly height: number }
): number =>
  1 -
  tableVerticalLayoutForBoards(
    split,
    tableHandsOutside({
      tiltedTable: tilted,
      viewport: { ...viewport, devicePixelRatio: 1 },
    })
  ).lowerFrame.heightRatio;

const subscribeResize = (listener: () => void): (() => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};
const landscape = (): boolean => window.innerWidth > window.innerHeight;

/** `tableSeamShare` for this window, kept current as it is resized. */
export const useTableSeamShare = (split: number, tilted: boolean): number => {
  const wide = useSyncExternalStore(subscribeResize, landscape, () => true);
  return tableSeamShare(
    split,
    tilted,
    wide ? { width: 2, height: 1 } : { width: 1, height: 2 }
  );
};
