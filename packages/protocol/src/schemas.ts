import { isCardBackValue } from '@ptcgsim/game-core';
import * as v from 'valibot';
import {
  MAX_CARD_STEPS,
  MAX_CHAT_CODE_UNITS,
  MAX_DECK_CARDS,
  MAX_DECK_ENTRIES,
  MAX_IMAGE_URL_CODE_UNITS,
  MAX_PRESENTATION_EVENTS,
  MAX_REPLAY_FRAMES,
  MAX_ROOM_CODE_LENGTH,
  PROTOCOL_VERSION,
  V2_ROOM_CODE_PATTERN,
} from './constants.js';

const boundedString = (maximum: number, minimum = 1) =>
  v.pipe(v.string(), v.minLength(minimum), v.maxLength(maximum));
const IdentifierSchema = boundedString(128);
const UrlSchema = boundedString(MAX_IMAGE_URL_CODE_UNITS);
/**
 * A card back a player sets: a reference (ADR-041), or a legacy URL as
 * older clients still send. Views keep the plain bound, so replays recorded
 * before references keep reading.
 */
const CardBackSchema = v.pipe(
  UrlSchema,
  v.check((value: string) => isCardBackValue(value), 'Invalid card back')
);
const SafeIntegerSchema = v.pipe(v.number(), v.safeInteger());
const NonNegativeIntegerSchema = v.pipe(SafeIntegerSchema, v.minValue(0));
const PositiveIntegerSchema = v.pipe(SafeIntegerSchema, v.minValue(1));
const RevisionSchema = NonNegativeIntegerSchema;
const CardCategorySchema = v.picklist([
  'Pokémon',
  'Trainer',
  'Energy',
  'Unknown',
] as const);
const QuarterTurnsSchema = v.picklist([0, 1, 2, 3] as const);
const CapabilitySchema = boundedString(512, 32);
const ContinuationSaveIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{22}$/u, 'Invalid continuation save ID')
);
const ContinuationOperationIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{43}$/u, 'Invalid continuation operation ID')
);
const ContinuationCapabilitySchema = v.pipe(
  v.string(),
  v.regex(
    /^ptcgsave\.v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u,
    'Invalid continuation capability'
  )
);
const RoomCodeSchema = v.pipe(
  v.string(),
  v.regex(V2_ROOM_CODE_PATTERN, 'Invalid room code')
);

const RoomModeSchema = v.picklist(['solo', 'multiplayer'] as const);

export const RoomCreationRequestSchema = v.strictObject({
  mode: v.optional(RoomModeSchema, 'multiplayer'),
});

export const RoomCreationResponseSchema = v.variant('mode', [
  v.strictObject({
    mode: v.literal('solo'),
    roomCode: RoomCodeSchema,
    credentials: v.strictObject({
      playerOneSeatCapability: CapabilitySchema,
      spectatorCapability: v.optional(CapabilitySchema),
    }),
  }),
  v.strictObject({
    mode: v.literal('multiplayer'),
    roomCode: RoomCodeSchema,
    credentials: v.strictObject({
      playerOneSeatCapability: CapabilitySchema,
      playerTwoSeatCapability: CapabilitySchema,
      spectatorCapability: v.optional(CapabilitySchema),
    }),
  }),
]);

export const RoomInvitationIssueRequestSchema = v.strictObject({
  capability: CapabilitySchema,
  requestedRole: v.picklist(['player', 'spectator'] as const),
});

export const RoomInvitationIssueResponseSchema = v.strictObject({
  invitation: CapabilitySchema,
  requestedRole: v.picklist(['player', 'spectator'] as const),
  expiresAt: NonNegativeIntegerSchema,
});

export const RoomInvitationHandoffSchema = v.strictObject({
  roomCode: RoomCodeSchema,
  invitation: CapabilitySchema,
  requestedRole: v.picklist(['player', 'spectator'] as const),
  expiresAt: NonNegativeIntegerSchema,
});

export const RoomAdmissionTicketRequestSchema = v.strictObject({
  capability: CapabilitySchema,
  displayName: boundedString(64),
  requestedRole: v.picklist(['player', 'spectator'] as const),
});

export const RoomAdmissionTicketResponseSchema = v.strictObject({
  admissionTicket: CapabilitySchema,
  resumeToken: CapabilitySchema,
  expiresAt: NonNegativeIntegerSchema,
});

export const ContinuationCreationRequestSchema = v.strictObject({
  resumeToken: CapabilitySchema,
  operationId: ContinuationOperationIdSchema,
});

export const ContinuationCreationResponseSchema = v.pipe(
  v.strictObject({
    format: v.literal('ptcgsim-continuation-creation-result-v1'),
    saveId: ContinuationSaveIdSchema,
    operationId: ContinuationOperationIdSchema,
    capability: ContinuationCapabilitySchema,
    createdAt: NonNegativeIntegerSchema,
    expiresAt: NonNegativeIntegerSchema,
  }),
  v.check(
    (value) =>
      value.expiresAt > value.createdAt &&
      value.capability.startsWith(`ptcgsave.v1.${value.saveId}.`),
    'Continuation creation result is inconsistent'
  )
);

/** Small browser/file handoff. Canonical match state remains server-held. */
export const ContinuationHandoffSchema = v.pipe(
  v.strictObject({
    format: v.literal('ptcgsim-continuation-handoff-v1'),
    saveId: ContinuationSaveIdSchema,
    capability: ContinuationCapabilitySchema,
    expiresAt: NonNegativeIntegerSchema,
  }),
  v.check(
    (value) => value.capability.startsWith(`ptcgsave.v1.${value.saveId}.`),
    'Continuation handoff is inconsistent'
  )
);

export const ContinuationRestoreRequestSchema = v.strictObject({
  capability: ContinuationCapabilitySchema,
  operationId: ContinuationOperationIdSchema,
});

export const ContinuationRevocationRequestSchema = v.strictObject({
  capability: ContinuationCapabilitySchema,
});

