import {
  MATCH_STATE_SCHEMA_VERSION,
  type MatchState,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  authoritySnapshotCommandValidationMatches,
  authoritySnapshotValidationFor,
  authoritySnapshotValidationMatches,
  assertAuthorityTransactionTransition,
  createReplayHistory,
  validateAuthoritySnapshot,
  type AdmissionPersistence,
  type AuthorityPersistenceTiming,
  type AuthoritySnapshotValidation,
  type AuthoritySnapshotStore,
  type PersistedAdmissionTransaction,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import {
  JOURNAL_RETENTION_STORAGE_KEY,
  initialJournalRetentionIndex,
  journalStorageKey,
  prepareJournalRetention,
  type JournalRetentionTransaction,
} from './journal-retention.js';

export const AUTHORITY_SNAPSHOT_STORAGE_KEY = 'authority:snapshot';
export const AUTHORITY_FRONTIER_STORAGE_KEY = 'authority:frontier';
export const ROOM_LIFECYCLE_STORAGE_KEY = 'room:lifecycle';
const LEGACY_STORAGE_FORMAT = 'ptcgsim-room-authority-v1';
const PREVIOUS_STORAGE_FORMAT = 'ptcgsim-room-authority-v2';
const PRIOR_STORAGE_FORMAT = 'ptcgsim-room-authority-v3';
const FORMER_STORAGE_FORMAT = 'ptcgsim-room-authority-v4';
const RECENT_STORAGE_FORMAT = 'ptcgsim-room-authority-v5';
const STORAGE_FORMAT = 'ptcgsim-room-authority-v6';
const AUTHORITY_FRONTIER_FORMAT = 'ptcgsim-authority-frontier-v1';
const GENERATION_PATTERN = /^[0-9a-f]{32}$/u;

export interface DurableStorageTransactionLike extends JournalRetentionTransaction {
  readonly put: (entries: Record<string, unknown>) => Promise<void>;
  readonly setAlarm: (scheduledTime: number | Date) => Promise<void>;
  readonly deleteAlarm: () => Promise<void>;
}

export interface DurableStorageLike {
  readonly get: <Value>(key: string) => Promise<Value | undefined>;
  readonly deleteAll: () => Promise<void>;
  readonly transaction: <Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ) => Promise<Value>;
}

export interface RoomInitializationLifecycle {
  readonly createdAt: number;
  readonly unclaimedExpiresAt: number;
}

type StoredRoomLifecycle =
  | {
      readonly format: 'ptcgsim-room-lifecycle-v1';
      readonly state: 'unclaimed';
      readonly createdAt: number;
      readonly unclaimedExpiresAt: number;
    }
  | {
      readonly format: 'ptcgsim-room-lifecycle-v1';
      readonly state: 'claimed';
      readonly createdAt: number;
      readonly claimedAtAuthorityVersion: number;
    }
  | {
      readonly format: 'ptcgsim-room-lifecycle-v1';
      readonly state: 'expiring';
      readonly createdAt: number;
      readonly unclaimedExpiresAt: number;
    };

export type UnclaimedRoomExpiryResult =
  'expired' | 'claimed' | 'scheduled' | 'missing';

interface StoredAuthoritySnapshot {
  readonly format:
    | typeof STORAGE_FORMAT
    | typeof RECENT_STORAGE_FORMAT
    | typeof FORMER_STORAGE_FORMAT
    | typeof PRIOR_STORAGE_FORMAT
    | typeof PREVIOUS_STORAGE_FORMAT
    | typeof LEGACY_STORAGE_FORMAT;
  readonly generation?: string;
  readonly snapshot: RoomAuthoritySnapshot;
}

export interface StoredAuthorityFrontier {
  readonly format: typeof AUTHORITY_FRONTIER_FORMAT;
  readonly envelopeFormat: typeof STORAGE_FORMAT;
  readonly authoritySchemaVersion: typeof AUTHORITY_SNAPSHOT_SCHEMA_VERSION;
  readonly matchStateSchemaVersion: typeof MATCH_STATE_SCHEMA_VERSION;
  readonly matchId: string;
  readonly mode: RoomAuthoritySnapshot['mode'];
  readonly authorityVersion: number;
  readonly stateRevision: number;
  readonly generation: string;
}

interface ValidatedAuthorityHead {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly validation: AuthoritySnapshotValidation;
  readonly frontier: StoredAuthorityFrontier;
}

