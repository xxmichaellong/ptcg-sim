import { MATCH_STATE_SCHEMA_VERSION, type PlayerId } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import {
  AUTHORITY_FRONTIER_STORAGE_KEY,
  ConcurrentRoomWriteError,
  type DurableStorageLike,
  type DurableStorageTransactionLike,
} from './durable-storage.js';
import {
  DEFAULT_CONTINUATION_TTL_MS,
  MINIMUM_CONTINUATION_TTL_MS,
} from './continuation-custody.js';
import {
  DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY,
  consumeContinuationCreationRateLimit,
  validContinuationCreationRateLimitPolicy,
  type ContinuationCreationRateLimitPolicy,
} from './continuation-request-rate.js';

export const ROOM_CONTINUATION_CREATIONS_STORAGE_KEY =
  'room:continuation-creations';
const LEDGER_FORMAT = 'ptcgsim-room-continuation-creations-v1';
const PLAN_FORMAT = 'ptcgsim-continuation-creation-plan-v1';
const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CREATE_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_STORED_CREATION_ENTRIES = 16;
const OPERATION_DIGEST_DOMAIN = 'ptcgsim-continuation-create-operation-v1';
const AUTHORITY_GENERATION_PATTERN = /^[0-9a-f]{32}$/u;

export interface ContinuationSourceCreationPolicy {
  readonly maximumPerPlayer: number;
  readonly maximumPerRoom: number;
  readonly retentionMs: number;
}

export const DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY: ContinuationSourceCreationPolicy =
  Object.freeze({
    maximumPerPlayer: 4,
    maximumPerRoom: 8,
    retentionMs: DEFAULT_CONTINUATION_TTL_MS,
  });

export interface ContinuationSourceIdentity {
  readonly digestCapability: (value: string) => Promise<string>;
  readonly nextSaveId: () => string;
}

export interface ReserveContinuationSourceCreationInput {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSessionId: string;
  readonly operationId: string;
  readonly sourceBuild: string;
  readonly createdAt: number;
}

export interface ContinuationSourceCreationPlan {
  readonly format: typeof PLAN_FORMAT;
  readonly operationId: string;
  readonly saveId: string;
  readonly requesterPlayerId: PlayerId;
  readonly requesterSessionId: string;
  readonly sourceBuild: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly snapshot: RoomAuthoritySnapshot;
}

export interface ContinuationSourceCreationReference {
  readonly saveId: string;
  readonly expiresAt: number;
}

export type ContinuationSourceCreationReservation =
  | {
      readonly state: 'pending';
      readonly created: boolean;
      readonly plan: ContinuationSourceCreationPlan;
    }
  | {
      readonly state: 'completed';
      readonly reference: ContinuationSourceCreationReference;
    }
  | {
      readonly state: 'quota_exceeded';
      readonly scope: 'player' | 'room';
    }
  | {
      readonly state: 'rate_limited';
      readonly retryAfterSeconds: number;
    };

export interface CompleteContinuationSourceCreationInput {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSessionId: string;
  readonly operationId: string;
  readonly completedAt: number;
  readonly reference: ContinuationSourceCreationReference;
}

interface StoredPendingCreation {
  readonly state: 'pending';
  readonly operationDigest: string;
  readonly saveId: string;
  readonly requesterPlayerId: PlayerId;
  readonly requesterSessionId: string;
  readonly sourceBuild: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly snapshot: RoomAuthoritySnapshot;
}

interface StoredCompletedCreation {
  readonly state: 'completed';
  readonly operationDigest: string;
  readonly saveId: string;
  readonly requesterPlayerId: PlayerId;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly completedAt: number;
}

type StoredCreation = StoredPendingCreation | StoredCompletedCreation;

interface StoredCreationLedger {
  readonly format: typeof LEDGER_FORMAT;
  readonly entries: readonly StoredCreation[];
}

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validSourceBuild = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 128 &&
  [...value].every((character) => character >= ' ');

const validPolicy = (policy: ContinuationSourceCreationPolicy): boolean =>
  Number.isSafeInteger(policy.maximumPerPlayer) &&
  policy.maximumPerPlayer >= 1 &&
  policy.maximumPerPlayer <= MAX_STORED_CREATION_ENTRIES &&
  Number.isSafeInteger(policy.maximumPerRoom) &&
  policy.maximumPerRoom >= policy.maximumPerPlayer &&
  policy.maximumPerRoom <= MAX_STORED_CREATION_ENTRIES &&
  Number.isSafeInteger(policy.retentionMs) &&
  policy.retentionMs >= MINIMUM_CONTINUATION_TTL_MS &&
  policy.retentionMs <= DEFAULT_CONTINUATION_TTL_MS;

