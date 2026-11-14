import type { PlayerId } from '@ptcgsim/game-core';

import type { DurableStorageTransactionLike } from './durable-storage.js';

export const ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY =
  'room:continuation-creation-rate-limit';
const RATE_LIMIT_FORMAT = 'ptcgsim-continuation-creation-rate-limit-v1';
const MAXIMUM_RATE_BUCKETS = 2;
const MAXIMUM_POLICY_ATTEMPTS = 10_000;

export interface ContinuationCreationRateLimitPolicy {
  readonly maximumAttempts: number;
  readonly windowMs: number;
}

export const DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY: ContinuationCreationRateLimitPolicy =
  Object.freeze({ maximumAttempts: 12, windowMs: 60_000 });

export type ContinuationCreationRateLimitDecision =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

interface StoredContinuationCreationRateBucket {
  readonly requesterPlayerId: PlayerId;
  readonly windowStartedAt: number;
  readonly attempts: number;
}

interface StoredContinuationCreationRateLimit {
  readonly format: typeof RATE_LIMIT_FORMAT;
  readonly buckets: readonly StoredContinuationCreationRateBucket[];
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

export const validContinuationCreationRateLimitPolicy = (
  policy: ContinuationCreationRateLimitPolicy
): boolean =>
  Number.isSafeInteger(policy.maximumAttempts) &&
  policy.maximumAttempts >= 1 &&
  policy.maximumAttempts <= MAXIMUM_POLICY_ATTEMPTS &&
  Number.isSafeInteger(policy.windowMs) &&
  policy.windowMs >= 1_000 &&
  policy.windowMs <= 24 * 60 * 60_000;

const readBucket = (value: unknown): StoredContinuationCreationRateBucket => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['attempts', 'requesterPlayerId', 'windowStartedAt']) ||
    typeof Reflect.get(value, 'requesterPlayerId') !== 'string' ||
    Reflect.get(value, 'requesterPlayerId').length < 1 ||
    Reflect.get(value, 'requesterPlayerId').length > 256 ||
    !safeNonNegativeInteger(Reflect.get(value, 'windowStartedAt')) ||
    !safeNonNegativeInteger(Reflect.get(value, 'attempts')) ||
    Reflect.get(value, 'attempts') < 1 ||
    Reflect.get(value, 'attempts') > MAXIMUM_POLICY_ATTEMPTS
  ) {
    throw new Error('Stored continuation creation rate limit is malformed');
  }
  return value as StoredContinuationCreationRateBucket;
};

const readRateLimit = (value: unknown): StoredContinuationCreationRateLimit => {
  if (value === undefined) return { format: RATE_LIMIT_FORMAT, buckets: [] };
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, ['buckets', 'format']) ||
    Reflect.get(value, 'format') !== RATE_LIMIT_FORMAT ||
    !Array.isArray(Reflect.get(value, 'buckets')) ||
    Reflect.get(value, 'buckets').length > MAXIMUM_RATE_BUCKETS
  ) {
    throw new Error('Stored continuation creation rate limit is malformed');
  }
  const buckets = (Reflect.get(value, 'buckets') as unknown[]).map(readBucket);
  if (
    new Set(buckets.map(({ requesterPlayerId }) => requesterPlayerId)).size !==
    buckets.length
  ) {
    throw new Error('Stored continuation creation rate limit is malformed');
  }
  return { format: RATE_LIMIT_FORMAT, buckets };
};

/**
 * Consumes one authenticated new-operation attempt inside the source
 * reservation transaction. The caller must check exact-operation retries
 * before invoking this helper so an ambiguous response never double-charges.
 */
export const consumeContinuationCreationRateLimit = async (
  transaction: DurableStorageTransactionLike,
  requesterPlayerId: PlayerId,
  activePlayerIds: readonly PlayerId[],
  now: number,
  policy: ContinuationCreationRateLimitPolicy
): Promise<ContinuationCreationRateLimitDecision> => {
  if (
    !safeNonNegativeInteger(now) ||
    !validContinuationCreationRateLimitPolicy(policy) ||
    activePlayerIds.length < 1 ||
    activePlayerIds.length > MAXIMUM_RATE_BUCKETS ||
    new Set(activePlayerIds).size !== activePlayerIds.length ||
    !activePlayerIds.includes(requesterPlayerId)
  ) {
    throw new Error('Continuation creation rate limit input is invalid');
  }
  const stored = readRateLimit(
    await transaction.get<unknown>(
      ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY
    )
  );
  const activePlayers = new Set(activePlayerIds);
  const buckets = stored.buckets.filter(({ requesterPlayerId: playerId }) =>
    activePlayers.has(playerId)
  );
  const previous = buckets.find(
    (bucket) => bucket.requesterPlayerId === requesterPlayerId
  );
  const previousWindowEndsAt = previous
    ? previous.windowStartedAt + policy.windowMs
    : undefined;
  if (
    previousWindowEndsAt !== undefined &&
    !Number.isSafeInteger(previousWindowEndsAt)
  ) {
    throw new Error('Stored continuation creation rate limit is malformed');
  }
  const continuesPreviousWindow =
    previous !== undefined &&
    previous.windowStartedAt <= now &&
    now < previousWindowEndsAt!;
  const windowStartedAt = continuesPreviousWindow
    ? previous.windowStartedAt
    : now;
  const windowEndsAt = windowStartedAt + policy.windowMs;
  if (!Number.isSafeInteger(windowEndsAt)) {
    throw new Error('Continuation creation rate limit input is invalid');
  }
  const attempts = continuesPreviousWindow ? previous.attempts : 0;
  if (attempts >= policy.maximumAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAt - now) / 1_000)),
    };
  }
  const nextAttempts = attempts + 1;
  const nextByPlayer = new Map(
    buckets.map((bucket) => [bucket.requesterPlayerId, bucket])
  );
  nextByPlayer.set(requesterPlayerId, {
    requesterPlayerId,
    windowStartedAt,
    attempts: nextAttempts,
  });
  await transaction.put({
    [ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY]: {
      format: RATE_LIMIT_FORMAT,
      buckets: activePlayerIds.flatMap((playerId) => {
        const bucket = nextByPlayer.get(playerId);
        return bucket ? [bucket] : [];
      }),
    } satisfies StoredContinuationCreationRateLimit,
  });
  return {
    allowed: true,
    remaining: policy.maximumAttempts - nextAttempts,
  };
};
