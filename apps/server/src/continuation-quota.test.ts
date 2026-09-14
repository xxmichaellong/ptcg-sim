import { describe, expect, it } from 'vitest';

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import {
  CONTINUATION_QUOTA_LEASES_STORAGE_KEY,
  DurableContinuationQuotaShard,
  continuationQuotaShardName,
  expireContinuationQuotaLeases,
  type ContinuationQuotaShardPolicy,
  type ReserveContinuationQuotaLeaseInput,
} from './continuation-quota.js';
import { MINIMUM_CONTINUATION_TTL_MS } from './continuation-custody.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const createdAt = 2_000_000_000_000;
const identity = new WebCryptoAuthoritySource();
const policy: ContinuationQuotaShardPolicy = { maximumActiveLeases: 2 };

const input = (
  operationId = 'A'.repeat(43),
  saveId = 'L'.repeat(22),
  sourceRoomCode = 'CDEFGHJK2345',
  requestedAt = createdAt
): ReserveContinuationQuotaLeaseInput => ({
  sourceRoomCode,
  operationId,
  saveId,
  createdAt,
  expiresAt: createdAt + MINIMUM_CONTINUATION_TTL_MS,
  requestedAt,
});

const setup = (
  configuredPolicy: ContinuationQuotaShardPolicy = policy
): {
  readonly storage: MemoryDurableStorage;
  readonly quota: DurableContinuationQuotaShard;
} => {
  const storage = new MemoryDurableStorage();
  return {
    storage,
    quota: new DurableContinuationQuotaShard(
      storage,
      identity,
      configuredPolicy
    ),
  };
};