export interface StoredAuthorityJournalEntry {
  readonly format: typeof STORAGE_FORMAT;
  readonly expectedAuthorityVersion: number;
  readonly resultingAuthorityVersion: number;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly sessionId: string;
  readonly outcome: PersistedAuthorityTransaction['outcome'];
  readonly eventBatch?: PersistedAuthorityTransaction['eventBatch'];
}

export interface StoredAdmissionJournalEntry {
  readonly format: typeof STORAGE_FORMAT;
  readonly expectedAuthorityVersion: number;
  readonly resultingAuthorityVersion: number;
  readonly kind: PersistedAdmissionTransaction['kind'];
  readonly sessionId?: string;
  readonly ticketDigest?: string;
  readonly invitationDigest?: string;
  readonly sourceInvitationDigest?: string;
  readonly admissionTicketDigest?: string;
}

export class ConcurrentRoomWriteError extends Error {
  constructor(
    readonly expectedAuthorityVersion: number,
    readonly actualAuthorityVersion: number
  ) {
    super(
      `Room authority version changed from ${expectedAuthorityVersion} to ${actualAuthorityVersion}`
    );
    this.name = 'ConcurrentRoomWriteError';
  }
}

export class RoomAlreadyInitializedError extends Error {
  constructor() {
    super('Room authority snapshot is already initialized');
    this.name = 'RoomAlreadyInitializedError';
  }
}

export class RoomExpiredError extends Error {
  constructor() {
    super('Room expired before its first admission');
    this.name = 'RoomExpiredError';
  }
}

const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const defaultAuthorityGeneration = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const validGeneration = (value: unknown): value is string =>
  typeof value === 'string' && GENERATION_PATTERN.test(value);

const frontierForSnapshot = (
  snapshot: RoomAuthoritySnapshot,
  generation: string
): StoredAuthorityFrontier =>
  Object.freeze({
    format: AUTHORITY_FRONTIER_FORMAT,
    envelopeFormat: STORAGE_FORMAT,
    authoritySchemaVersion: snapshot.schemaVersion,
    matchStateSchemaVersion: snapshot.state.schemaVersion,
    matchId: snapshot.state.matchId,
    mode: snapshot.mode,
    authorityVersion: snapshot.authorityVersion,
    stateRevision: snapshot.state.revision,
    generation,
  });

const storedFrontierKeys = [
  'authoritySchemaVersion',
  'authorityVersion',
  'envelopeFormat',
  'format',
  'generation',
  'matchId',
  'matchStateSchemaVersion',
  'mode',
  'stateRevision',
] as const;

const readStoredFrontier = (
  value: unknown
): StoredAuthorityFrontier | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    JSON.stringify((keys as string[]).sort()) !==
      JSON.stringify([...storedFrontierKeys].sort())
  ) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.format !== AUTHORITY_FRONTIER_FORMAT ||
    candidate.envelopeFormat !== STORAGE_FORMAT ||
    candidate.authoritySchemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION ||
    candidate.matchStateSchemaVersion !== MATCH_STATE_SCHEMA_VERSION ||
    typeof candidate.matchId !== 'string' ||
    candidate.matchId.length < 1 ||
    candidate.matchId.length > 128 ||
    (candidate.mode !== 'solo' && candidate.mode !== 'multiplayer') ||
    !safeNonNegativeInteger(candidate.authorityVersion) ||
    !safeNonNegativeInteger(candidate.stateRevision) ||
    !validGeneration(candidate.generation)
  ) {
    return undefined;
  }
  return value as StoredAuthorityFrontier;
};

const frontierMatches = (
  left: StoredAuthorityFrontier,
  right: StoredAuthorityFrontier
): boolean => storedFrontierKeys.every((key) => left[key] === right[key]);

const assertGenerationRotated = (
  currentGeneration: string | undefined,
  nextGeneration: string
): void => {
  if (!validGeneration(nextGeneration)) {
    throw new Error('Authority generation is malformed');
  }
  if (currentGeneration === nextGeneration) {
    throw new Error('Authority generation did not rotate');
  }
};

const safeMonotonicMark = (monotonicNow: () => number): number | undefined => {
  try {
    const mark = monotonicNow();
    return Number.isFinite(mark) ? mark : undefined;
  } catch {
    return undefined;
  }
};

