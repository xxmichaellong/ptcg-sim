import type {
  AdmissionTicketIssueResult,
  RoomAuthoritySnapshot,
  RoomInvitationIssueResult,
} from '@ptcgsim/room-authority';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ROOM_LIFECYCLE_STORAGE_KEY,
  RoomExpiredError,
  storedRoomLifecycleState,
  type DurableStorageLike,
} from './durable-storage.js';

export const ROOM_RATE_LIMIT_STORAGE_KEY = 'room:rate-limits';
const ROOM_RATE_LIMIT_FORMAT = 'ptcgsim-room-rate-limits-v1';

export type RoomRateLimitedOperation =
  'invitation' | 'admission_ticket' | 'session_hello' | 'socket_upgrade';

export interface RoomRateLimitPolicy {
  readonly maximumAttempts: number;
  readonly windowMs: number;
}

export const DEFAULT_ROOM_RATE_LIMIT_POLICIES: Readonly<
  Record<RoomRateLimitedOperation, RoomRateLimitPolicy>
> = {
  invitation: { maximumAttempts: 24, windowMs: 60_000 },
  admission_ticket: { maximumAttempts: 60, windowMs: 60_000 },
  session_hello: { maximumAttempts: 120, windowMs: 60_000 },
  socket_upgrade: { maximumAttempts: 120, windowMs: 60_000 },
};

interface StoredRateLimitBucket {
  readonly windowStartedAt: number;
  readonly attempts: number;
}

interface StoredRoomRateLimits {
  readonly format: typeof ROOM_RATE_LIMIT_FORMAT;
  readonly buckets: Partial<
    Readonly<Record<RoomRateLimitedOperation, StoredRateLimitBucket>>
  >;
}

export type RoomRateLimitDecision =
  | {
      readonly allowed: true;
      readonly remaining: number;
    }
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: number;
    };

export interface RoomRateLimitPort {
  readonly attempt: (
    operation: RoomRateLimitedOperation,
    now: number
  ) => Promise<RoomRateLimitDecision>;
}

export interface RoomOperationRateLimitRejection {
  readonly accepted: false;
  readonly code: 'rate_limited';
  readonly retryAfterSeconds: number;
  readonly snapshot: RoomAuthoritySnapshot;
}

export type BoundedAdmissionTicketIssueResult =
  AdmissionTicketIssueResult | RoomOperationRateLimitRejection;

export type BoundedRoomInvitationIssueResult =
  RoomInvitationIssueResult | RoomOperationRateLimitRejection;

const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validPolicy = (policy: RoomRateLimitPolicy): boolean =>
  Number.isSafeInteger(policy.maximumAttempts) &&
  policy.maximumAttempts >= 1 &&
  policy.maximumAttempts <= 10_000 &&
  Number.isSafeInteger(policy.windowMs) &&
  policy.windowMs >= 1_000 &&
  policy.windowMs <= 24 * 60 * 60_000;

const readStoredRateLimits = (value: unknown): StoredRoomRateLimits => {
  if (value === undefined) {
    return { format: ROOM_RATE_LIMIT_FORMAT, buckets: {} };
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'format') !== ROOM_RATE_LIMIT_FORMAT
  ) {
    throw new Error('Stored room rate limits are malformed');
  }
  const buckets = Reflect.get(value, 'buckets');
  if (
    typeof buckets !== 'object' ||
    buckets === null ||
    Array.isArray(buckets)
  ) {
    throw new Error('Stored room rate limits are malformed');
  }
  for (const [operation, bucket] of Object.entries(buckets)) {
    if (
      ![
        'invitation',
        'admission_ticket',
        'session_hello',
        'socket_upgrade',
      ].includes(operation) ||
      typeof bucket !== 'object' ||
      bucket === null ||
      !safeNonNegativeInteger(Reflect.get(bucket, 'windowStartedAt')) ||
      !safeNonNegativeInteger(Reflect.get(bucket, 'attempts'))
    ) {
      throw new Error('Stored room rate limits are malformed');
    }
  }
  return value as StoredRoomRateLimits;
};

export class DurableRoomRateLimiter implements RoomRateLimitPort {
  constructor(
    private readonly storage: DurableStorageLike,
    private readonly policies = DEFAULT_ROOM_RATE_LIMIT_POLICIES
  ) {}

  async attempt(
    operation: RoomRateLimitedOperation,
    now: number
  ): Promise<RoomRateLimitDecision> {
    const policy = this.policies[operation];
    if (!safeNonNegativeInteger(now) || !policy || !validPolicy(policy)) {
      throw new Error('Room rate limit input is invalid');
    }
    const windowStartedAt = now - (now % policy.windowMs);
    return this.storage.transaction(async (transaction) => {
      const [snapshot, lifecycleValue, storedValue] = await Promise.all([
        transaction.get<unknown>(AUTHORITY_SNAPSHOT_STORAGE_KEY),
        transaction.get<unknown>(ROOM_LIFECYCLE_STORAGE_KEY),
        transaction.get<unknown>(ROOM_RATE_LIMIT_STORAGE_KEY),
      ]);
      if (snapshot === undefined) throw new RoomExpiredError();
      if (storedRoomLifecycleState(lifecycleValue) === 'expiring') {
        throw new RoomExpiredError();
      }
      const stored = readStoredRateLimits(storedValue);
      const previous = stored.buckets[operation];
      const attempts =
        previous?.windowStartedAt === windowStartedAt ? previous.attempts : 0;
      if (attempts >= policy.maximumAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowStartedAt + policy.windowMs - now) / 1_000)
          ),
        };
      }
      const nextAttempts = attempts + 1;
      await transaction.put({
        [ROOM_RATE_LIMIT_STORAGE_KEY]: {
          format: ROOM_RATE_LIMIT_FORMAT,
          buckets: {
            ...stored.buckets,
            [operation]: { windowStartedAt, attempts: nextAttempts },
          },
        } satisfies StoredRoomRateLimits,
      });
      return {
        allowed: true,
        remaining: policy.maximumAttempts - nextAttempts,
      };
    });
  }
}
