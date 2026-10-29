import { t } from '@lingui/core/macro';

import type { ToastOptions } from '../ui/toast.js';
import type { BoardSessionControllerEffect } from './BoardSessionController.js';

/** One notice at a time: pressing the key again replaces it. */
export const ALREADY_THERE_TOAST_ID = 'board-already-there';

/** The places a key, the palette or a menu sends a card to. */
export type AlreadyTherePlace =
  | 'active'
  | 'bench'
  | 'hand'
  | 'discard'
  | 'lostZone'
  | 'board'
  | 'prizes'
  | 'stadium';

/**
 * Where a move was sending a card that already lies there (`b` on a
 * Benched Pokémon, `d` on a card in the discard pile): the client keeps
 * such a move from the room, and the player is told where the card is.
 * Null for any other refusal, which says nothing here.
 */
export const alreadyTherePlace = (
  effect: BoardSessionControllerEffect
): AlreadyTherePlace | null => {
  if (effect.kind === 'ShortcutActionRejected' && effect.reason === 'no_op') {
    const request = effect.request;
    switch (request.action) {
      case 'moveCardToPlay':
        return request.slot;
      case 'moveCardToZone':
        return request.destination;
      case 'moveCardToStadium':
        return 'stadium';
      default:
        return null;
    }
  }
  if (
    effect.kind === 'OverlayActionRejected' &&
    effect.reason === 'no_op' &&
    effect.request.kind === 'context' &&
    effect.request.action === 'moveCard' &&
    effect.request.destination === 'board'
  ) {
    return 'board';
  }
  return null;
};

const placeTitle = (place: AlreadyTherePlace): string => {
  switch (place) {
    case 'active':
      return t`Already in the Active Spot`;
    case 'bench':
      return t`Already on the Bench`;
    case 'hand':
      return t`Already in hand`;
    case 'discard':
      return t`Already in the discard pile`;
    case 'lostZone':
      return t`Already in the Lost Zone`;
    case 'board':
      return t`Already on the Board`;
    case 'prizes':
      return t`Already in the Prizes`;
    case 'stadium':
      return t`Already the Stadium`;
  }
};

/** A calm word for a move to where the card already is: nothing went wrong. */
export const alreadyThereNotice = (
  effect: BoardSessionControllerEffect
): ToastOptions | undefined => {
  const place = alreadyTherePlace(effect);
  return place
    ? { id: ALREADY_THERE_TOAST_ID, title: placeTitle(place) }
    : undefined;
};