const activeRequester = (
  snapshot: RoomAuthoritySnapshot,
  requesterSessionId: string
): PlayerId | undefined => {
  validateAuthoritySnapshot(snapshot);
  const session = snapshot.sessions[requesterSessionId];
  if (
    !session?.active ||
    session.viewer.kind !== 'player' ||
    snapshot.mode !== 'multiplayer' ||
    !snapshot.admission ||
    snapshot.admission.seats[session.viewer.playerId]?.claimedSessionId !==
      requesterSessionId
  ) {
    return undefined;
  }
  return session.viewer.playerId;
};

const readStoredCreation = (value: unknown): StoredCreation => {
  const storedOperationDigest =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, 'operationDigest')
      : undefined;
  const storedSaveId =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, 'saveId')
      : undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof storedOperationDigest !== 'string' ||
    !DIGEST_PATTERN.test(storedOperationDigest) ||
    typeof storedSaveId !== 'string' ||
    !SAVE_ID_PATTERN.test(storedSaveId) ||
    typeof Reflect.get(value, 'requesterPlayerId') !== 'string' ||
    !safeNonNegativeInteger(Reflect.get(value, 'createdAt')) ||
    !safeNonNegativeInteger(Reflect.get(value, 'expiresAt')) ||
    Reflect.get(value, 'expiresAt') <= Reflect.get(value, 'createdAt') ||
    Reflect.get(value, 'expiresAt') - Reflect.get(value, 'createdAt') <
      MINIMUM_CONTINUATION_TTL_MS ||
    Reflect.get(value, 'expiresAt') - Reflect.get(value, 'createdAt') >
      DEFAULT_CONTINUATION_TTL_MS
  ) {
    throw new Error('Stored room continuation creation is malformed');
  }
  if (
    Reflect.get(value, 'state') === 'completed' &&
    exactKeys(value, [
      'completedAt',
      'createdAt',
      'expiresAt',
      'operationDigest',
      'requesterPlayerId',
      'saveId',
      'state',
    ]) &&
    safeNonNegativeInteger(Reflect.get(value, 'completedAt')) &&
    Reflect.get(value, 'completedAt') >= Reflect.get(value, 'createdAt') &&
    Reflect.get(value, 'completedAt') < Reflect.get(value, 'expiresAt')
  ) {
    return value as StoredCompletedCreation;
  }
  if (
    Reflect.get(value, 'state') === 'pending' &&
    exactKeys(value, [
      'createdAt',
      'expiresAt',
      'operationDigest',
      'requesterPlayerId',
      'requesterSessionId',
      'saveId',
      'snapshot',
      'sourceBuild',
      'state',
    ]) &&
    typeof Reflect.get(value, 'requesterSessionId') === 'string' &&
    validSourceBuild(Reflect.get(value, 'sourceBuild')) &&
    typeof Reflect.get(value, 'snapshot') === 'object' &&
    Reflect.get(value, 'snapshot') !== null
  ) {
    const pending = value as StoredPendingCreation;
    const playerId = activeRequester(
      pending.snapshot,
      pending.requesterSessionId
    );
    if (playerId === pending.requesterPlayerId) return pending;
  }
  throw new Error('Stored room continuation creation is malformed');
};

const readLedger = (value: unknown): StoredCreationLedger => {
  if (value === undefined) return { format: LEDGER_FORMAT, entries: [] };
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['entries', 'format']) ||
    Reflect.get(value, 'format') !== LEDGER_FORMAT ||
    !Array.isArray(Reflect.get(value, 'entries')) ||
    Reflect.get(value, 'entries').length > MAX_STORED_CREATION_ENTRIES
  ) {
    throw new Error('Stored room continuation creation ledger is malformed');
  }
  const entries = (Reflect.get(value, 'entries') as unknown[]).map(
    readStoredCreation
  );
  if (
    new Set(entries.map(({ operationDigest }) => operationDigest)).size !==
    entries.length
  ) {
    throw new Error('Stored room continuation creation ledger is malformed');
  }
  return { format: LEDGER_FORMAT, entries };
};

const persistPrunedLedger = (
  transaction: DurableStorageTransactionLike,
  ledger: StoredCreationLedger,
  entries: readonly StoredCreation[]
): Promise<void> =>
  entries.length === ledger.entries.length
    ? Promise.resolve()
    : transaction.put({
        [ROOM_CONTINUATION_CREATIONS_STORAGE_KEY]: {
          format: LEDGER_FORMAT,
          entries,
        } satisfies StoredCreationLedger,
      });

