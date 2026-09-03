import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_SNAPSHOT_STORAGE_KEY,
  ROOM_LIFECYCLE_STORAGE_KEY,
  RoomExpiredError,
  type DurableStorageLike,
  type DurableStorageTransactionLike,
} from './durable-storage.js';
import {
  DurableRoomRateLimiter,
  ROOM_RATE_LIMIT_STORAGE_KEY,
  type RoomRateLimitPolicy,
  type RoomRateLimitedOperation,
} from './room-rate-limit.js';

class MemoryDurableStorage implements DurableStorageLike {
  readonly values = new Map<string, unknown>([
    [AUTHORITY_SNAPSHOT_STORAGE_KEY, { initialized: true }],
  ]);
  private tail: Promise<void> = Promise.resolve();

  async get<Value>(key: string): Promise<Value | undefined> {
    return structuredClone(this.values.get(key)) as Value | undefined;
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
  }

  transaction<Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ): Promise<Value> {
    const run = this.tail.then(async () => {
      const staged = new Map(
        [...this.values].map(([key, value]) => [key, structuredClone(value)])
      );
      const result = await closure({
        get: async <Stored>(key: string) =>
          structuredClone(staged.get(key)) as Stored | undefined,
        put: async (entries) => {
          for (const [key, value] of Object.entries(entries)) {
            staged.set(key, structuredClone(value));
          }
        },
        setAlarm: async () => undefined,
        deleteAlarm: async () => undefined,
      });
      this.values.clear();
      for (const [key, value] of staged) this.values.set(key, value);
      return result;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

const policies = (
  policy: RoomRateLimitPolicy
): Readonly<Record<RoomRateLimitedOperation, RoomRateLimitPolicy>> => ({
  invitation: policy,
  admission_ticket: policy,
  session_hello: policy,
  socket_upgrade: policy,
});

describe('durable per-room rate limits', () => {
  it('atomically caps concurrent attempts and returns the fixed-window retry', async () => {
    const storage = new MemoryDurableStorage();
    const limiter = new DurableRoomRateLimiter(
      storage,
      policies({ maximumAttempts: 3, windowMs: 10_000 })
    );

    const decisions = await Promise.all(
      Array.from({ length: 4 }, () => limiter.attempt('invitation', 12_500))
    );
    expect(decisions).toEqual([
      { allowed: true, remaining: 2 },
      { allowed: true, remaining: 1 },
      { allowed: true, remaining: 0 },
      { allowed: false, retryAfterSeconds: 8 },
    ]);
    await expect(limiter.attempt('invitation', 20_000)).resolves.toEqual({
      allowed: true,
      remaining: 2,
    });
  });

  it('keeps operation budgets independent and survives limiter recreation', async () => {
    const storage = new MemoryDurableStorage();
    const configured = policies({ maximumAttempts: 1, windowMs: 60_000 });
    const first = new DurableRoomRateLimiter(storage, configured);

    await expect(first.attempt('invitation', 1_000)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(
      first.attempt('admission_ticket', 1_000)
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      new DurableRoomRateLimiter(storage, configured).attempt(
        'invitation',
        2_000
      )
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 58 });
  });

  it('fails closed for missing, expiring, or malformed durable room state', async () => {
    const storage = new MemoryDurableStorage();
    const limiter = new DurableRoomRateLimiter(storage);
    storage.values.delete(AUTHORITY_SNAPSHOT_STORAGE_KEY);
    await expect(
      limiter.attempt('socket_upgrade', 1_000)
    ).rejects.toBeInstanceOf(RoomExpiredError);

    storage.values.set(AUTHORITY_SNAPSHOT_STORAGE_KEY, { initialized: true });
    storage.values.set(ROOM_LIFECYCLE_STORAGE_KEY, {
      format: 'ptcgsim-room-lifecycle-v1',
      state: 'expiring',
      createdAt: 0,
      unclaimedExpiresAt: 1_000,
    });
    await expect(
      limiter.attempt('socket_upgrade', 1_000)
    ).rejects.toBeInstanceOf(RoomExpiredError);

    storage.values.delete(ROOM_LIFECYCLE_STORAGE_KEY);
    storage.values.set(ROOM_RATE_LIMIT_STORAGE_KEY, {
      format: 'ptcgsim-room-rate-limits-v1',
      buckets: {
        invitation: { windowStartedAt: 0, attempts: -1 },
      },
    });
    await expect(limiter.attempt('invitation', 1_000)).rejects.toThrow(
      'rate limits are malformed'
    );
  });
});
