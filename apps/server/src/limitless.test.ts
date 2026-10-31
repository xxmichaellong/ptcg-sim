import { describe, expect, it, vi } from 'vitest';

import {
  LIMITLESS_USER_AGENT,
  LimitlessRequestError,
  limitlessGet,
  parseLimitlessRateLimit,
} from './limitless.js';

const options = (fetch: typeof globalThis.fetch, apiKey?: string) => ({
  fetch,
  maximumBytes: 1_000,
  timeoutMs: 1_000,
  ...(apiKey ? { apiKey } : {}),
});

describe('Limitless rate-limit header', () => {
  it('reads what is left and when the window resets', () => {
    expect(parseLimitlessRateLimit('"50-in-5min"; r=49; t=300')).toEqual({
      remaining: 49,
      resetSeconds: 300,
    });
    expect(parseLimitlessRateLimit('"50-in-5min";r=0;t=12')).toEqual({
      remaining: 0,
      resetSeconds: 12,
    });
  });

  it('ignores a header it cannot read', () => {
    expect(parseLimitlessRateLimit(null)).toBeUndefined();
    expect(parseLimitlessRateLimit('"50-in-5min"')).toBeUndefined();
    expect(parseLimitlessRateLimit('r=abc; t=1')).toBeUndefined();
  });
});

describe('a request to Limitless', () => {
  it('names the project, sends the key and the ETag, and reads JSON with its ETag and limit', async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('user-agent')).toBe(LIMITLESS_USER_AGENT);
        expect(headers.get('X-Access-Key')).toBe('key');
        expect(headers.get('If-None-Match')).toBe('W/"1"');
        return new Response(JSON.stringify([1, 2]), {
          headers: { etag: 'W/"2"', ratelimit: '"50-in-5min"; r=7; t=30' },
        });
      }
    );
    await expect(
      limitlessGet(options(fetch, 'key'), '/api/x', { etag: 'W/"1"' })
    ).resolves.toEqual({
      status: 200,
      body: [1, 2],
      etag: 'W/"2"',
      rateLimit: { remaining: 7, resetSeconds: 30 },
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://play.limitlesstcg.com/api/x'
    );
  });

  it('answers a 304 without a body', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 304 }));
    await expect(limitlessGet(options(fetch), '/api/x')).resolves.toEqual({
      status: 304,
    });
  });

  it('tells a rate limit, an unknown id and a failure apart', async () => {
    const answer = (status: number, headers: Record<string, string> = {}) =>
      vi.fn(async () => new Response('no', { status, headers }));
    await expect(
      limitlessGet(options(answer(429, { 'retry-after': '42' })), '/api/x')
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 42_000 });
    await expect(
      limitlessGet(
        options(answer(429, { ratelimit: '"50-in-5min"; r=0; t=90' })),
        '/api/x'
      )
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 90_000 });
    await expect(
      limitlessGet(options(answer(400)), '/api/x')
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      limitlessGet(options(answer(404)), '/api/x')
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      limitlessGet(options(answer(503)), '/api/x')
    ).rejects.toMatchObject({ code: 'request_failed' });
    await expect(
      limitlessGet(
        options(
          vi.fn(async () => {
            throw new TypeError('offline');
          })
        ),
        '/api/x'
      )
    ).rejects.toBeInstanceOf(LimitlessRequestError);
  });

  it('refuses a body that is too big or not JSON', async () => {
    await expect(
      limitlessGet(
        options(vi.fn(async () => new Response('x'.repeat(2_000)))),
        '/api/x'
      )
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      limitlessGet(options(vi.fn(async () => new Response('{nope'))), '/api/x')
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
