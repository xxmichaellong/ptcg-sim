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
  MatchState,
} from './model.js';

export interface DeckEntry {
  readonly definition: CardDefinition;
  readonly count: number;
}

export type WorkAreaCardsDestination =
  'discard' | 'lostZone' | 'hand' | 'shuffleIntoDeck' | 'shuffleToDeckBottom';

export type StagedCardsDestination = WorkAreaCardsDestination;

export type LooseBoardCardsDestination = Exclude<
  WorkAreaCardsDestination,
  'shuffleToDeckBottom'
>;

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
      readonly type: 'MovePlayStack';
      readonly stackId: StackId;
      readonly expectedSourceSlot: PlaySlot;
      readonly expectedActiveStackId: StackId | null;
      readonly expectedBenchStackIds: readonly StackId[];
      readonly destinationSlot: PlaySlot;
      readonly targetStackId?: StackId;
    }
  | {
      readonly type: 'MoveInspectedCard';
      readonly cardId: CardInstanceId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex?: number;
    }
  | {
      readonly type: 'MoveStagedCard';
      readonly cardId: CardInstanceId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex?: number;
    }
  | {
      readonly type: 'RestoreStagedStack';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly expectedActiveStackId: StackId | null;
      readonly expectedBenchStackIds: readonly StackId[];
      readonly destinationSlot: PlaySlot;
      readonly benchIndex?: number;
    }
  | {
      readonly type: 'ResolveStagedCards';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly destination: StagedCardsDestination;
    }
  | {
      readonly type: 'ResolveInspectionCards';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly destination: WorkAreaCardsDestination;
    }
  | {
      readonly type: 'MoveCardToDeckTop';
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
    }
  | {
      readonly type: 'MoveCardToDeckBottom';
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
    }
  | {
      readonly type: 'ShuffleCardIntoDeck';
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
    }
  | {
      readonly type: 'SwapCardWithDeckTop';
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
    }
  | { readonly type: 'MovePrizesToDeckBottom'; readonly playerId: PlayerId }
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
      readonly type: 'PlayRandomCardFaceDown';
      readonly actorPlayerId: PlayerId;
      readonly targetPlayerId: PlayerId;
    }
  | { readonly type: 'StartTurn'; readonly playerId: PlayerId }
  | { readonly type: 'DeclareAttack'; readonly playerId: PlayerId }
  | { readonly type: 'PassTurn'; readonly playerId: PlayerId }
  | {
      readonly type: 'MoveZoneContents';
      readonly sourceZoneId: ZoneId;
      readonly destinationZoneId: ZoneId;
    }
  | {
      readonly type: 'ResolveLooseBoardCards';
      readonly playerId: PlayerId;
      readonly expectedBoardCardIds: readonly CardInstanceId[];
      readonly destination: LooseBoardCardsDestination;
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
      readonly type: 'SetCardOrientation';
      readonly cardId: CardInstanceId;
      readonly orientationQuarterTurns: QuarterTurns;
    }
  | {
      readonly type: 'SetCardAbilityUsed';
      readonly cardId: CardInstanceId;
      readonly used: boolean;
    }
  | {
      readonly type: 'ChangeCardCategory';
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
      readonly category: Exclude<CardCategory, 'Unknown'>;
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
      readonly actorPlayerId: PlayerId;
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
      readonly revealed: boolean;
    }
  | {
      readonly type: 'SetZonePublicReveal';
      readonly actorPlayerId: PlayerId;
      readonly playerId: PlayerId;
      readonly zoneId: ZoneId;
      readonly expectedCardIds: readonly CardInstanceId[];
      readonly revealed: boolean;
    }
  | {
      readonly type: 'BeginZoneInspection';
      readonly sourcePlayerId: PlayerId;
      readonly viewerPlayerId: PlayerId;
      readonly sourceZoneId: ZoneId;
      readonly expectedCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'BeginCardInspection';
      readonly playerId: PlayerId;
      readonly viewerPlayerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
    }
  | {
      readonly type: 'EndPrivateInspection';
      readonly viewerPlayerId: PlayerId;
      readonly inspectionId: InspectionId;
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
  | {
      readonly type: 'ApplySoloUndo';
      readonly actorPlayerId: PlayerId;
      readonly targetPlayerId: PlayerId;
      readonly revertedCommandId: string;
      readonly revertedRevision: number;
      readonly checkpoint: MatchState;
    }
  | { readonly type: 'FlipCoin'; readonly playerId: PlayerId };

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
  readonly nextWorkAreaId: () => WorkAreaId;
  readonly shuffle: <Value>(values: readonly Value[]) => readonly Value[];
  readonly randomInt: (exclusiveMaximum: number) => number;
}