const measuredDuration = (startedAt?: number, finishedAt?: number): number =>
  startedAt === undefined ||
  finishedAt === undefined ||
  finishedAt < startedAt ||
  !Number.isFinite(finishedAt - startedAt)
    ? 0
    : Math.min(finishedAt - startedAt, 86_400_000);

const readStoredRoomLifecycle = (
  value: unknown
): StoredRoomLifecycle | undefined => {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'format') !== 'ptcgsim-room-lifecycle-v1' ||
    !safeNonNegativeInteger(Reflect.get(value, 'createdAt'))
  ) {
    throw new Error('Stored room lifecycle is malformed');
  }
  const state = Reflect.get(value, 'state');
  const createdAt = Reflect.get(value, 'createdAt');
  if (state === 'claimed') {
    if (
      !safeNonNegativeInteger(Reflect.get(value, 'claimedAtAuthorityVersion'))
    ) {
      throw new Error('Stored room lifecycle is malformed');
    }
    return value as StoredRoomLifecycle;
  }
  const unclaimedExpiresAt = Reflect.get(value, 'unclaimedExpiresAt');
  if (
    (state !== 'unclaimed' && state !== 'expiring') ||
    !safeNonNegativeInteger(unclaimedExpiresAt) ||
    !safeNonNegativeInteger(createdAt) ||
    unclaimedExpiresAt <= createdAt
  ) {
    throw new Error('Stored room lifecycle is malformed');
  }
  return value as StoredRoomLifecycle;
};

export const storedRoomLifecycleState = (
  value: unknown
): StoredRoomLifecycle['state'] | undefined =>
  readStoredRoomLifecycle(value)?.state;

const validInitializationLifecycle = (
  lifecycle: RoomInitializationLifecycle
): boolean =>
  safeNonNegativeInteger(lifecycle.createdAt) &&
  safeNonNegativeInteger(lifecycle.unclaimedExpiresAt) &&
  lifecycle.unclaimedExpiresAt > lifecycle.createdAt &&
  lifecycle.unclaimedExpiresAt - lifecycle.createdAt <= 24 * 60 * 60_000;

const isStoredSnapshot = (value: unknown): value is StoredAuthoritySnapshot =>
  typeof value === 'object' &&
  value !== null &&
  (Reflect.get(value, 'format') === STORAGE_FORMAT ||
    Reflect.get(value, 'format') === RECENT_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === FORMER_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === PRIOR_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === PREVIOUS_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === LEGACY_STORAGE_FORMAT) &&
  typeof Reflect.get(value, 'snapshot') === 'object' &&
  Reflect.get(value, 'snapshot') !== null;

const migrateMatchState = (value: unknown): MatchState => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored match state has an unsupported schema');
  }
  const schemaVersion = Reflect.get(value, 'schemaVersion');
  if (schemaVersion !== 1 && schemaVersion !== MATCH_STATE_SCHEMA_VERSION) {
    throw new Error('Stored match state has an unsupported schema');
  }
  const state = value as MatchState;
  if (schemaVersion === MATCH_STATE_SCHEMA_VERSION) return state;
  const visibility = Reflect.get(value, 'visibility');
  if (typeof visibility !== 'object' || visibility === null) {
    throw new Error('Stored match visibility is malformed');
  }
  const grants = Reflect.get(visibility, 'inspectionGrants');
  if (typeof grants !== 'object' || grants === null || Array.isArray(grants)) {
    throw new Error('Stored match inspection grants are malformed');
  }
  const inspectionGrants = Object.fromEntries(
    Object.entries(grants).map(([id, grant]) => {
      if (typeof grant !== 'object' || grant === null) {
        throw new Error('Stored match inspection grant is malformed');
      }
      const cardIds = Reflect.get(grant, 'cardIds');
      if (!Array.isArray(cardIds)) {
        throw new Error('Stored match inspection grant cards are malformed');
      }
      return [
        id,
        {
          ...grant,
          // Old state did not distinguish a one-card zone look from a card
          // look. Prefer the privacy-safe generic wording when ambiguous.
          scope: cardIds.length === 1 ? 'card' : 'zone',
        },
      ];
    })
  ) as MatchState['visibility']['inspectionGrants'];
  return {
    ...state,
    schemaVersion: MATCH_STATE_SCHEMA_VERSION,
    visibility: { ...state.visibility, inspectionGrants },
  };
};

