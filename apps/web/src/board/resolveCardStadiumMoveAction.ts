import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

export type CardStadiumMoveResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_card'
        | 'unsupported_source'
        | 'unsupported_target'
        | 'no_op';
    };

const rejected = (
  reason: Exclude<CardStadiumMoveResolution, { ok: true }>['reason']
): CardStadiumMoveResolution => ({ ok: false, reason });

/** Resolves one selected card into the singleton shared stadium zone. */
export const resolveCardStadiumMoveAction = (
  view: MatchViewState,
  cardId: ViewCardId
): CardStadiumMoveResolution => {
  if (view.viewer.kind !== 'player') return rejected('not_player');
  const located = locateViewCardActionSource(view, cardId);
  if (!located) return rejected('stale_card');
  if (
    located.isLowerEvolution ||
    ((located.sourceKind === 'inspection' || located.sourceKind === 'staged') &&
      located.sourcePlayerId !== view.viewer.playerId)
  ) {
    return rejected('unsupported_source');
  }
  const stadium = Object.values(view.zones).find(
    (zone) => zone.kind === 'stadium'
  );
  if (!stadium || stadium.cards.length > 1) {
    return rejected('unsupported_target');
  }
  if (located.sourceId === stadium.id) return rejected('no_op');
  return {
    ok: true,
    command: {
      type: 'MoveCardToStadium',
      cardId: located.card.id,
      expectedSourceId: located.sourceId,
      expectedStadiumCardId: stadium.cards[0]?.id ?? null,
    },
  };
};