describe('sharded global continuation quota', () => {
  it('maps rooms deterministically into a fixed bounded shard set', async () => {
    const first = await continuationQuotaShardName(
      'CDEFGHJK2345',
      64,
      identity
    );
    await expect(
      continuationQuotaShardName('CDEFGHJK2345', 64, identity)
    ).resolves.toBe(first);
    expect(first).toMatch(/^continuation-quota-v1-[0-9a-f]{3}$/u);
    const shard = Number.parseInt(first.slice(-3), 16);
    expect(shard).toBeGreaterThanOrEqual(0);
    expect(shard).toBeLessThan(64);
    await expect(
      continuationQuotaShardName('invalid-room', 64, identity)
    ).rejects.toThrow('source room is invalid');
    await expect(
      continuationQuotaShardName('CDEFGHJK2345', 0, identity)
    ).rejects.toThrow('shard count is invalid');
    await expect(
      continuationQuotaShardName('CDEFGHJK2345', 4_097, identity)
    ).rejects.toThrow('shard count is invalid');
    await expect(
      continuationQuotaShardName('CDEFGHJK2345', 64, {
        digestCapability: async () => 'malformed',
      })
    ).rejects.toThrow('identity is invalid');
  });

  it('persists one digest-only expiring lease and recovers its exact retry', async () => {
    const { quota, storage } = setup();
    await expect(quota.reserve(input())).resolves.toEqual({
      state: 'reserved',
      created: true,
    });
    expect(storage.alarm).toBe(createdAt + MINIMUM_CONTINUATION_TTL_MS);
    const stored = JSON.stringify(
      storage.values.get(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
    );
    expect(stored).not.toContain('CDEFGHJK2345');
    expect(stored).not.toContain('A'.repeat(43));
    expect(stored).toContain('L'.repeat(22));
    const beforeRetry = structuredClone(
      storage.values.get(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
    );
    await expect(quota.reserve(input())).resolves.toEqual({
      state: 'reserved',
      created: false,
    });
    expect(storage.values.get(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)).toEqual(
      beforeRetry
    );

    storage.alarm = null;
    await expect(quota.reserve(input())).resolves.toEqual({
      state: 'reserved',
      created: false,
    });
    expect(storage.alarm).toBe(createdAt + MINIMUM_CONTINUATION_TTL_MS);
  });

  it('enforces the shard ceiling and prunes expired capacity transactionally', async () => {
    const { quota, storage } = setup();
    await quota.reserve(input());
    await quota.reserve(input('B'.repeat(43), 'M'.repeat(22)));
    await expect(
      quota.reserve(input('C'.repeat(43), 'N'.repeat(22)))
    ).resolves.toEqual({ state: 'quota_exceeded' });

    const afterExpiry = input(
      'C'.repeat(43),
      'N'.repeat(22),
      'CDEFGHJK2345',
      createdAt + MINIMUM_CONTINUATION_TTL_MS
    );
    const later = {
      ...afterExpiry,
      createdAt: afterExpiry.requestedAt,
      expiresAt: afterExpiry.requestedAt + MINIMUM_CONTINUATION_TTL_MS,
    };
    await expect(quota.reserve(later)).resolves.toEqual({
      state: 'reserved',
      created: true,
    });
    expect(storage.alarm).toBe(later.expiresAt);
    const stored = JSON.stringify(
      storage.values.get(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
    );
    expect(stored).not.toContain('L'.repeat(22));
    expect(stored).not.toContain('M'.repeat(22));
    expect(stored).toContain('N'.repeat(22));
  });

  it('rejects operation reuse, save collisions, malformed input, and bad policy', async () => {
    const { quota } = setup();
    await quota.reserve(input());
    await expect(
      quota.reserve(input('A'.repeat(43), 'M'.repeat(22)))
    ).resolves.toBeUndefined();
    await expect(
      quota.reserve(input('B'.repeat(43), 'L'.repeat(22)))
    ).resolves.toBeUndefined();
    for (const malformed of [
      { ...input(), sourceRoomCode: 'bad' },
      { ...input(), operationId: 'short' },
      { ...input(), saveId: 'short' },
      { ...input(), requestedAt: createdAt - 1 },
      { ...input(), requestedAt: createdAt + MINIMUM_CONTINUATION_TTL_MS },
      { ...input(), expiresAt: createdAt + MINIMUM_CONTINUATION_TTL_MS - 1 },
    ]) {
      await expect(quota.reserve(malformed)).resolves.toBeUndefined();
    }
    expect(
      () =>
        new DurableContinuationQuotaShard(storageFixture(), identity, {
          maximumActiveLeases: 0,
        })
    ).toThrow('policy is invalid');
    expect(
      () =>
        new DurableContinuationQuotaShard(storageFixture(), identity, {
          maximumActiveLeases: 513,
        })
    ).toThrow('policy is invalid');
  });

  it('is stable across transaction retry, rollback, and ambiguous commit', async () => {
    const retried = setup();
    retried.storage.retryTransactionOnce = true;
    await expect(retried.quota.reserve(input())).resolves.toEqual({
      state: 'reserved',
      created: true,
    });
    expect(retried.storage.transactionAttempts).toBe(2);
    expect(
      JSON.stringify(
        retried.storage.values.get(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
      ).match(/"saveId"/gu)
    ).toHaveLength(1);

    const rolledBack = setup();
    rolledBack.storage.failSetAlarm = true;
    await expect(rolledBack.quota.reserve(input())).rejects.toThrow(
      'setAlarm failure'
    );
    expect(rolledBack.storage.values.size).toBe(0);
    rolledBack.storage.failSetAlarm = false;
    await expect(rolledBack.quota.reserve(input())).resolves.toEqual({
      state: 'reserved',
      created: true,
    });

    const ambiguous = setup();
    ambiguous.storage.failAfterTransactionCommitOnce = true;
    await expect(ambiguous.quota.reserve(input())).rejects.toThrow(
      'ambiguous transaction failure'
    );
    await expect(ambiguous.quota.reserve(input())).resolves.toEqual({
      state: 'reserved',
      created: false,
    });
  });

  it('expires due leases, retains future leases, and clears the final alarm', async () => {
    const { quota, storage } = setup();
    await quota.reserve(input());
    const laterCreatedAt = createdAt + 1;
    await quota.reserve({
      ...input('B'.repeat(43), 'M'.repeat(22)),
      createdAt: laterCreatedAt,
      expiresAt: laterCreatedAt + MINIMUM_CONTINUATION_TTL_MS,
      requestedAt: laterCreatedAt,
    });
    await expect(
      expireContinuationQuotaLeases(
        storage,
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).resolves.toBe(1);
    expect(storage.alarm).toBe(laterCreatedAt + MINIMUM_CONTINUATION_TTL_MS);
    await expect(
      expireContinuationQuotaLeases(
        storage,
        laterCreatedAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).resolves.toBe(1);
    expect(storage.values.has(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)).toBe(
      false
    );
    expect(storage.alarm).toBeNull();
    await expect(expireContinuationQuotaLeases(storage, -1)).rejects.toThrow(
      'expiry time is invalid'
    );
  });

  it('rolls expiry cleanup back atomically and recovers an ambiguous cleanup', async () => {
    const failed = setup({ maximumActiveLeases: 1 });
    await failed.quota.reserve(input());
    failed.storage.failDeleteAlarm = true;
    await expect(
      expireContinuationQuotaLeases(
        failed.storage,
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).rejects.toThrow('deleteAlarm failure');
    expect(
      failed.storage.values.has(CONTINUATION_QUOTA_LEASES_STORAGE_KEY)
    ).toBe(true);
    expect(failed.storage.alarm).toBe(createdAt + MINIMUM_CONTINUATION_TTL_MS);
    failed.storage.failDeleteAlarm = false;
    await expect(
      expireContinuationQuotaLeases(
        failed.storage,
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).resolves.toBe(1);

    const ambiguous = setup({ maximumActiveLeases: 1 });
    await ambiguous.quota.reserve(input());
    ambiguous.storage.failAfterTransactionCommitOnce = true;
    await expect(
      expireContinuationQuotaLeases(
        ambiguous.storage,
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).rejects.toThrow('ambiguous transaction failure');
    expect(ambiguous.storage.values.size).toBe(0);
    expect(ambiguous.storage.alarm).toBeNull();
    await expect(
      expireContinuationQuotaLeases(
        ambiguous.storage,
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).resolves.toBe(0);
  });

  it('fails closed on malformed, duplicate, or oversized stored ledgers', async () => {
    const { quota, storage } = setup();
    storage.values.set(CONTINUATION_QUOTA_LEASES_STORAGE_KEY, {
      format: 'ptcgsim-continuation-quota-leases-v1',
      leases: [{ malformed: true }],
    });
    await expect(quota.reserve(input())).rejects.toThrow('lease is malformed');
    await expect(
      expireContinuationQuotaLeases(storage, createdAt)
    ).rejects.toThrow('lease is malformed');

    const valid = setup();
    await valid.quota.reserve(input());
    const ledger = valid.storage.values.get(
      CONTINUATION_QUOTA_LEASES_STORAGE_KEY
    ) as { leases: unknown[] };
    valid.storage.values.set(CONTINUATION_QUOTA_LEASES_STORAGE_KEY, {
      format: 'ptcgsim-continuation-quota-leases-v1',
      leases: [...ledger.leases, structuredClone(ledger.leases[0])],
    });
    await expect(valid.quota.reserve(input())).rejects.toThrow(
      'ledger is malformed'
    );

    storage.values.set(CONTINUATION_QUOTA_LEASES_STORAGE_KEY, {
      format: 'ptcgsim-continuation-quota-leases-v1',
      leases: Array.from({ length: 513 }, () => ({ malformed: true })),
    });
    await expect(quota.reserve(input())).rejects.toThrow('ledger is malformed');
  });
});

const storageFixture = (): MemoryDurableStorage => new MemoryDurableStorage();
