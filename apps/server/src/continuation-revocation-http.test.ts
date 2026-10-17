import { describe, expect, it, vi } from 'vitest';

import {
  handleContinuationRevocationRequest,
  MAX_CONTINUATION_REVOCATION_REQUEST_BYTES,
  type ContinuationRevoker,
} from './continuation-revocation-http.js';

const saveId = 'A'.repeat(22);
const capability = `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`;

const request = (
  body: string,
  headers: Record<string, string> = {},
  url = `https://play.example/v2/continuations/${saveId}`
): Request =>
  new Request(url, {
    method: 'DELETE',
    headers: {
      Origin: 'https://play.example',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

const validRequest = (value = capability): Request =>
  request(JSON.stringify({ capability: value }));
const allow = async () => ({ allowed: true, retryAfterSeconds: 60 });
const revoker = (result = true): ContinuationRevoker =>
  vi.fn(async () => result);

describe('continuation revocation HTTP boundary', () => {
  it('returns the same secure empty response for new and idempotent revocation', async () => {
    const newlyRevoked = revoker(true);
    const alreadyUnavailable = revoker(false);
    const first = await handleContinuationRevocationRequest(
      validRequest(),
      saveId,
      newlyRevoked,
      allow
    );
    const repeated = await handleContinuationRevocationRequest(
      validRequest(),
      saveId,
      alreadyUnavailable,
      allow
    );

    expect(first.status).toBe(204);
    expect(repeated.status).toBe(204);
    expect(await first.text()).toBe('');
    expect(await repeated.text()).toBe('');
    expect(first.headers.get('Cache-Control')).toContain('no-store');
    expect(first.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    expect(first.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(first.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(newlyRevoked).toHaveBeenCalledWith(saveId, { capability });
  });

  it('makes a path mismatch indistinguishable without selecting custody', async () => {
    const revoke = revoker();
    const foreignCapability = `ptcgsave.v1.${'C'.repeat(22)}.${'D'.repeat(43)}`;
    const rateLimit = vi.fn(allow);
    const response = await handleContinuationRevocationRequest(
      validRequest(foreignCapability),
      saveId,
      revoke,
      rateLimit
    );

    expect(response.status).toBe(204);
    expect(rateLimit).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('rejects invalid path, origin, media, shape, JSON, encoding, query, and size before either budget', async () => {
    const revoke = revoker();
    const rateLimit = vi.fn(allow);
    const responses = await Promise.all([
      handleContinuationRevocationRequest(
        validRequest(),
        'bad-save-id',
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request(JSON.stringify({ capability }), {
          Origin: 'https://attacker.example',
        }),
        saveId,
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request(JSON.stringify({ capability }), {
          'Content-Type': 'text/plain',
        }),
        saveId,
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request(JSON.stringify({ capability, force: true })),
        saveId,
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request('{'),
        saveId,
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request(JSON.stringify({ capability }), {
          'Content-Encoding': 'gzip',
        }),
        saveId,
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request(
          JSON.stringify({ capability }),
          {},
          `https://play.example/v2/continuations/${saveId}?x=1`
        ),
        saveId,
        revoke,
        rateLimit
      ),
      handleContinuationRevocationRequest(
        request(
          JSON.stringify({
            capability,
            padding: 'x'.repeat(MAX_CONTINUATION_REVOCATION_REQUEST_BYTES),
          })
        ),
        saveId,
        revoke,
        rateLimit
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      400, 403, 415, 400, 400, 415, 400, 413,
    ]);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('requires a valid anonymous limiter decision before custody', async () => {
    const revoke = revoker();
    const limited = await handleContinuationRevocationRequest(
      validRequest(),
      saveId,
      revoke,
      async () => ({ allowed: false, retryAfterSeconds: 31 })
    );
    const malformed = await handleContinuationRevocationRequest(
      validRequest(),
      saveId,
      revoke,
      async () => ({ allowed: true, retryAfterSeconds: 0 })
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('31');
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(malformed.status).toBe(503);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('redacts thrown and malformed internal results', async () => {
    const thrown = await handleContinuationRevocationRequest(
      validRequest(),
      saveId,
      async () => {
        throw new Error(capability);
      },
      allow
    );
    const malformed = await handleContinuationRevocationRequest(
      validRequest(),
      saveId,
      async () => ({ revoked: true, capability }),
      allow
    );

    for (const response of [thrown, malformed]) {
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).toBe('{"error":"internal_retryable"}');
      expect(text).not.toContain(capability);
    }
  });

  it('advertises DELETE for every other method', async () => {
    const revoke = revoker();
    const rateLimit = vi.fn(allow);
    const response = await handleContinuationRevocationRequest(
      new Request(`https://play.example/v2/continuations/${saveId}`, {
        method: 'POST',
        headers: { Origin: 'https://play.example' },
      }),
      saveId,
      revoke,
      rateLimit
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('DELETE');
    expect(rateLimit).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});
