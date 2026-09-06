import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';

export interface LocatedViewCardActionSource {
  readonly card: ViewCard;
  readonly sourceId: string;
  readonly sourcePlayerId: string;
  readonly sourceKind: 'zone' | 'stack' | 'inspection' | 'staged';
  readonly sourceIndex: number;
  readonly isLowerEvolution: boolean;
}

/** Locates a recipient-visible card and classifies its stale-safe command source. */
export const locateViewCardActionSource = (
  view: MatchViewState,
  cardId: string
): LocatedViewCardActionSource | null => {
  for (const zone of Object.values(view.zones)) {
    const sourceIndex = zone.cards.findIndex((card) => card.id === cardId);
    if (sourceIndex >= 0) {
      const card = zone.cards[sourceIndex]!;
      return {
        card,
        sourceId: zone.id,
        sourcePlayerId: zone.ownerId ?? card.ownerId,
        sourceKind: 'zone',
        sourceIndex,
        isLowerEvolution: false,
      };
    }
  }
  for (const stack of Object.values(view.stacks)) {
    const evolutionIndex = stack.evolutionCards.findIndex(
      (card) => card.id === cardId
    );
    if (evolutionIndex >= 0) {
      return {
        card: stack.evolutionCards[evolutionIndex]!,
        sourceId: stack.id,
        sourcePlayerId: stack.boardPlayerId,
        sourceKind: 'stack',
        sourceIndex: evolutionIndex,
        isLowerEvolution: evolutionIndex < stack.evolutionCards.length - 1,
      };
    }
    const attachmentIndex = stack.attachmentCards.findIndex(
      (card) => card.id === cardId
    );
    if (attachmentIndex >= 0) {
      return {
        card: stack.attachmentCards[attachmentIndex]!,
        sourceId: stack.id,
        sourcePlayerId: stack.boardPlayerId,
        sourceKind: 'stack',
        sourceIndex: attachmentIndex,
        isLowerEvolution: false,
      };
    }
  }
  for (const [playerId, areas] of Object.entries(view.workAreas)) {
    const inspectionIndex =
      areas.inspection?.cards.findIndex((card) => card.id === cardId) ?? -1;
    if (inspectionIndex >= 0 && areas.inspection) {
      return {
        card: areas.inspection.cards[inspectionIndex]!,
        sourceId: areas.inspection.id,
        sourcePlayerId: playerId,
        sourceKind: 'inspection',
        sourceIndex: inspectionIndex,
        isLowerEvolution: false,
      };
    }
    const resolution = areas.attachmentResolution;
    const evolutionIndex =
      resolution?.evolutionCards.findIndex((card) => card.id === cardId) ?? -1;
    if (evolutionIndex >= 0 && resolution) {
      return {
        card: resolution.evolutionCards[evolutionIndex]!,
        sourceId: resolution.id,
        sourcePlayerId: playerId,
        sourceKind: 'staged',
        sourceIndex: evolutionIndex,
        isLowerEvolution: false,
      };
    }
    const attachmentIndex =
      resolution?.attachmentCards.findIndex((card) => card.id === cardId) ?? -1;
    if (attachmentIndex >= 0 && resolution) {
      return {
        card: resolution.attachmentCards[attachmentIndex]!,
        sourceId: resolution.id,
        sourcePlayerId: playerId,
        sourceKind: 'staged',
        sourceIndex: attachmentIndex,
        isLowerEvolution: false,
      };
    }
  }
  return null;
};
