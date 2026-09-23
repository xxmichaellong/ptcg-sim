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
  MatchState,
} from './model.js';
import type {
  LooseBoardCardsDestination,
  WorkAreaCardsDestination,
} from './commands.js';

/**
 * Where a card dragged into a work area came from. A sole evolution takes the
 * whole stack with it; a top evolution that still carries lower stages or
 * attachments takes the stack too and stages those dependents, exactly as v1's
 * `relocateAttachedCards` does for any departure outside active/bench.
 */
export type WorkAreaArrivalSource =
  | { readonly kind: 'zone'; readonly zoneId: ZoneId }
  | { readonly kind: 'stackAttachment'; readonly stackId: StackId }
  | { readonly kind: 'stackLowerEvolution'; readonly stackId: StackId }
  | { readonly kind: 'stackSoleEvolution'; readonly stackId: StackId }
  | {
      readonly kind: 'stackTopWithDependents';
      readonly stackId: StackId;
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      /**
       * The staged window the dependents open, as a stack departure does, or
       * null when the arrival's own target is the staged window they join.
       */
      readonly attachmentResolution: {
        readonly id: WorkAreaId;
        readonly cardIds: readonly CardInstanceId[];
        readonly evolutionCardIds: readonly CardInstanceId[];
        readonly attachmentCardIds: readonly CardInstanceId[];
        readonly suggestedSlot: PlaySlot;
      } | null;
    }
  | { readonly kind: 'inspection'; readonly workAreaId: WorkAreaId }
  | {
      readonly kind: 'attachmentResolution';
      readonly workAreaId: WorkAreaId;
    };

