import type {
  DurableStorageLike,
  DurableStorageTransactionLike,
} from './durable-storage.js';
import {
  DEFAULT_CONTINUATION_TTL_MS,
  MINIMUM_CONTINUATION_TTL_MS,
} from './continuation-custody.js';

export const CONTINUATION_QUOTA_LEASES_STORAGE_KEY =
  'continuation-quota:leases';
const LEDGER_FORMAT = 'ptcgsim-continuation-quota-leases-v1';
const SHARD_NAME_PREFIX = 'continuation-quota-v1-';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BASE64_URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ROOM_DIGEST_DOMAIN = 'ptcgsim-continuation-quota-room-v1';
const OPERATION_DIGEST_DOMAIN = 'ptcgsim-continuation-quota-operation-v1';
const MAXIMUM_QUOTA_SHARDS = 4_096;
const MAXIMUM_LEASES_PER_SHARD = 512;

export interface ContinuationQuotaShardPolicy {
  readonly maximumActiveLeases: number;
}

export interface ContinuationQuotaIdentity {
  readonly digestCapability: (value: string) => Promise<string>;
}

export interface ReserveContinuationQuotaLeaseInput {
  readonly sourceRoomCode: string;
  readonly operationId: string;
  readonly saveId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly requestedAt: number;
}

export type ContinuationQuotaLeaseReservation =
  | {
      readonly state: 'reserved';
      /** False only when the exact lease already existed. */
      readonly created: boolean;
    }
  | {
      readonly state: 'quota_exceeded';
    };

interface StoredContinuationQuotaLease {
  readonly operationDigest: string;
  readonly sourceRoomDigest: string;
  readonly saveId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface StoredContinuationQuotaLedger {
  readonly format: typeof LEDGER_FORMAT;
  readonly leases: readonly StoredContinuationQuotaLease[];
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

const validLifetime = (createdAt: unknown, expiresAt: unknown): boolean =>
  safeNonNegativeInteger(createdAt) &&
  safeNonNegativeInteger(expiresAt) &&
  expiresAt > createdAt &&
  expiresAt - createdAt >= MINIMUM_CONTINUATION_TTL_MS &&
  expiresAt - createdAt <= DEFAULT_CONTINUATION_TTL_MS;

const validPolicy = (policy: ContinuationQuotaShardPolicy): boolean =>
  Number.isSafeInteger(policy.maximumActiveLeases) &&
  policy.maximumActiveLeases >= 1 &&
  policy.maximumActiveLeases <= MAXIMUM_LEASES_PER_SHARD;

const readStoredLease = (value: unknown): StoredContinuationQuotaLease => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'createdAt',
      'expiresAt',
      'operationDigest',
      'saveId',
      'sourceRoomDigest',
    ]) ||
    typeof Reflect.get(value, 'operationDigest') !== 'string' ||
    !DIGEST_PATTERN.test(Reflect.get(value, 'operationDigest')) ||
    typeof Reflect.get(value, 'sourceRoomDigest') !== 'string' ||
    !DIGEST_PATTERN.test(Reflect.get(value, 'sourceRoomDigest')) ||
    typeof Reflect.get(value, 'saveId') !== 'string' ||
    !SAVE_ID_PATTERN.test(Reflect.get(value, 'saveId')) ||
    !validLifetime(
      Reflect.get(value, 'createdAt'),
      Reflect.get(value, 'expiresAt')
    )
  ) {
    throw new Error('Stored continuation quota lease is malformed');
  }
  return value as StoredContinuationQuotaLease;
};

const readLedger = (value: unknown): StoredContinuationQuotaLedger => {
  if (value === undefined) return { format: LEDGER_FORMAT, leases: [] };
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['format', 'leases']) ||
    Reflect.get(value, 'format') !== LEDGER_FORMAT ||
    !Array.isArray(Reflect.get(value, 'leases')) ||
    Reflect.get(value, 'leases').length > MAXIMUM_LEASES_PER_SHARD
  ) {
    throw new Error('Stored continuation quota ledger is malformed');
  }
  const leases = (Reflect.get(value, 'leases') as unknown[]).map(
    readStoredLease
  );
  if (
    new Set(leases.map(({ operationDigest }) => operationDigest)).size !==
      leases.length ||
    new Set(leases.map(({ saveId }) => saveId)).size !== leases.length
  ) {
    throw new Error('Stored continuation quota ledger is malformed');
  }
  return { format: LEDGER_FORMAT, leases };
};

const earliestExpiry = (
  leases: readonly StoredContinuationQuotaLease[]
): number | undefined =>
  leases.reduce<number | undefined>(
    (earliest, lease) =>
      earliest === undefined || lease.expiresAt < earliest
        ? lease.expiresAt
        : earliest,
    undefined
  );

const reconcileAlarm = async (
  transaction: DurableStorageTransactionLike,
  leases: readonly StoredContinuationQuotaLease[]
): Promise<void> => {
  const currentAlarm = await transaction.getAlarm();
  const nextAlarm = earliestExpiry(leases);
  if (nextAlarm === undefined) {
    if (currentAlarm !== null) await transaction.deleteAlarm();
  } else if (currentAlarm !== nextAlarm) {
    await transaction.setAlarm(nextAlarm);
  }
};

const persistPrunedLedger = async (
  transaction: DurableStorageTransactionLike,
  ledger: StoredContinuationQuotaLedger,
  leases: readonly StoredContinuationQuotaLease[]
): Promise<void> => {
  if (leases.length === ledger.leases.length) return;
  if (leases.length === 0) {
    await transaction.delete([CONTINUATION_QUOTA_LEASES_STORAGE_KEY]);
    return;
  }
  await transaction.put({
    [CONTINUATION_QUOTA_LEASES_STORAGE_KEY]: {
      format: LEDGER_FORMAT,
      leases,
    } satisfies StoredContinuationQuotaLedger,
  });
};

