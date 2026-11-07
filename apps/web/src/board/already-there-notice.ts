import { plural, t } from '@lingui/core/macro';

import type { ToastOptions } from '../ui/toast.js';
import type { BoardSessionControllerEffect } from './BoardSessionController.js';
import { groupRefusalNotice } from './group-notice.js';

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
 * Benched Pokémon, `d` on a card in the discard pile), or a group whose
 * every card does: the client keeps such a move from the room, and the
 * player is told where the cards are. Null for any other refusal, which
 * says nothing here.
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
  if (effect.kind === 'GroupActionRejected' && effect.reason === 'no_op') {
    const action = effect.action;
    switch (action?.kind) {
      case 'play':
        return action.slot;
      case 'stadium':
        return 'stadium';
      case 'send':
        switch (action.to) {
          case 'hand':
          case 'discard':
          case 'lostZone':
          case 'prizes':
          case 'board':
            return action.to;
          default:
            return null;
        }
      default:
        return null;
    }
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

/** Every card of a group already lies there: "All 3 are already in hand". */
const groupPlaceTitle = (place: AlreadyTherePlace, count: number): string => {
  switch (place) {
    case 'active':
      return plural(count, { other: 'All # are already in the Active Spot' });
    case 'bench':
      return plural(count, { other: 'All # are already on the Bench' });
    case 'hand':
      return plural(count, { other: 'All # are already in hand' });
    case 'discard':
      return plural(count, { other: 'All # are already in the discard pile' });
    case 'lostZone':
      return plural(count, { other: 'All # are already in the Lost Zone' });
    case 'board':
      return plural(count, { other: 'All # are already on the Board' });
    case 'prizes':
      return plural(count, { other: 'All # are already in the Prizes' });
    case 'stadium':
      return plural(count, { other: 'All # are already the Stadium' });
  }
};

/**
 * What the table says about a move it kept from the room: a calm word for
 * a move to where the cards already are (nothing went wrong), or why the
 * selection can't do what was asked (`groupRefusalNotice`).
 */
export const alreadyThereNotice = (
  effect: BoardSessionControllerEffect
): ToastOptions | undefined => {
  const place = alreadyTherePlace(effect);
  if (!place) return groupRefusalNotice(effect);
  const count =
    effect.kind === 'GroupActionRejected' ? effect.itemCount : undefined;
  return {
    id: ALREADY_THERE_TOAST_ID,
    title:
      count !== undefined && count > 1
        ? groupPlaceTitle(place, count)
        : placeTitle(place),
  };
};
