import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

export const CARD_ZONE_MOVE_DESTINATIONS = [
  'hand',
  'discard',
  'lostZone',
  'board',
] as const;

export type CardZoneMoveDestination =
  (typeof CARD_ZONE_MOVE_DESTINATIONS)[number];

export const isCardZoneMoveDestination = (
  value: unknown
): value is CardZoneMoveDestination =>
  typeof value === 'string' &&
  (CARD_ZONE_MOVE_DESTINATIONS as readonly string[]).includes(value);

export type CardZoneMoveResolution =
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
  reason: Exclude<CardZoneMoveResolution, { ok: true }>['reason']
): CardZoneMoveResolution => ({ ok: false, reason });

/** Resolves one selected card into its current board-side destination zone. */
export const resolveCardZoneMoveAction = (
  view: MatchViewState,
  cardId: ViewCardId,
  destination: CardZoneMoveDestination
): CardZoneMoveResolution => {
  if (view.viewer.kind !== 'player') return rejected('not_player');
  const located = locateViewCardActionSource(view, cardId);
  if (!located) return rejected('stale_card');
  if (located.isLowerEvolution) return rejected('unsupported_source');
  if (
    (located.sourceKind === 'inspection' || located.sourceKind === 'staged') &&
    located.sourcePlayerId !== view.viewer.playerId
  ) {
    return rejected('unsupported_source');
  }
  const destinationZone = Object.values(view.zones).find(
    (zone) =>
      zone.kind === destination && zone.ownerId === located.sourcePlayerId
  );
  if (!destinationZone) return rejected('unsupported_target');
  if (located.sourceId === destinationZone.id) return rejected('no_op');

  switch (located.sourceKind) {
    case 'zone':
      return {
        ok: true,
        command: {
          type: 'MoveCard',
          cardId: located.card.id,
          expectedSourceZoneId: located.sourceId,
          destinationZoneId: destinationZone.id,
        },
      };
    case 'stack':
      return {
        ok: true,
        command: {
          type: 'MoveCardFromStack',
          cardId: located.card.id,
          expectedStackId: located.sourceId,
          destinationZoneId: destinationZone.id,
        },
      };
    case 'inspection':
      return {
        ok: true,
        command: {
          type: 'MoveInspectedCard',
          cardId: located.card.id,
          expectedWorkAreaId: located.sourceId,
          destinationZoneId: destinationZone.id,
        },
      };
    case 'staged':
      return {
        ok: true,
        command: {
          type: 'MoveStagedCard',
          cardId: located.card.id,
          expectedWorkAreaId: located.sourceId,
          destinationZoneId: destinationZone.id,
        },
      };
  }
};
