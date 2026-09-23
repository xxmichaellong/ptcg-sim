import { playerZoneId } from './create-match.js';
import type { CardInstanceId, PlayerId } from './ids.js';
import type { MatchState } from './model.js';

export interface PlayerResetAnalysis {
  readonly ownedCardIds: ReadonlySet<CardInstanceId>;
  readonly foreignSurfaceCardIds: readonly CardInstanceId[];
  readonly orphanedCardIds: readonly CardInstanceId[];
  readonly removedCardIds: ReadonlySet<CardInstanceId>;
  readonly returnedCardIds: readonly CardInstanceId[];
}

const appendUnique = (
  destination: CardInstanceId[],
  seen: Set<CardInstanceId>,
  cardIds: readonly CardInstanceId[]
): void => {
  for (const cardId of cardIds) {
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    destination.push(cardId);
  }
};

/**
 * Resolves every cross-owned card affected by a seat reset before mutation.
 * The ordering is stable: owned zones, active/bench stacks, then work areas.
 */
export const analyzePlayerReset = (
  state: MatchState,
  playerId: PlayerId
): PlayerResetAnalysis => {
  const ownedCardIds = new Set(
    Object.values(state.cards)
      .filter((card) => card.ownerId === playerId)
      .map((card) => card.id)
  );
  const foreignSurfaceCardIds: CardInstanceId[] = [];
  const seenForeign = new Set<CardInstanceId>();
  for (const zone of Object.values(state.zones)) {
    if (zone.ownerId !== playerId) continue;
    appendUnique(
      foreignSurfaceCardIds,
      seenForeign,
      zone.cardIds.filter((cardId) => !ownedCardIds.has(cardId))
    );
  }
  const board = state.boards[playerId];
  const stackIds = board
    ? [
        ...(board.activeStackId ? [board.activeStackId] : []),
        ...board.benchStackIds,
      ]
    : [];
  for (const stackId of stackIds) {
    const stack = state.stacks[stackId];
    if (!stack) continue;
    appendUnique(
      foreignSurfaceCardIds,
      seenForeign,
      [...stack.evolutionCardIds, ...stack.attachmentCardIds].filter(
        (cardId) => !ownedCardIds.has(cardId)
      )
    );
  }
  const workAreas = state.workAreas[playerId];
  appendUnique(
    foreignSurfaceCardIds,
    seenForeign,
    (workAreas?.inspection?.cardIds ?? []).filter(
      (cardId) => !ownedCardIds.has(cardId)
    )
  );
  appendUnique(
    foreignSurfaceCardIds,
    seenForeign,
    [
      ...(workAreas?.attachmentResolution?.evolutionCardIds ?? []),
      ...(workAreas?.attachmentResolution?.attachmentCardIds ?? []),
    ].filter((cardId) => !ownedCardIds.has(cardId))
  );

  const removedCardIds = new Set([...ownedCardIds, ...foreignSurfaceCardIds]);
  const orphanedCardIds: CardInstanceId[] = [];
  const seenOrphans = new Set<CardInstanceId>();
  for (const stack of Object.values(state.stacks)) {
    if (stack.evolutionCardIds.some((cardId) => !removedCardIds.has(cardId))) {
      continue;
    }
    appendUnique(
      orphanedCardIds,
      seenOrphans,
      stack.attachmentCardIds.filter((cardId) => !removedCardIds.has(cardId))
    );
  }
  const returnedCardIds = [...foreignSurfaceCardIds, ...orphanedCardIds];
  return {
    ownedCardIds,
    foreignSurfaceCardIds,
    orphanedCardIds,
    removedCardIds,
    returnedCardIds,
  };
};

export const resetReturnCapacityIsValid = (
  state: MatchState,
  analysis: PlayerResetAnalysis
): boolean => {
  const returnedByOwner = new Map<PlayerId, number>();
  for (const cardId of analysis.returnedCardIds) {
    const ownerId = state.cards[cardId]?.ownerId;
    if (!ownerId) return false;
    returnedByOwner.set(ownerId, (returnedByOwner.get(ownerId) ?? 0) + 1);
  }
  for (const [ownerId, returnedCount] of returnedByOwner) {
    const discard = state.zones[playerZoneId(ownerId, 'discard')];
    if (!discard) return false;
    const retainedCount = discard.cardIds.filter(
      (cardId) => !analysis.removedCardIds.has(cardId)
    ).length;
    if (retainedCount + returnedCount > 200) return false;
  }
  return true;
};