export type DomainEvent =
  | {
      readonly type: 'DeckLoaded';
      readonly playerId: PlayerId;
      readonly definitions: readonly CardDefinition[];
      readonly cards: readonly CardInstance[];
      readonly deckOrder: readonly CardInstanceId[];
    }
  | {
      readonly type: 'PlayerCardBackSet';
      readonly playerId: PlayerId;
      readonly cardBackUrl: string;
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
      readonly type: 'RandomHandCardPlayedFaceDown';
      readonly actorPlayerId: PlayerId;
      readonly targetPlayerId: PlayerId;
      readonly handZoneId: ZoneId;
      readonly boardZoneId: ZoneId;
      readonly expectedHandCardIds: readonly CardInstanceId[];
      readonly expectedBoardCardIds: readonly CardInstanceId[];
      readonly cardId: CardInstanceId;
      readonly destinationIndex: number;
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
      /**
       * Versioned attachment semantics. Older CardMovedToPlay/attachment
       * events retain append-only replay behavior; newly decided attachment
       * moves carry both the exact prior order and v1-computed destination.
       */
      readonly type: 'CardAttachedToPlayStack';
      readonly cardId: CardInstanceId;
      readonly expectedSourceZoneId: ZoneId;
      readonly boardPlayerId: PlayerId;
      readonly stackId: StackId;
      readonly attachmentOrderVersion: 1;
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly attachmentCardIds: readonly CardInstanceId[];
    }
  | {
      /** Atomic source departure plus target evolution/attachment. */
      readonly type: 'CardPlacedOnPlayStack';
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
      readonly targetStackId: StackId;
      readonly expectedTargetTopCardId: CardInstanceId;
      readonly expectedTargetEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedTargetAttachmentCardIds: readonly CardInstanceId[];
      readonly mode: 'attachment' | 'evolution';
      readonly attachmentOrderVersion: 1;
      readonly evolutionCardIds: readonly CardInstanceId[];
      readonly attachmentCardIds: readonly CardInstanceId[];
    }
  | {
      readonly type: 'CardMovedFromStack';
      readonly cardId: CardInstanceId;
      readonly expectedStackId: StackId;
      /**
       * `attachment` preserves the original event shape. A lower evolution is
       * distinct from a top departure because its play stack remains intact.
       */
      readonly source: 'attachment' | 'lowerEvolution';
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
        readonly cardIds: readonly CardInstanceId[];
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
      /** A card dragged into an open inspection/attached-card work area. */
      readonly type: 'CardMovedToWorkArea';
      /** The work area's owner, which is also the card's owner. */
      readonly playerId: PlayerId;
      readonly target: 'inspection' | 'attachmentResolution';
      readonly expectedWorkAreaId: WorkAreaId;
      readonly cardId: CardInstanceId;
      readonly source: WorkAreaArrivalSource;
      /** Exact private viewers for an inspection arrival; empty otherwise. */
      readonly viewerIds: readonly PlayerId[];
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
      /**
       * Versioned live-stack restoration semantics. Historical
       * StagedStackRestored events continue to replay their recorded order;
       * newly decided restores carry the exact staged input and v1 result.
       */
      readonly type: 'StagedStackRestoredToPlayStack';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly attachmentOrderVersion: 1;
      readonly attachmentCardIds: readonly CardInstanceId[];
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
      readonly expectedViewerIdsByCardId: Readonly<
        Record<string, readonly PlayerId[]>
      >;
      readonly expectedDeckCardIds: readonly CardInstanceId[];
      readonly returnTo?: 'sourcePosition' | 'sourceTail';
    }
  | {
      readonly type: 'StagedCardSwappedWithDeckTop';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly source: 'evolution' | 'attachment';
      readonly cardId: CardInstanceId;
      readonly deckTopCardId: CardInstanceId;
      readonly expectedCardIds: readonly CardInstanceId[];
      readonly expectedEvolutionCardIds: readonly CardInstanceId[];
      readonly expectedAttachmentCardIds: readonly CardInstanceId[];
      readonly expectedDeckCardIds: readonly CardInstanceId[];
      readonly returnedCardIds: readonly CardInstanceId[];
      readonly returnTo?: 'sourcePosition' | 'legacyFlatTailV1';
      readonly returnedEvolutionCardIds?: readonly CardInstanceId[];
      readonly returnedAttachmentCardIds?: readonly CardInstanceId[];
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
      readonly actorPlayerId: PlayerId;
      readonly playerId: PlayerId;
      readonly scope: 'card' | 'zone';
      readonly expectedSourceId: ZoneId | StackId | WorkAreaId;
      readonly expectedSourceCardIds: readonly CardInstanceId[];
      readonly cardIds: readonly CardInstanceId[];
      readonly revealed: boolean;
    }
  | {
      readonly type: 'InspectionGrantOpened';
      readonly scope: 'card' | 'zone';
      readonly inspectionId: InspectionId;
      readonly sourcePlayerId: PlayerId;
      readonly sourceId: ZoneId | StackId | WorkAreaId;
      readonly expectedSourceCardIds: readonly CardInstanceId[];
      readonly cardIds: readonly CardInstanceId[];
      readonly viewerIds: readonly PlayerId[];
    }
  | {
      readonly type: 'InspectionGrantClosed';
      readonly scope: 'card' | 'zone';
      readonly inspectionId: InspectionId;
      readonly sourcePlayerId: PlayerId;
      readonly sourceId: ZoneId | StackId | WorkAreaId;
      readonly expectedCardIds: readonly CardInstanceId[];
      readonly expectedViewerIds: readonly PlayerId[];
      readonly viewerId: PlayerId;
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
      readonly type: 'InspectionExtended';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly inspectionId: InspectionId;
      readonly sourceZoneId: ZoneId;
      readonly expectedCardIds: readonly CardInstanceId[];
      readonly cardIds: readonly CardInstanceId[];
      readonly expectedViewerIdsByCardId: Readonly<
        Record<string, readonly PlayerId[]>
      >;
      readonly viewerIds: readonly PlayerId[];
    }
  | {
      readonly type: 'InspectionVisibilityCleared';
      readonly playerId: PlayerId;
      readonly expectedWorkAreaId: WorkAreaId;
      readonly inspectionId: InspectionId;
      readonly expectedCardIds: readonly CardInstanceId[];
      readonly expectedViewerIdsByCardId: Readonly<
        Record<string, readonly PlayerId[]>
      >;
      readonly replacementViewerIds: readonly PlayerId[];
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
      readonly type: 'CoachingConsentSet';
      readonly playerId: PlayerId;
      readonly expectedConsent: boolean;
      readonly consent: boolean;
      readonly revokedInspections: readonly {
        readonly inspectionId: InspectionId;
        readonly scope: 'card' | 'zone';
        readonly sourcePlayerId: PlayerId;
        readonly sourceId: ZoneId | StackId | WorkAreaId;
        readonly viewerPlayerId: PlayerId;
        readonly cardCount: number;
      }[];
    }
  | {
      readonly type: 'OncePerGameMarkerSet';
      readonly playerId: PlayerId;
      readonly marker: 'gx' | 'vstar';
      readonly used: boolean;
    }
  | {
      readonly type: 'UndoApplied';
      readonly actorPlayerId: PlayerId;
      readonly targetPlayerId: PlayerId;
      readonly revertedCommandId: string;
      readonly revertedRevision: number;
      readonly fromRevision: number;
      readonly checkpointRevision: number;
      readonly checkpointHash: string;
      readonly restoredState: MatchState;
    }
  | {
      readonly type: 'CoinFlipped';
      readonly playerId: PlayerId;
      readonly result: 'heads' | 'tails';
    };

export interface EventBatch {
  readonly revision: number;
  readonly events: readonly DomainEvent[];
  /**
   * The seat whose command produced this batch, when it was a player's
   * command. Recorded so the battle log can name who acted -- v1 names the
   * initiator even when it was the opponent moving your cards -- and absent
   * on batches written before it was recorded or produced by the room itself.
   */
  readonly actorPlayerId?: PlayerId;
}
