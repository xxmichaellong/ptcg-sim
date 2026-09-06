import type { MatchViewState, ViewCard, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

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

type ViewZone = MatchViewState['zones'][string];
type ViewStack = MatchViewState['stacks'][string];

interface LocatedCard {
  readonly card: ViewCard;
  readonly zone?: ViewZone;
  readonly stack?: ViewStack;
  readonly sourceId: string;
  readonly sourcePlayerId: string;
  readonly sourceKind: 'zone' | 'stack' | 'inspection' | 'staged';
  readonly isLowerEvolution: boolean;
}

const locateCard = (
  view: MatchViewState,
  cardId: ViewCardId
): LocatedCard | null => {
  for (const zone of Object.values(view.zones)) {
    const card = zone.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return {
        card,
        zone,
        sourceId: zone.id,
        sourcePlayerId: zone.ownerId ?? card.ownerId,
        sourceKind: 'zone',
        isLowerEvolution: false,
      };
    }
  }
  for (const stack of Object.values(view.stacks)) {
    const evolutionIndex = stack.evolutionCards.findIndex(
      (candidate) => candidate.id === cardId
    );
    if (evolutionIndex >= 0) {
      return {
        card: stack.evolutionCards[evolutionIndex]!,
        stack,
        sourceId: stack.id,
        sourcePlayerId: stack.boardPlayerId,
        sourceKind: 'stack',
        isLowerEvolution: evolutionIndex < stack.evolutionCards.length - 1,
      };
    }
    const attachment = stack.attachmentCards.find(
      (candidate) => candidate.id === cardId
    );
    if (attachment) {
      return {
        card: attachment,
        stack,
        sourceId: stack.id,
        sourcePlayerId: stack.boardPlayerId,
        sourceKind: 'stack',
        isLowerEvolution: false,
      };
    }
  }
  for (const [playerId, areas] of Object.entries(view.workAreas)) {
    const inspection = areas.inspection;
    const inspected = inspection?.cards.find(
      (candidate) => candidate.id === cardId
    );
    if (inspected && inspection) {
      return {
        card: inspected,
        sourceId: inspection.id,
        sourcePlayerId: playerId,
        sourceKind: 'inspection',
        isLowerEvolution: false,
      };
    }
    const staged = areas.attachmentResolution;
    const stagedCard = staged
      ? [...staged.evolutionCards, ...staged.attachmentCards].find(
          (candidate) => candidate.id === cardId
        )
      : undefined;
    if (stagedCard && staged) {
      return {
        card: stagedCard,
        sourceId: staged.id,
        sourcePlayerId: playerId,
        sourceKind: 'staged',
        isLowerEvolution: false,
      };
    }
  }
  return null;
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
  const located = locateCard(view, cardId);
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