const digest = async (
  identity: ContinuationQuotaIdentity,
  value: string
): Promise<string> => {
  const result = await identity.digestCapability(value);
  if (!DIGEST_PATTERN.test(result)) {
    throw new Error('Continuation quota identity is invalid');
  }
  return result;
};

const validateShardCount = (shardCount: number): void => {
  if (
    !Number.isSafeInteger(shardCount) ||
    shardCount < 1 ||
    shardCount > MAXIMUM_QUOTA_SHARDS
  ) {
    throw new Error('Continuation quota shard count is invalid');
  }
};

/**
 * Maps a public source-room code to one fixed quota partition without retaining
 * that code in quota storage. Fixed per-shard capacities make their sum a hard
 * global ceiling while avoiding one global Durable Object singleton.
 */
export const continuationQuotaShardName = async (
  sourceRoomCode: string,
  shardCount: number,
  identity: ContinuationQuotaIdentity
): Promise<string> => {
  if (!ROOM_CODE_PATTERN.test(sourceRoomCode)) {
    throw new Error('Continuation quota source room is invalid');
  }
  validateShardCount(shardCount);
  const roomDigest = await digest(
    identity,
    `${ROOM_DIGEST_DOMAIN}\u0000${sourceRoomCode}`
  );
  let prefix = 0;
  for (const character of roomDigest.slice(0, 6)) {
    const value = BASE64_URL_ALPHABET.indexOf(character);
    if (value < 0) throw new Error('Continuation quota identity is invalid');
    prefix = prefix * 64 + value;
  }
  const shard = prefix % shardCount;
  return `${SHARD_NAME_PREFIX}${shard.toString(16).padStart(3, '0')}`;
};

export class DurableContinuationQuotaShard {
  constructor(
    private readonly storage: DurableStorageLike,
    private readonly identity: ContinuationQuotaIdentity,
    private readonly policy: ContinuationQuotaShardPolicy
  ) {
    if (!validPolicy(policy)) {
      throw new Error('Continuation quota shard policy is invalid');
    }
  }

  async reserve(
    input: ReserveContinuationQuotaLeaseInput
  ): Promise<ContinuationQuotaLeaseReservation | undefined> {
    if (
      !ROOM_CODE_PATTERN.test(input.sourceRoomCode) ||
      !OPERATION_ID_PATTERN.test(input.operationId) ||
      !SAVE_ID_PATTERN.test(input.saveId) ||
      !validLifetime(input.createdAt, input.expiresAt) ||
      !safeNonNegativeInteger(input.requestedAt) ||
      input.requestedAt < input.createdAt ||
      input.requestedAt >= input.expiresAt
    ) {
      return undefined;
    }
    const [sourceRoomDigest, operationDigest] = await Promise.all([
      digest(
        this.identity,
        `${ROOM_DIGEST_DOMAIN}\u0000${input.sourceRoomCode}`
      ),
      digest(
        this.identity,
        `${OPERATION_DIGEST_DOMAIN}\u0000${input.sourceRoomCode}\u0000${input.operationId}`
      ),
    ]);
    const candidate: StoredContinuationQuotaLease = {
      operationDigest,
      sourceRoomDigest,
      saveId: input.saveId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    };
    return this.storage.transaction(async (transaction) => {
      const ledger = readLedger(
        await transaction.get<unknown>(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
      );
      const leases = ledger.leases.filter(
        (lease) => input.requestedAt < lease.expiresAt
      );
      const existing = leases.find(
        (lease) => lease.operationDigest === operationDigest
      );
      if (existing) {
        await persistPrunedLedger(transaction, ledger, leases);
        await reconcileAlarm(transaction, leases);
        return existing.sourceRoomDigest === sourceRoomDigest &&
          existing.saveId === input.saveId &&
          existing.createdAt === input.createdAt &&
          existing.expiresAt === input.expiresAt
          ? { state: 'reserved' as const, created: false }
          : undefined;
      }
      if (leases.some((lease) => lease.saveId === input.saveId)) {
        await persistPrunedLedger(transaction, ledger, leases);
        await reconcileAlarm(transaction, leases);
        return undefined;
      }
      if (leases.length >= this.policy.maximumActiveLeases) {
        await persistPrunedLedger(transaction, ledger, leases);
        await reconcileAlarm(transaction, leases);
        return { state: 'quota_exceeded' as const };
      }
      const nextLeases = [...leases, candidate];
      await transaction.put({
        [CONTINUATION_QUOTA_LEASES_STORAGE_KEY]: {
          format: LEDGER_FORMAT,
          leases: nextLeases,
        } satisfies StoredContinuationQuotaLedger,
      });
      await reconcileAlarm(transaction, nextLeases);
      return { state: 'reserved' as const, created: true };
    });
  }
}

export const expireContinuationQuotaLeases = async (
  storage: DurableStorageLike,
  now: number
): Promise<number> => {
  if (!safeNonNegativeInteger(now)) {
    throw new Error('Continuation quota expiry time is invalid');
  }
  return storage.transaction(async (transaction) => {
    const ledger = readLedger(
      await transaction.get<unknown>(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
    );
    const leases = ledger.leases.filter((lease) => now < lease.expiresAt);
    await persistPrunedLedger(transaction, ledger, leases);
    await reconcileAlarm(transaction, leases);
    return ledger.leases.length - leases.length;
  });
};
