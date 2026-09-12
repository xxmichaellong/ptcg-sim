import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

export const DECK_RELATIVE_ACTIONS = [
  'moveToTop',
  'moveToBottom',
  'shuffleIntoDeck',
  'swapWithTop',
] as const;

export type DeckRelativeAction = (typeof DECK_RELATIVE_ACTIONS)[number];

export const isDeckRelativeAction = (
  value: unknown
): value is DeckRelativeAction =>
  typeof value === 'string' &&
  (DECK_RELATIVE_ACTIONS as readonly string[]).includes(value);

const commandTypeByAction = {
  moveToTop: 'MoveCardToDeckTop',
  moveToBottom: 'MoveCardToDeckBottom',
  shuffleIntoDeck: 'ShuffleCardIntoDeck',
  swapWithTop: 'SwapCardWithDeckTop',
} as const satisfies Readonly<
  Record<DeckRelativeAction, WireGameCommand['type']>
>;

export type DeckRelativeActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_card'
        | 'unsupported_source'
        | 'no_deck'
        | 'empty_deck'
        | 'no_op';
    };

/** Maps the legacy top/switch card controls to a stale-safe semantic intent. */
export const resolveDeckRelativeCardAction = (
  view: MatchViewState,
  cardId: string,
  action: DeckRelativeAction
): DeckRelativeActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const located = locateViewCardActionSource(view, cardId);
  if (!located) return { ok: false, reason: 'stale_card' };
  if (
    located.isLowerEvolution ||
    ((located.sourceKind === 'inspection' || located.sourceKind === 'staged') &&
      located.sourcePlayerId !== view.viewer.playerId)
  ) {
    return { ok: false, reason: 'unsupported_source' };
  }
  const deck = Object.values(view.zones).find(
    (zone) => zone.kind === 'deck' && zone.ownerId === located.sourcePlayerId
  );
  if (!deck) return { ok: false, reason: 'no_deck' };
  if (located.sourceId === deck.id) {
    if (
      action === 'swapWithTop' ||
      (action === 'moveToTop' && located.sourceIndex === 0) ||
      (action === 'moveToBottom' &&
        located.sourceIndex === deck.cards.length - 1)
    ) {
      return { ok: false, reason: 'no_op' };
    }
  }
  if (action === 'swapWithTop' && deck.cards.length === 0) {
    return { ok: false, reason: 'empty_deck' };
  }
  return {
    ok: true,
    command: {
      type: commandTypeByAction[action],
      cardId,
      expectedSourceId: located.sourceId,
    },
  };
};

export const submitDeckRelativeCardAction = (
  view: MatchViewState,
  cardId: string,
  action: DeckRelativeAction,
  submit: (command: WireGameCommand) => void
): DeckRelativeActionResolution => {
  const resolution = resolveDeckRelativeCardAction(view, cardId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};

export type PrizeDeckBottomActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'no_prizes' | 'empty_prizes';
    };

export const resolvePrizeDeckBottomAction = (
  view: MatchViewState
): PrizeDeckBottomActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const playerId = view.viewer.playerId;
  const prizes = Object.values(view.zones).find(
    (zone) => zone.kind === 'prizes' && zone.ownerId === playerId
  );
  if (!prizes) return { ok: false, reason: 'no_prizes' };
  if (prizes.cards.length === 0) {
    return { ok: false, reason: 'empty_prizes' };
  }
  return { ok: true, command: { type: 'MovePrizesToDeckBottom' } };
};

export const submitPrizeDeckBottomAction = (
  view: MatchViewState,
  submit: (command: WireGameCommand) => void
): PrizeDeckBottomActionResolution => {
  const resolution = resolvePrizeDeckBottomAction(view);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