export const ContinuationRestoreResponseSchema = v.pipe(
  v.strictObject({
    format: v.literal('ptcgsim-continuation-restore-result-v1'),
    saveId: ContinuationSaveIdSchema,
    operationId: ContinuationOperationIdSchema,
    completedAt: NonNegativeIntegerSchema,
    targetRoomCode: RoomCodeSchema,
    requesterSeatCapability: CapabilitySchema,
    opponentInvitation: v.strictObject({
      invitation: CapabilitySchema,
      expiresAt: NonNegativeIntegerSchema,
    }),
  }),
  v.check(
    (value) => value.opponentInvitation.expiresAt > value.completedAt,
    'Continuation restore result is expired'
  )
);

const CardPresentationSchema = v.pipe(
  v.strictObject({
    readingQuarterTurns: v.picklist([0, 1, 2, 3] as const),
    overlay: v.optional(v.literal('upper-half')),
    finish: v.optional(v.picklist(['matte', 'sheen', 'holo', 'rainbow'])),
    foilRegion: v.optional(v.picklist(['artwork', 'full', 'none'])),
    join: v.optional(
      v.strictObject({
        key: v.pipe(
          boundedString(128),
          v.check((key) => key.trim().length > 0)
        ),
        columns: v.picklist([1, 2, 3, 4] as const),
        rows: v.picklist([1, 2, 3, 4] as const),
        part: v.picklist([0, 1, 2, 3] as const),
      })
    ),
  }),
  v.check(
    (value) =>
      !value.join ||
      (!value.overlay &&
        value.join.columns * value.join.rows > 1 &&
        value.join.columns * value.join.rows <= 4 &&
        value.join.part < value.join.columns * value.join.rows)
  )
);

export const SerializedCardDefinitionSchema = v.object({
  id: IdentifierSchema,
  name: boundedString(256),
  category: CardCategorySchema,
  imageUrl: UrlSchema,
  imageUrlSmall: v.optional(UrlSchema),
  presentation: v.optional(CardPresentationSchema),
});

const WireDeckEntrySchema = v.object({
  definition: SerializedCardDefinitionSchema,
  count: v.pipe(PositiveIntegerSchema, v.maxValue(200)),
});

const MoveCardCommandSchema = v.object({
  type: v.literal('MoveCard'),
  cardId: IdentifierSchema,
  expectedSourceZoneId: IdentifierSchema,
  destinationZoneId: IdentifierSchema,
  destinationIndex: v.optional(NonNegativeIntegerSchema),
});

const MoveCardFromStackCommandSchema = v.object({
  type: v.literal('MoveCardFromStack'),
  cardId: IdentifierSchema,
  expectedStackId: IdentifierSchema,
  destinationZoneId: IdentifierSchema,
  destinationIndex: v.optional(NonNegativeIntegerSchema),
});

const MovePlayStackToZoneCommandSchema = v.object({
  type: v.literal('MovePlayStackToZone'),
  stackId: IdentifierSchema,
  // As many as a stack can show (StackViewSchema): a command for any
  // Pokémon on the table must pass, or the room never answers it.
  expectedEvolutionCardIds: v.pipe(
    v.array(IdentifierSchema),
    v.minLength(1),
    v.maxLength(200)
  ),
  expectedAttachmentCardIds: v.pipe(
    v.array(IdentifierSchema),
    v.maxLength(200)
  ),
  destinationZoneId: IdentifierSchema,
  destinationIndex: v.optional(NonNegativeIntegerSchema),
});

const MoveInspectedCardCommandSchema = v.object({
  type: v.literal('MoveInspectedCard'),
  cardId: IdentifierSchema,
  expectedWorkAreaId: IdentifierSchema,
  destinationZoneId: IdentifierSchema,
  destinationIndex: v.optional(NonNegativeIntegerSchema),
});

const MoveStagedCardCommandSchema = v.object({
  type: v.literal('MoveStagedCard'),
  cardId: IdentifierSchema,
  expectedWorkAreaId: IdentifierSchema,
  destinationZoneId: IdentifierSchema,
  destinationIndex: v.optional(NonNegativeIntegerSchema),
});

const MoveCardToPlayCommandSchema = v.object({
  type: v.literal('MoveCardToPlay'),
  cardId: IdentifierSchema,
  expectedSourceZoneId: IdentifierSchema,
  boardPlayerId: IdentifierSchema,
  slot: v.picklist(['active', 'bench'] as const),
  targetStackId: v.optional(IdentifierSchema),
  benchIndex: v.optional(NonNegativeIntegerSchema),
});

const MoveInspectedCardToPlayCommandSchema = v.strictObject({
  // A card being looked at, played straight to Active or the Bench.
  type: v.literal('MoveInspectedCardToPlay'),
  cardId: IdentifierSchema,
  expectedWorkAreaId: IdentifierSchema,
  boardPlayerId: IdentifierSchema,
  slot: v.picklist(['active', 'bench'] as const),
  benchIndex: v.optional(NonNegativeIntegerSchema),
});

const PlaceCardOnPlayStackCommandSchema = v.strictObject({
  type: v.literal('PlaceCardOnPlayStack'),
  cardId: IdentifierSchema,
  expectedSourceId: IdentifierSchema,
  targetStackId: IdentifierSchema,
  expectedTargetTopCardId: IdentifierSchema,
  mode: v.picklist(['attachment', 'evolution'] as const),
});

const MoveCardToStadiumCommandSchema = v.object({
  type: v.literal('MoveCardToStadium'),
  cardId: IdentifierSchema,
  expectedSourceId: IdentifierSchema,
  expectedStadiumCardId: v.nullable(IdentifierSchema),
  expectedStadiumCardIds: v.optional(
    v.pipe(v.array(IdentifierSchema), v.maxLength(4))
  ),
  placement: v.optional(v.literal('add')),
});

const MoveCardToDeckTopCommandSchema = v.object({
  type: v.literal('MoveCardToDeckTop'),
  cardId: IdentifierSchema,
  expectedSourceId: IdentifierSchema,
});

