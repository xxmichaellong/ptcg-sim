import type { ContinuationCreationRequest } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  handleContinuationCreationRequest,
  MAX_CONTINUATION_CREATION_REQUEST_BYTES,
  type ContinuationCreator,
} from './continuation-creation-http.js';

const resumeToken = 'resume-capability-never-reflected-00000000001';
const operationId = 'B'.repeat(43);
const saveId = 'A'.repeat(22);
const capability = `ptcgsave.v1.${saveId}.${'C'.repeat(43)}`;
const receipt = {
  format: 'ptcgsim-continuation-creation-result-v1' as const,
  saveId,
  operationId,
  capability,
  createdAt: 1_000,
  expiresAt: 61_000,
};

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = 'https://play.example/v2/rooms/ABCDEFGH2345/continuations'
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

const validRequest = (): Request =>
  request(JSON.stringify({ resumeToken, operationId }));
const allow = async () => ({ allowed: true, retryAfterSeconds: 60 });
const acceptedCreator = (): ContinuationCreator =>
  vi.fn(async () => ({ state: 'created', receipt }));

const withDispose = <Value extends object>(
  value: Value,
  dispose: () => void
): Value => {
  Object.defineProperty(value, Symbol.dispose, { value: dispose });
  return value;
};

describe('continuation creation HTTP boundary', () => {
  it('returns only an exact no-store receipt and disposes RPC transport metadata', async () => {
    const dispose = vi.fn();
    const create = vi.fn(async (_input: ContinuationCreationRequest) =>
      withDispose({ state: 'created' as const, receipt }, dispose)
    );
    const response = await handleContinuationCreationRequest(
      validRequest(),
      create,
      allow
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt);
    expect(create).toHaveBeenCalledWith({ resumeToken, operationId });
    expect(dispose).toHaveBeenCalledOnce();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rejects cross-origin, non-JSON, extended, malformed, encoded, queried, and oversized requests before either budget', async () => {
    const create = acceptedCreator();
    const rateLimit = vi.fn(allow);
    const responses = await Promise.all([
      handleContinuationCreationRequest(
        request(JSON.stringify({ resumeToken, operationId }), {
          Origin: 'https://attacker.example',
        }),
        create,
        rateLimit
      ),
      handleContinuationCreationRequest(
        request(JSON.stringify({ resumeToken, operationId }), {
          'Content-Type': 'text/plain',
        }),
        create,
        rateLimit
      ),
      handleContinuationCreationRequest(
        request(JSON.stringify({ resumeToken, operationId, sessionId: 'x' })),
        create,
        rateLimit
      ),
      handleContinuationCreationRequest(request('{'), create, rateLimit),
      handleContinuationCreationRequest(
        request(JSON.stringify({ resumeToken, operationId }), {
          'Content-Encoding': 'gzip',
        }),
        create,
        rateLimit
      ),
      handleContinuationCreationRequest(
        request(
          JSON.stringify({ resumeToken, operationId }),
          {},
          'https://play.example/v2/rooms/ABCDEFGH2345/continuations?x=1'
        ),
        create,
        rateLimit
      ),
      handleContinuationCreationRequest(
        request(
          JSON.stringify({
            resumeToken,
            operationId,
            padding: 'x'.repeat(MAX_CONTINUATION_CREATION_REQUEST_BYTES),
          })
        ),
        create,
        rateLimit
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      403, 415, 400, 400, 415, 400, 413,
    ]);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a valid anonymous edge decision before calling the source room', async () => {
    const create = acceptedCreator();
    const limited = await handleContinuationCreationRequest(
      validRequest(),
      create,
      async () => ({ allowed: false, retryAfterSeconds: 37 })
    );
    const malformed = await handleContinuationCreationRequest(
      validRequest(),
      create,
      async () =>
        ({ allowed: true, retryAfterSeconds: 0 }) as {
          allowed: boolean;
          retryAfterSeconds: number;
        }
    );
    const unavailable = await handleContinuationCreationRequest(
      validRequest(),
      create,
      async () => {
        throw new Error('limiter unavailable');
      }
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('37');
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(malformed.status).toBe(503);
    expect(unavailable.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps private credential, authenticated rate, and all quota refusals without leaking scope', async () => {
    const rejected = await handleContinuationCreationRequest(
      validRequest(),
      async () => undefined,
      allow
    );
    const rateLimited = await handleContinuationCreationRequest(
      validRequest(),
      async () => ({ state: 'rate_limited', retryAfterSeconds: 41 }),
      allow
    );
    const quotaResponses = await Promise.all(
      (['player', 'room', 'global'] as const).map((scope) =>
        handleContinuationCreationRequest(
          validRequest(),
          async () => ({ state: 'quota_exceeded', scope }),
          allow
        )
      )
    );

    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ error: 'continuation_rejected' });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('Retry-After')).toBe('41');
    expect(await rateLimited.json()).toEqual({ error: 'rate_limited' });
    expect(quotaResponses.map(({ status }) => status)).toEqual([429, 429, 429]);
    expect(
      await Promise.all(quotaResponses.map((value) => value.json()))
    ).toEqual(
      Array.from({ length: 3 }, () => ({ error: 'continuation_capacity' }))
    );
  });

  it('disposes and redacts thrown, extended, malformed, and mismatched results', async () => {
    const disposal = vi.fn();
    const malformedResults: unknown[] = [
      withDispose(
        { state: 'created', receipt, injected: capability },
        disposal
      ),
      {
        state: 'created',
        receipt: { ...receipt, operationId: 'D'.repeat(43) },
      },
      { state: 'rate_limited', retryAfterSeconds: 0 },
      { state: 'quota_exceeded', scope: 'cluster' },
    ];
    const responses = await Promise.all([
      handleContinuationCreationRequest(
        validRequest(),
        async () => {
          throw new Error(capability);
        },
        allow
      ),
      ...malformedResults.map((result) =>
        handleContinuationCreationRequest(
          validRequest(),
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
      expect(text).not.toContain(resumeToken);
    }
  });

  it('advertises POST without consuming a budget for other methods', async () => {
    const create = acceptedCreator();
    const rateLimit = vi.fn(allow);
    const response = await handleContinuationCreationRequest(
      new Request('https://play.example/v2/rooms/ABCDEFGH2345/continuations', {
        headers: { Origin: 'https://play.example' },
      }),
      create,
      rateLimit
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(rateLimit).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
