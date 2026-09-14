import { env, exports } from 'cloudflare:workers';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_STORAGE_KEY,
  MINIMUM_CONTINUATION_TTL_MS,
} from '../src/continuation-custody.js';

const tombstone = (createdAt: number, expiresAt: number) => ({
  format: 'ptcgsim-continuation-record-v1',
  state: 'revoked',
  saveId: 'A'.repeat(22),
  capabilityDigest: 'B'.repeat(43),
  createdAt,
  expiresAt,
  revokedAt: createdAt,
});

describe('continuation Durable Object runtime', () => {
  it('is provisioned while its edge route remains absent', async () => {
    const response = await exports.default.fetch(
      new Request(
        'https://play.example/v2/continuations/AAAAAAAAAAAAAAAAAAAAAA'
      )
    );

    expect(env.PTCG_CONTINUATION).toBeDefined();
    expect(response.status).toBe(404);
  });

  it('deletes expired custody after eviction without requiring a decrypt key', async () => {
    const stub = env.PTCG_CONTINUATION.getByName('expired-runtime-record');
    const now = Date.now();
    const createdAt = now - MINIMUM_CONTINUATION_TTL_MS - 1;
    const expiresAt = now - 1;
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put(
        CONTINUATION_STORAGE_KEY,
        tombstone(createdAt, expiresAt)
      );
      // Prevent automatic local delivery from racing the explicit test helper.
      await state.storage.setAlarm(now + MINIMUM_CONTINUATION_TTL_MS);
    });
    await evictDurableObject(stub);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const result = await runInDurableObject(stub, async (_instance, state) => ({
      record: await state.storage.get(CONTINUATION_STORAGE_KEY),
      alarm: await state.storage.getAlarm(),
    }));
    expect(result).toEqual({ record: undefined, alarm: null });
  });

  it('reschedules an early continuation alarm at the exact expiry', async () => {
    const stub = env.PTCG_CONTINUATION.getByName('early-runtime-record');
    const now = Date.now();
    const createdAt = now - 1;
    const expiresAt = createdAt + MINIMUM_CONTINUATION_TTL_MS;
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put(
        CONTINUATION_STORAGE_KEY,
        tombstone(createdAt, expiresAt)
      );
      await state.storage.setAlarm(expiresAt + MINIMUM_CONTINUATION_TTL_MS);
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const result = await runInDurableObject(stub, async (_instance, state) => ({
      record: await state.storage.get(CONTINUATION_STORAGE_KEY),
      alarm: await state.storage.getAlarm(),
    }));
    expect(result.record).toEqual(tombstone(createdAt, expiresAt));
    expect(result.alarm).toBe(expiresAt);
  });
});