const MoveCardToDeckBottomCommandSchema = v.object({
  type: v.literal('MoveCardToDeckBottom'),
  cardId: IdentifierSchema,
  expectedSourceId: IdentifierSchema,
});

const SetDamageCommandSchema = v.object({
  type: v.literal('SetDamage'),
  stackId: IdentifierSchema,
  damage: v.nullable(v.pipe(NonNegativeIntegerSchema, v.maxValue(9_990))),
});

const SetSpecialConditionCommandSchema = v.object({
  type: v.literal('SetSpecialCondition'),
  stackId: IdentifierSchema,
  condition: v.nullable(boundedString(16, 0)),
});

const SetAbilityUsedCommandSchema = v.object({
  type: v.literal('SetAbilityUsed'),
  stackId: IdentifierSchema,
  used: v.boolean(),
});

const SetCardAbilityUsedCommandSchema = v.object({
  type: v.literal('SetCardAbilityUsed'),
  cardId: IdentifierSchema,
  used: v.boolean(),
});

const SetPublicRevealCommandSchema = v.object({
  type: v.literal('SetPublicReveal'),
  cardId: IdentifierSchema,
  expectedSourceId: IdentifierSchema,
  revealed: v.boolean(),
});

const RotateStackCommandSchema = v.object({
  type: v.literal('RotateStack'),
  stackId: IdentifierSchema,
  rotationQuarterTurns: QuarterTurnsSchema,
});

const SetCardOrientationCommandSchema = v.object({
  type: v.literal('SetCardOrientation'),
  cardId: IdentifierSchema,
  orientationQuarterTurns: QuarterTurnsSchema,
});

const ShuffleZoneCommandSchema = v.object({
  type: v.literal('ShuffleZone'),
  zoneId: IdentifierSchema,
});

/**
 * The Pokémon an earlier step of the same command made, by that step's
 * place among the steps: a V-UNION's or LEGEND's later pieces go onto the
 * Pokémon its first piece has just become, which has no id until the room
 * makes it.
 */
const CardStepRefSchema = v.pipe(
  NonNegativeIntegerSchema,
  v.maxValue(MAX_CARD_STEPS - 1)
);

const MoveCardToPlayStepSchema = v.object({
  ...MoveCardToPlayCommandSchema.entries,
  targetStackRef: v.optional(CardStepRefSchema),
});

const PlaceCardOnPlayStackStepSchema = v.strictObject({
  ...PlaceCardOnPlayStackCommandSchema.entries,
  targetStackId: v.optional(IdentifierSchema),
  targetStackRef: v.optional(CardStepRefSchema),
});

/**
 * One step of a group's move (ApplyCardSteps): a single-card command, as it
 * would be sent alone, from a short list. The two that put a card on a
 * Pokémon may name one an earlier step made (`targetStackRef`) instead.
 */
export const WireCardStepSchema = v.variant('type', [
  MoveCardCommandSchema,
  MoveCardFromStackCommandSchema,
  MovePlayStackToZoneCommandSchema,
  MoveInspectedCardCommandSchema,
  MoveStagedCardCommandSchema,
  MoveCardToPlayStepSchema,
  MoveInspectedCardToPlayCommandSchema,
  PlaceCardOnPlayStackStepSchema,
  MoveCardToStadiumCommandSchema,
  MoveCardToDeckTopCommandSchema,
  MoveCardToDeckBottomCommandSchema,
  SetDamageCommandSchema,
  SetSpecialConditionCommandSchema,
  SetAbilityUsedCommandSchema,
  SetCardAbilityUsedCommandSchema,
  SetPublicRevealCommandSchema,
  RotateStackCommandSchema,
  SetCardOrientationCommandSchema,
  ShuffleZoneCommandSchema,
]);

type CardStepShape = v.InferOutput<typeof WireCardStepSchema>;

/** Whether a step makes a new Pokémon a later step may put cards on. */
export const cardStepMakesPokemon = (
  step: CardStepShape
): step is Extract<
  CardStepShape,
  { readonly type: 'MoveCardToPlay' | 'MoveInspectedCardToPlay' }
> =>
  (step.type === 'MoveCardToPlay' &&
    step.targetStackId === undefined &&
    step.targetStackRef === undefined) ||
  step.type === 'MoveInspectedCardToPlay';

/**
 * The steps' shape, before the room reads them: a step names only a
 * Pokémon an earlier step made, a card put on a Pokémon names it one way
 * only, and shuffles come last (a deck shuffled once its cards are in).
 * What the steps do is checked by the room, step by step, as if each came
 * alone.
 */
const wellFormedCardSteps = (steps: CardStepShape[]): boolean => {
  let shuffled = false;
  return steps.every((step, index) => {
    if (step.type === 'ShuffleZone') {
      shuffled = true;
      return true;
    }
    if (shuffled) return false;
    if (step.type !== 'MoveCardToPlay' && step.type !== 'PlaceCardOnPlayStack')
      return true;
    const ref = step.targetStackRef;
    if (ref !== undefined && step.targetStackId !== undefined) return false;
    if (step.type === 'PlaceCardOnPlayStack' && ref === undefined)
      return step.targetStackId !== undefined;
    return (
      ref === undefined || (ref < index && cardStepMakesPokemon(steps[ref]!))
    );
  });
};

const ApplyCardStepsCommandSchema = v.object({
  type: v.literal('ApplyCardSteps'),
  steps: v.pipe(
    v.array(WireCardStepSchema),
    v.minLength(2),
    v.maxLength(MAX_CARD_STEPS),
    v.check(wellFormedCardSteps, 'Malformed card steps')
  ),
});

