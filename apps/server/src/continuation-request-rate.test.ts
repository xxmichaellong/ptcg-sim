import { asPlayerId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY,
  ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY,
  consumeContinuationCreationRateLimit,
} from './continuation-request-rate.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('continuation-rate-player-one');
const p2 = asPlayerId('continuation-rate-player-two');
const policy = { maximumAttempts: 2, windowMs: 10_000 };

const consume = (storage: MemoryDurableStorage, playerId = p1, now = 12_500) =>
  storage.transaction((transaction) =>
    consumeContinuationCreationRateLimit(
      transaction,
      playerId,
      [p1, p2],
      now,
      policy
    )
  );

describe('authenticated continuation creation request rate limit', () => {
  it('pins the frozen human-safe default independently from count quota', () => {
    expect(DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY).toEqual({
      maximumAttempts: 12,
      windowMs: 60_000,
    });
    expect(
      Object.isFrozen(DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY)
    ).toBe(true);
  });

  it('caps each player independently and resets on the fixed window', async () => {
    const storage = new MemoryDurableStorage();
    await expect(consume(storage)).resolves.toEqual({
      allowed: true,
      remaining: 1,
    });
    await expect(consume(storage)).resolves.toEqual({
      allowed: true,
      remaining: 0,
    });
    await expect(consume(storage)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
    await expect(consume(storage, p2)).resolves.toEqual({
      allowed: true,
      remaining: 1,
    });
    await expect(consume(storage, p1, 22_500)).resolves.toEqual({
      allowed: true,
      remaining: 1,
    });
  });

  it('retains only bounded current-player buckets without raw request data', async () => {
    const storage = new MemoryDurableStorage();
    await consume(storage);
    await consume(storage, p2);
    const stored = storage.values.get(
      ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY
    );
    expect(stored).toEqual({
      format: 'ptcgsim-continuation-creation-rate-limit-v1',
      buckets: [
        { requesterPlayerId: p1, windowStartedAt: 12_500, attempts: 1 },
        { requesterPlayerId: p2, windowStartedAt: 12_500, attempts: 1 },
      ],
    });
    expect(JSON.stringify(stored)).not.toContain('operationId');
    expect(JSON.stringify(stored)).not.toContain('capability');
  });

  it('fails closed for invalid policy, identity sets, clocks, and storage', async () => {
    const storage = new MemoryDurableStorage();
    await expect(
      storage.transaction((transaction) =>
        consumeContinuationCreationRateLimit(
          transaction,
          p1,
          [p1, p2],
          Number.NaN,
          DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY
        )
      )
    ).rejects.toThrow('input is invalid');
    await expect(
      storage.transaction((transaction) =>
        consumeContinuationCreationRateLimit(
          transaction,
          p1,
          [p2],
          1_000,
          DEFAULT_CONTINUATION_CREATION_RATE_LIMIT_POLICY
        )
      )
    ).rejects.toThrow('input is invalid');

    for (const invalidPolicy of [
      { maximumAttempts: 0, windowMs: 60_000 },
      { maximumAttempts: 10_001, windowMs: 60_000 },
      { maximumAttempts: 1, windowMs: 999 },
      { maximumAttempts: 1, windowMs: 24 * 60 * 60_000 + 1 },
    ]) {
      await expect(
        new MemoryDurableStorage().transaction((transaction) =>
          consumeContinuationCreationRateLimit(
            transaction,
            p1,
            [p1, p2],
            1_000,
            invalidPolicy
          )
        )
      ).rejects.toThrow('input is invalid');
    }

    storage.values.set(ROOM_CONTINUATION_CREATION_RATE_LIMIT_STORAGE_KEY, {
      format: 'ptcgsim-continuation-creation-rate-limit-v1',
      buckets: [
        { requesterPlayerId: p1, windowStartedAt: 0, attempts: 1 },
        { requesterPlayerId: p1, windowStartedAt: 0, attempts: 1 },
      ],
    });
    await expect(consume(storage)).rejects.toThrow('is malformed');
  });
});
