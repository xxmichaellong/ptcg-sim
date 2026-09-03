import {
  applyEventBatch,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  collectInvariantProblems,
  createEmptyMatch,
  playerZoneId,
  stableSerialize,
  type CommandContext,
  type MatchViewState,
  type PlayerId,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  RoomAuthorityCoordinator,
  authoritySnapshotValidationMatches,
  createReplayHistory,
  emptyProjectionIdentityState,
  projectRecipient,
  replayHistoryStates,
  validateAuthoritySnapshot,
  type AuthorityPolicy,
  type AuthorityProcessResult,
  type OpaqueIdSource,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import {
  parseClientFrame,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  DurableRoomSnapshotStore,
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  type DurableRoomSnapshotStore as DurableStore,
  type StoredAuthorityJournalEntry,
} from './durable-storage.js';
import { journalStorageKey } from './journal-retention.js';
import {
  GENERATED_MODEL_COMMAND_TYPES,
  MODEL_COMMAND_GENERATORS,
  type ModelRandom,
} from './testing/model-command-generators.js';
import {
  MODEL_COMMAND_REGISTRY,
  type ModelCommandCoverage,
  type ModelCommandFamily,
  type ScenarioModelCommandType,
  type WireGameCommandType,
} from './testing/model-command-registry.js';
import { MODEL_REGRESSION_SEEDS } from './testing/model-regression-seeds.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;
type CommandResultMessage = Extract<ServerMessage, { type: 'CommandResult' }>;

const p1 = asPlayerId('model-player-one') as PlayerId & 'model-player-one';
const p2 = asPlayerId('model-player-two') as PlayerId & 'model-player-two';
const spectatorSessionId = 'model-session-spectator';
const playerOneSessionId = 'model-session-one';
const playerTwoSessionId = 'model-session-two';

const sessionIdForPlayer = (playerId: PlayerId): string => {
  if (playerId === p1) return playerOneSessionId;
  if (playerId === p2) return playerTwoSessionId;
  throw new Error(`Unknown model player ${playerId}`);
};

const parseIntegerEnvironment = (
  name: string,
  raw: string | undefined,
  fallback: number,
  maximum: number
): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  }
  return value;
};

const integerEnvironment = (
  name: string,
  fallback: number,
  maximum: number
): number =>
  parseIntegerEnvironment(name, process.env[name], fallback, maximum);

const MODEL_MATRIX_TIMEOUT_MS = integerEnvironment(
  'PTCGSIM_MODEL_TIMEOUT_MS',
  300_000,
  86_400_000
);

const configuredStartSeed = (): number => {
  const raw = process.env.PTCGSIM_MODEL_SEED;
  if (raw === undefined) return 0x13579bdf;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('PTCGSIM_MODEL_SEED must be a uint32 integer');
  }
  return value >>> 0;
};

class SeededRandom implements ModelRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const result = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    this.state >>>= 0;
    return result;
  }

  integer = (exclusiveMaximum: number): number => {
    if (!Number.isSafeInteger(exclusiveMaximum) || exclusiveMaximum < 1) {
      throw new Error('Model random bound must be a positive safe integer');
    }
    return Math.floor(this.next() * exclusiveMaximum);
  };

  boolean = (): boolean => this.integer(2) === 0;

  pick = <Value>(values: readonly Value[]): Value | undefined =>
    values.length === 0 ? undefined : values[this.integer(values.length)];
}

class DeterministicAuthoritySource implements CommandContext, OpaqueIdSource {
  private readonly shuffleRandom: SeededRandom;
  private readonly integerRandom: SeededRandom;
  private cardCounter = 0;
  private stackCounter = 0;
  private inspectionCounter = 0;
  private workAreaCounter = 0;
  private opaqueCounter = 0;
  private shuffleCounter = 0;
  private randomIntCounter = 0;

  constructor(private readonly seed: number) {
    this.shuffleRandom = new SeededRandom(seed ^ 0xa5a5_5a5a);
    this.integerRandom = new SeededRandom(seed ^ 0x3c6e_f372);
  }

  nextCardId = () =>
    asCardInstanceId(
      `model-card-${this.seed}-${String(++this.cardCounter).padStart(5, '0')}`
    );

  nextStackId = () =>
    asStackId(
      `model-stack-${this.seed}-${String(++this.stackCounter).padStart(5, '0')}`
    );

  nextInspectionId = () =>
    asInspectionId(
      `model-inspection-${this.seed}-${String(++this.inspectionCounter).padStart(5, '0')}`
    );

  nextWorkAreaId = () =>
    asWorkAreaId(
      `model-work-${this.seed}-${String(++this.workAreaCounter).padStart(5, '0')}`
    );

  nextOpaqueId = (kind: 'card' | 'definition'): string =>
    `model-${kind}-alias-${this.seed}-${String(++this.opaqueCounter).padStart(7, '0')}`;

  shuffle = <Value>(values: readonly Value[]): readonly Value[] => {
    this.shuffleCounter += 1;
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const replacement = this.shuffleRandom.integer(index + 1);
      [shuffled[index], shuffled[replacement]] = [
        shuffled[replacement]!,
        shuffled[index]!,
      ];
    }
    return shuffled;
  };

  randomInt = (exclusiveMaximum: number): number => {
    this.randomIntCounter += 1;
    return this.integerRandom.integer(exclusiveMaximum);
  };

  callCounts = () => ({
    cards: this.cardCounter,
    stacks: this.stackCounter,
    inspections: this.inspectionCounter,
    workAreas: this.workAreaCounter,
    opaqueIds: this.opaqueCounter,
    shuffles: this.shuffleCounter,
    randomInts: this.randomIntCounter,
  });
}

