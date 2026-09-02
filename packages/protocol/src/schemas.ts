import * as v from 'valibot';
import {
  MAX_CHAT_CODE_UNITS,
  MAX_DECK_ENTRIES,
  MAX_REPLAY_FRAMES,
  MAX_ROOM_CODE_LENGTH,
  PROTOCOL_VERSION,
} from './constants.js';

const boundedString = (maximum: number, minimum = 1) =>
  v.pipe(v.string(), v.minLength(minimum), v.maxLength(maximum));
const IdentifierSchema = boundedString(128);
const UrlSchema = boundedString(4_096);
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

export const SerializedCardDefinitionSchema = v.object({
  id: IdentifierSchema,
  name: boundedString(256),
  category: CardCategorySchema,
  imageUrl: UrlSchema,
  imageUrlSmall: v.optional(UrlSchema),
});

const WireDeckEntrySchema = v.object({
  definition: SerializedCardDefinitionSchema,
  count: v.pipe(PositiveIntegerSchema, v.maxValue(200)),
});

export const WireGameCommandSchema = v.variant('type', [
  v.object({
    type: v.literal('LoadDeck'),
    targetPlayerId: v.optional(IdentifierSchema),
    entries: v.pipe(
      v.array(WireDeckEntrySchema),
      v.maxLength(MAX_DECK_ENTRIES)
    ),
  }),
  v.object({
    type: v.literal('ResetPlayer'),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('SetupPlayer'),
    targetPlayerId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('MoveCard'),
    cardId: IdentifierSchema,
    expectedSourceZoneId: IdentifierSchema,
    destinationZoneId: IdentifierSchema,
    destinationIndex: v.optional(NonNegativeIntegerSchema),
  }),
  v.object({
    type: v.literal('MoveCardToPlay'),
    cardId: IdentifierSchema,
    expectedSourceZoneId: IdentifierSchema,
    boardPlayerId: IdentifierSchema,
    slot: v.picklist(['active', 'bench'] as const),
    targetStackId: v.optional(IdentifierSchema),
    benchIndex: v.optional(NonNegativeIntegerSchema),
  }),
  v.object({
    type: v.literal('MoveCardFromStack'),
    cardId: IdentifierSchema,
    expectedStackId: IdentifierSchema,
    destinationZoneId: IdentifierSchema,
    destinationIndex: v.optional(NonNegativeIntegerSchema),
  }),
  v.object({
    type: v.literal('MovePlayStack'),
    stackId: IdentifierSchema,
    expectedSourceSlot: v.picklist(['active', 'bench'] as const),
    expectedActiveStackId: v.nullable(IdentifierSchema),
    expectedBenchStackIds: v.pipe(v.array(IdentifierSchema), v.maxLength(200)),
    destinationSlot: v.picklist(['active', 'bench'] as const),
    targetStackId: v.optional(IdentifierSchema),
  }),
  v.object({
    type: v.literal('MoveInspectedCard'),
    cardId: IdentifierSchema,
    expectedWorkAreaId: IdentifierSchema,
    destinationZoneId: IdentifierSchema,
    destinationIndex: v.optional(NonNegativeIntegerSchema),
  }),
  v.object({
    type: v.literal('MoveStagedCard'),
    cardId: IdentifierSchema,
    expectedWorkAreaId: IdentifierSchema,
    destinationZoneId: IdentifierSchema,
    destinationIndex: v.optional(NonNegativeIntegerSchema),
  }),
  v.object({
    type: v.literal('RestoreStagedStack'),
    expectedWorkAreaId: IdentifierSchema,
    expectedActiveStackId: v.nullable(IdentifierSchema),
    expectedBenchStackIds: v.pipe(v.array(IdentifierSchema), v.maxLength(200)),
    destinationSlot: v.picklist(['active', 'bench'] as const),
    benchIndex: v.optional(NonNegativeIntegerSchema),
  }),
  v.object({
    type: v.literal('ResolveStagedCards'),
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
    type: v.literal('MoveCardToDeckTop'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
  }),
  v.object({
    type: v.literal('MoveCardToDeckBottom'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
  }),
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
  v.object({ type: v.literal('MovePrizesToDeckBottom') }),
  v.object({ type: v.literal('ShuffleZone'), zoneId: IdentifierSchema }),
  v.object({
    type: v.literal('DrawCards'),
    count: v.pipe(PositiveIntegerSchema, v.maxValue(200)),
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
  }),
  v.object({
    type: v.literal('ShuffleHandIntoDeckAndDraw'),
    count: v.pipe(NonNegativeIntegerSchema, v.maxValue(200)),
  }),
  v.object({
    type: v.literal('ShuffleHandToDeckBottomAndDraw'),
    count: v.pipe(NonNegativeIntegerSchema, v.maxValue(200)),
  }),
  v.object({
    type: v.literal('SetDamage'),
    stackId: IdentifierSchema,
    damage: v.nullable(v.pipe(NonNegativeIntegerSchema, v.maxValue(9_990))),
  }),
  v.object({
    type: v.literal('SetSpecialCondition'),
    stackId: IdentifierSchema,
    condition: v.nullable(boundedString(16, 0)),
  }),
  v.object({
    type: v.literal('SetAbilityUsed'),
    stackId: IdentifierSchema,
    used: v.boolean(),
  }),
  v.object({
    type: v.literal('RotateStack'),
    stackId: IdentifierSchema,
    rotationQuarterTurns: QuarterTurnsSchema,
  }),
  v.object({
    type: v.literal('SetCardOrientation'),
    cardId: IdentifierSchema,
    orientationQuarterTurns: QuarterTurnsSchema,
  }),
  v.object({
    type: v.literal('SetCardAbilityUsed'),
    cardId: IdentifierSchema,
    used: v.boolean(),
  }),
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
  v.object({
    type: v.literal('SetPublicReveal'),
    cardId: IdentifierSchema,
    expectedSourceId: IdentifierSchema,
    revealed: v.boolean(),
  }),
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
    inspectionId: IdentifierSchema,
    returnTo: v.picklist(['top', 'bottom'] as const),
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
  v.object({ type: v.literal('FlipCoin') }),
]);

const HelloSchema = v.object({
  type: v.literal('Hello'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  buildId: boundedString(128),
  roomCode: boundedString(MAX_ROOM_CODE_LENGTH),
  displayName: boundedString(64),
  requestedRole: v.picklist(['player', 'spectator'] as const),
  admissionTicket: v.optional(boundedString(512)),
  resumeToken: v.optional(boundedString(512)),
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

const SendChatSchema = v.object({
  type: v.literal('SendChat'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  message: boundedString(MAX_CHAT_CODE_UNITS),
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
  resumeToken: v.optional(boundedString(512)),
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

export const PresentationEventSchema = v.variant('type', [
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
]);

const StatePublicationSchema = v.object({
  type: v.literal('StatePublication'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  coveringCommandId: v.optional(IdentifierSchema),
  executedClientSequence: NonNegativeIntegerSchema,
  snapshot: MatchViewStateSchema,
  presentationEvents: v.optional(
    v.pipe(v.array(PresentationEventSchema), v.maxLength(100))
  ),
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
});

const ReplayFrameSchema = v.strictObject({
  type: v.literal('ReplayFrame'),
  protocolVersion: v.literal(PROTOCOL_VERSION),
  replayId: IdentifierSchema,
  index: v.pipe(NonNegativeIntegerSchema, v.maxValue(MAX_REPLAY_FRAMES - 1)),
  snapshot: MatchViewStateSchema,
  presentationEvents: v.optional(
    v.pipe(v.array(PresentationEventSchema), v.maxLength(100))
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
  CommandResultSchema,
  ChatMessageSchema,
  PresenceSchema,
  PongSchema,
  ServerNoticeSchema,
  SessionSupersededSchema,
  ReplayStartedSchema,
  ReplayFrameSchema,
  ReplayCompletedSchema,
]);

export type WireGameCommand = v.InferOutput<typeof WireGameCommandSchema>;
export type PresentationEvent = v.InferOutput<typeof PresentationEventSchema>;
export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;
export type ServerMessage = v.InferOutput<typeof ServerMessageSchema>;
export type SerializedMatchViewState = v.InferOutput<
  typeof MatchViewStateSchema
>;
