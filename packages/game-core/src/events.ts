import type {
  CardInstanceId,
  InspectionId,
  PlayerId,
  StackId,
  WorkAreaId,
  ZoneId,
} from './ids.js';
import type {
  CardDefinition,
  CardFace,
  CardInstance,
  PlaySlot,
  QuarterTurns,
  SpecialCondition,
} from './model.js';

export type DomainEvent =
  | {
      readonly type: 'DeckLoaded';
      readonly playerId: PlayerId;
      readonly definitions: readonly CardDefinition[];
      readonly cards: readonly CardInstance[];
      readonly deckOrder: readonly CardInstanceId[];
    }
  | {
      readonly type: 'PlayerReset';
      readonly playerId: PlayerId;
      readonly deckOrder: readonly CardInstanceId[];
    }
  | {
      readonly type: 'PlayerSetup';
      readonly playerId: PlayerId;
      readonly deckOrder: readonly CardInstanceId[];
      readonly handOrder: readonly CardInstanceId[];
      readonly prizeOrder: readonly CardInstanceId[];
    }
  | {
      readonly type: 'CardMoved';
      readonly cardId: CardInstanceId;
      readonly expectedSourceZoneId: ZoneId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex: number;
      readonly concealIdentity: boolean;
    }
  | {
      readonly type: 'CardsDrawn';
      readonly playerId: PlayerId;
      readonly cardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'ZoneShuffled';
      readonly zoneId: ZoneId;
      readonly cardOrder: readonly CardInstanceId[];
      readonly concealedCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'CardMovedToPlay';
      readonly cardId: CardInstanceId;
      readonly expectedSourceZoneId: ZoneId;
      readonly boardPlayerId: PlayerId;
      readonly slot: PlaySlot;
      readonly mode: 'newStack' | 'evolution' | 'attachment';
      readonly stackId: StackId;
      readonly benchIndex: number;
      readonly previousActiveToBench: boolean;
    }
  | {
      readonly type: 'StackDamageSet';
      readonly stackId: StackId;
      readonly damage: number | null;
    }
  | {
      readonly type: 'StackConditionSet';
      readonly stackId: StackId;
      readonly condition: SpecialCondition | null;
    }
  | {
      readonly type: 'StackAbilitySet';
      readonly stackId: StackId;
      readonly used: boolean;
    }
  | {
      readonly type: 'StackRotationSet';
      readonly stackId: StackId;
      readonly rotationQuarterTurns: QuarterTurns;
    }
  | {
      readonly type: 'CardFaceSet';
      readonly cardId: CardInstanceId;
      readonly face: CardFace;
      readonly concealIdentity: boolean;
    }
  | {
      readonly type: 'CardCategorySet';
      readonly cardId: CardInstanceId;
      readonly category: CardInstance['currentCategory'];
    }
  | {
      readonly type: 'PublicRevealSet';
      readonly cardId: CardInstanceId;
      readonly revealed: boolean;
    }
  | {
      readonly type: 'InspectionOpened';
      readonly playerId: PlayerId;
      readonly workAreaId: WorkAreaId;
      readonly inspectionId: InspectionId;
      readonly sourceZoneId: ZoneId;
      readonly cardIds: readonly CardInstanceId[];
      readonly viewerIds: readonly PlayerId[];
    }
  | {
      readonly type: 'InspectionClosed';
      readonly playerId: PlayerId;
      readonly inspectionId: InspectionId;
      readonly destinationZoneId: ZoneId;
      readonly cardOrder: readonly CardInstanceId[];
      readonly concealIdentity: boolean;
    }
  | {
      readonly type: 'OncePerGameMarkerSet';
      readonly playerId: PlayerId;
      readonly marker: 'gx' | 'vstar';
      readonly used: boolean;
    }
  | { readonly type: 'CoinFlipped'; readonly result: 'heads' | 'tails' };

export interface EventBatch {
  readonly revision: number;
  readonly events: readonly DomainEvent[];
}
