import { describe, expect, it, vi } from 'vitest';

import {
  createTcgdexCardCatalog,
  TcgdexCatalogError,
} from './tcgdex-card-catalog.js';

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const asFetch = (
  implementation: FetchImplementation
): typeof globalThis.fetch => implementation as typeof globalThis.fetch;

const jsonResponse = (value: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const detail = (
  id: string,
  options: {
    readonly setId?: string;
    readonly setName?: string;
    readonly releaseDate?: string;
  } = {}
): Record<string, unknown> => ({
  category: 'Pokemon',
  id,
  image: `https://assets.tcgdex.net/en/sv/${id}`,
  localId: id.split('-').at(-1),
  name: `Card ${id}`,
  rarity: 'Common',
  stage: 'Basic',
  set: options.setId
    ? {
        id: options.setId,
        name: options.setName ?? `Set ${options.setId}`,
        releaseDate: options.releaseDate,
      }
    : undefined,
});

describe('TCGdex card catalog', () => {
  it('returns an empty result without a request for an empty term', async () => {
    const fetch = vi.fn<FetchImplementation>();
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });

    await expect(catalog.queryCardsByName('  ')).resolves.toEqual({
      results: [],
      totalSummaries: 0,
      term: '',
      isHugeResultSet: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes wildcards and merges both EX spellings in provider order', async () => {
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) {
        return jsonResponse(
          url.searchParams.get('name') === 'Charizard EX'
            ? [{ id: 'a-1' }, { id: 'shared-2' }]
            : [{ id: 'shared-2' }, { id: 'b-3' }]
        );
      }
      return jsonResponse(detail(url.pathname.split('/').at(-1) ?? ''));
    });
    const catalog = createTcgdexCardCatalog({
      fetch: asFetch(fetch),
      baseUrl: 'https://catalog.example/v2/en',
    });

    const result = await catalog.queryCardsByName('*Charizard EX*');

    expect(result.term).toBe('Charizard EX');
    expect(result.totalSummaries).toBe(3);
    expect(result.results.map((card) => card.id)).toEqual([
      'a-1',
      'shared-2',
      'b-3',
    ]);
    const listUrls = fetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith('/cards'));
    expect(listUrls.every((url) => url.pathname === '/v2/en/cards')).toBe(true);
    expect(listUrls.map((url) => url.searchParams.get('name'))).toEqual([
      'Charizard EX',
      'Charizard-EX',
    ]);
  });

  it('uses the official stage and optional name filters for LV.X searches', async () => {
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) return jsonResponse([]);
      throw new Error(`Unexpected URL ${url.toString()}`);
    });
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });

    await catalog.queryCardsByName('Torterra LV.X');

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/v2/en/cards');
    expect(url.searchParams.get('name')).toBe('Torterra');
    expect(url.searchParams.get('stage')).toBe('LEVEL-UP');
  });

  it('returns a huge-result signal without fetching card details', async () => {
    const fetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    );
    const catalog = createTcgdexCardCatalog({
      fetch: asFetch(fetch),
      limits: { hugeResultThreshold: 2 },
    });

    await expect(catalog.queryCardsByName('a')).resolves.toEqual({
      results: [],
      totalSummaries: 3,
      term: 'a',
      isHugeResultSet: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caps card-detail work and bounds concurrent requests', async () => {
    let activeDetails = 0;
    let maximumActiveDetails = 0;
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) {
        return jsonResponse(
          Array.from({ length: 7 }, (_, index) => ({ id: `set-${index}` }))
        );
      }
      activeDetails += 1;
      maximumActiveDetails = Math.max(maximumActiveDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDetails -= 1;
      return jsonResponse(detail(url.pathname.split('/').at(-1) ?? ''));
    });
    const catalog = createTcgdexCardCatalog({
      fetch: asFetch(fetch),
      limits: { detailLimit: 6, detailConcurrency: 2 },
    });

    const result = await catalog.queryCardsByName('Pikachu');

    expect(result.results).toHaveLength(6);
    expect(maximumActiveDetails).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it('normalizes a valid detail and hydrates its set release date', async () => {
    const fetch = vi.fn<FetchImplementation>(async (input, init) => {
      const url = new URL(String(input));
      expect(init).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
      });
      if (url.pathname.endsWith('/cards'))
        return jsonResponse([{ id: 'sv1-25' }]);
      if (url.pathname.endsWith('/cards/sv1-25')) {
        return jsonResponse(
          detail('sv1-25', { setId: 'sv1', setName: 'Scarlet & Violet' })
        );
      }
      if (url.pathname.endsWith('/sets/sv1')) {
        return jsonResponse({ releaseDate: '2023-03-31' });
      }
      throw new Error(`Unexpected URL ${url.toString()}`);
    });
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });

    const result = await catalog.queryCardsByName('Pikachu');

    expect(result.results[0]).toEqual({
      id: 'sv1-25',
      name: 'Card sv1-25',
      supertype: 'Pokémon',
      stage: 'Basic',
      number: '25',
      set: {
        id: 'sv1',
        name: 'Scarlet & Violet',
        releaseDate: '2023-03-31',
      },
      images: {
        small: 'https://assets.tcgdex.net/en/sv/sv1-25/high.webp',
        large: 'https://assets.tcgdex.net/en/sv/sv1-25/high.webp',
      },
      image: 'https://assets.tcgdex.net/en/sv/sv1-25/high.webp',
      rarity: 'Common',
      _provider: 'tcgdex',
    });
  });

  it('bounds concurrent set hydration independently from detail work', async () => {
    let activeSets = 0;
    let maximumActiveSets = 0;
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) {
        return jsonResponse(
          Array.from({ length: 5 }, (_, index) => ({ id: `card-${index}` }))
        );
      }
      if (url.pathname.includes('/cards/')) {
        const id = url.pathname.split('/').at(-1) ?? '';
        return jsonResponse(detail(id, { setId: `set-${id}` }));
      }
      activeSets += 1;
      maximumActiveSets = Math.max(maximumActiveSets, activeSets);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSets -= 1;
      return jsonResponse({ releaseDate: '2024-01-02' });
    });
    const catalog = createTcgdexCardCatalog({
      fetch: asFetch(fetch),
      limits: { setConcurrency: 2 },
    });

    const result = await catalog.queryCardsByName('Pikachu');

    expect(result.results).toHaveLength(5);
    expect(maximumActiveSets).toBe(2);
  });

  it('skips failed or malformed details without failing valid siblings', async () => {
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) {
        return jsonResponse([
          { id: 'failed' },
          { id: 'malformed' },
          { id: 'valid' },
        ]);
      }
      if (url.pathname.endsWith('/cards/failed')) {
        return new Response('unavailable', { status: 503 });
      }
      if (url.pathname.endsWith('/cards/malformed')) {
        return jsonResponse({ id: 'malformed', name: 'No image' });
      }
      return jsonResponse(detail('valid'));
    });
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });

    const result = await catalog.queryCardsByName('Pikachu');

    expect(result.totalSummaries).toBe(3);
    expect(result.results.map((card) => card.id)).toEqual(['valid']);
  });

  it('contains set lookup failure and preserves a detail-provided date', async () => {
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) return jsonResponse([{ id: 'a' }]);
      if (url.pathname.endsWith('/cards/a')) {
        return jsonResponse(
          detail('a', { setId: 'set-a', releaseDate: '2024-01-02' })
        );
      }
      return new Response('unavailable', { status: 503 });
    });
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });

    const result = await catalog.queryCardsByName('Pikachu');

    expect(result.results[0]?.set?.releaseDate).toBe('2024-01-02');
  });

  it('reuses cached set dates and refetches after an explicit clear', async () => {
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) return jsonResponse([{ id: 'a' }]);
      if (url.pathname.endsWith('/cards/a')) {
        return jsonResponse(detail('a', { setId: 'set-a' }));
      }
      return jsonResponse({ releaseDate: '2024-01-02' });
    });
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });

    await catalog.queryCardsByName('Pikachu');
    await catalog.queryCardsByName('Pikachu');
    catalog.clearCache();
    await catalog.queryCardsByName('Pikachu');

    const setCalls = fetch.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.includes('/sets/')
    );
    expect(setCalls).toHaveLength(2);
  });

  it('evicts the least recently used set date at the configured bound', async () => {
    let nextSet = 'set-a';
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards'))
        return jsonResponse([{ id: 'card' }]);
      if (url.pathname.endsWith('/cards/card')) {
        return jsonResponse(detail('card', { setId: nextSet }));
      }
      return jsonResponse({ releaseDate: '2024-01-02' });
    });
    const catalog = createTcgdexCardCatalog({
      fetch: asFetch(fetch),
      limits: { setCacheEntries: 1 },
    });

    await catalog.queryCardsByName('first');
    nextSet = 'set-b';
    await catalog.queryCardsByName('second');
    nextSet = 'set-a';
    await catalog.queryCardsByName('third');

    const setUrls = fetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.includes('/sets/'));
    expect(setUrls.map((url) => url.pathname.split('/').at(-1))).toEqual([
      'set-a',
      'set-b',
      'set-a',
    ]);
  });

  it.each([
    ['non-array summary response', { invalid: true }],
    ['summary without an id', [{ name: 'Pikachu' }]],
  ])('rejects a %s', async (_name, payload) => {
    const catalog = createTcgdexCardCatalog({
      fetch: asFetch(async () => jsonResponse(payload)),
    });

    await expect(catalog.queryCardsByName('Pikachu')).rejects.toMatchObject({
      name: 'TcgdexCatalogError',
      code: 'invalid_response',
    });
  });

  it('returns typed HTTP, JSON, and size failures at the search boundary', async () => {
    const unreadable = new Response(null);
    vi.spyOn(unreadable, 'text').mockRejectedValue(new Error('body failed'));
    const cases: Array<{
      readonly response: Response;
      readonly code: string;
      readonly limits?: { readonly listResponseCodeUnits: number };
    }> = [
      {
        response: new Response('unavailable', { status: 503 }),
        code: 'request_failed',
      },
      { response: unreadable, code: 'request_failed' },
      { response: new Response('{'), code: 'invalid_response' },
      {
        response: new Response('[{"id":"too-large"}]'),
        code: 'response_too_large',
        limits: { listResponseCodeUnits: 5 },
      },
    ];

    for (const entry of cases) {
      const catalog = createTcgdexCardCatalog({
        fetch: asFetch(async () => entry.response),
        limits: entry.limits,
      });
      await expect(catalog.queryCardsByName('Pikachu')).rejects.toMatchObject({
        name: 'TcgdexCatalogError',
        code: entry.code,
      });
    }
  });

  it('propagates cancellation instead of converting it to an empty result', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<FetchImplementation>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });
    const pending = catalog.queryCardsByName('Pikachu', {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not swallow cancellation after detail hydration has started', async () => {
    const controller = new AbortController();
    let markDetailStarted: (() => void) | undefined;
    const detailStarted = new Promise<void>((resolve) => {
      markDetailStarted = resolve;
    });
    const fetch = vi.fn<FetchImplementation>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/cards')) return jsonResponse([{ id: 'a' }]);
      markDetailStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true }
        );
      });
    });
    const catalog = createTcgdexCardCatalog({ fetch: asFetch(fetch) });
    const pending = catalog.queryCardsByName('Pikachu', {
      signal: controller.signal,
    });

    await detailStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed when browser fetch is unavailable', async () => {
    vi.stubGlobal('fetch', undefined);
    try {
      const catalog = createTcgdexCardCatalog();
      await expect(catalog.queryCardsByName('Pikachu')).rejects.toEqual(
        expect.objectContaining({
          name: 'TcgdexCatalogError',
          code: 'catalog_unavailable',
        } satisfies Partial<TcgdexCatalogError>)
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