const assertCurrentFrontier = (
  value: unknown,
  snapshot: RoomAuthoritySnapshot
): void => {
  const actualAuthorityVersion =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, 'authorityVersion')
      : undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value, [
      'authoritySchemaVersion',
      'authorityVersion',
      'envelopeFormat',
      'format',
      'generation',
      'matchId',
      'matchStateSchemaVersion',
      'mode',
      'stateRevision',
    ]) ||
    Reflect.get(value, 'format') !== 'ptcgsim-authority-frontier-v1' ||
    Reflect.get(value, 'envelopeFormat') !== 'ptcgsim-room-authority-v6' ||
    Reflect.get(value, 'authoritySchemaVersion') !==
      AUTHORITY_SNAPSHOT_SCHEMA_VERSION ||
    Reflect.get(value, 'matchStateSchemaVersion') !==
      MATCH_STATE_SCHEMA_VERSION ||
    Reflect.get(value, 'matchId') !== snapshot.state.matchId ||
    Reflect.get(value, 'mode') !== snapshot.mode ||
    actualAuthorityVersion !== snapshot.authorityVersion ||
    Reflect.get(value, 'stateRevision') !== snapshot.state.revision ||
    typeof Reflect.get(value, 'generation') !== 'string' ||
    !AUTHORITY_GENERATION_PATTERN.test(Reflect.get(value, 'generation'))
  ) {
    throw new ConcurrentRoomWriteError(
      snapshot.authorityVersion,
      safeNonNegativeInteger(actualAuthorityVersion)
        ? actualAuthorityVersion
        : -1
    );
  }
};

const planFromPending = (
  pending: StoredPendingCreation,
  operationId: string
): ContinuationSourceCreationPlan =>
  Object.freeze({
    format: PLAN_FORMAT,
    operationId,
    saveId: pending.saveId,
    requesterPlayerId: pending.requesterPlayerId,
    requesterSessionId: pending.requesterSessionId,
    sourceBuild: pending.sourceBuild,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    snapshot: pending.snapshot,
  });

const referenceFromCreation = (
  creation: StoredCreation
): ContinuationSourceCreationReference =>
  Object.freeze({ saveId: creation.saveId, expiresAt: creation.expiresAt });

const operationDigest = (
  operationId: string,
  identity: ContinuationSourceIdentity
): Promise<string> =>
  identity.digestCapability(`${OPERATION_DIGEST_DOMAIN}\u0000${operationId}`);

export class DurableRoomContinuationSource {
  constructor(
    private readonly storage: DurableStorageLike,
    private readonly identity: ContinuationSourceIdentity,
    private readonly policy: ContinuationSourceCreationPolicy = DEFAULT_CONTINUATION_SOURCE_CREATION_POLICY,
    private readonly rateLimitPolicy: ContinuationCreationRateLimitPolicy = DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY
  ) {
    if (
      !validPolicy(policy) ||
      !validContinuationCreationRateLimitPolicy(rateLimitPolicy)
    ) {
      throw new Error('Continuation source creation policy is invalid');
    }
  }