const initialSnapshot = (
  seed: number,
  mode: 'solo' | 'multiplayer' = 'multiplayer',
  coachingConsent = false
): RoomAuthoritySnapshot => {
  const created = createEmptyMatch(asMatchId(`model-match-${seed}`), [
    {
      playerId: p1,
      displayName: 'Model Blue',
      cardBackUrl: '/model/blue.png',
    },
    {
      playerId: p2,
      displayName: 'Model Red',
      cardBackUrl: '/model/red.png',
    },
  ]);
  const state = coachingConsent
    ? {
        ...created,
        players: Object.fromEntries(
          Object.entries(created.players).map(([playerId, player]) => [
            playerId,
            { ...player, coachingConsent: true },
          ])
        ),
      }
    : created;
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode,
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {
      [playerOneSessionId]: {
        id: playerOneSessionId,
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      [playerTwoSessionId]: {
        id: playerTwoSessionId,
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      [spectatorSessionId]: {
        id: spectatorSessionId,
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

interface ModelHarness {
  readonly seed: number;
  readonly modelRandom: SeededRandom;
  readonly authoritySource: DeterministicAuthoritySource;
  readonly storage: MemoryDurableStorage;
  readonly generation: () => string;
  readonly policy: AuthorityPolicy;
  store: DurableStore;
  coordinator: RoomAuthorityCoordinator;
  readonly views: Map<string, MatchViewState>;
  readonly priorCommands: Map<
    string,
    {
      readonly envelope: CommandEnvelope;
      readonly result: CommandResultMessage;
    }
  >;
  generationCounter: number;
}

const createHarness = async (
  seed: number,
  mode: 'solo' | 'multiplayer' = 'multiplayer',
  policy: AuthorityPolicy = {
    ...DEFAULT_AUTHORITY_POLICY,
    maximumReplayEventBatches: 8,
  },
  coachingConsent = false
): Promise<ModelHarness> => {
  const storage = new MemoryDurableStorage();
  const authoritySource = new DeterministicAuthoritySource(seed);
  const harness = {
    seed,
    modelRandom: new SeededRandom(seed),
    authoritySource,
    storage,
    generationCounter: 0,
    generation: () => '',
    policy,
    store: undefined as unknown as DurableStore,
    coordinator: undefined as unknown as RoomAuthorityCoordinator,
    views: new Map<string, MatchViewState>(),
    priorCommands: new Map<
      string,
      {
        readonly envelope: CommandEnvelope;
        readonly result: CommandResultMessage;
      }
    >(),
  } satisfies ModelHarness;
  harness.generation = () =>
    `${seed.toString(16).padStart(8, '0')}${(++harness.generationCounter)
      .toString(16)
      .padStart(24, '0')}`;
  harness.store = new DurableRoomSnapshotStore(
    storage,
    () => 0,
    harness.generation
  );
  const snapshot = initialSnapshot(seed, mode, coachingConsent);
  await harness.store.initialize(snapshot);
  harness.coordinator = new RoomAuthorityCoordinator(snapshot, harness.store, {
    commandContext: authoritySource,
    opaqueIds: authoritySource,
    policy,
  });
  return harness;
};

const resultMessage = (
  result: AuthorityProcessResult,
  sessionId: string
): CommandResultMessage => {
  const message = result.deliveries.find(
    (delivery) =>
      delivery.sessionId === sessionId &&
      delivery.message.type === 'CommandResult'
  )?.message;
  if (!message || message.type !== 'CommandResult') {
    throw new Error('Authority result omitted the submitting session result');
  }
  return message;
};

const capturePublishedViews = (
  harness: ModelHarness,
  result: AuthorityProcessResult
): void => {
  for (const delivery of result.deliveries) {
    if (delivery.message.type === 'StatePublication') {
      harness.views.set(
        delivery.sessionId,
        delivery.message.snapshot as unknown as MatchViewState
      );
    }
  }
};

const envelope = (
  snapshot: RoomAuthoritySnapshot,
  sessionId: string,
  commandId: string,
  command: WireGameCommand,
  overrides: Partial<
    Pick<CommandEnvelope, 'clientSequence' | 'lastSeenRevision'>
  > = {}
): CommandEnvelope => {
  const session = snapshot.sessions[sessionId];
  if (!session) throw new Error(`Missing model session ${sessionId}`);
  const candidate = {
    type: 'Command',
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    clientSequence: overrides.clientSequence ?? session.nextClientSequence,
    commandId,
    lastSeenRevision: overrides.lastSeenRevision ?? snapshot.state.revision,
    command,
  };
  const parsed = parseClientFrame(JSON.stringify(candidate));
  if (!parsed.ok || parsed.value.type !== 'Command') {
    throw new Error(
      `Model generated an invalid wire command ${command.type}: ${
        parsed.ok ? 'wrong message type' : JSON.stringify(parsed.issues)
      }`
    );
  }
  return parsed.value;
};

const allProjectedCards = (view: MatchViewState) => [
  ...Object.values(view.zones).flatMap((zone) => zone.cards),
  ...Object.values(view.stacks).flatMap((stack) => [
    ...stack.evolutionCards,
    ...stack.attachmentCards,
  ]),
  ...Object.values(view.workAreas).flatMap((areas) => [
    ...(areas.inspection?.cards ?? []),
    ...(areas.attachmentResolution?.evolutionCards ?? []),
    ...(areas.attachmentResolution?.attachmentCards ?? []),
  ]),
];

const canonicalLeakInPayload = (
  snapshot: RoomAuthoritySnapshot,
  payload: unknown
): string | undefined => {
  const strings: string[] = [];
  const visit = (value: unknown, seen: WeakSet<object>): void => {
    if (typeof value === 'string') {
      strings.push(value);
      return;
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'string') strings.push(key);
      visit(Reflect.get(value, key), seen);
    }
  };
  visit(payload, new WeakSet());
  return [
    ...Object.keys(snapshot.state.cards),
    ...Object.keys(snapshot.state.definitions),
  ].find((identifier) => strings.some((value) => value.includes(identifier)));
};

const assertProjectionSafe = (
  snapshot: RoomAuthoritySnapshot,
  view: MatchViewState
): void => {
  expect(canonicalLeakInPayload(snapshot, view)).toBeUndefined();
  const cards = allProjectedCards(view);
  const knownDefinitionIds = new Set(
    cards.flatMap((card) => (card.kind === 'known' ? [card.definitionId] : []))
  );
  expect(new Set(Object.keys(view.definitions))).toEqual(knownDefinitionIds);
  for (const card of cards) {
    if (card.kind === 'concealed') {
      expect(Object.keys(card).sort()).toEqual(
        ['cardBackUrl', 'id', 'kind', 'ownerId', 'publiclyRevealed'].sort()
      );
    }
  }
};

const assertSnapshotProofAndReplay = (result: AuthorityProcessResult): void => {
  expect(
    authoritySnapshotValidationMatches(
      result.snapshotValidation,
      result.snapshot
    )
  ).toBe(true);
  expect(Object.isFrozen(result.snapshot)).toBe(true);
  expect(collectInvariantProblems(result.snapshot.state)).toEqual([]);
  expect(() =>
    validateAuthoritySnapshot(structuredClone(result.snapshot))
  ).not.toThrow();
  const replayed = replayHistoryStates(result.snapshot.replayHistory).at(-1);
  expect(stableSerialize(replayed)).toBe(
    stableSerialize(result.snapshot.state)
  );
  for (const delivery of result.deliveries) {
    expect(
      canonicalLeakInPayload(result.snapshot, delivery.message),
      `canonical identifier leaked in ${delivery.message.type}`
    ).toBeUndefined();
  }
  const publications = result.deliveries.filter(
    (delivery) => delivery.message.type === 'StatePublication'
  );
  expect(new Set(publications.map((delivery) => delivery.sessionId)).size).toBe(
    publications.length
  );
  for (const delivery of publications) {
    const session = result.snapshot.sessions[delivery.sessionId];
    expect(session?.active).toBe(true);
    if (delivery.message.type !== 'StatePublication' || !session) continue;
    const delivered = delivery.message.snapshot as unknown as MatchViewState;
    expect(delivered.viewer).toEqual(session.viewer);
    const independentlyProjected = projectRecipient(
      result.snapshot.state,
      session.viewer,
      result.snapshot.identities,
      {
        nextOpaqueId: () => {
          throw new Error('Publication omitted a required recipient alias');
        },
      }
    ).snapshot;
    expect(stableSerialize(delivered)).toBe(
      stableSerialize(independentlyProjected)
    );
  }
  const acceptedCommitted = result.deliveries.some(
    (delivery) =>
      delivery.message.type === 'CommandResult' &&
      delivery.message.accepted &&
      result.committed
  );
  if (acceptedCommitted) {
    expect(publications.map((delivery) => delivery.sessionId).sort()).toEqual(
      Object.values(result.snapshot.sessions)
        .filter((session) => session.active)
        .map((session) => session.id)
        .sort()
    );
  }
  for (const view of harnessViews(result)) {
    assertProjectionSafe(result.snapshot, view);
  }
};

const harnessViews = (result: AuthorityProcessResult): MatchViewState[] =>
  result.deliveries.flatMap((delivery) =>
    delivery.message.type === 'StatePublication'
      ? [delivery.message.snapshot as unknown as MatchViewState]
      : []
  );

const submitBootstrap = async (
  harness: ModelHarness,
  playerId: PlayerId,
  command: WireGameCommand,
  label: string
): Promise<AuthorityProcessResult> => {
  const sessionId = sessionIdForPlayer(playerId);
  const current = harness.coordinator.currentSnapshot();
  const submitted = envelope(
    current,
    sessionId,
    `model-bootstrap-${harness.seed}-${label}`,
    command
  );
  const result = await harness.coordinator.submit(submitted);
  capturePublishedViews(harness, result);
  const message = resultMessage(result, sessionId);
  expect(result.committed).toBe(true);
  expect(message.accepted).toBe(true);
  harness.priorCommands.set(submitted.commandId, {
    envelope: submitted,
    result: message,
  });
  assertSnapshotProofAndReplay(result);
  return result;
};

const bootstrapHarness = async (
  harness: ModelHarness,
  coverage?: ModelCoverage
): Promise<void> => {
  for (const playerId of [p1, p2]) {
    const sessionId = sessionIdForPlayer(playerId);
    const view = projectRecipient(
      harness.coordinator.currentSnapshot().state,
      { kind: 'player', playerId },
      emptyProjectionIdentityState(),
      harness.authoritySource
    ).snapshot;
    const load = MODEL_COMMAND_GENERATORS.LoadDeck({
      view,
      random: harness.modelRandom,
      seed: harness.seed,
    });
    if (coverage) recordGeneration(coverage, 'LoadDeck', load);
    const loaded = await submitBootstrap(
      harness,
      playerId,
      load,
      `load-${playerId}`
    );
    if (coverage) {
      recordCommandOutcome(coverage, load, loaded, sessionId);
    }
    const setupCommand = {
      type: 'SetupPlayer',
      targetPlayerId: playerId,
    } as const;
    if (coverage) recordGeneration(coverage, 'SetupPlayer', setupCommand);
    const setup = await submitBootstrap(
      harness,
      playerId,
      setupCommand,
      `setup-${playerId}`
    );
    if (coverage)
      recordCommandOutcome(coverage, setupCommand, setup, sessionId);
  }
};

type ModelOperation =
  | 'valid'
  | 'gap'
  | 'future-revision'
  | 'duplicate'
  | 'stale'
  | 'forged'
  | 'spectator';

const operationForStep = (step: number): ModelOperation => {
  switch (step % 12) {
    case 0:
      return 'gap';
    case 1:
      return 'duplicate';
    case 2:
      return 'stale';
    case 3:
      return 'forged';
    case 4:
      return 'spectator';
    case 5:
      return 'future-revision';
    default:
      return 'valid';
  }
};

const RANDOM_MODEL_COMMAND_TYPES = GENERATED_MODEL_COMMAND_TYPES.flatMap(
  (type) =>
    MODEL_COMMAND_REGISTRY[type].family === 'lifecycle'
      ? [type]
      : [type, type, type, type]
);

const generatedCommand = (
  harness: ModelHarness,
  sessionId: string,
  coverage: ModelCoverage
): WireGameCommand => {
  const view = harness.views.get(sessionId);
  if (!view) throw new Error(`No projection for ${sessionId}`);
  const offset = harness.modelRandom.integer(RANDOM_MODEL_COMMAND_TYPES.length);
  for (
    let attempt = 0;
    attempt < RANDOM_MODEL_COMMAND_TYPES.length;
    attempt += 1
  ) {
    const type =
      RANDOM_MODEL_COMMAND_TYPES[
        (offset + attempt) % RANDOM_MODEL_COMMAND_TYPES.length
      ]!;
    const command = MODEL_COMMAND_GENERATORS[type]({
      view,
      random: harness.modelRandom,
      seed: harness.seed,
    }) as WireGameCommand | undefined;
    recordGeneration(coverage, type, command);
    if (command) return command;
  }
  const fallback = { type: 'FlipCoin' } as const;
  recordGeneration(coverage, 'FlipCoin', fallback);
  return fallback;
};

const forgedCommand = (
  harness: ModelHarness,
  actorSessionId: string,
  otherSessionId: string
): WireGameCommand => {
  const actorView = harness.views.get(actorSessionId);
  const otherView = harness.views.get(otherSessionId);
  const foreign = otherView
    ? harness.modelRandom.pick(allProjectedCards(otherView))
    : undefined;
  const actorPlayerId =
    actorView?.viewer.kind === 'player' ? actorView.viewer.playerId : undefined;
  const destination =
    actorPlayerId && actorView
      ? Object.values(actorView.zones).find(
          (zone) => zone.ownerId === actorPlayerId && zone.kind === 'discard'
        )
      : undefined;
  return {
    type: 'MoveCard',
    cardId: foreign?.id ?? `forged-card-${harness.seed}`,
    expectedSourceZoneId: `forged-source-${harness.seed}`,
    destinationZoneId: destination?.id ?? `forged-destination-${harness.seed}`,
  };
};

interface ModelCoverage {
  readonly acceptedByFamily: Map<ModelCommandFamily, number>;
  readonly acceptedByType: Map<string, number>;
  readonly rejectionByOperation: Map<ModelOperation, number>;
  readonly commandByType: Map<WireGameCommandType, CommandCoverageCounters>;
  readonly commandByVariant: Map<string, CommandCoverageCounters>;
  readonly observedScenarios: Set<ScenarioModelCommandType>;
  announcements: number;
  compactionTransitions: number;
  frontierHits: number;
  reconstructions: number;
}

interface CommandCoverageCounters {
  generated: number;
  yielded: number;
  accepted: number;
  persistedRejected: number;
  immediateRejected: number;
}

const emptyCommandCoverage = (): CommandCoverageCounters => ({
  generated: 0,
  yielded: 0,
  accepted: 0,
  persistedRejected: 0,
  immediateRejected: 0,
});

const emptyCoverage = (): ModelCoverage => ({
  acceptedByFamily: new Map(),
  acceptedByType: new Map(),
  rejectionByOperation: new Map(),
  commandByType: new Map(),
  commandByVariant: new Map(),
  observedScenarios: new Set(),
  announcements: 0,
  compactionTransitions: 0,
  frontierHits: 0,
  reconstructions: 0,
});

const coverageReport = (coverage: ModelCoverage) => ({
  byType: Object.fromEntries(
    (Object.keys(MODEL_COMMAND_REGISTRY) as WireGameCommandType[]).map(
      (type) => [
        type,
        coverage.commandByType.get(type) ?? emptyCommandCoverage(),
      ]
    )
  ),
  byVariant: Object.fromEntries(
    [...coverage.commandByVariant.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ),
  acceptedByFamily: Object.fromEntries(
    [...coverage.acceptedByFamily.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ),
  rejectionByOperation: Object.fromEntries(
    [...coverage.rejectionByOperation.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ),
  announcements: coverage.announcements,
  compactionTransitions: coverage.compactionTransitions,
  frontierHits: coverage.frontierHits,
  reconstructions: coverage.reconstructions,
});

const increment = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const commandCounters = <Key>(
  map: Map<Key, CommandCoverageCounters>,
  key: Key
): CommandCoverageCounters => {
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyCommandCoverage();
  map.set(key, created);
  return created;
};

const commandVariant = (command: WireGameCommand): string => {
  switch (command.type) {
    case 'LoadDeck':
    case 'ResetPlayer':
    case 'SetupPlayer':
      return `${command.type}:target=${command.targetPlayerId ? 'explicit' : 'omitted'}`;
    case 'MoveCard':
      return `${command.type}:index=${command.destinationIndex ?? 'omitted'}`;
    case 'MoveCardToPlay':
      return `${command.type}:${command.slot}:target=${command.targetStackId ? 'explicit' : 'omitted'}:index=${command.benchIndex ?? 'omitted'}`;
    case 'MoveCardFromStack':
    case 'MoveInspectedCard':
    case 'MoveStagedCard':
      return `${command.type}:index=${command.destinationIndex ?? 'omitted'}`;
    case 'MovePlayStack':
      return `${command.type}:${command.expectedSourceSlot}->${command.destinationSlot}:target=${command.targetStackId ? 'explicit' : 'omitted'}`;
    case 'RestoreStagedStack':
      return `${command.type}:${command.destinationSlot}:index=${command.benchIndex ?? 'omitted'}`;
    case 'ResolveStagedCards':
    case 'ResolveInspectionCards':
    case 'ResolveLooseBoardCards':
      return `${command.type}:${command.destination}`;
    case 'MoveCardToDeckTop':
    case 'MoveCardToDeckBottom':
    case 'ShuffleCardIntoDeck':
    case 'SwapCardWithDeckTop':
    case 'BeginCardInspection':
    case 'EndPrivateInspection':
      return command.type;
    case 'MovePrizesToDeckBottom':
    case 'FlipCoin':
      return command.type;
    case 'ShuffleZone':
      return command.type;
    case 'DrawCards':
    case 'DiscardHandAndDraw':
    case 'ShuffleHandIntoDeckAndDraw':
    case 'ShuffleHandToDeckBottomAndDraw':
      return `${command.type}:count=${command.count}`;
    case 'PlayRandomCardFaceDown':
    case 'StartTurn':
    case 'DeclareAttack':
    case 'PassTurn':
    case 'ApplySoloUndo':
      return command.type;
    case 'MoveZoneContents':
      return command.type;
    case 'ShuffleZoneIntoDeck':
    case 'ShuffleZoneToDeckBottom':
      return command.type;
    case 'SetDamage':
      return `${command.type}:${command.damage === null ? 'null' : command.damage}`;
    case 'SetSpecialCondition':
      return `${command.type}:${command.condition === null ? 'null' : command.condition}`;
    case 'SetAbilityUsed':
    case 'SetCardAbilityUsed':
      return `${command.type}:${command.used}`;
    case 'RotateStack':
      return `${command.type}:${command.rotationQuarterTurns}`;
    case 'SetCardOrientation':
      return `${command.type}:${command.orientationQuarterTurns}`;
    case 'ChangeCardCategory':
      return `${command.type}:${command.category}`;
    case 'SetCardFace':
      return `${command.type}:${command.face}`;
    case 'SetPublicReveal':
      return `${command.type}:${command.revealed}`;
    case 'SetZonePublicReveal':
      return `${command.type}:${command.revealed}`;
    case 'BeginZoneInspection':
      return command.type;
    case 'ExtractDeckCardsForInspection':
      return `${command.type}:${command.edge}:${command.visibility}:count=${command.count}`;
    case 'CloseInspection':
      return `${command.type}:${command.returnTo}`;
    case 'SetOncePerGameMarker':
      return `${command.type}:${command.marker}:${command.used}`;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
};

const recordGeneration = (
  coverage: ModelCoverage,
  type: WireGameCommandType,
  command: WireGameCommand | undefined
): void => {
  const byType = commandCounters(coverage.commandByType, type);
  byType.generated += 1;
  if (!command) return;
  byType.yielded += 1;
  const byVariant = commandCounters(
    coverage.commandByVariant,
    `${command.type}/${commandVariant(command)}`
  );
  byVariant.generated += 1;
  byVariant.yielded += 1;
};

const recordCommandOutcome = (
  coverage: ModelCoverage,
  command: WireGameCommand,
  result: AuthorityProcessResult,
  sessionId: string
): void => {
  const fields: readonly CommandCoverageCounters[] = [
    commandCounters(coverage.commandByType, command.type),
    commandCounters(
      coverage.commandByVariant,
      `${command.type}/${commandVariant(command)}`
    ),
  ];
  const message = resultMessage(result, sessionId);
  for (const counters of fields) {
    if (result.committed && message.accepted) counters.accepted += 1;
    else if (result.committed) counters.persistedRejected += 1;
    else if (!message.accepted) counters.immediateRejected += 1;
  }
  const metadata = MODEL_COMMAND_REGISTRY[command.type];
  if (
    result.committed &&
    message.accepted &&
    metadata.coverage === 'scenario'
  ) {
    coverage.observedScenarios.add(command.type as ScenarioModelCommandType);
  }
};

const playerView = (
  harness: ModelHarness,
  playerId: PlayerId
): MatchViewState => {
  const view = harness.views.get(sessionIdForPlayer(playerId));
  if (!view) throw new Error(`Missing model view for ${playerId}`);
  return view;
};

const viewZone = (
  harness: ModelHarness,
  playerId: PlayerId,
  kind: MatchViewState['zones'][string]['kind']
) => {
  const zone = Object.values(playerView(harness, playerId).zones).find(
    (candidate) => candidate.ownerId === playerId && candidate.kind === kind
  );
  if (!zone) throw new Error(`Missing ${kind} view for ${playerId}`);
  return zone;
};

const zoneViewedBy = (
  harness: ModelHarness,
  viewerId: PlayerId,
  ownerId: PlayerId,
  kind: MatchViewState['zones'][string]['kind']
) => {
  const zone = Object.values(playerView(harness, viewerId).zones).find(
    (candidate) => candidate.ownerId === ownerId && candidate.kind === kind
  );
  if (!zone) {
    throw new Error(`Missing ${ownerId} ${kind} view for ${viewerId}`);
  }
  return zone;
};

const submitScenarioCommand = async (
  harness: ModelHarness,
  coverage: ModelCoverage,
  sessionId: string,
  label: string,
  command: WireGameCommand,
  expected: { readonly accepted?: boolean; readonly committed?: boolean } = {}
): Promise<AuthorityProcessResult> => {
  recordGeneration(coverage, command.type, command);
  const before = harness.coordinator.currentSnapshot();
  const submitted = envelope(
    before,
    sessionId,
    `model-scenario-${harness.seed}-${label}`,
    command
  );
  const result = await harness.coordinator.submit(submitted);
  const message = resultMessage(result, sessionId);
  expect(message.accepted).toBe(expected.accepted ?? true);
  expect(result.committed).toBe(expected.committed ?? true);
  recordCommandOutcome(coverage, command, result, sessionId);
  if (result.committed && message.accepted) {
    increment(coverage.acceptedByType, command.type);
    increment(
      coverage.acceptedByFamily,
      MODEL_COMMAND_REGISTRY[command.type].family
    );
  }
  capturePublishedViews(harness, result);
  assertSnapshotProofAndReplay(result);
  if (result.committed) {
    const journal = harness.storage.values.get(
      journalStorageKey('authority', result.snapshot.authorityVersion)
    ) as StoredAuthorityJournalEntry | undefined;
    expect(journal?.outcome).toMatchObject({
      commandId: submitted.commandId,
      accepted: message.accepted,
    });
    if (message.accepted) {
      expect(journal?.eventBatch).toBeDefined();
      expect(
        stableSerialize(applyEventBatch(before.state, journal!.eventBatch!))
      ).toBe(stableSerialize(result.snapshot.state));
    } else {
      expect(journal?.eventBatch).toBeUndefined();
      expect(stableSerialize(result.snapshot.state)).toBe(
        stableSerialize(before.state)
      );
    }
    harness.priorCommands.set(submitted.commandId, {
      envelope: submitted,
      result: message,
    });
  }
  return result;
};

const commandResultJson = (
  result: AuthorityProcessResult,
  sessionId: string
): string => JSON.stringify(resultMessage(result, sessionId));

const reconstructHarness = async (harness: ModelHarness): Promise<void> => {
  const before = harness.coordinator.currentSnapshot();
  const serialized = stableSerialize(before);
  const previousViews = new Map(harness.views);
  harness.store = new DurableRoomSnapshotStore(
    harness.storage,
    () => 0,
    harness.generation
  );
  const restored = await RoomAuthorityCoordinator.restore(harness.store, {
    commandContext: harness.authoritySource,
    opaqueIds: harness.authoritySource,
    policy: harness.policy,
  });
  if (!restored) throw new Error('Model reconstruction lost the room');
  harness.coordinator = restored;
  expect(stableSerialize(restored.currentSnapshot())).toBe(serialized);

  let identities = restored.currentSnapshot().identities;
  const noNewAliases: OpaqueIdSource = {
    nextOpaqueId: () => {
      throw new Error(
        'Reconstruction required a new identity for unchanged state'
      );
    },
  };
  for (const session of Object.values(restored.currentSnapshot().sessions)) {
    if (!session.active) continue;
    const projected = projectRecipient(
      restored.currentSnapshot().state,
      session.viewer,
      identities,
      noNewAliases
    );
    identities = projected.identities;
    expect(stableSerialize(projected.snapshot)).toBe(
      stableSerialize(previousViews.get(session.id))
    );
    assertProjectionSafe(restored.currentSnapshot(), projected.snapshot);
  }
  expect(stableSerialize(identities)).toBe(
    stableSerialize(restored.currentSnapshot().identities)
  );
};

const traceFailure = (
  error: unknown,
  input: {
    readonly seed: number;
    readonly step: number;
    readonly operation: ModelOperation;
    readonly actor: string;
    readonly command: WireGameCommand;
    readonly trace: readonly string[];
  }
): never => {
  const cause =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const trace = JSON.stringify(input.trace.slice(-12)).slice(0, 4_000);
  throw new Error(
    `model failure seed=${input.seed} step=${input.step} operation=${input.operation} actor=${input.actor} command=${input.command.type} trace=${trace}\n${cause}`
  );
};

const runSeed = async (
  seed: number,
  steps: number,
  coverage: ModelCoverage
): Promise<string> => {
  const harness = await createHarness(seed);
  await bootstrapHarness(harness, coverage);
  const trace: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    const operation = operationForStep(step);
    const actor = harness.modelRandom.boolean() ? p1 : p2;
    const actorSessionId = sessionIdForPlayer(actor);
    const otherSessionId = sessionIdForPlayer(actor === p1 ? p2 : p1);
    const current = harness.coordinator.currentSnapshot();
    let submitted: CommandEnvelope;
    let expectedImmediate = false;
    let duplicateExpected: string | undefined;

    if (operation === 'duplicate') {
      const retainedCommandIds = new Set(
        current.sessions[actorSessionId]!.recentOutcomes.map(
          (outcome) => outcome.commandId
        )
      );
      const candidates = [...harness.priorCommands.values()].filter(
        (entry) =>
          entry.envelope.sessionId === actorSessionId &&
          retainedCommandIds.has(entry.envelope.commandId)
      );
      const prior = harness.modelRandom.pick(candidates);
      if (prior) {
        submitted = prior.envelope;
        duplicateExpected = JSON.stringify(prior.result);
        expectedImmediate = true;
      } else {
        submitted = envelope(current, actorSessionId, `model-${seed}-${step}`, {
          type: 'FlipCoin',
        });
      }
    } else if (operation === 'gap') {
      submitted = envelope(
        current,
        actorSessionId,
        `model-${seed}-${step}`,
        { type: 'FlipCoin' },
        {
          clientSequence:
            current.sessions[actorSessionId]!.nextClientSequence + 1,
        }
      );
      expectedImmediate = true;
    } else if (operation === 'future-revision') {
      submitted = envelope(
        current,
        actorSessionId,
        `model-${seed}-${step}`,
        { type: 'FlipCoin' },
        { lastSeenRevision: current.state.revision + 1 }
      );
      expectedImmediate = true;
    } else if (operation === 'stale') {
      submitted = envelope(
        current,
        actorSessionId,
        `model-${seed}-${step}`,
        { type: 'SetupPlayer', targetPlayerId: actor },
        { lastSeenRevision: Math.max(0, current.state.revision - 1) }
      );
      if (current.state.revision === 0) expectedImmediate = false;
    } else if (operation === 'forged') {
      submitted = envelope(
        current,
        actorSessionId,
        `model-${seed}-${step}`,
        forgedCommand(harness, actorSessionId, otherSessionId)
      );
    } else if (operation === 'spectator') {
      submitted = envelope(
        current,
        spectatorSessionId,
        `model-${seed}-${step}`,
        { type: 'FlipCoin' }
      );
    } else {
      submitted = envelope(
        current,
        actorSessionId,
        `model-${seed}-${step}`,
        generatedCommand(harness, actorSessionId, coverage)
      );
    }

    const submittingSessionId = submitted.sessionId;
    const before = harness.coordinator.currentSnapshot();
    const beforeSnapshot = stableSerialize(before);
    const beforeState = stableSerialize(before.state);
    const beforeReplay = stableSerialize(before.replayHistory);
    const beforeTransactions = harness.storage.transactionCalls;
    const beforePuts = harness.storage.putCalls;

    try {
      const result = await harness.coordinator.submit(submitted);
      const message = resultMessage(result, submittingSessionId);
      recordCommandOutcome(
        coverage,
        submitted.command,
        result,
        submittingSessionId
      );
      const after = result.snapshot;
      trace.push(
        `${step}:${operation}:${submittingSessionId}:${submitted.command.type}:${message.accepted ? 'accepted' : message.code}`
      );
      if (!message.accepted) {
        increment(coverage.rejectionByOperation, operation);
      }

      if (expectedImmediate) {
        expect(result.committed).toBe(false);
        expect(stableSerialize(after)).toBe(beforeSnapshot);
        expect(harness.storage.transactionCalls).toBe(beforeTransactions);
        expect(harness.storage.putCalls).toBe(beforePuts);
      } else {
        expect(result.committed).toBe(true);
        expect(after.authorityVersion).toBe(before.authorityVersion + 1);
        expect(after.sessions[submittingSessionId]!.nextClientSequence).toBe(
          before.sessions[submittingSessionId]!.nextClientSequence + 1
        );
        expect(harness.storage.transactionCalls).toBe(beforeTransactions + 1);
        expect(result.timing.breakdown.frontierFastPathHit).toBe(1);
        coverage.frontierHits += 1;
        const journal = harness.storage.values.get(
          journalStorageKey('authority', after.authorityVersion)
        ) as StoredAuthorityJournalEntry | undefined;
        expect(journal?.outcome).toMatchObject({
          commandId: submitted.commandId,
          clientSequence: submitted.clientSequence,
          accepted: message.accepted,
          revision: message.revision,
        });
        if (message.accepted) {
          expect(after.state.revision).toBe(before.state.revision + 1);
          expect(journal?.eventBatch).toMatchObject({
            revision: after.state.revision,
          });
          expect(
            stableSerialize(applyEventBatch(before.state, journal!.eventBatch!))
          ).toBe(stableSerialize(after.state));
          const metadata = MODEL_COMMAND_REGISTRY[submitted.command.type];
          increment(coverage.acceptedByFamily, metadata.family);
          increment(coverage.acceptedByType, submitted.command.type);
          if (
            result.deliveries.some(
              (delivery) =>
                delivery.message.type === 'StatePublication' &&
                (delivery.message.presentationEvents?.length ?? 0) > 0
            )
          ) {
            coverage.announcements += 1;
          }
        } else {
          expect(journal?.eventBatch).toBeUndefined();
          expect(stableSerialize(after.state)).toBe(beforeState);
          expect(stableSerialize(after.replayHistory)).toBe(beforeReplay);
        }
        harness.priorCommands.set(submitted.commandId, {
          envelope: submitted,
          result: message,
        });
      }
      if (duplicateExpected !== undefined) {
        expect(commandResultJson(result, submittingSessionId)).toBe(
          duplicateExpected
        );
      }
      capturePublishedViews(harness, result);
      assertSnapshotProofAndReplay(result);
      if (
        after.replayHistory.baseState.revision >
        before.replayHistory.baseState.revision
      ) {
        coverage.compactionTransitions += 1;
      }

      if ((step + 1) % 10 === 0) {
        await reconstructHarness(harness);
        coverage.reconstructions += 1;
      }
    } catch (error) {
      traceFailure(error, {
        seed,
        step,
        operation,
        actor,
        command: submitted.command,
        trace,
      });
    }
  }
  if (steps % 10 !== 0) {
    await reconstructHarness(harness);
    coverage.reconstructions += 1;
  }
  return stableSerialize({
    snapshot: harness.coordinator.currentSnapshot(),
    trace,
  });
};

const ownedKnownZoneCards = (
  harness: ModelHarness,
  playerId: PlayerId,
  category?: 'Pokémon' | 'Trainer' | 'Energy'
) =>
  Object.values(playerView(harness, playerId).zones).flatMap((zone) =>
    zone.ownerId === playerId
      ? zone.cards.flatMap((card) =>
          card.kind === 'known' &&
          (category === undefined || card.category === category)
            ? [{ card, zone }]
            : []
        )
      : []
  );

const prepareStagedEvolution = async (
  harness: ModelHarness,
  coverage: ModelCoverage,
  label: string,
  retainedEvolutionCount: 1 | 2
): Promise<void> => {
  const required = retainedEvolutionCount + 2;
  const handCards = viewZone(harness, p1, 'hand').cards.flatMap((card) =>
    card.kind === 'known' ? [card] : []
  );
  expect(handCards.length).toBeGreaterThanOrEqual(required);
  for (const [index, card] of handCards.slice(0, required).entries()) {
    if (card.category === 'Pokémon') continue;
    await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      `${label}-category-${index}`,
      {
        type: 'ChangeCardCategory',
        cardId: card.id,
        expectedSourceId: viewZone(harness, p1, 'hand').id,
        category: 'Pokémon',
      }
    );
  }
  const pokemon = ownedKnownZoneCards(harness, p1, 'Pokémon');
  expect(pokemon.length).toBeGreaterThan(retainedEvolutionCount);
  const [base, ...evolutions] = pokemon;
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    `${label}-base`,
    {
      type: 'MoveCardToPlay',
      cardId: base!.card.id,
      expectedSourceZoneId: base!.zone.id,
      boardPlayerId: p1,
      slot: 'active',
    }
  );
  for (let index = 0; index <= retainedEvolutionCount; index += 1) {
    const source = evolutions[index]!;
    const stackId = playerView(harness, p1).boards[p1]!.activeStackId!;
    await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      `${label}-evolution-${index}`,
      {
        type: 'MoveCardToPlay',
        cardId: source.card.id,
        expectedSourceZoneId: source.zone.id,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      }
    );
  }
  const view = playerView(harness, p1);
  const stackId = view.boards[p1]!.activeStackId!;
  const top = view.stacks[stackId]!.evolutionCards.at(-1)!;
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    `${label}-depart`,
    {
      type: 'MoveCardFromStack',
      cardId: top.id,
      expectedStackId: stackId,
      destinationZoneId: viewZone(harness, p1, 'discard').id,
    }
  );
  expect(
    playerView(harness, p1).workAreas[p1]?.attachmentResolution
  ).not.toBeNull();
};

const openInspection = async (
  harness: ModelHarness,
  coverage: ModelCoverage,
  label: string,
  visibility: 'private' | 'public' = 'private',
  edge: 'top' | 'bottom' = 'top'
): Promise<void> => {
  await submitScenarioCommand(harness, coverage, playerOneSessionId, label, {
    type: 'ExtractDeckCardsForInspection',
    ownerPlayerId: p1,
    count: 2,
    edge,
    visibility,
  });
  expect(playerView(harness, p1).workAreas[p1]?.inspection).not.toBeNull();
};

const warmGeneratedPreconditions = async (
  coverage: ModelCoverage
): Promise<void> => {
  const harness = await createHarness(0x7000_0040);
  await bootstrapHarness(harness, coverage);
  const hand = viewZone(harness, p1, 'hand');
  const card = hand.cards[0]!;
  if (card.kind !== 'known') throw new Error('Warm-up hand card is concealed');
  if (card.category !== 'Pokémon') {
    await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      'warm-category',
      {
        type: 'ChangeCardCategory',
        cardId: card.id,
        expectedSourceId: hand.id,
        category: 'Pokémon',
      }
    );
  }
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    'warm-stack',
    {
      type: 'MoveCardToPlay',
      cardId: card.id,
      expectedSourceZoneId: hand.id,
      boardPlayerId: p1,
      slot: 'active',
    }
  );
  let view = playerView(harness, p1);
  const stackId = view.boards[p1]!.activeStackId!;
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    'warm-damage',
    { type: 'SetDamage', stackId, damage: 30 }
  );
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    'warm-condition',
    { type: 'SetSpecialCondition', stackId, condition: 'P' }
  );
  view = playerView(harness, p1);
  const top = view.stacks[stackId]!.evolutionCards.at(-1)!;
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    'warm-orientation',
    { type: 'SetCardOrientation', cardId: top.id, orientationQuarterTurns: 1 }
  );
  await submitScenarioCommand(
    harness,
    coverage,
    playerOneSessionId,
    'warm-stack-departure',
    {
      type: 'MoveCardFromStack',
      cardId: top.id,
      expectedStackId: stackId,
      destinationZoneId: viewZone(harness, p1, 'discard').id,
    }
  );
  await reconstructHarness(harness);
};

