import type { ViewCardId } from '@ptcgsim/game-core';

import type {
  BoardIntent,
  BoardPresentation,
  CardSelectionMode,
} from './model.js';

/**
 * No selection, shared, so a presentation that keeps none keeps the same
 * array and a held card's move is told apart by reference (onlyHeldCardMoved).
 */
export const NO_SELECTION: readonly ViewCardId[] = Object.freeze([]);

/**
 * The one selected item, for a surface that acts on one card (the preview,
 * a card's own menu, the single-card keys): null for none, and for several,
 * so such a surface goes quiet for a group instead of acting on one card.
 */
export const selectedCardIdOf = (
  presentation: Pick<BoardPresentation, 'selection'>
): ViewCardId | null =>
  presentation.selection.length === 1 ? presentation.selection[0]! : null;

/** How a press changes the selection; the old `toggle` flag reads as `toggle`. */
export const cardSelectionModeOf = (
  intent: Extract<BoardIntent, { readonly kind: 'CardSelected' }>
): CardSelectionMode => intent.mode ?? (intent.toggle ? 'toggle' : 'replace');

/** Whether two selections hold the same items in the same order. */
export const sameSelection = (
  left: readonly ViewCardId[],
  right: readonly ViewCardId[]
): boolean =>
  left === right ||
  (left.length === right.length &&
    left.every((cardId, index) => right[index] === cardId));