const migrateStoredSnapshot = (value: unknown): RoomAuthoritySnapshot => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored room snapshot has an unsupported schema');
  }
  const schemaVersion = Reflect.get(value, 'schemaVersion');
  const rawState = Reflect.get(value, 'state');
  let candidate: RoomAuthoritySnapshot;
  const legacySchema =
    schemaVersion === 1 ||
    schemaVersion === 2 ||
    schemaVersion === 3 ||
    schemaVersion === 4;
  if (schemaVersion === 1) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      mode: 'multiplayer',
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 2) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 3) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 4) {
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    };
  } else if (schemaVersion === 5) {
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      ...(Reflect.get(value, 'admission')
        ? {
            admission: {
              ...(Reflect.get(value, 'admission') as NonNullable<
                RoomAuthoritySnapshot['admission']
              >),
              invitations: {},
            },
          }
        : {}),
    };
  } else if (schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
    candidate = value as RoomAuthoritySnapshot;
  } else {
    throw new Error('Stored room snapshot has an unsupported schema');
  }
  if (legacySchema && candidate.admission) {
    candidate = {
      ...candidate,
      admission: { ...candidate.admission, invitations: {}, tickets: {} },
    };
  }
  validateAuthoritySnapshot(candidate);
  return candidate;
};

interface ReadStoredAuthoritySnapshot {
  readonly format: StoredAuthoritySnapshot['format'];
  readonly generation?: string;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly validation: AuthoritySnapshotValidation;
}

const readStoredSnapshotEnvelope = (
  value: unknown
): ReadStoredAuthoritySnapshot | undefined => {
  if (value === undefined) return undefined;
  if (!isStoredSnapshot(value)) {
    throw new Error('Stored room snapshot has an unsupported envelope');
  }
  if (
    value.generation !== undefined &&
    (value.format !== STORAGE_FORMAT || !validGeneration(value.generation))
  ) {
    throw new Error('Stored room snapshot generation is malformed');
  }
  const snapshot = migrateStoredSnapshot(value.snapshot);
  const validation = authoritySnapshotValidationFor(snapshot);
  if (!validation) {
    throw new Error('Stored room snapshot did not retain validation evidence');
  }
  return {
    format: value.format,
    ...(value.generation ? { generation: value.generation } : {}),
    snapshot,
    validation,
  };
};

const readStoredSnapshot = (
  value: unknown
): RoomAuthoritySnapshot | undefined =>
  readStoredSnapshotEnvelope(value)?.snapshot;

