import { describe, expect, it, vi } from 'vitest';

import type { CatalogManifest } from './builder.js';
import {
  CARD_CATALOG_PATH,
  cardCatalogBodyPath,
  cardCatalogBodyVersion,
  handleCardCatalogBodyRequest,
  handleCardCatalogManifestRequest,
  type CardCatalogBodyCache,
} from './http.js';

const VERSION = '0123456789abcdef0123';
const ORIGIN = 'https://play.example';

const manifest: CatalogManifest = {
  version: VERSION,
  builtAt: '2026-10-15T06:17:00.000Z',
  sets: ['me05', 'sv01'],
  cards: 324,
  complete: true,
};

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new Blob([text]).stream();

const memoryCache = (): CardCatalogBodyCache & {
  readonly stored: Map<string, Response>;
} => {
  const stored = new Map<string, Response>();
  return {
    stored,
    match: async (request) => stored.get(request.url)?.clone(),
    put: async (request, response) => {
      stored.set(request.url, response);
    },
  };
};

describe('card catalog routes', () => {
  it('recognizes body URLs and nothing else', () => {
    expect(cardCatalogBodyPath(VERSION)).toBe(
      `/v2/cards/catalog/${VERSION}.json`
    );
    expect(cardCatalogBodyVersion(`/v2/cards/catalog/${VERSION}.json`)).toBe(
      VERSION
    );
    expect(
      cardCatalogBodyVersion(`/v2/cards/catalog/${VERSION}`)
    ).toBeUndefined();
    expect(
      cardCatalogBodyVersion('/v2/cards/catalog/XYZ.json')
    ).toBeUndefined();
    expect(
      cardCatalogBodyVersion(`/v2/cards/catalog/${VERSION}0.json`)
    ).toBeUndefined();
  });
});

describe('GET /v2/cards/catalog', () => {
  it('describes the published catalog, cacheable for a few minutes', async () => {
    const response = await handleCardCatalogManifestRequest(
      new Request(`${ORIGIN}${CARD_CATALOG_PATH}`),
      async () => manifest
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.json()).toEqual({
      version: VERSION,
      url: `/v2/cards/catalog/${VERSION}.json`,
      builtAt: '2026-10-15T06:17:00.000Z',
      sets: 2,
      cards: 324,
      complete: true,
    });
  });

  it('answers 503 while there is nothing yet, asking again in seconds', async () => {
    const response = await handleCardCatalogManifestRequest(
      new Request(`${ORIGIN}${CARD_CATALOG_PATH}`),
      async () => null
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({
      error: 'unavailable',
      building: true,
    });
  });

  it('refuses other methods and query strings', async () => {
    const read = vi.fn(async () => manifest);
    const post = await handleCardCatalogManifestRequest(
      new Request(`${ORIGIN}${CARD_CATALOG_PATH}`, { method: 'POST' }),
      read
    );
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET');
    const query = await handleCardCatalogManifestRequest(
      new Request(`${ORIGIN}${CARD_CATALOG_PATH}?v=1`),
      read
    );
    expect(query.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('GET /v2/cards/catalog/<version>.json', () => {
  const url = `${ORIGIN}/v2/cards/catalog/${VERSION}.json`;

  it('serves the body as immutable JSON and keeps it in the edge cache', async () => {
    const cache = memoryCache();
    const read = vi.fn(async () => streamOf('{"v":1}'));
    const waits: Promise<unknown>[] = [];
    const first = await handleCardCatalogBodyRequest(
      new Request(url),
      VERSION,
      read,
      {
        cache,
        waitUntil: (promise) => waits.push(promise),
      }
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(first.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8'
    );
    expect(await first.text()).toBe('{"v":1}');
    await Promise.all(waits);
    expect(cache.stored.has(url)).toBe(true);

    const second = await handleCardCatalogBodyRequest(
      new Request(url),
      VERSION,
      read,
      {
        cache,
      }
    );
    expect(await second.text()).toBe('{"v":1}');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('works with no edge cache at all', async () => {
    const response = await handleCardCatalogBodyRequest(
      new Request(url),
      VERSION,
      async () => streamOf('{"v":1}')
    );
    expect(await response.text()).toBe('{"v":1}');
  });

  it('answers 404 for a version that is not the published one', async () => {
    const cache = memoryCache();
    const response = await handleCardCatalogBodyRequest(
      new Request(url),
      VERSION,
      async () => null,
      { cache }
    );
    expect(response.status).toBe(404);
    expect(cache.stored.size).toBe(0);
  });

  it('refuses other methods and query strings', async () => {
    const read = vi.fn(async () => streamOf('{}'));
    expect(
      (
        await handleCardCatalogBodyRequest(
          new Request(url, { method: 'DELETE' }),
          VERSION,
          read
        )
      ).status
    ).toBe(405);
    expect(
      (
        await handleCardCatalogBodyRequest(
          new Request(`${url}?x=1`),
          VERSION,
          read
        )
      ).status
    ).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it('still serves the body when the cache refuses to store it', async () => {
    const response = await handleCardCatalogBodyRequest(
      new Request(url),
      VERSION,
      async () => streamOf('{"v":1}'),
      {
        cache: {
          match: async () => undefined,
          put: async () => {
            throw new Error('cache full');
          },
        },
      }
    );
    expect(await response.text()).toBe('{"v":1}');
  });
});
