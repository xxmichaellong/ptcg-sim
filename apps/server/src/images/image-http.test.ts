import { describe, expect, it, vi } from 'vitest';

import { jpeg, webpLossless } from './image-fixtures.test-support.js';
import {
  handleImageImportRequest,
  handleImageServeRequest,
  handleImageUploadRequest,
  servedImageHash,
} from './image-http.js';
import { MAX_IMAGE_UPLOAD_BYTES } from './image-store.js';

const ORIGIN = 'https://ptcgsim.test';
const sha = 'c'.repeat(64);

const upload = (
  body: BodyInit | null,
  headers: Record<string, string> = { Origin: ORIGIN }
) => new Request(`${ORIGIN}/v2/images`, { method: 'POST', body, headers });

const allowed = async () => ({ allowed: true, retryAfterSeconds: 60 });
const refused = async () => ({ allowed: false, retryAfterSeconds: 60 });

describe('image upload', () => {
  it('stores a picture sent by the app and answers its reference', async () => {
    const bytes = webpLossless(600, 838);
    const store = vi.fn(async () => ({ kind: 'stored' as const, sha256: sha }));
    const response = await handleImageUploadRequest(
      upload(bytes),
      store,
      allowed
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ref: `img:${sha}` });
    expect([...(store.mock.calls[0]?.[0] ?? [])]).toEqual([...bytes]);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('refuses other sites, other methods, oversize bodies and rate-limited senders before storing', async () => {
    const store = vi.fn(async () => ({ kind: 'stored' as const, sha256: sha }));
    expect(
      (await handleImageUploadRequest(upload(jpeg(10, 10), {}), store)).status
    ).toBe(403);
    expect(
      (
        await handleImageUploadRequest(
          upload(jpeg(10, 10), { Origin: 'https://elsewhere.test' }),
          store
        )
      ).status
    ).toBe(403);
    expect(
      (
        await handleImageUploadRequest(
          new Request(`${ORIGIN}/v2/images`, {
            method: 'PUT',
            body: jpeg(10, 10),
            headers: { Origin: ORIGIN },
          }),
          store
        )
      ).status
    ).toBe(405);
    expect(
      (
        await handleImageUploadRequest(
          upload(new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)),
          store
        )
      ).status
    ).toBe(413);
    const limited = await handleImageUploadRequest(
      upload(jpeg(10, 10)),
      store,
      refused
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(store).not.toHaveBeenCalled();
  });

  it("answers the store's refusal in HTTP terms", async () => {
    for (const [result, status, error] of [
      [{ kind: 'blocked' }, 403, 'image_blocked'],
      [
        { kind: 'invalid', reason: 'unsupported_type' },
        415,
        'unsupported_image_type',
      ],
      [
        { kind: 'invalid', reason: 'too_big_picture' },
        422,
        'image_dimensions_too_large',
      ],
      [{ kind: 'invalid', reason: 'too_large' }, 413, 'image_too_large'],
    ] as const) {
      const response = await handleImageUploadRequest(
        upload(jpeg(10, 10)),
        async () => result
      );
      expect(response.status, error).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
  });
});

describe('image serving', () => {
  it('serves stored bytes from our origin, cached a year, never sniffed', async () => {
    expect(servedImageHash(`/v2/images/${sha}`)).toBe(sha);
    expect(servedImageHash('/v2/images/ABC')).toBeUndefined();
    expect(servedImageHash(`/v2/images/${sha}/x`)).toBeUndefined();
    const bytes = jpeg(600, 838);
    const response = await handleImageServeRequest(
      new Request(`${ORIGIN}/v2/images/${sha}`),
      sha,
      async () => ({ type: 'image/jpeg', bytes })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      ...bytes,
    ]);
  });

  it('answers 404 for a picture it has not got, or has banned', async () => {
    const response = await handleImageServeRequest(
      new Request(`${ORIGIN}/v2/images/${sha}`),
      sha,
      async () => null
    );
    expect(response.status).toBe(404);
  });

  it('reads the store once per location, then serves from the cache', async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: async (request: Request) => entries.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        entries.set(request.url, response);
      },
    };
    const read = vi.fn(async () => ({
      type: 'image/webp' as const,
      bytes: webpLossless(10, 10),
    }));
    for (let index = 0; index < 3; index += 1) {
      const response = await handleImageServeRequest(
        new Request(`${ORIGIN}/v2/images/${sha}`),
        sha,
        read,
        { cache }
      );
      expect(response.status).toBe(200);
    }
    expect(read).toHaveBeenCalledOnce();
  });
});

describe('image import', () => {
  const importRequest = (
    body: unknown,
    headers: Record<string, string> = {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    }
  ) =>
    new Request(`${ORIGIN}/v2/images/import`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
    });

  it('hands an outside picture to the page that asked, not cached', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetcher = vi.fn(
      async () =>
        new Response(png, { headers: { 'Content-Type': 'image/png' } })
    );
    const response = await handleImageImportRequest(
      importRequest({ url: 'https://images.example.test/back.png' }),
      fetcher,
      allowed
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...png]);
  });

  it('refuses other sites, bad bodies, forbidden hosts and rate-limited senders without fetching', async () => {
    const fetcher = vi.fn(async () => new Response(''));
    expect(
      (
        await handleImageImportRequest(
          importRequest(
            { url: 'https://images.example.test/a.png' },
            { 'Content-Type': 'application/json' }
          ),
          fetcher
        )
      ).status
    ).toBe(403);
    expect(
      (
        await handleImageImportRequest(
          importRequest(
            { url: 'https://images.example.test/a.png' },
            { Origin: ORIGIN, 'Content-Type': 'text/plain' }
          ),
          fetcher
        )
      ).status
    ).toBe(415);
    for (const body of [
      { url: 42 },
      { url: 'https://images.example.test/a.png', extra: true },
      [],
    ]) {
      expect(
        (await handleImageImportRequest(importRequest(body), fetcher)).status
      ).toBe(400);
    }
    const local = await handleImageImportRequest(
      importRequest({ url: 'https://127.0.0.1/a.png' }),
      fetcher
    );
    expect(local.status).toBe(400);
    expect(await local.json()).toEqual({ error: 'forbidden_host' });
    expect(
      (
        await handleImageImportRequest(
          importRequest({ url: 'https://images.example.test/a.png' }),
          fetcher,
          refused
        )
      ).status
    ).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
