import type {
  CardInstanceId,
  PlayerId,
  StackId,
  WorkAreaId,
  ZoneId,
} from './ids.js';
import type {
  CardFace,
  CardInstance,
  CardLocation,
  MatchState,
} from './model.js';

export interface CardSourceSnapshot {
  readonly id: ZoneId | StackId | WorkAreaId;
  readonly playerId: PlayerId;
  readonly cardIds: readonly CardInstanceId[];
  readonly kind: 'zone' | 'stack' | 'inspection' | 'attachmentResolution';
  readonly zoneKind?: MatchState['zones'][string]['kind'];
}

/** Returns the exact ordered container used by stale-safe per-card actions. */
export const cardSourceSnapshot = (
  state: MatchState,
  card: CardInstance,
  location: CardLocation
): CardSourceSnapshot | null => {
  switch (location.kind) {
    case 'zone': {
      const zone = state.zones[location.zoneId];
      if (!zone) return null;
      return {
        id: zone.id,
        playerId: zone.ownerId ?? card.ownerId,
        cardIds: [...zone.cardIds],
        kind: 'zone',
        zoneKind: zone.kind,
      };
    }
    case 'stackEvolution':
    case 'stackAttachment': {
      const stack = state.stacks[location.stackId];
      if (!stack) return null;
      return {
        id: stack.id,
        playerId: stack.boardPlayerId,
        cardIds: [...stack.evolutionCardIds, ...stack.attachmentCardIds],
        kind: 'stack',
      };
    }
    case 'inspectionWorkArea': {
      const inspection = state.workAreas[location.playerId]?.inspection;
      if (!inspection) return null;
      return {
        id: inspection.id,
        playerId: location.playerId,
        cardIds: [...inspection.cardIds],
        kind: 'inspection',
      };
    }
    case 'attachmentResolutionWorkArea': {
      const resolution =
        state.workAreas[location.playerId]?.attachmentResolution;
      if (!resolution) return null;
      return {
        id: resolution.id,
        playerId: location.playerId,
        cardIds: [
          ...resolution.evolutionCardIds,
          ...resolution.attachmentCardIds,
        ],
        kind: 'attachmentResolution',
      };
    }
  }
};

/** Legacy prize/hand concealment keeps canonical cards face-up; other hides turn down. */
export const publicVisibilityFace = (
  source: CardSourceSnapshot,
  revealed: boolean
): CardFace =>
  revealed || source.zoneKind === 'hand' || source.zoneKind === 'prizes'
    ? 'up'
    : 'down';
