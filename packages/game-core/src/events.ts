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
import type {
  LooseBoardCardsDestination,
  WorkAreaCardsDestination,
} from './commands.js';

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
      readonly type: 'AbilityMarkersReset';
      readonly stackIds: readonly StackId[];
      readonly cardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'InPlayCardsRevealed';
      readonly cardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'TurnAdvanced';
      readonly playerId: PlayerId;
      readonly expectedTurnNumber: number;
      readonly expectedCurrentPlayerId: PlayerId | null;
      readonly turnNumber: number;
    }
  | {
      readonly type: 'TableActionDeclared';
      readonly action: 'startTurn' | 'attack' | 'pass';
      readonly playerId: PlayerId;
      readonly outcome: 'drawn' | 'emptyDeck' | 'declared';
      readonly turnNumber: number;
    }
  | {
      readonly type: 'ZoneShuffled';
      readonly zoneId: ZoneId;
      readonly cardOrder: readonly CardInstanceId[];
      readonly concealedCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'ZoneOrdersSet';
      readonly reason:
        | 'move-zone-contents'
        | 'move-card-to-deck-top'
        | 'move-card-to-deck-bottom'
        | 'move-prizes-to-deck-bottom'
        | 'shuffle-zone-into-deck'
        | 'shuffle-zone-to-deck-bottom'
        | 'discard-hand-and-draw'
        | 'shuffle-hand-into-deck-and-draw'
        | 'shuffle-hand-to-deck-bottom-and-draw';
      readonly zones: readonly {
        readonly zoneId: ZoneId;
        readonly expectedCardIds: readonly CardInstanceId[];
        readonly cardIds: readonly CardInstanceId[];
      }[];
      readonly concealedCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'LooseBoardCardsResolved';
      readonly playerId: PlayerId;
      readonly destination: LooseBoardCardsDestination;
      readonly boardZoneId: ZoneId;
      readonly destinationZoneId: ZoneId;
      readonly expectedBoardCardIds: readonly CardInstanceId[];
      readonly expectedDestinationCardIds: readonly CardInstanceId[];
      readonly destinationCardIds: readonly CardInstanceId[];
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
      readonly type: 'CardMovedFromStack';
      readonly cardId: CardInstanceId;
      readonly expectedStackId: StackId;
      readonly source: 'attachment';
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex: number;
      readonly concealIdentity: boolean;
    }
  | {
      readonly type: 'PlayStackDeparted';
      readonly cardId: CardInstanceId;
      readonly expectedStackId: StackId;
      readonly boardPlayerId: PlayerId;
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex: number;
      readonly concealIdentity: boolean;
      readonly attachmentResolution: {
        readonly id: WorkAreaId;
        readonly evolutionCardIds: readonly CardInstanceId[];
        readonly attachmentCardIds: readonly CardInstanceId[];
        readonly suggestedSlot: PlaySlot;
      } | null;
    }
  | {
      readonly type: 'PlayStackLayoutSet';
      readonly boardPlayerId: PlayerId;
      readonly expectedActiveStackId: StackId | null;
      readonly expectedBenchStackIds: readonly StackId[];
      readonly activeStackId: StackId | null;
      readonly benchStackIds: readonly StackId[];
    }
  | {
      readonly type: 'InspectedCardMoved';
      readonly playerId: PlayerId;
      readonly inspectionId: InspectionId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly cardId: CardInstanceId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex: number;
      readonly concealIdentity: boolean;
    }
  | {
      readonly type: 'StagedCardMoved';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly source: 'evolution' | 'attachment';
      readonly cardId: CardInstanceId;
      readonly destinationZoneId: ZoneId;
      readonly destinationIndex: number;
      readonly concealIdentity: boolean;
    }
  | {
      readonly type: 'StagedStackRestored';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly expectedActiveStackId: StackId | null;
      readonly expectedBenchStackIds: readonly StackId[];
      readonly stackId: StackId;
      readonly destinationSlot: PlaySlot;
      readonly benchIndex: number;
    }
  | {
      readonly type: 'StagedCardsResolved';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly destination: WorkAreaCardsDestination;
      readonly destinationZoneId: ZoneId;
      readonly expectedDestinationCardIds: readonly CardInstanceId[];
      readonly destinationCardIds: readonly CardInstanceId[];
      readonly concealedCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'InspectionCardsResolved';
      readonly playerId: PlayerId;
      readonly inspectionId: InspectionId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly expectedCardIds: readonly CardInstanceId[];
      readonly destination: WorkAreaCardsDestination;
      readonly destinationZoneId: ZoneId;
      readonly expectedDestinationCardIds: readonly CardInstanceId[];
      readonly destinationCardIds: readonly CardInstanceId[];
      readonly concealedCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'InspectionCardSwappedWithDeckTop';
      readonly playerId: PlayerId;
      readonly inspectionId: InspectionId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly cardId: CardInstanceId;
      readonly deckTopCardId: CardInstanceId;
      readonly expectedInspectionCardIds: readonly CardInstanceId[];
      readonly expectedDeckCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'StagedCardSwappedWithDeckTop';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly source: 'evolution' | 'attachment';
      readonly cardId: CardInstanceId;
      readonly deckTopCardId: CardInstanceId;
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly expectedDeckCardIds: readonly CardInstanceId[];
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
      readonly type: 'CardOrientationSet';
      readonly cardId: CardInstanceId;
      readonly orientationQuarterTurns: QuarterTurns;
    }
  | {
      readonly type: 'CardAbilitySet';
      readonly cardId: CardInstanceId;
      readonly used: boolean;
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
      readonly playerId: PlayerId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
      readonly expectedSourceCardIds: readonly CardInstanceId[];
      readonly cardIds: readonly CardInstanceId[];
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