describe('seeded authority/storage model', () => {
  it('is byte deterministic for the same seed and retains named regression seeds', async () => {
    for (const seed of MODEL_REGRESSION_SEEDS) {
      const first = await runSeed(seed, 24, emptyCoverage());
      const second = await runSeed(seed, 24, emptyCoverage());
      expect(second).toBe(first);
    }
  }, 120_000);

  it(
    'runs the configurable generated command/recovery matrix',
    async () => {
      const seedCount = integerEnvironment('PTCGSIM_MODEL_COUNT', 100, 10_000);
      const steps = integerEnvironment('PTCGSIM_MODEL_STEPS', 50, 10_000);
      const startSeed = configuredStartSeed();
      const coverage = emptyCoverage();
      await warmGeneratedPreconditions(coverage);
      for (let index = 0; index < seedCount; index += 1) {
        await runSeed(
          (startSeed + Math.imul(index, 0x9e37_79b9)) >>> 0,
          steps,
          coverage
        );
      }

      const scheduledOperations = [
        ['gap', 0],
        ['future-revision', 5],
        ['stale', 2],
        ['forged', 3],
        ['spectator', 4],
      ] as const;
      for (const [operation, firstStep] of scheduledOperations.filter(
        ([, firstStep]) => steps > firstStep
      )) {
        expect(
          coverage.rejectionByOperation.get(operation) ?? 0
        ).toBeGreaterThan(0);
      }
      if (seedCount * steps >= 5_000) {
        for (const [type, metadata] of Object.entries(
          MODEL_COMMAND_REGISTRY
        ) as [WireGameCommandType, ModelCommandCoverage][]) {
          if (metadata.coverage !== 'generated') continue;
          const counters = coverage.commandByType.get(type);
          expect(
            counters?.yielded ?? 0,
            `yielded command ${type}`
          ).toBeGreaterThan(0);
          expect(
            counters?.accepted ?? 0,
            `accepted command ${type}`
          ).toBeGreaterThan(0);
        }
        for (const family of [
          'lifecycle',
          'movement',
          'stack-work-area',
          'shuffle-random',
          'bulk',
          'markers-annotations',
          'visibility-inspection',
          'table-announcement',
        ] as const) {
          expect(
            coverage.acceptedByFamily.get(family) ?? 0,
            `accepted family ${family}`
          ).toBeGreaterThan(0);
        }
        expect(coverage.announcements).toBeGreaterThan(0);
        expect(coverage.compactionTransitions).toBeGreaterThan(0);
        expect(coverage.frontierHits).toBeGreaterThan(0);
      }
      expect(coverage.reconstructions).toBe(seedCount * Math.ceil(steps / 10));
      if (process.env.PTCGSIM_MODEL_REPORT === '1') {
        console.info(
          `PTCGSIM_MODEL_COVERAGE ${JSON.stringify(coverageReport(coverage))}`
        );
      }
    },
    MODEL_MATRIX_TIMEOUT_MS
  );
});

