import {
  resolveCardPresentation,
  type MatchViewState,
  type ViewCardId,
  type ViewCard,
} from '@ptcgsim/game-core';
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

/** Matching artwork pieces join; other arrivals replace the whole Stadium. */
export const resolveCardStadiumMoveAction = (
  view: MatchViewState,
  cardId: ViewCardId,
  placement?: 'add',
  /** The seat at the bottom (a flipped Solo board): its window is worked too. */
  actingPlayerId?: string
): CardStadiumMoveResolution => {
  if (view.viewer.kind !== 'player') return rejected('not_player');
  const located = locateViewCardActionSource(view, cardId);
  if (!located) return rejected('stale_card');
  if (
    located.isLowerEvolution ||
    ((located.sourceKind === 'inspection' || located.sourceKind === 'staged') &&
      located.sourcePlayerId !== view.viewer.playerId &&
      located.sourcePlayerId !== actingPlayerId)
  ) {
    return rejected('unsupported_source');
  }
  const stadium = Object.values(view.zones).find(
    (zone) => zone.kind === 'stadium'
  );
  if (
    !stadium ||
    stadium.cards.length > 4 ||
    (located.sourceId !== stadium.id &&
      stadium.cards.some((card) => card.id === cardId))
  ) {
    return rejected('unsupported_target');
  }
  if (located.sourceId === stadium.id) return rejected('no_op');
  const joinOf = (card: ViewCard) =>
    card.kind === 'known' && card.face === 'up'
      ? resolveCardPresentation(view.definitions[card.definitionId] ?? {})?.join
      : undefined;
  const join = joinOf(located.card);
  const add =
    placement === 'add' ||
    (join &&
      stadium.cards.length > 0 &&
      stadium.cards.every((card) => {
        const other = joinOf(card);
        // A Stadium is one player's card: another's half replaces it.
        return (
          card.ownerId === located.card.ownerId &&
          other?.key === join.key &&
          other.columns === join.columns &&
          other.rows === join.rows &&
          other.part !== join.part
        );
      }));
  if (add && stadium.cards.length >= 4) return rejected('unsupported_target');
  return {
    ok: true,
    command: {
      type: 'MoveCardToStadium',
      cardId: located.card.id,
      expectedSourceId: located.sourceId,
      expectedStadiumCardId: stadium.cards[0]?.id ?? null,
      ...(stadium.cards.length > 1 || add
        ? { expectedStadiumCardIds: stadium.cards.map((card) => card.id) }
        : {}),
      ...(add ? { placement: 'add' as const } : {}),
    },
  };
};
