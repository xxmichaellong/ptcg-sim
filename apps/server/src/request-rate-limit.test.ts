import { describe, expect, it, vi } from 'vitest';

import {
  anonymousRequestRateLimitKey,
  consumeContinuationCreationRateLimit,
  consumeContinuationRestoreRateLimit,
  consumeContinuationRevocationRateLimit,
  consumeRoomCreationRateLimit,
  readRequestRateLimitDecision,
  ROOM_CREATION_RATE_LIMIT_RETRY_SECONDS,
} from './request-rate-limit.js';

const request = (address?: string): Request =>
  new Request('https://play.example/v2/rooms', {
    headers: address ? { 'CF-Connecting-IP': address } : {},
  });

describe('anonymous edge request rate limits', () => {
  it('copies only exact bounded limiter decisions', () => {
    const input = { allowed: true, retryAfterSeconds: 60 };
    const parsed = readRequestRateLimitDecision(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(
      readRequestRateLimitDecision({ ...input, injected: true })
    ).toBeUndefined();
    expect(
      readRequestRateLimitDecision({ ...input, retryAfterSeconds: 0 })
    ).toBeUndefined();
  });

  it('derives stable scoped keys without exposing raw network addresses', async () => {
    const address = '203.0.113.42';
    const first = await anonymousRequestRateLimitKey(
      request(address),
      'room_creation'
    );
    const repeated = await anonymousRequestRateLimitKey(
      request(address),
      'room_creation'
    );
    const otherAddress = await anonymousRequestRateLimitKey(
      request('203.0.113.43'),
      'room_creation'
    );
    const otherScope = await anonymousRequestRateLimitKey(
      request(address),
      'other_scope'
    );

    expect(first).toBe(repeated);
    expect(first).toHaveLength(64);
    expect(first).not.toContain(address);
    expect(otherAddress).not.toBe(first);
    expect(otherScope).not.toBe(first);
  });

  it('passes only the anonymous key to the platform limiter', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    await expect(
      consumeRoomCreationRateLimit(request('203.0.113.42'), { limit })
    ).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: ROOM_CREATION_RATE_LIMIT_RETRY_SECONDS,
    });
    expect(limit).toHaveBeenCalledOnce();
    expect(limit.mock.calls[0]?.[0].key).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('uses independent anonymous scopes for continuation lifecycle operations', async () => {
    const keys: string[] = [];
    const binding = {
      limit: vi.fn(async ({ key }: { readonly key: string }) => {
        keys.push(key);
        return { success: true };
      }),
    };
    const input = request('203.0.113.42');

    await consumeContinuationCreationRateLimit(input, binding);
    await consumeContinuationRestoreRateLimit(input, binding);
    await consumeContinuationRevocationRateLimit(input, binding);

    expect(keys).toHaveLength(3);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(new Set(keys)).toHaveProperty('size', 3);
  });

  it('rejects invalid scopes before calling the digest', async () => {
    await expect(anonymousRequestRateLimitKey(request(), '')).rejects.toThrow(
      'scope is invalid'
    );
  });
});