describe('named model scenarios', () => {
  it('keeps every wire variant explicit in both registries', () => {
    expect(parseIntegerEnvironment('MODEL_TEST', undefined, 7, 10)).toBe(7);
    expect(parseIntegerEnvironment('MODEL_TEST', '9', 7, 10)).toBe(9);
    expect(() => parseIntegerEnvironment('MODEL_TEST', '0', 7, 10)).toThrow(
      'MODEL_TEST must be an integer from 1 through 10'
    );
    expect(() => parseIntegerEnvironment('MODEL_TEST', '11', 7, 10)).toThrow(
      'MODEL_TEST must be an integer from 1 through 10'
    );
    expect(() => parseIntegerEnvironment('MODEL_TEST', '1.5', 7, 10)).toThrow(
      'MODEL_TEST must be an integer from 1 through 10'
    );
    expect(Object.keys(MODEL_COMMAND_REGISTRY)).toHaveLength(48);
    expect(new Set(Object.keys(MODEL_COMMAND_GENERATORS))).toEqual(
      new Set(Object.keys(MODEL_COMMAND_REGISTRY))
    );
    const expected = new Set<ScenarioModelCommandType>([
      'MoveInspectedCard',
      'MoveStagedCard',
      'RestoreStagedStack',
      'ResolveStagedCards',
      'ResolveInspectionCards',
      'CloseInspection',
      'ApplySoloUndo',
    ]);
    const actual = new Set(
      Object.entries(MODEL_COMMAND_REGISTRY).flatMap(([type, metadata]) =>
        metadata.coverage === 'scenario'
          ? [type as ScenarioModelCommandType]
          : []
      )
    );
    expect(actual).toEqual(expected);
  });

  it('detects a canonical identifier hidden in presentation metadata', async () => {
    const harness = await createHarness(0x7000_0000);
    await bootstrapHarness(harness);
    const snapshot = harness.coordinator.currentSnapshot();
    const cardId = Object.keys(snapshot.state.cards)[0]!;

    expect(
      canonicalLeakInPayload(snapshot, {
        type: 'StatePublication',
        presentationEvents: [
          { type: 'TaintedTestEvent', message: `moved ${cardId}` },
        ],
      })
    ).toBe(cardId);
    await reconstructHarness(harness);
  });

  it('executes every hard-precondition scenario through authority and durable storage', async () => {
    const coverage = emptyCoverage();
    const work = await createHarness(0x7000_0001);
    await bootstrapHarness(work, coverage);
    await prepareStagedEvolution(work, coverage, 'staged-resolve', 2);
    let staged = playerView(work, p1).workAreas[p1]!.attachmentResolution!;
    await submitScenarioCommand(
      work,
      coverage,
      playerOneSessionId,
      'move-staged',
      {
        type: 'MoveStagedCard',
        cardId: staged.evolutionCards[0]!.id,
        expectedWorkAreaId: staged.id,
        destinationZoneId: viewZone(work, p1, 'discard').id,
        destinationIndex: 0,
      }
    );
    staged = playerView(work, p1).workAreas[p1]!.attachmentResolution!;
    await submitScenarioCommand(
      work,
      coverage,
      playerOneSessionId,
      'resolve-staged',
      {
        type: 'ResolveStagedCards',
        expectedWorkAreaId: staged.id,
        destination: 'shuffleIntoDeck',
      }
    );

    await openInspection(work, coverage, 'inspection-move', 'private', 'top');
    let inspection = playerView(work, p1).workAreas[p1]!.inspection!;
    await submitScenarioCommand(
      work,
      coverage,
      playerOneSessionId,
      'move-inspected',
      {
        type: 'MoveInspectedCard',
        cardId: inspection.cards[0]!.id,
        expectedWorkAreaId: inspection.id,
        destinationZoneId: viewZone(work, p1, 'hand').id,
        destinationIndex: 0,
      }
    );
    inspection = playerView(work, p1).workAreas[p1]!.inspection!;
    await submitScenarioCommand(
      work,
      coverage,
      playerOneSessionId,
      'resolve-inspection',
      {
        type: 'ResolveInspectionCards',
        expectedWorkAreaId: inspection.id,
        destination: 'shuffleToDeckBottom',
      }
    );

    await openInspection(
      work,
      coverage,
      'inspection-close',
      'public',
      'bottom'
    );
    const projectedInspection = playerView(work, p1).workAreas[p1]!.inspection!;
    expect(projectedInspection).not.toHaveProperty('inspectionId');
    const canonicalInspection =
      work.coordinator.currentSnapshot().state.workAreas[p1]!.inspection!;
    await submitScenarioCommand(
      work,
      coverage,
      playerOneSessionId,
      'close-inspection-core-only',
      {
        type: 'CloseInspection',
        // Known protocol gap: the public work-area projection exposes only the
        // work-area ID, while this command still requires the canonical token.
        inspectionId: canonicalInspection.inspectionId,
        returnTo: 'bottom',
      }
    );

    const restore = await createHarness(0x7000_0002);
    await bootstrapHarness(restore, coverage);
    await prepareStagedEvolution(restore, coverage, 'staged-restore', 1);
    const restoreView = playerView(restore, p1);
    const restoreArea = restoreView.workAreas[p1]!.attachmentResolution!;
    await submitScenarioCommand(
      restore,
      coverage,
      playerOneSessionId,
      'restore-staged',
      {
        type: 'RestoreStagedStack',
        expectedWorkAreaId: restoreArea.id,
        expectedActiveStackId: restoreView.boards[p1]!.activeStackId,
        expectedBenchStackIds: [...restoreView.boards[p1]!.benchStackIds],
        destinationSlot: 'bench',
        benchIndex: 0,
      }
    );

    const solo = await createHarness(0x7000_0003, 'solo');
    await bootstrapHarness(solo, coverage);
    await submitScenarioCommand(
      solo,
      coverage,
      playerOneSessionId,
      'solo-undo',
      { type: 'ApplySoloUndo', targetPlayerId: p2 }
    );

    expect(coverage.observedScenarios).toEqual(
      new Set<ScenarioModelCommandType>([
        'MoveInspectedCard',
        'MoveStagedCard',
        'RestoreStagedStack',
        'ResolveStagedCards',
        'ResolveInspectionCards',
        'CloseInspection',
        'ApplySoloUndo',
      ])
    );
    for (const type of coverage.observedScenarios) {
      expect(coverage.commandByType.get(type)?.accepted, type).toBeGreaterThan(
        0
      );
    }
    await reconstructHarness(work);
    await reconstructHarness(restore);
    await reconstructHarness(solo);
  }, 120_000);

  it('covers opponent policy, spectator persistence, cross-view handles, and coaching inspection', async () => {
    const coverage = emptyCoverage();
    const allowed = await createHarness(0x7000_0010);
    await bootstrapHarness(allowed, coverage);
    const p2Hand = viewZone(allowed, p2, 'hand');
    const p2Discard = viewZone(allowed, p2, 'discard');
    await submitScenarioCommand(
      allowed,
      coverage,
      playerTwoSessionId,
      'publish-opponent-card',
      {
        type: 'MoveCard',
        cardId: p2Hand.cards[0]!.id,
        expectedSourceZoneId: p2Hand.id,
        destinationZoneId: p2Discard.id,
      }
    );
    const publicDiscard = zoneViewedBy(allowed, p1, p2, 'discard');
    const publicLost = zoneViewedBy(allowed, p1, p2, 'lostZone');
    expect(publicDiscard.cards[0]?.kind).toBe('known');
    await submitScenarioCommand(
      allowed,
      coverage,
      playerOneSessionId,
      'opponent-public-move',
      {
        type: 'MoveCard',
        cardId: publicDiscard.cards[0]!.id,
        expectedSourceZoneId: publicDiscard.id,
        destinationZoneId: publicLost.id,
      }
    );

    const foreignOwnerAlias = viewZone(allowed, p2, 'hand').cards[0]!.id;
    const beforeCrossView = allowed.coordinator.currentSnapshot();
    const crossView = await submitScenarioCommand(
      allowed,
      coverage,
      playerOneSessionId,
      'cross-view-handle',
      {
        type: 'MoveCard',
        cardId: foreignOwnerAlias,
        expectedSourceZoneId: zoneViewedBy(allowed, p1, p2, 'hand').id,
        destinationZoneId: viewZone(allowed, p1, 'discard').id,
      },
      { accepted: false, committed: true }
    );
    expect(resultMessage(crossView, playerOneSessionId)).toMatchObject({
      code: 'stale_reference',
    });
    expect(
      crossView.snapshot.sessions[playerOneSessionId]!.nextClientSequence
    ).toBe(
      beforeCrossView.sessions[playerOneSessionId]!.nextClientSequence + 1
    );

    const beforeSpectator = allowed.coordinator.currentSnapshot();
    const spectator = await submitScenarioCommand(
      allowed,
      coverage,
      spectatorSessionId,
      'spectator-command',
      { type: 'FlipCoin' },
      { accepted: false, committed: true }
    );
    expect(resultMessage(spectator, spectatorSessionId)).toMatchObject({
      code: 'unauthorized',
    });
    expect(
      spectator.snapshot.sessions[spectatorSessionId]!.nextClientSequence
    ).toBe(
      beforeSpectator.sessions[spectatorSessionId]!.nextClientSequence + 1
    );

    const denied = await createHarness(0x7000_0011, 'multiplayer', {
      ...DEFAULT_AUTHORITY_POLICY,
      allowOpponentPublicInteraction: false,
      maximumReplayEventBatches: 8,
    });
    await bootstrapHarness(denied, coverage);
    const deniedResult = await submitScenarioCommand(
      denied,
      coverage,
      playerOneSessionId,
      'policy-false-opponent',
      { type: 'StartTurn', targetPlayerId: p2 },
      { accepted: false, committed: true }
    );
    expect(resultMessage(deniedResult, playerOneSessionId)).toMatchObject({
      code: 'unauthorized',
    });

    const coached = await createHarness(
      0x7000_0012,
      'multiplayer',
      { ...DEFAULT_AUTHORITY_POLICY, maximumReplayEventBatches: 8 },
      true
    );
    await bootstrapHarness(coached, coverage);
    const opponentHand = zoneViewedBy(coached, p1, p2, 'hand');
    await submitScenarioCommand(
      coached,
      coverage,
      playerOneSessionId,
      'coached-opponent-zone',
      {
        type: 'BeginZoneInspection',
        targetPlayerId: p2,
        zoneId: opponentHand.id,
        expectedCardIds: opponentHand.cards.map((card) => card.id),
      }
    );
    const grant = playerView(coached, p1).privateInspections.at(-1)!;
    await submitScenarioCommand(
      coached,
      coverage,
      playerOneSessionId,
      'coached-opponent-end',
      { type: 'EndPrivateInspection', inspectionId: grant.id }
    );
    await submitScenarioCommand(
      coached,
      coverage,
      playerOneSessionId,
      'opponent-public-bottom-extract',
      {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: p2,
        count: 1,
        edge: 'bottom',
        visibility: 'public',
      }
    );
    expect(playerView(coached, p1).workAreas[p2]!.inspection).not.toBeNull();

    expect(coverage.commandByType.get('MoveCard')?.accepted).toBeGreaterThan(1);
    expect(
      coverage.commandByType.get('MoveCard')?.persistedRejected
    ).toBeGreaterThan(0);
    expect(
      coverage.commandByType.get('FlipCoin')?.persistedRejected
    ).toBeGreaterThan(0);
    await reconstructHarness(allowed);
    await reconstructHarness(denied);
    await reconstructHarness(coached);
  }, 120_000);

  it('covers movement indices, stack layout targets, marker boundaries, count clamps, and work-area reveal', async () => {
    const coverage = emptyCoverage();
    const movement = await createHarness(0x7000_0018);
    await bootstrapHarness(movement, coverage);
    const initialHand = viewZone(movement, p1, 'hand');
    for (const [index, card] of initialHand.cards.slice(0, 3).entries()) {
      if (card.kind !== 'known')
        throw new Error('Owner hand card is concealed');
      if (card.category === 'Pokémon') continue;
      await submitScenarioCommand(
        movement,
        coverage,
        playerOneSessionId,
        `layout-category-${index}`,
        {
          type: 'ChangeCardCategory',
          cardId: card.id,
          expectedSourceId: initialHand.id,
          category: 'Pokémon',
        }
      );
    }
    const pokemon = ownedKnownZoneCards(movement, p1, 'Pokémon').slice(0, 3);
    expect(pokemon).toHaveLength(3);
    for (const [index, source] of pokemon.entries()) {
      const board = playerView(movement, p1).boards[p1]!;
      await submitScenarioCommand(
        movement,
        coverage,
        playerOneSessionId,
        `layout-stack-${index}`,
        {
          type: 'MoveCardToPlay',
          cardId: source.card.id,
          expectedSourceZoneId: source.zone.id,
          boardPlayerId: p1,
          slot: index === 0 ? 'active' : 'bench',
          ...(index === 2 ? { benchIndex: board.benchStackIds.length } : {}),
        }
      );
    }

    const moveLayout = async (
      label: string,
      stackId: string,
      destinationSlot: 'active' | 'bench',
      targetStackId?: string
    ) => {
      const view = playerView(movement, p1);
      const stack = view.stacks[stackId]!;
      await submitScenarioCommand(
        movement,
        coverage,
        playerOneSessionId,
        label,
        {
          type: 'MovePlayStack',
          stackId,
          expectedSourceSlot: stack.slot,
          expectedActiveStackId: view.boards[p1]!.activeStackId,
          expectedBenchStackIds: [...view.boards[p1]!.benchStackIds],
          destinationSlot,
          ...(targetStackId ? { targetStackId } : {}),
        }
      );
    };
    let layout = playerView(movement, p1).boards[p1]!;
    await moveLayout('layout-promote', layout.benchStackIds[0]!, 'active');
    layout = playerView(movement, p1).boards[p1]!;
    await moveLayout(
      'layout-reorder',
      layout.benchStackIds[0]!,
      'bench',
      layout.benchStackIds[1]!
    );
    layout = playerView(movement, p1).boards[p1]!;
    await moveLayout(
      'layout-target-swap',
      layout.activeStackId!,
      'bench',
      layout.benchStackIds[0]!
    );
    layout = playerView(movement, p1).boards[p1]!;
    await moveLayout('layout-demote', layout.activeStackId!, 'bench');
    layout = playerView(movement, p1).boards[p1]!;
    await moveLayout('layout-repromote', layout.benchStackIds[0]!, 'active');

    const activeStackId = playerView(movement, p1).boards[p1]!.activeStackId!;
    for (const [label, damage, accepted] of [
      ['ten', 10, true],
      ['null', null, true],
      ['ten-again', 10, true],
      ['zero', 0, true],
      ['maximum', 9_990, true],
      ['noop', 9_990, false],
    ] as const) {
      await submitScenarioCommand(
        movement,
        coverage,
        playerOneSessionId,
        `damage-${label}`,
        { type: 'SetDamage', stackId: activeStackId, damage },
        accepted ? {} : { accepted: false, committed: true }
      );
    }
    const activeTop = playerView(movement, p1).stacks[
      activeStackId
    ]!.evolutionCards.at(-1)!;
    await submitScenarioCommand(
      movement,
      coverage,
      playerOneSessionId,
      'reveal-stack-card',
      {
        type: 'SetPublicReveal',
        cardId: activeTop.id,
        expectedSourceId: activeStackId,
        revealed: true,
      }
    );

    const indexSources = ownedKnownZoneCards(movement, p1)
      .filter((source) => source.zone.kind !== 'discard')
      .slice(0, 3);
    expect(indexSources).toHaveLength(3);
    for (const [index, destinationIndex] of [undefined, 0, 1].entries()) {
      const source = indexSources[index]!;
      await submitScenarioCommand(
        movement,
        coverage,
        playerOneSessionId,
        `move-index-${index}`,
        {
          type: 'MoveCard',
          cardId: source.card.id,
          expectedSourceZoneId: source.zone.id,
          destinationZoneId: viewZone(movement, p1, 'discard').id,
          ...(destinationIndex === undefined ? {} : { destinationIndex }),
        }
      );
    }
    let discard = viewZone(movement, p1, 'discard');
    await submitScenarioCommand(
      movement,
      coverage,
      playerOneSessionId,
      'move-index-recycle',
      {
        type: 'MoveCard',
        cardId: discard.cards[0]!.id,
        expectedSourceZoneId: discard.id,
        destinationZoneId: viewZone(movement, p1, 'hand').id,
      }
    );
    const recycledHand = viewZone(movement, p1, 'hand');
    discard = viewZone(movement, p1, 'discard');
    await submitScenarioCommand(
      movement,
      coverage,
      playerOneSessionId,
      'move-index-end',
      {
        type: 'MoveCard',
        cardId: recycledHand.cards.at(-1)!.id,
        expectedSourceZoneId: recycledHand.id,
        destinationZoneId: discard.id,
        destinationIndex: discard.cards.length,
      }
    );
    discard = viewZone(movement, p1, 'discard');
    await submitScenarioCommand(
      movement,
      coverage,
      playerOneSessionId,
      'move-to-board',
      {
        type: 'MoveCard',
        cardId: discard.cards[0]!.id,
        expectedSourceZoneId: discard.id,
        destinationZoneId: viewZone(movement, p1, 'board').id,
        destinationIndex: 0,
      }
    );
    discard = viewZone(movement, p1, 'discard');
    const stadium = Object.values(playerView(movement, p1).zones).find(
      (zone) => zone.kind === 'stadium'
    )!;
    await submitScenarioCommand(
      movement,
      coverage,
      playerOneSessionId,
      'move-to-stadium',
      {
        type: 'MoveCard',
        cardId: discard.cards[0]!.id,
        expectedSourceZoneId: discard.id,
        destinationZoneId: stadium.id,
      }
    );

    await openInspection(
      movement,
      coverage,
      'top-public-work-area',
      'public',
      'top'
    );
    const inspection = playerView(movement, p1).workAreas[p1]!.inspection!;
    await submitScenarioCommand(
      movement,
      coverage,
      playerOneSessionId,
      'hide-work-area-card',
      {
        type: 'SetPublicReveal',
        cardId: inspection.cards[0]!.id,
        expectedSourceId: inspection.id,
        revealed: false,
      }
    );

    const counts = await createHarness(0x7000_0019);
    await bootstrapHarness(counts, coverage);
    for (const [label, count] of [
      ['zero', 0],
      ['one', 1],
      ['available', viewZone(counts, p1, 'deck').cards.length - 1],
      ['over', 200],
    ] as const) {
      await submitScenarioCommand(
        counts,
        coverage,
        playerOneSessionId,
        `count-${label}`,
        { type: 'DiscardHandAndDraw', count }
      );
    }

    expect(
      coverage.commandByVariant.get('SetDamage/SetDamage:null')?.accepted
    ).toBeGreaterThan(0);
    expect(
      coverage.commandByVariant.get('SetDamage/SetDamage:0')?.accepted
    ).toBeGreaterThan(0);
    expect(
      coverage.commandByVariant.get('SetDamage/SetDamage:9990')
        ?.persistedRejected
    ).toBeGreaterThan(0);
    expect(
      coverage.commandByVariant.get(
        'MovePlayStack/MovePlayStack:bench->bench:target=explicit'
      )?.accepted
    ).toBeGreaterThan(0);
    expect(
      coverage.commandByVariant.get(
        'MovePlayStack/MovePlayStack:active->bench:target=omitted'
      )?.accepted
    ).toBeGreaterThan(0);
    await reconstructHarness(movement);
    await reconstructHarness(counts);
  }, 120_000);

  it('invalidates face-down board handles after shuffle and preserves hidden twin-world noninterference', async () => {
    const coverage = emptyCoverage();
    const harness = await createHarness(0x7000_0020);
    await bootstrapHarness(harness, coverage);
    const hand = viewZone(harness, p1, 'hand');
    const board = viewZone(harness, p1, 'board');
    const cards = hand.cards.slice(0, 3);
    expect(cards).toHaveLength(3);
    for (const [index, card] of cards.entries()) {
      await submitScenarioCommand(
        harness,
        coverage,
        playerOneSessionId,
        `vis-board-${index}`,
        {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: board.id,
          destinationIndex: index,
        }
      );
    }
    const publicBoard = viewZone(harness, p1, 'board');
    for (const [index, card] of publicBoard.cards.slice(0, 2).entries()) {
      await submitScenarioCommand(
        harness,
        coverage,
        playerOneSessionId,
        `vis-face-down-${index}`,
        { type: 'SetCardFace', cardId: card.id, face: 'down' }
      );
    }
    const beforeShuffle = zoneViewedBy(harness, p2, p1, 'board');
    const oldHidden = beforeShuffle.cards
      .filter((card) => card.kind === 'concealed')
      .map((card) => card.id);
    const stablePublic = beforeShuffle.cards.find(
      (card) => card.kind === 'known'
    )!.id;
    expect(oldHidden).toHaveLength(2);
    await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      'vis-shuffle-board',
      { type: 'ShuffleZone', zoneId: board.id }
    );
    const afterShuffle = zoneViewedBy(harness, p2, p1, 'board');
    const nextAliases = afterShuffle.cards.map((card) => card.id);
    for (const oldAlias of oldHidden)
      expect(nextAliases).not.toContain(oldAlias);
    expect(nextAliases).toContain(stablePublic);
    const staleHandle = await submitScenarioCommand(
      harness,
      coverage,
      playerTwoSessionId,
      'vis-stale-handle',
      { type: 'SetCardFace', cardId: oldHidden[0]!, face: 'up' },
      { accepted: false, committed: true }
    );
    expect(resultMessage(staleHandle, playerTwoSessionId)).toMatchObject({
      code: 'stale_reference',
    });

    const snapshot = harness.coordinator.currentSnapshot();
    const hiddenHandIds = snapshot.state.zones[
      playerZoneId(p2, 'hand')
    ]!.cardIds.slice(0, 2);
    const clonedTwinState = structuredClone(snapshot.state);
    const firstDefinition =
      clonedTwinState.cards[hiddenHandIds[0]!]!.definitionId;
    const twinState = {
      ...clonedTwinState,
      cards: {
        ...clonedTwinState.cards,
        [hiddenHandIds[0]!]: {
          ...clonedTwinState.cards[hiddenHandIds[0]!]!,
          definitionId: clonedTwinState.cards[hiddenHandIds[1]!]!.definitionId,
        },
        [hiddenHandIds[1]!]: {
          ...clonedTwinState.cards[hiddenHandIds[1]!]!,
          definitionId: firstDefinition,
        },
      },
    };
    const noNewAliases: OpaqueIdSource = {
      nextOpaqueId: () => {
        throw new Error('Twin-world projection requested an unexpected alias');
      },
    };
    const originalProjection = projectRecipient(
      snapshot.state,
      { kind: 'player', playerId: p1 },
      snapshot.identities,
      noNewAliases
    ).snapshot;
    const twinProjection = projectRecipient(
      twinState,
      { kind: 'player', playerId: p1 },
      snapshot.identities,
      noNewAliases
    ).snapshot;
    expect(stableSerialize(twinProjection)).toBe(
      stableSerialize(originalProjection)
    );
    await reconstructHarness(harness);
  }, 120_000);

  it('recovers deterministically across precommit, transaction-retry, ambiguous, and dedupe boundaries', async () => {
    const coverage = emptyCoverage();
    const harness = await createHarness(0x7000_0030);
    await bootstrapHarness(harness, coverage);

    const beforePreconditionCalls = harness.authoritySource.callCounts();
    const preconditionHand = viewZone(harness, p1, 'hand');
    await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      'no-rng-precondition',
      {
        type: 'MoveCard',
        cardId: preconditionHand.cards[0]!.id,
        expectedSourceZoneId: viewZone(harness, p1, 'discard').id,
        destinationZoneId: viewZone(harness, p1, 'board').id,
      },
      { accepted: false, committed: true }
    );
    expect(harness.authoritySource.callCounts()).toEqual(
      beforePreconditionCalls
    );

    const duplicateSnapshot = harness.coordinator.currentSnapshot();
    const duplicateEnvelope = envelope(
      duplicateSnapshot,
      playerOneSessionId,
      'model-scenario-duplicate-source',
      { type: 'FlipCoin' }
    );
    const original = await harness.coordinator.submit(duplicateEnvelope);
    capturePublishedViews(harness, original);
    const originalMessage = commandResultJson(original, playerOneSessionId);
    const afterOriginalCalls = harness.authoritySource.callCounts();
    const duplicate = await harness.coordinator.submit(duplicateEnvelope);
    expect(duplicate.committed).toBe(false);
    expect(commandResultJson(duplicate, playerOneSessionId)).toBe(
      originalMessage
    );
    expect(harness.authoritySource.callCounts()).toEqual(afterOriginalCalls);

    const beforeRetryAttempts = harness.storage.transactionAttempts;
    const beforeRetryCalls = harness.authoritySource.callCounts();
    harness.storage.retryTransactionOnce = true;
    const retried = await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      'transaction-retry',
      { type: 'FlipCoin' }
    );
    expect(harness.storage.transactionAttempts).toBe(beforeRetryAttempts + 2);
    expect(harness.authoritySource.callCounts().randomInts).toBe(
      beforeRetryCalls.randomInts + 1
    );
    const retryJournal = harness.storage.values.get(
      journalStorageKey('authority', retried.snapshot.authorityVersion)
    ) as StoredAuthorityJournalEntry;
    expect(retryJournal.eventBatch).toEqual(
      retried.snapshot.replayHistory.entries.at(-1)?.batch
    );

    const beforeFailure = harness.coordinator.currentSnapshot();
    const precommitEnvelope = envelope(
      beforeFailure,
      playerOneSessionId,
      'model-scenario-precommit-failure',
      { type: 'FlipCoin' }
    );
    const beforePrecommitCalls = harness.authoritySource.callCounts();
    harness.storage.failPutWhenKeyStartsWith = 'authority:journal:';
    await expect(harness.coordinator.submit(precommitEnvelope)).rejects.toThrow(
      'injected transactional put failure'
    );
    harness.storage.failPutWhenKeyStartsWith = undefined;
    expect(stableSerialize(harness.coordinator.currentSnapshot())).toBe(
      stableSerialize(beforeFailure)
    );
    expect(harness.authoritySource.callCounts().randomInts).toBe(
      beforePrecommitCalls.randomInts + 1
    );
    const recovered = await harness.coordinator.submit(precommitEnvelope);
    expect(recovered.committed).toBe(true);
    expect(resultMessage(recovered, playerOneSessionId).accepted).toBe(true);
    expect(harness.authoritySource.callCounts().randomInts).toBe(
      beforePrecommitCalls.randomInts + 2
    );
    capturePublishedViews(harness, recovered);

    const beforeAmbiguous = harness.coordinator.currentSnapshot();
    const ambiguousEnvelope = envelope(
      beforeAmbiguous,
      playerOneSessionId,
      'model-scenario-ambiguous-failure',
      { type: 'FlipCoin' }
    );
    const beforeAmbiguousCalls = harness.authoritySource.callCounts();
    const beforeAmbiguousViews = new Map(
      [...harness.views].map(([sessionId, view]) => [
        sessionId,
        stableSerialize(view),
      ])
    );
    harness.storage.failAfterTransactionCommitOnce = true;
    await expect(harness.coordinator.submit(ambiguousEnvelope)).rejects.toThrow(
      'injected ambiguous transaction failure'
    );
    const committedAfterFailure = harness.coordinator.currentSnapshot();
    expect(committedAfterFailure.authorityVersion).toBe(
      beforeAmbiguous.authorityVersion + 1
    );
    expect(harness.authoritySource.callCounts().randomInts).toBe(
      beforeAmbiguousCalls.randomInts + 1
    );
    expect(
      new Map(
        [...harness.views].map(([sessionId, view]) => [
          sessionId,
          stableSerialize(view),
        ])
      )
    ).toEqual(beforeAmbiguousViews);
    const ambiguousOutcome = committedAfterFailure.sessions[
      playerOneSessionId
    ]!.recentOutcomes.find(
      (outcome) => outcome.commandId === ambiguousEnvelope.commandId
    )!;
    const ambiguousJournal = harness.storage.values.get(
      journalStorageKey('authority', committedAfterFailure.authorityVersion)
    ) as StoredAuthorityJournalEntry;
    expect(ambiguousJournal.outcome).toMatchObject(ambiguousOutcome);
    expect(
      stableSerialize(
        applyEventBatch(beforeAmbiguous.state, ambiguousJournal.eventBatch!)
      )
    ).toBe(stableSerialize(committedAfterFailure.state));
    expect(
      [...harness.storage.values.values()].filter((value) => {
        if (typeof value !== 'object' || value === null) return false;
        const outcome = Reflect.get(value, 'outcome');
        return (
          typeof outcome === 'object' &&
          outcome !== null &&
          Reflect.get(outcome, 'commandId') === ambiguousEnvelope.commandId
        );
      })
    ).toHaveLength(1);
    const afterAmbiguousCalls = harness.authoritySource.callCounts();
    const beforeDuplicateStorage = stableSerialize([
      ...harness.storage.values.entries(),
    ]);
    const beforeDuplicateTransactions = harness.storage.transactionCalls;
    const ambiguousDuplicate =
      await harness.coordinator.submit(ambiguousEnvelope);
    expect(ambiguousDuplicate.committed).toBe(false);
    expect(resultMessage(ambiguousDuplicate, playerOneSessionId)).toMatchObject(
      ambiguousOutcome
    );
    expect(
      ambiguousDuplicate.deliveries
        .filter((delivery) => delivery.message.type === 'StatePublication')
        .map((delivery) => delivery.sessionId)
    ).toEqual([playerOneSessionId]);
    expect(harness.authoritySource.callCounts()).toEqual(afterAmbiguousCalls);
    expect(harness.storage.transactionCalls).toBe(beforeDuplicateTransactions);
    expect(stableSerialize([...harness.storage.values.entries()])).toBe(
      beforeDuplicateStorage
    );
    capturePublishedViews(harness, ambiguousDuplicate);
    expect(playerView(harness, p1).revision).toBe(
      committedAfterFailure.state.revision
    );
    expect(stableSerialize(playerView(harness, p2))).toBe(
      beforeAmbiguousViews.get(playerTwoSessionId)
    );
    expect(harness.storage.values.has(AUTHORITY_SNAPSHOT_STORAGE_KEY)).toBe(
      true
    );

    const bounded = await createHarness(0x7000_0031, 'multiplayer', {
      ...DEFAULT_AUTHORITY_POLICY,
      maximumRecentOutcomesPerSession: 3,
      maximumReplayEventBatches: 8,
    });
    await bootstrapHarness(bounded, coverage);
    const envelopes: CommandEnvelope[] = [];
    for (let index = 0; index < 4; index += 1) {
      const commandEnvelope = envelope(
        bounded.coordinator.currentSnapshot(),
        playerOneSessionId,
        `model-scenario-bounded-${index}`,
        { type: 'FlipCoin' }
      );
      envelopes.push(commandEnvelope);
      const result = await bounded.coordinator.submit(commandEnvelope);
      capturePublishedViews(bounded, result);
      expect(result.committed).toBe(true);
    }
    const retained =
      bounded.coordinator.currentSnapshot().sessions[playerOneSessionId]!
        .recentOutcomes;
    expect(retained).toHaveLength(3);
    expect(retained.map((outcome) => outcome.commandId)).not.toContain(
      envelopes[0]!.commandId
    );
    const beforeBoundedDuplicateCalls = bounded.authoritySource.callCounts();
    const boundedDuplicate = await bounded.coordinator.submit(
      envelopes.at(-1)!
    );
    expect(boundedDuplicate.committed).toBe(false);
    expect(resultMessage(boundedDuplicate, playerOneSessionId).accepted).toBe(
      true
    );
    expect(bounded.authoritySource.callCounts()).toEqual(
      beforeBoundedDuplicateCalls
    );
    const evictedRetry = await bounded.coordinator.submit(envelopes[0]!);
    expect(evictedRetry.committed).toBe(false);
    expect(resultMessage(evictedRetry, playerOneSessionId)).toMatchObject({
      accepted: false,
      code: 'invalid_sequence',
    });
    await submitScenarioCommand(
      harness,
      coverage,
      playerOneSessionId,
      'post-ambiguous-publication',
      { type: 'DeclareAttack', targetPlayerId: p1 }
    );
    await reconstructHarness(harness);
    await reconstructHarness(bounded);
  }, 120_000);
});
