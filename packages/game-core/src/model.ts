import type {
  CardDefinitionId,
  CardInstanceId,
  InspectionId,
  MatchId,
  PlayerId,
  StackId,
  WorkAreaId,
  ZoneId,
} from './ids.js';

export const MATCH_STATE_SCHEMA_VERSION = 1 as const;

export type CardCategory = 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown';
export type CardFace = 'up' | 'down';
export type QuarterTurns = 0 | 1 | 2 | 3;
export type SpecialCondition = string;

export interface CardDefinition {
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly category: CardCategory;
  readonly imageUrl: string;
  readonly imageUrlSmall?: string;
}

export interface CardInstance {
  readonly id: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly ownerId: PlayerId;
  readonly originalCategory: CardCategory;
  readonly currentCategory: CardCategory;
  readonly face: CardFace;
  readonly orientationQuarterTurns: QuarterTurns;
  readonly visibilityGeneration: number;
}

export interface OncePerGameMarkers {
  readonly gxUsed: boolean;
  readonly vstarUsed: boolean;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly cardBackUrl: string;
  readonly coachingConsent: boolean;
  readonly oncePerGame: OncePerGameMarkers;
}

export type PlayerZoneKind =
  'deck' | 'hand' | 'prizes' | 'discard' | 'lostZone' | 'board';
export type ZoneKind = PlayerZoneKind | 'stadium';

export interface CardZone {
  readonly id: ZoneId;
  readonly kind: ZoneKind;
  readonly ownerId: PlayerId | null;
  readonly cardIds: readonly CardInstanceId[];
}

export type PlaySlot = 'active' | 'bench';

export interface PlayStack {
  readonly id: StackId;
  readonly boardPlayerId: PlayerId;
  readonly slot: PlaySlot;
  readonly evolutionCardIds: readonly CardInstanceId[];
  readonly attachmentCardIds: readonly CardInstanceId[];
  readonly rotationQuarterTurns: QuarterTurns;
  readonly damage: number | null;
  readonly specialCondition: SpecialCondition | null;
  readonly abilityUsed: boolean;
}

export interface PlayerBoard {
  readonly activeStackId: StackId | null;
  readonly benchStackIds: readonly StackId[];
}

export interface InspectionWorkArea {
  readonly id: WorkAreaId;
  readonly inspectionId: InspectionId;
  readonly sourceZoneId: ZoneId;
  readonly cardIds: readonly CardInstanceId[];
  readonly viewerIds: readonly PlayerId[];
}

export interface AttachmentResolutionWorkArea {
  readonly id: WorkAreaId;
  readonly sourceStackId: StackId;
  readonly evolutionCardIds: readonly CardInstanceId[];
  readonly attachmentCardIds: readonly CardInstanceId[];
  readonly suggestedSlot: PlaySlot;
}

export interface PlayerWorkAreas {
  readonly inspection: InspectionWorkArea | null;
  readonly attachmentResolution: AttachmentResolutionWorkArea | null;
}

export interface VisibilityGrant {
  readonly inspectionId: InspectionId;
  readonly cardIds: readonly CardInstanceId[];
  readonly viewerIds: readonly PlayerId[];
}

export interface MatchVisibility {
  readonly publicCardIds: readonly CardInstanceId[];
  readonly inspectionGrants: Readonly<Record<string, VisibilityGrant>>;
}

export interface TurnState {
  readonly number: number;
  readonly currentPlayerId: PlayerId | null;
}

export interface MatchState {
  readonly schemaVersion: typeof MATCH_STATE_SCHEMA_VERSION;
  readonly matchId: MatchId;
  readonly revision: number;
  readonly lifecycle: 'lobby' | 'playing' | 'finished';
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly definitions: Readonly<Record<string, CardDefinition>>;
  readonly cards: Readonly<Record<string, CardInstance>>;
  readonly deckLists: Readonly<Record<string, readonly CardInstanceId[]>>;
  readonly zones: Readonly<Record<string, CardZone>>;
  readonly boards: Readonly<Record<string, PlayerBoard>>;
  readonly stacks: Readonly<Record<string, PlayStack>>;
  readonly workAreas: Readonly<Record<string, PlayerWorkAreas>>;
  readonly visibility: MatchVisibility;
  readonly turn: TurnState;
  readonly rngVersion: 1;
}

export type CardLocation =
  | {
      readonly kind: 'zone';
      readonly zoneId: ZoneId;
      readonly index: number;
    }
  | {
      readonly kind: 'stackEvolution';
      readonly stackId: StackId;
      readonly index: number;
    }
  | {
      readonly kind: 'stackAttachment';
      readonly stackId: StackId;
      readonly index: number;
    }
  | {
      readonly kind: 'inspectionWorkArea';
      readonly playerId: PlayerId;
      readonly index: number;
    }
  | {
      readonly kind: 'attachmentResolutionWorkArea';
      readonly playerId: PlayerId;
      readonly source: 'evolution' | 'attachment';
      readonly index: number;
    };

export interface MatchSeatInput {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly cardBackUrl: string;
}