  async reserveCreation(
    input: ReserveContinuationSourceCreationInput
  ): Promise<ContinuationSourceCreationReservation | undefined> {
    if (
      !CREATE_OPERATION_PATTERN.test(input.operationId) ||
      !safeNonNegativeInteger(input.createdAt) ||
      !validSourceBuild(input.sourceBuild)
    ) {
      return undefined;
    }
    const requesterPlayerId = activeRequester(
      input.snapshot,
      input.requesterSessionId
    );
    if (!requesterPlayerId) return undefined;
    const expiresAt = input.createdAt + this.policy.retentionMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new Error('Continuation source creation lifetime is invalid');
    }
    const digest = await operationDigest(input.operationId, this.identity);
    const saveId = this.identity.nextSaveId();
    if (!DIGEST_PATTERN.test(digest) || !SAVE_ID_PATTERN.test(saveId)) {
      throw new Error('Continuation source identity is invalid');
    }
    const snapshot = structuredClone(input.snapshot);
    validateAuthoritySnapshot(snapshot);
    const candidate: StoredPendingCreation = {
      state: 'pending',
      operationDigest: digest,
      saveId,
      requesterPlayerId,
      requesterSessionId: input.requesterSessionId,
      sourceBuild: input.sourceBuild,
      createdAt: input.createdAt,
      expiresAt,
      snapshot,
    };
    return this.storage.transaction(async (transaction) => {
      assertCurrentFrontier(
        await transaction.get<unknown>(AUTHORITY_FRONTIER_STORAGE_KEY),
        input.snapshot
      );
      const ledger = readLedger(
        await transaction.get<unknown>(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
      );
      const entries = ledger.entries.filter(
        (entry) => input.createdAt < entry.expiresAt
      );
      const existing = entries.find(
        (entry) => entry.operationDigest === digest
      );
      if (existing) {
        if (existing.requesterPlayerId !== requesterPlayerId) return undefined;
        await persistPrunedLedger(transaction, ledger, entries);
        return existing.state === 'pending'
          ? {
              state: 'pending' as const,
              created: false,
              plan: planFromPending(existing, input.operationId),
            }
          : {
              state: 'completed' as const,
              reference: referenceFromCreation(existing),
            };
      }
      const rateLimit = await consumeContinuationCreationRateLimit(
        transaction,
        requesterPlayerId,
        input.snapshot.state.playerOrder,
        input.createdAt,
        this.rateLimitPolicy
      );
      if (!rateLimit.allowed) {
        await persistPrunedLedger(transaction, ledger, entries);
        return {
          state: 'rate_limited' as const,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        };
      }
      if (
        entries.filter((entry) => entry.requesterPlayerId === requesterPlayerId)
          .length >= this.policy.maximumPerPlayer
      ) {
        await persistPrunedLedger(transaction, ledger, entries);
        return { state: 'quota_exceeded' as const, scope: 'player' as const };
      }
      if (entries.length >= this.policy.maximumPerRoom) {
        await persistPrunedLedger(transaction, ledger, entries);
        return { state: 'quota_exceeded' as const, scope: 'room' as const };
      }
      await transaction.put({
        [ROOM_CONTINUATION_CREATIONS_STORAGE_KEY]: {
          format: LEDGER_FORMAT,
          entries: [...entries, candidate],
        } satisfies StoredCreationLedger,
      });
      return {
        state: 'pending' as const,
        created: true,
        plan: planFromPending(candidate, input.operationId),
      };
    });
  }

  async completeCreation(
    input: CompleteContinuationSourceCreationInput
  ): Promise<ContinuationSourceCreationReference | undefined> {
    if (
      !CREATE_OPERATION_PATTERN.test(input.operationId) ||
      !safeNonNegativeInteger(input.completedAt) ||
      !SAVE_ID_PATTERN.test(input.reference.saveId) ||
      !safeNonNegativeInteger(input.reference.expiresAt)
    ) {
      return undefined;
    }
    const requesterPlayerId = activeRequester(
      input.snapshot,
      input.requesterSessionId
    );
    if (!requesterPlayerId) return undefined;
    const digest = await operationDigest(input.operationId, this.identity);
    if (!DIGEST_PATTERN.test(digest)) {
      throw new Error('Continuation source identity is invalid');
    }
    return this.storage.transaction(async (transaction) => {
      assertCurrentFrontier(
        await transaction.get<unknown>(AUTHORITY_FRONTIER_STORAGE_KEY),
        input.snapshot
      );
      const ledger = readLedger(
        await transaction.get<unknown>(ROOM_CONTINUATION_CREATIONS_STORAGE_KEY)
      );
      const entries = ledger.entries.filter(
        (entry) => input.completedAt < entry.expiresAt
      );
      const index = entries.findIndex(
        (entry) => entry.operationDigest === digest
      );
      if (index < 0) {
        await persistPrunedLedger(transaction, ledger, entries);
        return undefined;
      }
      const existing = entries[index]!;
      if (
        existing.requesterPlayerId !== requesterPlayerId ||
        existing.saveId !== input.reference.saveId ||
        existing.expiresAt !== input.reference.expiresAt ||
        input.completedAt < existing.createdAt
      ) {
        await persistPrunedLedger(transaction, ledger, entries);
        return undefined;
      }
      if (existing.state === 'completed') {
        await persistPrunedLedger(transaction, ledger, entries);
        return referenceFromCreation(existing);
      }
      const completed: StoredCompletedCreation = {
        state: 'completed',
        operationDigest: existing.operationDigest,
        saveId: existing.saveId,
        requesterPlayerId: existing.requesterPlayerId,
        createdAt: existing.createdAt,
        expiresAt: existing.expiresAt,
        completedAt: input.completedAt,
      };
      await transaction.put({
        [ROOM_CONTINUATION_CREATIONS_STORAGE_KEY]: {
          format: LEDGER_FORMAT,
          entries: entries.map((entry, entryIndex) =>
            entryIndex === index ? completed : entry
          ),
        } satisfies StoredCreationLedger,
      });
      return referenceFromCreation(completed);
    });
  }
}
