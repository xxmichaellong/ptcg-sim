import type {
  CardDefinitionId,
  CardInstanceId,
  InspectionId,
  PlayerId,
  StackId,
  WorkAreaId,
  ZoneId,
} from './ids.js';
import type {
  CardCategory,
  CardDefinition,
  CardFace,
  PlaySlot,
  QuarterTurns,
  SpecialCondition,
} from './model.js';

export interface DeckEntry {
  readonly definition: CardDefinition;
  readonly count: number;
}

export type GameCommand =
  | {
      readonly type: 'LoadDeck';
      readonly playerId: PlayerId;
      readonly entries: readonly DeckEntry[];
    }
  | { readonly type: 'ResetPlayer'; readonly playerId: PlayerId }
  | { readonly type: 'SetupPlayer'; readonly playerId: PlayerId }
  | {
      readonly type: 'MoveCard';
      readonly cardId: CardInstanceId;
      readonly expectedSourceZoneId: ZoneId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex?: number;
    }
  | {
      readonly type: 'MoveCardToPlay';
      readonly cardId: CardInstanceId;
      readonly expectedSourceZoneId: ZoneId;
      readonly boardPlayerId: PlayerId;
      readonly slot: PlaySlot;
      readonly targetStackId?: StackId;
      readonly benchIndex?: number;
    }
  | {
      readonly type: 'MoveCardFromStack';
      readonly cardId: CardInstanceId;
      readonly expectedStackId: StackId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex?: number;
    }
  | {
      readonly type: 'MoveInspectedCard';
      readonly cardId: CardInstanceId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex?: number;
    }
  | {
      readonly type: 'ShuffleZone';
      readonly zoneId: ZoneId;
    }
  | {
      readonly type: 'DrawCards';
      readonly playerId: PlayerId;
      readonly count: number;
    }
  | {
      readonly type: 'MoveZoneContents';
      readonly sourceZoneId: ZoneId;
      readonly destinationZoneId: ZoneId;
    }
  | {
      readonly type: 'ShuffleZoneIntoDeck';
      readonly playerId: PlayerId;
      readonly sourceZoneId: ZoneId;
    }
  | {
      readonly type: 'ShuffleZoneToDeckBottom';
      readonly playerId: PlayerId;
      readonly sourceZoneId: ZoneId;
    }
  | {
      readonly type: 'DiscardHandAndDraw';
      readonly playerId: PlayerId;
      readonly count: number;
    }
  | {
      readonly type: 'ShuffleHandIntoDeckAndDraw';
      readonly playerId: PlayerId;
      readonly count: number;
    }
  | {
      readonly type: 'ShuffleHandToDeckBottomAndDraw';
      readonly playerId: PlayerId;
      readonly count: number;
    }
  | {
      readonly type: 'SetDamage';
      readonly stackId: StackId;
      readonly damage: number | null;
    }
  | {
      readonly type: 'SetSpecialCondition';
      readonly stackId: StackId;
      readonly condition: SpecialCondition | null;
    }
  | {
      readonly type: 'SetAbilityUsed';
      readonly stackId: StackId;
      readonly used: boolean;
    }
  | {
      readonly type: 'RotateStack';
      readonly stackId: StackId;
      readonly rotationQuarterTurns: QuarterTurns;
    }
  | {
      readonly type: 'SetCardFace';
      readonly cardId: CardInstanceId;
      readonly face: CardFace;
    }
  | {
      readonly type: 'SetCardCategory';
      readonly cardId: CardInstanceId;
      readonly category: CardCategory;
    }
  | {
      readonly type: 'SetPublicReveal';
      readonly cardId: CardInstanceId;
      readonly revealed: boolean;
    }
  | {
      readonly type: 'ExtractDeckCardsForInspection';
      readonly playerId: PlayerId;
      readonly viewerIds: readonly PlayerId[];
      readonly count: number;
      readonly edge: 'top' | 'bottom';
    }
  | {
      readonly type: 'CloseInspection';
      readonly playerId: PlayerId;
      readonly inspectionId: InspectionId;
      readonly returnTo: 'top' | 'bottom';
    }
  | {
      readonly type: 'SetOncePerGameMarker';
      readonly playerId: PlayerId;
      readonly marker: 'gx' | 'vstar';
      readonly used: boolean;
    }
  | { readonly type: 'FlipCoin' };

export type CommandRejectionCode =
  | 'invalid_command'
  | 'not_found'
  | 'stale_reference'
  | 'precondition_failed'
  | 'conflict';

export interface CommandRejection {
  readonly accepted: false;
  readonly code: CommandRejectionCode;
  readonly message: string;
}

export interface CommandContext {
  readonly nextCardId: (
    definitionId: CardDefinitionId,
    copyIndex: number
  ) => CardInstanceId;
  readonly nextStackId: () => StackId;
  readonly nextInspectionId: () => InspectionId;
  readonly shuffle: <Value>(values: readonly Value[]) => readonly Value[];
  readonly randomInt: (exclusiveMaximum: number) => number;
}
