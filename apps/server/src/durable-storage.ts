import {
  MATCH_STATE_SCHEMA_VERSION,
  stableSerialize,
  type MatchState,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  authoritySnapshotCommandValidationMatches,
  authoritySnapshotValidationFor,
  authoritySnapshotValidationMatches,
  assertAdmissionTransactionTransition,
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
} from './journal-retention.js';
import type {
  DurableStorageLike,
  DurableStorageTransactionLike,
} from './durable-storage-types.js';
export type {
  DurableStorageLike,
  DurableStorageTransactionLike,
} from './durable-storage-types.js';

import type {
  RoomReplayArchive,
  StagedReplayArchive,
} from './replay-archive.js';
import { ROOM_ALREADY_INITIALIZED_MESSAGE } from './room-initialization.js';
import { chunkedSnapshotStorage } from './snapshot-storage.js';

export const AUTHORITY_SNAPSHOT_STORAGE_KEY = 'authority:snapshot';
export const AUTHORITY_FRONTIER_STORAGE_KEY = 'authority:frontier';
export const ROOM_LIFECYCLE_STORAGE_KEY = 'room:lifecycle';
/**
 * A claimed room nobody has used for this long is deleted, and its data
 * with it (ADR-051): rooms are kept for the game being played, not after.
 */
export const ROOM_IDLE_LIFETIME_MS = 24 * 60 * 60_000;
/**
 * How far a claimed room's idle deadline may fall behind before a use
 * moves it on: a busy room writes it about once an hour, not every move.
 */
export const ROOM_IDLE_REFRESH_MS = 60 * 60_000;
const ROOM_CONTINUATION_ORIGIN_STORAGE_KEY = 'room:continuation-origin';
const LEGACY_STORAGE_FORMAT = 'ptcgsim-room-authority-v1';
const PREVIOUS_STORAGE_FORMAT = 'ptcgsim-room-authority-v2';
const PRIOR_STORAGE_FORMAT = 'ptcgsim-room-authority-v3';
const FORMER_STORAGE_FORMAT = 'ptcgsim-room-authority-v4';
const RECENT_STORAGE_FORMAT = 'ptcgsim-room-authority-v5';
const STORAGE_FORMAT = 'ptcgsim-room-authority-v6';
const AUTHORITY_FRONTIER_FORMAT = 'ptcgsim-authority-frontier-v1';
const GENERATION_PATTERN = /^[0-9a-f]{32}$/u;
const CONTINUATION_RESTORE_DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

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
      /** Deleted from here on if nobody uses it meanwhile (ADR-051). */
      readonly idleExpiresAt?: number;
    }
  | {
      readonly format: 'ptcgsim-room-lifecycle-v1';
      readonly state: 'expiring';
      readonly createdAt: number;
      readonly unclaimedExpiresAt: number;
    };

interface StoredRoomContinuationOrigin {
  readonly format: 'ptcgsim-room-continuation-origin-v1';
  readonly restoreDigest: string;
}

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
  readonly sessionIds?: readonly string[];
  readonly disconnectedAt?: number;
  readonly reconnectExpiresAt?: number;
  readonly expiredAt?: number;
  readonly resumedAt?: number;
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
    super(ROOM_ALREADY_INITIALIZED_MESSAGE);
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