export class DurableRoomSnapshotStore
  implements AuthoritySnapshotStore, AdmissionPersistence
{
  private validatedHead: ValidatedAuthorityHead | undefined;

  constructor(
    private readonly storage: DurableStorageLike,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly nextAuthorityGeneration: () => string = defaultAuthorityGeneration
  ) {}

  async load(): Promise<RoomAuthoritySnapshot | undefined> {
    const capturedHead = this.validatedHead;
    const replacementGeneration = this.createGeneration();
    try {
      const loaded = await this.storage.transaction(async (transaction) => {
        const rawSnapshot = await transaction.get<unknown>(
          AUTHORITY_SNAPSHOT_STORAGE_KEY
        );
        const rawFrontier = await transaction.get<unknown>(
          AUTHORITY_FRONTIER_STORAGE_KEY
        );
        const restored = readStoredSnapshotEnvelope(rawSnapshot);
        if (!restored) {
          if (rawFrontier !== undefined) {
            throw new Error('Stored authority frontier has no snapshot');
          }
          return undefined;
        }

        const storedFrontier = readStoredFrontier(rawFrontier);
        let frontier: StoredAuthorityFrontier;
        if (restored.generation) {
          frontier = frontierForSnapshot(
            restored.snapshot,
            restored.generation
          );
          if (storedFrontier && !frontierMatches(storedFrontier, frontier)) {
            throw new Error(
              'Stored authority frontier diverges from its snapshot'
            );
          }
          if (!storedFrontier) {
            await transaction.put({
              [AUTHORITY_FRONTIER_STORAGE_KEY]: frontier,
            });
          } else {
            frontier = storedFrontier;
          }
        } else {
          frontier = frontierForSnapshot(
            restored.snapshot,
            replacementGeneration
          );
          await transaction.put({
            [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
              format: STORAGE_FORMAT,
              generation: replacementGeneration,
              snapshot: restored.snapshot,
            } satisfies StoredAuthoritySnapshot,
            [AUTHORITY_FRONTIER_STORAGE_KEY]: frontier,
          });
        }
        return {
          snapshot: restored.snapshot,
          validation: restored.validation,
          frontier,
        } satisfies ValidatedAuthorityHead;
      });
      if (!loaded) {
        if (this.validatedHead === capturedHead) this.validatedHead = undefined;
        return undefined;
      }
      this.validatedHead = loaded;
      return loaded.snapshot;
    } catch (error) {
      if (this.validatedHead === capturedHead) this.validatedHead = undefined;
      throw error;
    }
  }

  async initialize(
    snapshot: RoomAuthoritySnapshot,
    lifecycle?: RoomInitializationLifecycle
  ): Promise<void> {
    const validation = validateAuthoritySnapshot(snapshot);
    const generation = this.createGeneration();
    const frontier = frontierForSnapshot(snapshot, generation);
    if (
      lifecycle &&
      (!validInitializationLifecycle(lifecycle) ||
        snapshot.authorityVersion !== 0 ||
        Object.keys(snapshot.sessions).length > 0)
    ) {
      throw new Error('Initial room lifecycle is invalid');
    }
    await this.storage.transaction(async (transaction) => {
      const existing = await transaction.get<unknown>(
        AUTHORITY_SNAPSHOT_STORAGE_KEY
      );
      if (existing !== undefined) throw new RoomAlreadyInitializedError();
      if (
        (await transaction.get<unknown>(AUTHORITY_FRONTIER_STORAGE_KEY)) !==
        undefined
      ) {
        throw new Error('Stored authority frontier has no snapshot');
      }
      await transaction.put({
        [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
          format: STORAGE_FORMAT,
          generation,
          snapshot,
        } satisfies StoredAuthoritySnapshot,
        [AUTHORITY_FRONTIER_STORAGE_KEY]: frontier,
        [JOURNAL_RETENTION_STORAGE_KEY]: initialJournalRetentionIndex(
          snapshot.authorityVersion
        ),
        ...(lifecycle
          ? {
              [ROOM_LIFECYCLE_STORAGE_KEY]: {
                format: 'ptcgsim-room-lifecycle-v1',
                state: 'unclaimed',
                createdAt: lifecycle.createdAt,
                unclaimedExpiresAt: lifecycle.unclaimedExpiresAt,
              } satisfies StoredRoomLifecycle,
            }
          : {}),
      });
      if (lifecycle) {
        await transaction.setAlarm(lifecycle.unclaimedExpiresAt);
      }
    });
    this.validatedHead = { snapshot, validation, frontier };
  }

  private createGeneration(): string {
    const generation = this.nextAuthorityGeneration();
    if (!validGeneration(generation)) {
      throw new Error('Authority generation source returned an invalid value');
    }
    return generation;
  }

  async expireUnclaimedRoom(now: number): Promise<UnclaimedRoomExpiryResult> {
    if (!safeNonNegativeInteger(now)) {
      throw new Error('Room expiry clock is invalid');
    }
    const capturedHead = this.validatedHead;
    const replacementGeneration = this.createGeneration();
    const decision = await this.storage.transaction(async (transaction) => {
      const lifecycle = readStoredRoomLifecycle(
        await transaction.get<unknown>(ROOM_LIFECYCLE_STORAGE_KEY)
      );
      if (!lifecycle) {
        await transaction.deleteAlarm();
        return {
          status: 'missing' as const,
          deleteRoom: false,
          pairChanged: false,
        };
      }

      const rawSnapshot = await transaction.get<unknown>(
        AUTHORITY_SNAPSHOT_STORAGE_KEY
      );
      const rawFrontier = await transaction.get<unknown>(
        AUTHORITY_FRONTIER_STORAGE_KEY
      );
      const restored = readStoredSnapshotEnvelope(rawSnapshot);
      if (!restored && rawFrontier !== undefined) {
        throw new Error('Stored authority frontier has no snapshot');
      }
      let pairChanged = false;
      if (restored?.generation) {
        const expectedFrontier = frontierForSnapshot(
          restored.snapshot,
          restored.generation
        );
        const storedFrontier = readStoredFrontier(rawFrontier);
        if (
          storedFrontier &&
          !frontierMatches(storedFrontier, expectedFrontier)
        ) {
          throw new Error(
            'Stored authority frontier diverges from its snapshot'
          );
        }
        if (!storedFrontier) {
          await transaction.put({
            [AUTHORITY_FRONTIER_STORAGE_KEY]: expectedFrontier,
          });
          pairChanged = true;
        }
      } else if (restored) {
        const replacementFrontier = frontierForSnapshot(
          restored.snapshot,
          replacementGeneration
        );
        await transaction.put({
          [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
            format: STORAGE_FORMAT,
            generation: replacementGeneration,
            snapshot: restored.snapshot,
          } satisfies StoredAuthoritySnapshot,
          [AUTHORITY_FRONTIER_STORAGE_KEY]: replacementFrontier,
        });
        pairChanged = true;
      }

      if (lifecycle.state === 'claimed') {
        await transaction.deleteAlarm();
        return { status: 'claimed' as const, deleteRoom: false, pairChanged };
      }
      if (lifecycle.state === 'expiring') {
        return { status: 'expired' as const, deleteRoom: true, pairChanged };
      }
      const snapshot = restored?.snapshot;
      if (snapshot && Object.keys(snapshot.sessions).length > 0) {
        await transaction.put({
          [ROOM_LIFECYCLE_STORAGE_KEY]: {
            format: 'ptcgsim-room-lifecycle-v1',
            state: 'claimed',
            createdAt: lifecycle.createdAt,
            claimedAtAuthorityVersion: snapshot.authorityVersion,
          } satisfies StoredRoomLifecycle,
        });
        await transaction.deleteAlarm();
        return { status: 'claimed' as const, deleteRoom: false, pairChanged };
      }
      if (now < lifecycle.unclaimedExpiresAt) {
        await transaction.setAlarm(lifecycle.unclaimedExpiresAt);
        return { status: 'scheduled' as const, deleteRoom: false, pairChanged };
      }
      await transaction.put({
        [ROOM_LIFECYCLE_STORAGE_KEY]: {
          ...lifecycle,
          state: 'expiring',
        } satisfies StoredRoomLifecycle,
      });
      return { status: 'expired' as const, deleteRoom: true, pairChanged };
    });
    if (decision.pairChanged && this.validatedHead === capturedHead) {
      this.validatedHead = undefined;
    }
    if (decision.deleteRoom) {
      await this.storage.deleteAll();
      if (this.validatedHead === capturedHead) this.validatedHead = undefined;
    }
    return decision.status;
  }

  async commit(
    transaction: PersistedAuthorityTransaction
  ): Promise<AuthorityPersistenceTiming> {
    const validationStartedAt = safeMonotonicMark(this.monotonicNow);
    const trustedSnapshot = authoritySnapshotValidationMatches(
      transaction.snapshotValidation,
      transaction.snapshot
    );
    const candidateValidation = trustedSnapshot
      ? transaction.snapshotValidation!
      : validateAuthoritySnapshot(transaction.snapshot);
    const snapshotValidationMs = measuredDuration(
      validationStartedAt,
      safeMonotonicMark(this.monotonicNow)
    );
    const capturedHead = this.validatedHead;
    const nextGeneration = this.createGeneration();
    const nextFrontier = frontierForSnapshot(
      transaction.snapshot,
      nextGeneration
    );
    const transactionStartedAt = safeMonotonicMark(this.monotonicNow);
    let predecessorValidationMs = 0;
    let frontierFastPathHit = 0;
    try {
      await this.storage.transaction(async (storageTransaction) => {
        predecessorValidationMs = 0;
        frontierFastPathHit = 0;
        const lifecycle = readStoredRoomLifecycle(
          await storageTransaction.get<unknown>(ROOM_LIFECYCLE_STORAGE_KEY)
        );
        if (lifecycle?.state === 'expiring') throw new RoomExpiredError();
        const rawFrontier = await storageTransaction.get<unknown>(
          AUTHORITY_FRONTIER_STORAGE_KEY
        );
        const storedFrontier = readStoredFrontier(rawFrontier);
        const trustedCommand = Boolean(
          capturedHead &&
          storedFrontier &&
          frontierMatches(storedFrontier, capturedHead.frontier) &&
          capturedHead.frontier.authorityVersion ===
            transaction.expectedAuthorityVersion &&
          capturedHead.frontier.stateRevision ===
            transaction.expectedRevision &&
          authoritySnapshotValidationMatches(
            capturedHead.validation,
            capturedHead.snapshot
          ) &&
          trustedSnapshot &&
          authoritySnapshotCommandValidationMatches(
            transaction.snapshotValidation,
            transaction.snapshot,
            capturedHead.snapshot,
            transaction.expectedAuthorityVersion,
            transaction.expectedRevision,
            transaction.sessionId,
            transaction.outcome,
            transaction.eventBatch
          )
        );

        let current: RoomAuthoritySnapshot;
        let currentGeneration: string | undefined;
        if (trustedCommand) {
          frontierFastPathHit = 1;
          current = capturedHead!.snapshot;
          currentGeneration = capturedHead!.frontier.generation;
        } else {
          const rawSnapshot = await storageTransaction.get<unknown>(
            AUTHORITY_SNAPSHOT_STORAGE_KEY
          );
          const predecessorValidationStartedAt = safeMonotonicMark(
            this.monotonicNow
          );
          const restored = readStoredSnapshotEnvelope(rawSnapshot);
          predecessorValidationMs = measuredDuration(
            predecessorValidationStartedAt,
            safeMonotonicMark(this.monotonicNow)
          );
          if (!restored) {
            throw new Error('Room authority snapshot is not initialized');
          }
          if (restored.generation && storedFrontier) {
            const expectedFrontier = frontierForSnapshot(
              restored.snapshot,
              restored.generation
            );
            if (!frontierMatches(storedFrontier, expectedFrontier)) {
              throw new Error(
                'Stored authority frontier diverges from its snapshot'
              );
            }
          }
          current = restored.snapshot;
          currentGeneration = restored.generation;
        }
        assertGenerationRotated(currentGeneration, nextGeneration);
        if (current.authorityVersion !== transaction.expectedAuthorityVersion) {
          throw new ConcurrentRoomWriteError(
            transaction.expectedAuthorityVersion,
            current.authorityVersion
          );
        }
        if (current.state.revision !== transaction.expectedRevision) {
          throw new Error(
            'Room state revision changed before authority commit'
          );
        }
        if (!trustedCommand) {
          assertAuthorityTransactionTransition(current, transaction);
        }
        if (
          transaction.snapshot.authorityVersion !==
          current.authorityVersion + 1
        ) {
          throw new Error(
            'Authority commit did not advance exactly one version'
          );
        }
        const key = journalStorageKey(
          'authority',
          transaction.snapshot.authorityVersion
        );
        if ((await storageTransaction.get<unknown>(key)) !== undefined) {
          throw new Error('Authority journal key collision');
        }
        const journalEntry: StoredAuthorityJournalEntry = {
          format: STORAGE_FORMAT,
          expectedAuthorityVersion: transaction.expectedAuthorityVersion,
          resultingAuthorityVersion: transaction.snapshot.authorityVersion,
          expectedRevision: transaction.expectedRevision,
          resultingRevision: transaction.snapshot.state.revision,
          sessionId: transaction.sessionId,
          outcome: transaction.outcome,
          ...(transaction.eventBatch
            ? { eventBatch: transaction.eventBatch }
            : {}),
        };
        const retained = await prepareJournalRetention(
          storageTransaction,
          'authority',
          key,
          journalEntry,
          current.authorityVersion,
          transaction.snapshot.authorityVersion
        );
        await storageTransaction.put({
          [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
            format: STORAGE_FORMAT,
            generation: nextGeneration,
            snapshot: transaction.snapshot,
          } satisfies StoredAuthoritySnapshot,
          [AUTHORITY_FRONTIER_STORAGE_KEY]: nextFrontier,
          [key]: journalEntry,
          [JOURNAL_RETENTION_STORAGE_KEY]: retained.index,
        });
        if (retained.staleKeys.length > 0) {
          await storageTransaction.delete([...retained.staleKeys]);
        }
      });
    } catch (error) {
      if (this.validatedHead === capturedHead) this.validatedHead = undefined;
      throw error;
    }
    this.validatedHead = {
      snapshot: transaction.snapshot,
      validation: candidateValidation,
      frontier: nextFrontier,
    };
    return {
      snapshotValidationMs,
      predecessorValidationMs,
      frontierFastPathHit,
      transactionMs: measuredDuration(
        transactionStartedAt,
        safeMonotonicMark(this.monotonicNow)
      ),
    };
  }

  async commitAdmission(
    transaction: PersistedAdmissionTransaction
  ): Promise<void> {
    const validation = validateAuthoritySnapshot(transaction.snapshot);
    const capturedHead = this.validatedHead;
    const generation = this.createGeneration();
    const frontier = frontierForSnapshot(transaction.snapshot, generation);
    try {
      await this.storage.transaction(async (storageTransaction) => {
        const lifecycle = readStoredRoomLifecycle(
          await storageTransaction.get<unknown>(ROOM_LIFECYCLE_STORAGE_KEY)
        );
        if (lifecycle?.state === 'expiring') throw new RoomExpiredError();
        const rawFrontier = await storageTransaction.get<unknown>(
          AUTHORITY_FRONTIER_STORAGE_KEY
        );
        const storedFrontier = readStoredFrontier(rawFrontier);
        const restored = readStoredSnapshotEnvelope(
          await storageTransaction.get<unknown>(AUTHORITY_SNAPSHOT_STORAGE_KEY)
        );
        if (!restored) {
          throw new Error('Room authority snapshot is not initialized');
        }
        if (restored.generation && storedFrontier) {
          const expectedFrontier = frontierForSnapshot(
            restored.snapshot,
            restored.generation
          );
          if (!frontierMatches(storedFrontier, expectedFrontier)) {
            throw new Error(
              'Stored authority frontier diverges from its snapshot'
            );
          }
        }
        const current = restored.snapshot;
        assertGenerationRotated(restored.generation, generation);
        if (current.authorityVersion !== transaction.expectedAuthorityVersion) {
          throw new ConcurrentRoomWriteError(
            transaction.expectedAuthorityVersion,
            current.authorityVersion
          );
        }
        if (
          transaction.snapshot.authorityVersion !==
          current.authorityVersion + 1
        ) {
          throw new Error(
            'Admission commit did not advance exactly one version'
          );
        }
        const key = journalStorageKey(
          'admission',
          transaction.snapshot.authorityVersion
        );
        if ((await storageTransaction.get<unknown>(key)) !== undefined) {
          throw new Error('Admission journal key collision');
        }
        const journalEntry: StoredAdmissionJournalEntry = {
          format: STORAGE_FORMAT,
          expectedAuthorityVersion: transaction.expectedAuthorityVersion,
          resultingAuthorityVersion: transaction.snapshot.authorityVersion,
          kind: transaction.kind,
          ...(transaction.kind === 'invitation_issued'
            ? { invitationDigest: transaction.invitationDigest }
            : transaction.kind === 'ticket_issued'
              ? {
                  ticketDigest: transaction.ticketDigest,
                  ...(transaction.sourceInvitationDigest
                    ? {
                        sourceInvitationDigest:
                          transaction.sourceInvitationDigest,
                      }
                    : {}),
                }
              : {
                  sessionId: transaction.sessionId,
                  ...(transaction.admissionTicketDigest
                    ? {
                        admissionTicketDigest:
                          transaction.admissionTicketDigest,
                      }
                    : {}),
                  ...(transaction.invitationDigest
                    ? { invitationDigest: transaction.invitationDigest }
                    : {}),
                }),
        };
        const retained = await prepareJournalRetention(
          storageTransaction,
          'admission',
          key,
          journalEntry,
          current.authorityVersion,
          transaction.snapshot.authorityVersion
        );
        const claimsRoom =
          transaction.kind === 'seat_claimed' ||
          transaction.kind === 'spectator_joined' ||
          transaction.kind === 'session_resumed';
        await storageTransaction.put({
          [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
            format: STORAGE_FORMAT,
            generation,
            snapshot: transaction.snapshot,
          } satisfies StoredAuthoritySnapshot,
          [AUTHORITY_FRONTIER_STORAGE_KEY]: frontier,
          [key]: journalEntry,
          [JOURNAL_RETENTION_STORAGE_KEY]: retained.index,
          ...(claimsRoom && lifecycle?.state === 'unclaimed'
            ? {
                [ROOM_LIFECYCLE_STORAGE_KEY]: {
                  format: 'ptcgsim-room-lifecycle-v1',
                  state: 'claimed',
                  createdAt: lifecycle.createdAt,
                  claimedAtAuthorityVersion:
                    transaction.snapshot.authorityVersion,
                } satisfies StoredRoomLifecycle,
              }
            : {}),
        });
        if (claimsRoom && lifecycle?.state === 'unclaimed') {
          await storageTransaction.deleteAlarm();
        }
        if (retained.staleKeys.length > 0) {
          await storageTransaction.delete([...retained.staleKeys]);
        }
      });
    } catch (error) {
      if (this.validatedHead === capturedHead) this.validatedHead = undefined;
      throw error;
    }
    this.validatedHead = {
      snapshot: transaction.snapshot,
      validation,
      frontier,
    };
  }
}