export const WireGameCommandSchema = v.variant('type', [
  v.object({
    type: v.literal('LoadDeck'),
    targetPlayerId: v.optional(IdentifierSchema),
    entries: v.pipe(
      v.array(WireDeckEntrySchema),
      v.maxLength(MAX_DECK_ENTRIES),
      // Entry count alone does not bound the deck: the reducer rejects more
      // than MAX_DECK_CARDS instances, so reject it at the wire boundary too
      // rather than materializing the copies first.
      v.check(
        (entries) =>
          entries.reduce((total, entry) => total + entry.count, 0) <=
          MAX_DECK_CARDS,
        'Deck exceeds the maximum card count'
      )
    ),
  }),
  v.object({
    type: v.literal('SetCardBack'),
    targetPlayerId: v.optional(IdentifierSchema),
    cardBackUrl: CardBackSchema,
  }),
  v.object({
    type: v.literal('ResetPlayer'),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('SetupPlayer'),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  MoveCardCommandSchema,
  MoveCardToStadiumCommandSchema,
  MoveCardToPlayCommandSchema,
  PlaceCardOnPlayStackCommandSchema,
  MoveCardFromStackCommandSchema,
  MovePlayStackToZoneCommandSchema,
  v.object({
    type: v.literal('MovePlayStack'),
    stackId: IdentifierSchema,
    // The board it was seen on: a Pokémon can now change boards.
    expectedSourceBoardPlayerId: v.optional(IdentifierSchema),
    expectedSourceSlot: v.picklist(['active', 'bench'] as const),
    expectedActiveStackId: v.nullable(IdentifierSchema),
    expectedBenchStackIds: v.pipe(v.array(IdentifierSchema), v.maxLength(200)),
    destinationSlot: v.picklist(['active', 'bench'] as const),
    targetStackId: v.optional(IdentifierSchema),
    benchIndex: v.optional(NonNegativeIntegerSchema),
    // Onto the other player's board, as last seen: a Pokémon moved across.
    destinationBoard: v.optional(
      v.object({
        boardPlayerId: IdentifierSchema,
        expectedActiveStackId: v.nullable(IdentifierSchema),
        expectedBenchStackIds: v.pipe(
          v.array(IdentifierSchema),
          v.maxLength(200)
        ),
      })
    ),
  }),
  MoveInspectedCardCommandSchema,
  MoveInspectedCardToPlayCommandSchema,
  v.object({
    // A card dragged into an open work-area popup, as v1's `viewCards` and
    // `attachedCards` containers accept drops from anywhere on the board.
    type: v.literal('MoveCardToWorkArea'),
    cardId: IdentifierSchema,
    expectedWorkAreaId: IdentifierSchema,
  }),
  MoveStagedCardCommandSchema,
  v.object({
    type: v.literal('RestoreStagedStack'),
    targetPlayerId: v.optional(IdentifierSchema),
    expectedWorkAreaId: IdentifierSchema,
    // The board it is restored onto: the player's own, or this one's.
    expectedActiveStackId: v.nullable(IdentifierSchema),
    expectedBenchStackIds: v.pipe(v.array(IdentifierSchema), v.maxLength(200)),
    destinationSlot: v.picklist(['active', 'bench'] as const),
    benchIndex: v.optional(NonNegativeIntegerSchema),
    destinationBoardPlayerId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('ResolveStagedCards'),
    targetPlayerId: v.optional(IdentifierSchema),
    expectedWorkAreaId: IdentifierSchema,
    destination: v.picklist([
      'discard',
      'lostZone',
      'hand',
      'shuffleIntoDeck',
      'shuffleToDeckBottom',
    ] as const),
  }),
  v.object({
    type: v.literal('ResolveInspectionCards'),
    targetPlayerId: v.optional(IdentifierSchema),
    expectedWorkAreaId: IdentifierSchema,
    destination: v.picklist([
      'discard',
      'lostZone',
      'hand',
      'shuffleIntoDeck',
      'shuffleToDeckBottom',
    ] as const),
  }),
  MoveCardToDeckTopCommandSchema,
  MoveCardToDeckBottomCommandSchema,
  v.object({
    type: v.literal('ShuffleCardIntoDeck'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('SwapCardWithDeckTop'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('MovePrizesToDeckBottom'),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  ShuffleZoneCommandSchema,
  v.object({
    type: v.literal('DrawCards'),
    count: v.pipe(PositiveIntegerSchema, v.maxValue(200)),
    /** The seat that draws; defaults to the submitting seat. */
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  v.strictObject({
    type: v.literal('PlayRandomCardFaceDown'),
    targetPlayerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('StartTurn'),
    targetPlayerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('DeclareAttack'),
    targetPlayerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('PassTurn'),
    targetPlayerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('MoveZoneContents'),
    sourceZoneId: IdentifierSchema,
    destinationZoneId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('ResolveLooseBoardCards'),
    targetPlayerId: IdentifierSchema,
    expectedBoardCardIds: v.pipe(
      v.array(IdentifierSchema),
      v.minLength(1),
      v.maxLength(200)
    ),
    destination: v.picklist([
      'discard',
      'lostZone',
      'hand',
      'shuffleIntoDeck',
    ] as const),
  }),
  v.object({
    type: v.literal('ShuffleZoneIntoDeck'),
    sourceZoneId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('ShuffleZoneToDeckBottom'),
    sourceZoneId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('DiscardHandAndDraw'),
    count: v.pipe(NonNegativeIntegerSchema, v.maxValue(200)),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('ShuffleHandIntoDeckAndDraw'),
    count: v.pipe(NonNegativeIntegerSchema, v.maxValue(200)),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('ShuffleHandToDeckBottomAndDraw'),
    count: v.pipe(NonNegativeIntegerSchema, v.maxValue(200)),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  SetDamageCommandSchema,
  SetSpecialConditionCommandSchema,
  SetAbilityUsedCommandSchema,
  RotateStackCommandSchema,
  SetCardOrientationCommandSchema,
  SetCardAbilityUsedCommandSchema,
  v.object({
    type: v.literal('ChangeCardCategory'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
    category: v.picklist(['Pokémon', 'Trainer', 'Energy'] as const),
  }),
  v.object({
    type: v.literal('SetCardFace'),
    cardId: IdentifierSchema,
    face: v.picklist(['up', 'down'] as const),
  }),
  SetPublicRevealCommandSchema,
  v.object({
    type: v.literal('SetZonePublicReveal'),
    targetPlayerId: IdentifierSchema,
    zoneId: IdentifierSchema,
    expectedCardIds: v.pipe(
      v.array(IdentifierSchema),
      v.minLength(1),
      v.maxLength(200)
    ),
    revealed: v.boolean(),
  }),
  v.object({
    type: v.literal('BeginZoneInspection'),
    targetPlayerId: IdentifierSchema,
    zoneId: IdentifierSchema,
    expectedCardIds: v.pipe(
      v.array(IdentifierSchema),
      v.minLength(1),
      v.maxLength(200)
    ),
  }),
  v.object({
    type: v.literal('BeginCardInspection'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('EndPrivateInspection'),
    inspectionId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('ExtractDeckCardsForInspection'),
    ownerPlayerId: IdentifierSchema,
    count: v.pipe(PositiveIntegerSchema, v.maxValue(200)),
    edge: v.picklist(['top', 'bottom'] as const),
    visibility: v.picklist(['private', 'public'] as const),
  }),
  v.object({
    type: v.literal('CloseInspection'),
    expectedWorkAreaId: IdentifierSchema,
    returnTo: v.picklist(['top', 'bottom'] as const),
  }),
  v.strictObject({
    type: v.literal('SetCoachingConsent'),
    consent: v.boolean(),
  }),
  v.object({
    type: v.literal('SetOncePerGameMarker'),
    targetPlayerId: IdentifierSchema,
    marker: v.picklist(['gx', 'vstar'] as const),
    used: v.boolean(),
  }),
  v.strictObject({
    type: v.literal('ApplySoloUndo'),
    targetPlayerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('FlipCoin'),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  ApplyCardStepsCommandSchema,
]);

const HelloSchema = v.object({
  type: v.literal('Hello'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  buildId: boundedString(128),
  roomCode: boundedString(MAX_ROOM_CODE_LENGTH),
  displayName: boundedString(64),
  requestedRole: v.picklist(['player', 'spectator'] as const),
  admissionTicket: v.optional(boundedString(512)),
  /**
   * A ticket-bound resume bearer is sent alongside a new admission ticket.
   * Retrying that exact pair is safe whether ticket redemption did not run or
   * committed before its Welcome was lost.
   */
  resumeToken: v.optional(CapabilitySchema),
});

const CommandSchema = v.object({
  type: v.literal('Command'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  sessionId: IdentifierSchema,
  clientSequence: PositiveIntegerSchema,
  commandId: IdentifierSchema,
  lastSeenRevision: RevisionSchema,
  command: WireGameCommandSchema,
});

/**
 * `targetPlayerId` on these three names the seat the sender is acting for,
 * which on a flipped board is the seat at the bottom (v1's
 * `systemState.initiator`). It is a request, never an identity: the room
 * authenticates it against the sender's own seat and the room's flip rules,
 * and falls back to the sender's seat when it is not theirs to act for.
 */
const SendChatSchema = v.object({
  type: v.literal('SendChat'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  message: boundedString(MAX_CHAT_CODE_UNITS),
  targetPlayerId: v.optional(IdentifierSchema),
});

const DeclareMulliganSchema = v.object({
  type: v.literal('DeclareMulligan'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  targetPlayerId: v.optional(IdentifierSchema),
});

const DeclareDeckViewSchema = v.object({
  type: v.literal('DeclareDeckView'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  targetPlayerId: v.optional(IdentifierSchema),
});

const PingSchema = v.object({
  type: v.literal('Ping'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  id: NonNegativeIntegerSchema,
});

const LeaveSchema = v.object({
  type: v.literal('Leave'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
});

const RequestReplaySchema = v.strictObject({
  type: v.literal('RequestReplay'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
});

export const ClientMessageSchema = v.variant('type', [
  HelloSchema,
  CommandSchema,
  SendChatSchema,
  DeclareMulliganSchema,
  DeclareDeckViewSchema,
  PingSchema,
  RequestReplaySchema,
  LeaveSchema,
]);

const KnownViewCardSchema = v.object({
  kind: v.literal('known'),
  id: IdentifierSchema,
  definitionId: IdentifierSchema,
  ownerId: IdentifierSchema,
  category: CardCategorySchema,
  face: v.picklist(['up', 'down'] as const),
  orientationQuarterTurns: QuarterTurnsSchema,
  abilityUsed: v.boolean(),
  publiclyRevealed: v.boolean(),
  // Display-only decklist position, shared by every copy of a name, so the
  // Sort checkbox can paint v1's declared order.
  decklistRank: v.optional(NonNegativeIntegerSchema),
});

const ConcealedViewCardSchema = v.object({
  kind: v.literal('concealed'),
  id: IdentifierSchema,
  ownerId: IdentifierSchema,
  cardBackUrl: UrlSchema,
  publiclyRevealed: v.literal(false),
});

export const ViewCardSchema = v.variant('kind', [
  KnownViewCardSchema,
  ConcealedViewCardSchema,
]);

const ViewDefinitionSchema = v.object({
  id: IdentifierSchema,
  name: boundedString(256),
  category: CardCategorySchema,
  imageUrl: UrlSchema,
  imageUrlSmall: v.optional(UrlSchema),
  presentation: v.optional(CardPresentationSchema),
});

const PlayerViewSchema = v.object({
  id: IdentifierSchema,
  displayName: boundedString(64),
  cardBackUrl: UrlSchema,
  coachingConsent: v.boolean(),
  oncePerGame: v.object({ gxUsed: v.boolean(), vstarUsed: v.boolean() }),
});

const ZoneViewSchema = v.object({
  id: IdentifierSchema,
  kind: v.picklist([
    'deck',
    'hand',
    'prizes',
    'discard',
    'lostZone',
    'board',
    'stadium',
  ] as const),
  ownerId: v.nullable(IdentifierSchema),
  cards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
});

const BoardViewSchema = v.object({
  activeStackId: v.nullable(IdentifierSchema),
  benchStackIds: v.pipe(v.array(IdentifierSchema), v.maxLength(200)),
});

const StackViewSchema = v.object({
  id: IdentifierSchema,
  boardPlayerId: IdentifierSchema,
  slot: v.picklist(['active', 'bench'] as const),
  evolutionCards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
  attachmentCards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
  rotationQuarterTurns: QuarterTurnsSchema,
  damage: v.nullable(v.pipe(NonNegativeIntegerSchema, v.maxValue(9_990))),
  specialCondition: v.nullable(boundedString(16, 0)),
  abilityUsed: v.boolean(),
});

const WorkAreaViewSchema = v.object({
  inspection: v.nullable(
    v.object({
      id: IdentifierSchema,
      cards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
      sourceZoneId: IdentifierSchema,
    })
  ),
  attachmentResolution: v.nullable(
    v.object({
      id: IdentifierSchema,
      sourceStackId: IdentifierSchema,
      cards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
      evolutionCards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
      attachmentCards: v.pipe(v.array(ViewCardSchema), v.maxLength(200)),
      suggestedSlot: v.picklist(['active', 'bench'] as const),
    })
  ),
});

const PrivateInspectionViewSchema = v.object({
  id: IdentifierSchema,
  sourcePlayerId: IdentifierSchema,
  sourceId: IdentifierSchema,
  cardIds: v.pipe(v.array(IdentifierSchema), v.minLength(1), v.maxLength(200)),
});

export const ViewerRoleSchema = v.variant('kind', [
  v.object({ kind: v.literal('player'), playerId: IdentifierSchema }),
  v.object({ kind: v.literal('spectator') }),
]);

export const MatchViewStateSchema = v.object({
  matchId: IdentifierSchema,
  revision: RevisionSchema,
  lifecycle: v.picklist(['lobby', 'playing', 'finished'] as const),
  viewer: ViewerRoleSchema,
  playerOrder: v.pipe(v.array(IdentifierSchema), v.length(2)),
  players: v.record(IdentifierSchema, PlayerViewSchema),
  definitions: v.record(IdentifierSchema, ViewDefinitionSchema),
  zones: v.record(IdentifierSchema, ZoneViewSchema),
  boards: v.record(IdentifierSchema, BoardViewSchema),
  stacks: v.record(IdentifierSchema, StackViewSchema),
  workAreas: v.record(IdentifierSchema, WorkAreaViewSchema),
  privateInspections: v.pipe(
    v.array(PrivateInspectionViewSchema),
    v.maxLength(200)
  ),
  turn: v.object({
    number: NonNegativeIntegerSchema,
    currentPlayerId: v.nullable(IdentifierSchema),
  }),
});

const WelcomeSchema = v.object({
  type: v.literal('Welcome'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  buildId: boundedString(128),
  role: v.picklist(['player', 'spectator'] as const),
  playerId: v.optional(IdentifierSchema),
  sessionId: IdentifierSchema,
  resumeToken: CapabilitySchema,
  nextClientSequence: PositiveIntegerSchema,
  snapshot: MatchViewStateSchema,
});

const PresentationCardSourceSchema = v.picklist([
  'deck',
  'hand',
  'prizes',
  'discard',
  'lostZone',
  'board',
  'stadium',
  'active',
  'bench',
  'inspection',
  'attachmentResolution',
] as const);

const PresentationScopeSchema = v.picklist(['card', 'zone'] as const);

const MulliganDeclaredPresentationEventSchema = v.object({
  type: v.literal('MulliganDeclared'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
});

const DeckViewDeclaredPresentationEventSchema = v.object({
  type: v.literal('DeckViewDeclared'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
});

const OncePerGameMarkerSetPresentationEventSchema = v.object({
  type: v.literal('OncePerGameMarkerSet'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  marker: v.picklist(['gx', 'vstar'] as const),
  used: v.boolean(),
});

/**
 * Battle-log narration for card movement, in v1's grammar. Names are present
 * only when the card is publicly known before or after the move; the client
 * prints "card" otherwise, exactly as v1 does for hidden-zone moves.
 */
const CardMovedPresentationEventSchema = v.object({
  type: v.literal('CardMoved'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  verb: v.picklist([
    'moved',
    'attached',
    'evolved',
    'shuffledIntoDeck',
    'movedToDeckTop',
    'movedToDeckBottom',
    'switchedWithDeckTop',
  ] as const),
  source: PresentationCardSourceSchema,
  destination: v.optional(PresentationCardSourceSchema),
  /** Whose board it went to, for a Pokémon that changed boards. */
  destinationPlayerId: v.optional(IdentifierSchema),
  cardName: v.optional(boundedString(256)),
  targetCardName: v.optional(boundedString(256)),
});

const CardsDrawnPresentationEventSchema = v.object({
  type: v.literal('CardsDrawn'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  cardCount: PositiveIntegerSchema,
});

const ZoneShuffledPresentationEventSchema = v.object({
  type: v.literal('ZoneShuffled'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  source: PresentationCardSourceSchema,
});

const DeckCardsLookedPresentationEventSchema = v.object({
  type: v.literal('DeckCardsLooked'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  cardCount: PositiveIntegerSchema,
  edge: v.picklist(['top', 'bottom'] as const),
});

/** Several cards moved at once: "moved 3 card(s) from board to discard". */
const CardsResolvedPresentationEventSchema = v.object({
  type: v.literal('CardsResolved'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  verb: v.picklist(['moved', 'shuffled', 'discarded', 'left'] as const),
  cardCount: PositiveIntegerSchema,
  source: PresentationCardSourceSchema,
  destination: v.picklist([
    'hand',
    'discard',
    'lostZone',
    'deck',
    'deckBottom',
    'play',
    'prizes',
    'board',
  ] as const),
  /**
   * A group's cards by name, in the order they moved: "…: Fire Energy,
   * Switch". Null for a card not publicly known (a face-down prize), so the
   * line can say how many went unnamed. Absent on lines that fold no group.
   */
  cardNames: v.optional(
    v.pipe(
      v.array(v.nullable(boundedString(256))),
      v.minLength(1),
      v.maxLength(60)
    )
  ),
});

const HandReplacedPresentationEventSchema = v.object({
  type: v.literal('HandReplaced'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  mode: v.picklist([
    'discard',
    'shuffleIntoDeck',
    'shuffleToDeckBottom',
  ] as const),
  drawCount: NonNegativeIntegerSchema,
});

const CardCategoryChangedPresentationEventSchema = v.object({
  type: v.literal('CardCategoryChanged'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  category: v.picklist(['Pokémon', 'Trainer', 'Energy', 'Unknown'] as const),
  cardName: v.optional(boundedString(256)),
});

const AbilityUsedPresentationEventSchema = v.object({
  type: v.literal('AbilityUsed'),
  revision: RevisionSchema,
  playerId: IdentifierSchema,
  source: PresentationCardSourceSchema,
  cardName: v.optional(boundedString(256)),
});

export const PresentationEventSchema = v.variant('type', [
  CardMovedPresentationEventSchema,
  CardsDrawnPresentationEventSchema,
  ZoneShuffledPresentationEventSchema,
  DeckCardsLookedPresentationEventSchema,
  CardsResolvedPresentationEventSchema,
  HandReplacedPresentationEventSchema,
  CardCategoryChangedPresentationEventSchema,
  AbilityUsedPresentationEventSchema,
  v.object({
    type: v.literal('CoinFlipped'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    result: v.picklist(['heads', 'tails'] as const),
  }),
  v.object({
    type: v.literal('PlayerReset'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('DeckLoaded'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    cardCount: NonNegativeIntegerSchema,
  }),
  v.object({
    type: v.literal('PlayerSetup'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    handCount: NonNegativeIntegerSchema,
    prizeCount: NonNegativeIntegerSchema,
  }),
  v.object({
    type: v.literal('RandomCardPlayedFaceDown'),
    revision: RevisionSchema,
    actorPlayerId: IdentifierSchema,
    targetPlayerId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('TurnStarted'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    turnNumber: NonNegativeIntegerSchema,
  }),
  v.object({
    type: v.literal('TurnStartFailedNoDeck'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    turnNumber: NonNegativeIntegerSchema,
  }),
  v.object({
    type: v.literal('AttackDeclared'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    turnNumber: NonNegativeIntegerSchema,
  }),
  v.object({
    type: v.literal('PassDeclared'),
    revision: RevisionSchema,
    playerId: IdentifierSchema,
    turnNumber: NonNegativeIntegerSchema,
  }),
  v.object({
    type: v.literal('PublicCardsRevealed'),
    revision: RevisionSchema,
    actorPlayerId: IdentifierSchema,
    playerId: IdentifierSchema,
    scope: PresentationScopeSchema,
    source: PresentationCardSourceSchema,
    cardCount: PositiveIntegerSchema,
    cardName: v.optional(boundedString(256)),
    /**
     * A group's cards revealed one by one, by name in order (ADR-042 §6):
     * "revealed 2 cards in Red's hand: …". Absent on a single card's line.
     */
    cardNames: v.optional(
      v.pipe(
        v.array(v.nullable(boundedString(256))),
        v.minLength(2),
        v.maxLength(60)
      )
    ),
  }),
  v.object({
    type: v.literal('PublicCardsHidden'),
    revision: RevisionSchema,
    actorPlayerId: IdentifierSchema,
    playerId: IdentifierSchema,
    scope: PresentationScopeSchema,
    source: PresentationCardSourceSchema,
    cardCount: PositiveIntegerSchema,
  }),
  v.object({
    type: v.literal('PrivateInspectionStarted'),
    revision: RevisionSchema,
    sourcePlayerId: IdentifierSchema,
    viewerPlayerId: IdentifierSchema,
    scope: PresentationScopeSchema,
    source: PresentationCardSourceSchema,
    cardCount: PositiveIntegerSchema,
  }),
  v.object({
    type: v.literal('PrivateInspectionEnded'),
    revision: RevisionSchema,
    sourcePlayerId: IdentifierSchema,
    viewerPlayerId: IdentifierSchema,
    scope: PresentationScopeSchema,
    source: PresentationCardSourceSchema,
    cardCount: PositiveIntegerSchema,
  }),
  v.object({
    type: v.literal('UndoApplied'),
    revision: RevisionSchema,
    actorPlayerId: IdentifierSchema,
    targetPlayerId: IdentifierSchema,
    revertedRevision: RevisionSchema,
  }),
  OncePerGameMarkerSetPresentationEventSchema,
  MulliganDeclaredPresentationEventSchema,
  DeckViewDeclaredPresentationEventSchema,
]);

const StatePublicationSchema = v.object({
  type: v.literal('StatePublication'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  coveringCommandId: v.optional(IdentifierSchema),
  executedClientSequence: NonNegativeIntegerSchema,
  snapshot: MatchViewStateSchema,
  presentationEvents: v.optional(
    v.pipe(
      v.array(PresentationEventSchema),
      v.maxLength(MAX_PRESENTATION_EVENTS)
    )
  ),
});

/**
 * Authority metadata can change without executing a game command. This
 * message is intentionally distinct from StatePublication so an
 * equal-revision replacement cannot be mistaken for a command publication.
 */
const ProjectionRefreshSchema = v.object({
  type: v.literal('ProjectionRefresh'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  cause: v.literal('authority_reconciled'),
  snapshot: MatchViewStateSchema,
});

const CommandResultSchema = v.object({
  type: v.literal('CommandResult'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  commandId: IdentifierSchema,
  clientSequence: PositiveIntegerSchema,
  accepted: v.boolean(),
  revision: RevisionSchema,
  code: v.optional(
    v.picklist([
      'invalid_message',
      'invalid_sequence',
      'unauthorized',
      'stale_reference',
      'precondition_failed',
      'rate_limited',
      'room_not_ready',
      'room_full',
      'session_superseded',
      'internal_retryable',
    ] as const)
  ),
});

const ChatMessageSchema = v.object({
  type: v.literal('ChatMessage'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  messageId: IdentifierSchema,
  playerId: v.optional(IdentifierSchema),
  displayName: boundedString(64),
  message: boundedString(MAX_CHAT_CODE_UNITS),
  createdAtMs: NonNegativeIntegerSchema,
});

/** Ephemeral room delivery. It is intentionally absent from replay history. */
const MulliganAnnouncementSchema = v.object({
  type: v.literal('MulliganAnnouncement'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  event: MulliganDeclaredPresentationEventSchema,
});

/** Ephemeral room delivery. It is intentionally absent from replay history. */
const DeckViewAnnouncementSchema = v.object({
  type: v.literal('DeckViewAnnouncement'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  event: DeckViewDeclaredPresentationEventSchema,
});

const PresenceSchema = v.object({
  type: v.literal('Presence'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  playerId: v.optional(IdentifierSchema),
  displayName: boundedString(64),
  status: v.picklist([
    'joined',
    'disconnected',
    'reconnected',
    'left',
  ] as const),
});

const PongSchema = v.object({
  type: v.literal('Pong'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  id: NonNegativeIntegerSchema,
});

const ServerNoticeSchema = v.object({
  type: v.literal('ServerNotice'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  code: boundedString(64),
  message: boundedString(512),
  retryable: v.boolean(),
});

const SessionSupersededSchema = v.object({
  type: v.literal('SessionSuperseded'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
});

const ReplayStartedSchema = v.strictObject({
  type: v.literal('ReplayStarted'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  replayId: IdentifierSchema,
  viewer: ViewerRoleSchema,
  startRevision: RevisionSchema,
  endRevision: RevisionSchema,
  truncated: v.boolean(),
  frameCount: v.pipe(PositiveIntegerSchema, v.maxValue(MAX_REPLAY_FRAMES)),
  localDisclosureDefinitions: v.optional(
    v.pipe(v.array(ViewDefinitionSchema), v.maxLength(MAX_DECK_CARDS * 2))
  ),
});

const ReplayLocalDisclosureCardSchema = v.strictObject({
  kind: v.literal('known'),
  id: IdentifierSchema,
  definitionId: IdentifierSchema,
  ownerId: IdentifierSchema,
  category: CardCategorySchema,
  face: v.literal('up'),
  orientationQuarterTurns: QuarterTurnsSchema,
  abilityUsed: v.boolean(),
  publiclyRevealed: v.literal(false),
});

const ReplayLocalDisclosureSchema = v.strictObject({
  zoneIds: v.pipe(v.array(IdentifierSchema), v.maxLength(3)),
  cards: v.pipe(
    v.array(ReplayLocalDisclosureCardSchema),
    v.maxLength(MAX_DECK_CARDS * 2)
  ),
});

const ReplayFrameSchema = v.strictObject({
  type: v.literal('ReplayFrame'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  replayId: IdentifierSchema,
  index: v.pipe(NonNegativeIntegerSchema, v.maxValue(MAX_REPLAY_FRAMES - 1)),
  snapshot: MatchViewStateSchema,
  localDisclosure: v.optional(ReplayLocalDisclosureSchema),
  presentationEvents: v.optional(
    v.pipe(
      v.array(PresentationEventSchema),
      v.maxLength(MAX_PRESENTATION_EVENTS)
    )
  ),
});

const ReplayCompletedSchema = v.strictObject({
  type: v.literal('ReplayCompleted'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  replayId: IdentifierSchema,
  frameCount: v.pipe(PositiveIntegerSchema, v.maxValue(MAX_REPLAY_FRAMES)),
});

export const ServerMessageSchema = v.variant('type', [
  WelcomeSchema,
  StatePublicationSchema,
  ProjectionRefreshSchema,
  CommandResultSchema,
  ChatMessageSchema,
  MulliganAnnouncementSchema,
  DeckViewAnnouncementSchema,
  PresenceSchema,
  PongSchema,
  ServerNoticeSchema,
  SessionSupersededSchema,
  ReplayStartedSchema,
  ReplayFrameSchema,
  ReplayCompletedSchema,
]);

export type WireGameCommand = v.InferOutput<typeof WireGameCommandSchema>;
/** One step of a group's move (ApplyCardSteps). */
export type WireCardStep = v.InferOutput<typeof WireCardStepSchema>;
export type RoomCreationRequest = v.InferOutput<
  typeof RoomCreationRequestSchema
>;
export type RoomCreationResponse = v.InferOutput<
  typeof RoomCreationResponseSchema
>;
export type RoomInvitationIssueRequest = v.InferOutput<
  typeof RoomInvitationIssueRequestSchema
>;
export type RoomInvitationIssueResponse = v.InferOutput<
  typeof RoomInvitationIssueResponseSchema
>;
export type RoomInvitationHandoff = v.InferOutput<
  typeof RoomInvitationHandoffSchema
>;
export type RoomAdmissionTicketRequest = v.InferOutput<
  typeof RoomAdmissionTicketRequestSchema
>;
export type RoomAdmissionTicketResponse = v.InferOutput<
  typeof RoomAdmissionTicketResponseSchema
>;
export type ContinuationCreationRequest = v.InferOutput<
  typeof ContinuationCreationRequestSchema
>;
export type ContinuationCreationResponse = v.InferOutput<
  typeof ContinuationCreationResponseSchema
>;
export type ContinuationHandoff = v.InferOutput<
  typeof ContinuationHandoffSchema
>;
export type ContinuationRestoreRequest = v.InferOutput<
  typeof ContinuationRestoreRequestSchema
>;
export type ContinuationRevocationRequest = v.InferOutput<
  typeof ContinuationRevocationRequestSchema
>;
export type ContinuationRestoreResponse = v.InferOutput<
  typeof ContinuationRestoreResponseSchema
>;
export type PresentationEvent = v.InferOutput<typeof PresentationEventSchema>;
export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;
export type ServerMessage = v.InferOutput<typeof ServerMessageSchema>;
export type SerializedMatchViewState = v.InferOutput<
  typeof MatchViewStateSchema
>;
