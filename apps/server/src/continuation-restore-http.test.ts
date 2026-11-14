import type { ContinuationRestoreRequest } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  handleContinuationRestoreRequest,
  MAX_CONTINUATION_RESTORE_REQUEST_BYTES,
  type ContinuationRestorer,
} from './continuation-restore-http.js';

const saveId = 'A'.repeat(22);
const operationId = 'B'.repeat(43);
const capability = `ptcgsave.v1.${saveId}.${'C'.repeat(43)}`;
const requesterSeatCapability =
  'requester-seat-capability-never-reflected-000000001';
const invitation = 'opponent-invitation-never-reflected-00000000001';
const restored = {
  format: 'ptcgsim-continuation-restore-result-v1' as const,
  saveId,
  operationId,
  completedAt: 2_000,
  targetRoomCode: 'ABCDEFGH2345',
  requesterSeatCapability,
  opponentInvitation: { invitation, expiresAt: 62_000 },
};

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = `https://play.example/v2/continuations/${saveId}/restore`
): Request =>
  new Request(url, {
    method: 'POST',
    headers: {
      Origin: 'https://play.example',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

const validRequest = (value = capability): Request =>
  request(JSON.stringify({ capability: value, operationId }));
const allow = async () => ({ allowed: true, retryAfterSeconds: 60 });
const acceptedRestorer = (): ContinuationRestorer =>
  vi.fn(async () => restored);

const withDispose = <Value extends object>(
  value: Value,
  dispose: () => void
): Value => {
  Object.defineProperty(value, Symbol.dispose, { value: dispose });
  return value;
};

describe('continuation restore HTTP boundary', () => {
  it('returns only exact no-store fork credentials and disposes RPC metadata', async () => {
    const dispose = vi.fn();
    const restore = vi.fn(
      async (_saveId: string, _input: ContinuationRestoreRequest) =>
        withDispose({ ...restored }, dispose)
    );
    const response = await handleContinuationRestoreRequest(
      validRequest(),
      saveId,
      restore,
      allow
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(restored);
    expect(restore).toHaveBeenCalledWith(saveId, { capability, operationId });
    expect(dispose).toHaveBeenCalledOnce();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rejects invalid path, cross-origin, non-JSON, extended, malformed, encoded, queried, and oversized input before either budget', async () => {
    const restore = acceptedRestorer();
    const rateLimit = vi.fn(allow);
    const responses = await Promise.all([
      handleContinuationRestoreRequest(
        validRequest(),
        'bad-save-id',
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request(JSON.stringify({ capability, operationId }), {
          Origin: 'https://attacker.example',
        }),
        saveId,
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request(JSON.stringify({ capability, operationId }), {
          'Content-Type': 'text/plain',
        }),
        saveId,
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request(JSON.stringify({ capability, operationId, force: true })),
        saveId,
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request('{'),
        saveId,
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request(JSON.stringify({ capability, operationId }), {
          'Content-Encoding': 'gzip',
        }),
        saveId,
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request(
          JSON.stringify({ capability, operationId }),
          {},
          `https://play.example/v2/continuations/${saveId}/restore?x=1`
        ),
        saveId,
        restore,
        rateLimit
      ),
      handleContinuationRestoreRequest(
        request(
          JSON.stringify({
            capability,
            operationId,
            padding: 'x'.repeat(MAX_CONTINUATION_RESTORE_REQUEST_BYTES),
          })
        ),
        saveId,
        restore,
        rateLimit
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      400, 403, 415, 400, 400, 415, 400, 413,
    ]);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('requires a valid anonymous edge decision before locator or custody work', async () => {
    const restore = acceptedRestorer();
    const foreignCapability = `ptcgsave.v1.${'D'.repeat(22)}.${'E'.repeat(43)}`;
    const limited = await handleContinuationRestoreRequest(
      validRequest(foreignCapability),
      saveId,
      restore,
      async () => ({ allowed: false, retryAfterSeconds: 29 })
    );
    const malformed = await handleContinuationRestoreRequest(
      validRequest(),
      saveId,
      restore,
      async () => ({ allowed: true, retryAfterSeconds: 100_000 })
    );
    const unavailable = await handleContinuationRestoreRequest(
      validRequest(),
      saveId,
      restore,
      async () => {
        throw new Error('limiter unavailable');
      }
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('29');
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(malformed.status).toBe(503);
    expect(unavailable.status).toBe(503);
    expect(restore).not.toHaveBeenCalled();
  });

  it('uses one generic unavailable response for a path mismatch and custody rejection', async () => {
    const restore = vi.fn(async () => undefined);
    const foreignCapability = `ptcgsave.v1.${'D'.repeat(22)}.${'E'.repeat(43)}`;
    const mismatch = await handleContinuationRestoreRequest(
      validRequest(foreignCapability),
      saveId,
      restore,
      allow
    );
    const rejected = await handleContinuationRestoreRequest(
      validRequest(),
      saveId,
      restore,
      allow
    );

    expect(mismatch.status).toBe(404);
    expect(rejected.status).toBe(404);
    expect(await mismatch.json()).toEqual({
      error: 'continuation_unavailable',
    });
    expect(await rejected.json()).toEqual({
      error: 'continuation_unavailable',
    });
    expect(restore).toHaveBeenCalledOnce();
  });

  it('disposes and redacts thrown, extended, malformed, and mismatched results', async () => {
    const disposal = vi.fn();
    const malformedResults: unknown[] = [
      withDispose({ ...restored, injected: capability }, disposal),
      { ...restored, saveId: 'D'.repeat(22) },
      { ...restored, operationId: 'E'.repeat(43) },
      {
        ...restored,
        opponentInvitation: {
          ...restored.opponentInvitation,
          expiresAt: restored.completedAt,
        },
      },
    ];
    const responses = await Promise.all([
      handleContinuationRestoreRequest(
        validRequest(),
        saveId,
        async () => {
          throw new Error(capability);
        },
        allow
      ),
      ...malformedResults.map((result) =>
        handleContinuationRestoreRequest(
          validRequest(),
          saveId,
          async () => result,
          allow
        )
      ),
    ]);

    expect(responses.every(({ status }) => status === 503)).toBe(true);
    expect(disposal).toHaveBeenCalledOnce();
    for (const response of responses) {
      const text = await response.text();
      expect(text).toBe('{"error":"internal_retryable"}');
      expect(text).not.toContain(capability);
      expect(text).not.toContain(requesterSeatCapability);
      expect(text).not.toContain(invitation);
    }
  });

  it('advertises POST without consuming a budget for other methods', async () => {
    const restore = acceptedRestorer();
    const rateLimit = vi.fn(allow);
    const response = await handleContinuationRestoreRequest(
      new Request(`https://play.example/v2/continuations/${saveId}/restore`, {
        headers: { Origin: 'https://play.example' },
      }),
      saveId,
      restore,
      rateLimit
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(rateLimit).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});