const readStoredRoomContinuationOrigin = (
  value: unknown
): StoredRoomContinuationOrigin | undefined => {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    Reflect.get(value, 'format') !== 'ptcgsim-room-continuation-origin-v1' ||
    typeof Reflect.get(value, 'restoreDigest') !== 'string' ||
    !CONTINUATION_RESTORE_DIGEST_PATTERN.test(
      Reflect.get(value, 'restoreDigest')
    )
  ) {
    throw new Error('Stored room continuation origin is malformed');
  }
  return value as StoredRoomContinuationOrigin;
};

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
    const idleExpiresAt = Reflect.get(value, 'idleExpiresAt');
    if (
      !safeNonNegativeInteger(Reflect.get(value, 'claimedAtAuthorityVersion')) ||
      (idleExpiresAt !== undefined && !safeNonNegativeInteger(idleExpiresAt))
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

/**
 * Makes sure an alarm will come by a claimed room's new idle deadline. Any
 * alarm already set comes sooner (the old deadline, or a socket's), and
 * the alarm then sets the next one; only a room with none needs it set.
 */
const armIdleDeadline = async (
  transaction: Pick<DurableStorageTransactionLike, 'getAlarm' | 'setAlarm'>,
  lifecycle: Extract<StoredRoomLifecycle, { state: 'claimed' }>
): Promise<void> => {
  if (lifecycle.idleExpiresAt === undefined) return;
  if ((await transaction.getAlarm()) === null) {
    await transaction.setAlarm(lifecycle.idleExpiresAt);
  }
};

export const storedRoomLifecycleState = (
  value: unknown
): StoredRoomLifecycle['state'] | undefined =>
  readStoredRoomLifecycle(value)?.state;

/**
 * A claimed room's lifecycle with its idle deadline moved on, when a use at
 * `now` should move it (it has none, or it is an hour stale); else
 * undefined, and nothing is written.
 */
const refreshedIdleLifecycle = (
  lifecycle: StoredRoomLifecycle | undefined,
  now: number | undefined
): Extract<StoredRoomLifecycle, { state: 'claimed' }> | undefined => {
  if (lifecycle?.state !== 'claimed' || now === undefined) return undefined;
  const idleExpiresAt = now + ROOM_IDLE_LIFETIME_MS;
  if (
    lifecycle.idleExpiresAt !== undefined &&
    idleExpiresAt - lifecycle.idleExpiresAt < ROOM_IDLE_REFRESH_MS
  ) {
    return undefined;
  }
  return { ...lifecycle, idleExpiresAt };
};

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
  if (
    schemaVersion !== 1 &&
    schemaVersion !== 2 &&
    schemaVersion !== MATCH_STATE_SCHEMA_VERSION
  ) {
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
          ...(schemaVersion === 1
            ? { scope: cardIds.length === 1 ? 'card' : 'zone' }
            : {}),
        },
      ];
    })
  ) as MatchState['visibility']['inspectionGrants'];
  const workAreasValue = Reflect.get(value, 'workAreas');
  if (
    typeof workAreasValue !== 'object' ||
    workAreasValue === null ||
    Array.isArray(workAreasValue)
  ) {
    throw new Error('Stored match work areas are malformed');
  }
  const workAreas = Object.fromEntries(
    Object.entries(workAreasValue).map(([playerId, areasValue]) => {
      if (typeof areasValue !== 'object' || areasValue === null) {
        throw new Error('Stored player work areas are malformed');
      }
      const inspectionValue = Reflect.get(areasValue, 'inspection');
      let inspection: MatchState['workAreas'][string]['inspection'] = null;
      if (inspectionValue !== null) {
        if (typeof inspectionValue !== 'object') {
          throw new Error('Stored inspection work area is malformed');
        }
        const cardIds = Reflect.get(inspectionValue, 'cardIds');
        const viewerIds = Reflect.get(inspectionValue, 'viewerIds');
        if (!Array.isArray(cardIds) || !Array.isArray(viewerIds)) {
          throw new Error('Stored inspection visibility is malformed');
        }
        inspection = {
          ...(inspectionValue as Omit<
            NonNullable<MatchState['workAreas'][string]['inspection']>,
            'viewerIdsByCardId'
          >),
          cardIds,
          viewerIdsByCardId: Object.fromEntries(
            cardIds.map((cardId) => [cardId, [...viewerIds]])
          ),
        };
        delete (inspection as { viewerIds?: unknown }).viewerIds;
      }
      const resolutionValue = Reflect.get(areasValue, 'attachmentResolution');
      let attachmentResolution: MatchState['workAreas'][string]['attachmentResolution'] =
        null;
      if (resolutionValue !== null) {
        if (typeof resolutionValue !== 'object') {
          throw new Error('Stored attachment work area is malformed');
        }
        const evolutionCardIds = Reflect.get(
          resolutionValue,
          'evolutionCardIds'
        );
        const attachmentCardIds = Reflect.get(
          resolutionValue,
          'attachmentCardIds'
        );
        const cardIds = Reflect.get(resolutionValue, 'cardIds');
        if (
          !Array.isArray(evolutionCardIds) ||
          !Array.isArray(attachmentCardIds) ||
          (cardIds !== undefined && !Array.isArray(cardIds))
        ) {
          throw new Error('Stored attachment work-area order is malformed');
        }
        attachmentResolution = {
          ...(resolutionValue as NonNullable<
            MatchState['workAreas'][string]['attachmentResolution']
          >),
          cardIds: cardIds ?? [...evolutionCardIds, ...attachmentCardIds],
          evolutionCardIds,
          attachmentCardIds,
        };
      }
      return [playerId, { inspection, attachmentResolution }];
    })
  ) as MatchState['workAreas'];
  return {
    ...state,
    schemaVersion: MATCH_STATE_SCHEMA_VERSION,
    workAreas,
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
  const legacyAdmissionSchema =
    legacySchema || schemaVersion === 5 || schemaVersion === 6;
  // Schema 8 retired the separate solo undo history: undo now reads the
  // replay history every snapshot already keeps.
  const retiredUndoHistory =
    schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION;
  if (schemaVersion === 1) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      mode: 'multiplayer',
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 2) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 3) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
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
  } else if (schemaVersion === 6 || schemaVersion === 7) {
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    };
  } else if (schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
    candidate = value as RoomAuthoritySnapshot;
  } else {
    throw new Error('Stored room snapshot has an unsupported schema');
  }
  if (retiredUndoHistory) {
    const { soloUndoHistory: _retired, ...current } =
      candidate as RoomAuthoritySnapshot & {
        readonly soloUndoHistory?: unknown;
      };
    candidate = current;
  }
  const state = migrateMatchState(candidate.state);
  if (state !== candidate.state) {
    candidate = {
      ...candidate,
      state,
      replayHistory: createReplayHistory(state),
    };
  }
  if (legacyAdmissionSchema && candidate.admission) {
    candidate = {
      ...candidate,
      admission: {
        ...candidate.admission,
        playerSeatLimit: candidate.mode === 'solo' ? 1 : 2,
      },
    };
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

export class DurableRoomSnapshotStore
  implements AuthoritySnapshotStore, AdmissionPersistence
{
  private validatedHead: ValidatedAuthorityHead | undefined;
  private readonly storage: DurableStorageLike;
  /** Keeps what compaction drops for signed-in seats (ADR-053). */
  private replayArchive: RoomReplayArchive | undefined;

  constructor(
    storage: DurableStorageLike,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly nextAuthorityGeneration: () => string = defaultAuthorityGeneration,
    /** The wall clock a claimed room's idle deadline is set by. */
    private readonly wallClock: () => number = Date.now
  ) {
    this.storage = chunkedSnapshotStorage(
      storage,
      AUTHORITY_SNAPSHOT_STORAGE_KEY
    );
  }

  /** Commits from now on keep a game's record for signed-in seats. */
  archiveReplays(archive: RoomReplayArchive): void {
    this.replayArchive = archive;
  }

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
        (await transaction.get<unknown>(
          ROOM_CONTINUATION_ORIGIN_STORAGE_KEY
        )) !== undefined
      ) {
        throw new Error('Stored room continuation origin has no snapshot');
      }
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

  async initializeContinuationTarget(
    snapshot: RoomAuthoritySnapshot,
    lifecycle: RoomInitializationLifecycle,
    restoreDigest: string
  ): Promise<boolean> {
    const validation = validateAuthoritySnapshot(snapshot);
    if (
      !validInitializationLifecycle(lifecycle) ||
      !CONTINUATION_RESTORE_DIGEST_PATTERN.test(restoreDigest) ||
      snapshot.authorityVersion !== 0 ||
      snapshot.mode !== 'multiplayer' ||
      Object.keys(snapshot.sessions).length !== 0 ||
      snapshot.identities.cardAliases.length !== 0 ||
      snapshot.identities.definitionAliases.length !== 0 ||
      !snapshot.admission ||
      Object.values(snapshot.admission.seats).some(
        (seat) => seat.claimedSessionId !== null
      )
    ) {
      throw new Error('Continuation target initialization is invalid');
    }
    const generation = this.createGeneration();
    const frontier = frontierForSnapshot(snapshot, generation);
    const expectedLifecycle: StoredRoomLifecycle = {
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'unclaimed',
      createdAt: lifecycle.createdAt,
      unclaimedExpiresAt: lifecycle.unclaimedExpiresAt,
    };
    const expectedRetention = initialJournalRetentionIndex(
      snapshot.authorityVersion
    );
    const result = await this.storage.transaction(async (transaction) => {
      const [
        rawSnapshot,
        rawFrontier,
        rawLifecycle,
        rawOrigin,
        rawRetention,
        authorityJournal,
        admissionJournal,
      ] = await Promise.all([
        transaction.get<unknown>(AUTHORITY_SNAPSHOT_STORAGE_KEY),
        transaction.get<unknown>(AUTHORITY_FRONTIER_STORAGE_KEY),
        transaction.get<unknown>(ROOM_LIFECYCLE_STORAGE_KEY),
        transaction.get<unknown>(ROOM_CONTINUATION_ORIGIN_STORAGE_KEY),
        transaction.get<unknown>(JOURNAL_RETENTION_STORAGE_KEY),
        transaction.list<unknown>({ prefix: 'authority:journal:', limit: 1 }),
        transaction.list<unknown>({
          prefix: 'authority:admission:',
          limit: 1,
        }),
      ]);
      if (rawSnapshot === undefined) {
        if (
          rawFrontier !== undefined ||
          rawLifecycle !== undefined ||
          rawOrigin !== undefined ||
          rawRetention !== undefined ||
          authorityJournal.size > 0 ||
          admissionJournal.size > 0
        ) {
          throw new Error('Stored continuation target is incomplete');
        }
        const origin: StoredRoomContinuationOrigin = {
          format: 'ptcgsim-room-continuation-origin-v1',
          restoreDigest,
        };
        await transaction.put({
          [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
            format: STORAGE_FORMAT,
            generation,
            snapshot,
          } satisfies StoredAuthoritySnapshot,
          [AUTHORITY_FRONTIER_STORAGE_KEY]: frontier,
          [JOURNAL_RETENTION_STORAGE_KEY]: expectedRetention,
          [ROOM_LIFECYCLE_STORAGE_KEY]: expectedLifecycle,
          [ROOM_CONTINUATION_ORIGIN_STORAGE_KEY]: origin,
        });
        await transaction.setAlarm(lifecycle.unclaimedExpiresAt);
        return {
          created: true,
          head: { snapshot, validation, frontier },
        };
      }

      const origin = readStoredRoomContinuationOrigin(rawOrigin);
      if (!origin || origin.restoreDigest !== restoreDigest) {
        throw new RoomAlreadyInitializedError();
      }
      if (
        rawFrontier === undefined ||
        rawLifecycle === undefined ||
        rawRetention === undefined ||
        authorityJournal.size > 0 ||
        admissionJournal.size > 0 ||
        // Played or joined since: no journal says so now (ADR-051), its
        // frontier does.
        readStoredFrontier(rawFrontier)?.authorityVersion !== 0
      ) {
        throw new Error('Stored continuation target is incomplete');
      }
      const restored = readStoredSnapshotEnvelope(rawSnapshot);
      const storedFrontier = readStoredFrontier(rawFrontier);
      const storedLifecycle = readStoredRoomLifecycle(rawLifecycle);
      if (
        !restored ||
        restored.format !== STORAGE_FORMAT ||
        !restored.generation ||
        !storedFrontier ||
        !frontierMatches(
          storedFrontier,
          frontierForSnapshot(restored.snapshot, restored.generation)
        ) ||
        stableSerialize(restored.snapshot) !== stableSerialize(snapshot) ||
        stableSerialize(storedLifecycle) !==
          stableSerialize(expectedLifecycle) ||
        stableSerialize(rawRetention) !== stableSerialize(expectedRetention)
      ) {
        throw new RoomAlreadyInitializedError();
      }
      if ((await transaction.getAlarm()) !== lifecycle.unclaimedExpiresAt) {
        await transaction.setAlarm(lifecycle.unclaimedExpiresAt);
      }
      return {
        created: false,
        head: {
          snapshot: restored.snapshot,
          validation: restored.validation,
          frontier: storedFrontier,
        },
      };
    });
    this.validatedHead = result.head;
    return result.created;
  }

  /** The wall clock's reading, or undefined if it gives no usable time. */
  private wallTime(): number | undefined {
    try {
      const now = this.wallClock();
      return safeNonNegativeInteger(now) ? now : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * When a claimed room is deleted unless it is used before then
   * (ADR-051): undefined for a room not yet claimed, or one claimed
   * before rooms had the deadline.
   */
  async roomIdleDeadline(): Promise<number | undefined> {
    const lifecycle = readStoredRoomLifecycle(
      await this.storage.get<unknown>(ROOM_LIFECYCLE_STORAGE_KEY)
    );
    return lifecycle?.state === 'claimed' ? lifecycle.idleExpiresAt : undefined;
  }

  private createGeneration(): string {
    const generation = this.nextAuthorityGeneration();
    if (!validGeneration(generation)) {
      throw new Error('Authority generation source returned an invalid value');
    }
    return generation;
  }

  /**
   * The room's alarm, for its lifecycle: a room nobody claimed in time is
   * deleted, and so is a claimed one past its idle deadline with nobody
   * connected (`occupied` false; ADR-051). Someone still connected keeps
   * it another day. 'claimed' leaves the alarm unset for the Worker to set
   * by the soonest of the room's deadlines (roomIdleDeadline among them).
   */
  async expireUnclaimedRoom(
    now: number,
    occupied = false
  ): Promise<UnclaimedRoomExpiryResult> {
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
        const idleExpiresAt = lifecycle.idleExpiresAt;
        if (idleExpiresAt === undefined || now < idleExpiresAt || occupied) {
          // Claimed before rooms had the deadline, or kept by someone
          // still there: a day from now. Otherwise still within it.
          if (idleExpiresAt === undefined || now >= idleExpiresAt) {
            await transaction.put({
              [ROOM_LIFECYCLE_STORAGE_KEY]: {
                ...lifecycle,
                idleExpiresAt: now + ROOM_IDLE_LIFETIME_MS,
              } satisfies StoredRoomLifecycle,
            });
          }
          return { status: 'claimed' as const, deleteRoom: false, pairChanged };
        }
        await transaction.put({
          [ROOM_LIFECYCLE_STORAGE_KEY]: {
            format: 'ptcgsim-room-lifecycle-v1',
            state: 'expiring',
            createdAt: lifecycle.createdAt,
            unclaimedExpiresAt: Math.max(idleExpiresAt, lifecycle.createdAt + 1),
          } satisfies StoredRoomLifecycle,
        });
        return { status: 'expired' as const, deleteRoom: true, pairChanged };
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
    let archived: StagedReplayArchive | undefined;
    try {
      await this.storage.transaction(async (storageTransaction) => {
        predecessorValidationMs = 0;
        frontierFastPathHit = 0;
        archived = undefined;
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
        // Two rows a move: the snapshot and its frontier (ADR-051). There
        // is no journal of moves: nothing ever read it back, and each move
        // wrote three more rows for it.
        const idle = refreshedIdleLifecycle(lifecycle, this.wallTime());
        // A signed-in seat's game keeps what compaction drops, a block at
        // a time (ADR-053): no row a move.
        archived = await this.replayArchive?.stageCommit(
          storageTransaction,
          current,
          transaction.snapshot,
          transaction.eventBatch
        );
        await storageTransaction.put({
          [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
            format: STORAGE_FORMAT,
            generation: nextGeneration,
            snapshot: transaction.snapshot,
          } satisfies StoredAuthoritySnapshot,
          [AUTHORITY_FRONTIER_STORAGE_KEY]: nextFrontier,
          ...(idle ? { [ROOM_LIFECYCLE_STORAGE_KEY]: idle } : {}),
        });
        if (idle) await armIdleDeadline(storageTransaction, idle);
      });
    } catch (error) {
      if (this.validatedHead === capturedHead) this.validatedHead = undefined;
      this.replayArchive?.forget();
      throw error;
    }
    this.replayArchive?.applyStaged(archived);
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
    let archived: StagedReplayArchive | undefined;
    try {
      await this.storage.transaction(async (storageTransaction) => {
        archived = undefined;
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
        assertAdmissionTransactionTransition(current, transaction);
        const claimsRoom =
          transaction.kind === 'seat_claimed' ||
          transaction.kind === 'spectator_joined' ||
          transaction.kind === 'session_resumed';
        const now = this.wallTime();
        const claimed =
          claimsRoom && lifecycle?.state === 'unclaimed'
            ? ({
                format: 'ptcgsim-room-lifecycle-v1',
                state: 'claimed',
                createdAt: lifecycle.createdAt,
                claimedAtAuthorityVersion:
                  transaction.snapshot.authorityVersion,
                ...(now === undefined
                  ? {}
                  : { idleExpiresAt: now + ROOM_IDLE_LIFETIME_MS }),
              } satisfies StoredRoomLifecycle)
            : undefined;
        // A player arriving or coming back uses the room; the room's own
        // bookkeeping (a dropped connection, a seat given up) does not.
        const idle =
          claimed ??
          (transaction.kind === 'session_disconnected' ||
          transaction.kind === 'sessions_expired'
            ? undefined
            : refreshedIdleLifecycle(lifecycle, now));
        // A history begun again ends the game as it was (ADR-053).
        archived = await this.replayArchive?.stageAdmission(
          storageTransaction,
          current,
          transaction.snapshot
        );
        // No journal of admissions either (ADR-051): nothing read it back.
        await storageTransaction.put({
          [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
            format: STORAGE_FORMAT,
            generation,
            snapshot: transaction.snapshot,
          } satisfies StoredAuthoritySnapshot,
          [AUTHORITY_FRONTIER_STORAGE_KEY]: frontier,
          ...(idle ? { [ROOM_LIFECYCLE_STORAGE_KEY]: idle } : {}),
        });
        if (transaction.kind === 'session_disconnected') {
          const currentAlarm = await storageTransaction.getAlarm();
          if (
            currentAlarm === null ||
            transaction.reconnectExpiresAt < currentAlarm
          ) {
            await storageTransaction.setAlarm(transaction.reconnectExpiresAt);
          }
        }
        if (claimed) {
          // The unclaimed room's deadline gives way to the idle one; the
          // Worker brings it forward for any socket's sooner deadline.
          if (claimed.idleExpiresAt === undefined) {
            await storageTransaction.deleteAlarm();
          } else {
            await storageTransaction.setAlarm(claimed.idleExpiresAt);
          }
        } else if (idle) {
          await armIdleDeadline(storageTransaction, idle);
        }
      });
    } catch (error) {
      if (this.validatedHead === capturedHead) this.validatedHead = undefined;
      this.replayArchive?.forget();
      throw error;
    }
    this.replayArchive?.applyStaged(archived);
    this.validatedHead = {
      snapshot: transaction.snapshot,
      validation,
      frontier,
    };
  }
}
