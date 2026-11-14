import { onlyHeldCardMoved } from '@ptcgsim/renderer-contract';

import type { BoardSessionControllerState } from './BoardSessionController.js';

/**
 * Whether the board moved on from `previous` only by carrying the held card
 * on (a drag sends one such change per pointer move). The page around the
 * table reads whether a card is held, never where; the renderer paints it
 * there itself.
 */
export const onlyHeldCardMovedOn = (
  previous: BoardSessionControllerState,
  next: BoardSessionControllerState
): boolean => {
  if (!onlyHeldCardMoved(previous.presentation, next.presentation))
    return false;
  const keys = Object.keys(next) as (keyof BoardSessionControllerState)[];
  return (
    keys.length === Object.keys(previous).length &&
    keys.every(
      (key) =>
        key === 'generation' ||
        key === 'presentation' ||
        Object.is(previous[key], next[key])
    )
  );
};
