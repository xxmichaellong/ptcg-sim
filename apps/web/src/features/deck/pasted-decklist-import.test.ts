import { describe, expect, it, vi } from 'vitest';

import {
  LIMITLESS_DECKLIST_IMPORT_URL,
  resolveLimitlessDecklistLimits,
  type PastedDecklistImageLoader,
} from './limitless-decklist-contract.js';
import {
  importPastedDecklist,
  preloadPastedDecklistImages,
} from './pasted-decklist-import.js';

interface ImageHarness {
  readonly createImage: () => PastedDecklistImageLoader;
  readonly assigned: string[];
  readonly maximumActive: () => number;
}

const imageHarness = (outcomes: readonly boolean[] = []): ImageHarness => {
  const assigned: string[] = [];
  let active = 0;
  let maximumActive = 0;
  return {
    assigned,
    maximumActive: () => maximumActive,
    createImage: () => {
      let source = '';
      const image = {
        onload: null,
        onerror: null,
      } as unknown as PastedDecklistImageLoader;
      Object.defineProperty(image, 'src', {
        configurable: true,
        get: () => source,
        set: (value: string) => {
          source = value;
          const index = assigned.length;
          assigned.push(value);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          queueMicrotask(() => {
            active -= 1;
            const loaded = outcomes[index] ?? true;
            if (loaded) image.onload?.(new Event('load'));
            else image.onerror?.(new Event('error'));
          });
        },
      });
      return image;
    },
  };
};

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('importPastedDecklist', () => {
  it('skips the provider for complete local rows and preloads exact native image URLs', async () => {
    const images = imageHarness();
    const fetchRequest = vi.fn<typeof fetch>();
    const result = await importPastedDecklist('1 Arceus V BRS 122', {
      fetch: fetchRequest,
      createImage: images.createImage,
    });

    expect(result).toMatchObject({ ok: true, format: 'legacy' });
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(images.assigned).toEqual([
      'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_122_R_EN.png',
    ]);
  });

  it('posts only incomplete names and merges normalized provider metadata', async () => {
    const images = imageHarness();
    const fetchRequest = vi.fn<typeof fetch>(async (_input, _init) =>
      jsonResponse({
        cards: [
          {
            name: 'Mystery-Card',
            set: 'BRS',
            number: '122',
            region: 'int',
            card_type: 'pokemon',
            ignored_provider_field: 'allowed',
          },
        ],
        errors: [],
      })
    );
    const result = await importPastedDecklist(
      '1 Arceus V BRS 122\n2 Mystery Card',
      {
        language: 'French',
        fetch: fetchRequest,
        createImage: images.createImage,
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a completed import.');
    expect(result.rows[1]).toEqual({
      quantity: 2,
      name: 'Mystery Card',
      imageUrl:
        'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_122_R_FR.png',
      cardType: 'Pokémon',
    });
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(Object.isFrozen(result.rows[1])).toBe(true);
    expect(fetchRequest).toHaveBeenCalledOnce();
    const [url, request] = fetchRequest.mock.calls[0]!;
    expect(url).toBe(LIMITLESS_DECKLIST_IMPORT_URL);
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      input: '2 Mystery Card',
    });
  });

  it('uses provider-declared TPC routing and keeps local row identity', async () => {
    const images = imageHarness();
    const result = await importPastedDecklist('1 Unknown Japanese Card', {
      fetch: vi.fn<typeof fetch>(async () =>
        jsonResponse({
          cards: [
            {
              name: 'Unknown Japanese Card',
              set: 'XYZZY',
              number: '7',
              region: 'tpc',
              card_type: 'trainer',
            },
          ],
        })
      ),
      createImage: images.createImage,
    });

    expect(result).toMatchObject({
      ok: true,
      rows: [
        {
          quantity: 1,
          name: 'Unknown Japanese Card',
          cardType: 'Trainer',
          imageUrl:
            'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/XYZZY/XYZZY_7_R_JP_LG.png',
        },
      ],
    });
  });

  it('lets provider metadata classify Pocket Pokémon before applying the Trainer fallback', async () => {
    const images = imageHarness();
    const result = await importPastedDecklist(
      '1 Pocket Mon A1 1\n2 X Speed A1 2',
      {
        fetch: vi.fn<typeof fetch>(async () =>
          jsonResponse({
            cards: [{ name: 'Pocket Mon', card_type: 'pokemon' }],
            errors: ['Card "X Speed  " was not found.'],
          })
        ),
        createImage: images.createImage,
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a completed import.');
    expect(result.rows.map((row) => row.cardType)).toEqual([
      'Pokémon',
      'Trainer',
    ]);
  });

  it('contains provider failure when the source Pocket fallback completes the row', async () => {
    const images = imageHarness();
    const result = await importPastedDecklist('1 X Speed A1 2', {
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('offline');
      }),
      createImage: images.createImage,
    });

    expect(result).toMatchObject({
      ok: true,
      rows: [{ cardType: 'Trainer' }],
    });
  });

  it('returns typed provider, decoder, and unresolved-metadata failures', async () => {
    const images = imageHarness();
    const unavailable = await importPastedDecklist('1 Mystery Card', {
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({}, { status: 503 })),
      createImage: images.createImage,
    });
    expect(unavailable).toEqual({
      ok: false,
      reason: 'request_failed',
      rowNumbers: [1],
      status: 503,
    });

    const invalid = await importPastedDecklist('1 Mystery Card', {
      fetch: vi.fn<typeof fetch>(async () =>
        jsonResponse({ cards: 'not-an-array' })
      ),
      createImage: images.createImage,
    });
    expect(invalid).toEqual({
      ok: false,
      reason: 'invalid_response',
      rowNumbers: [1],
    });

    const unresolved = await importPastedDecklist('1 Mystery Card', {
      fetch: vi.fn<typeof fetch>(async () =>
        jsonResponse({ cards: [], errors: [] })
      ),
      createImage: images.createImage,
    });
    expect(unresolved).toEqual({
      ok: false,
      reason: 'incomplete_metadata',
      rowNumbers: [1],
    });
  });

  it('aborts an in-flight provider request without starting image work', async () => {
    const controller = new AbortController();
    const createImage = vi.fn<() => PastedDecklistImageLoader>();
    const fetchRequest = vi.fn<typeof fetch>(
      async (_input, request) =>
        await new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = importPastedDecklist('1 Mystery Card', {
      signal: controller.signal,
      fetch: fetchRequest,
      createImage,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(createImage).not.toHaveBeenCalled();
  });

  it('enforces request, response, and parsed-row limits before publication', async () => {
    const images = imageHarness();
    const requestTooLarge = await importPastedDecklist('1 Mystery Card', {
      fetch: vi.fn<typeof fetch>(),
      createImage: images.createImage,
      limits: { requestCodeUnits: 5 },
    });
    expect(requestTooLarge).toMatchObject({
      ok: false,
      reason: 'request_failed',
      rowNumbers: [1],
    });

    const responseTooLarge = await importPastedDecklist('1 Mystery Card', {
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ cards: [], padding: 'x'.repeat(100) }))
      ),
      createImage: images.createImage,
      limits: { responseCodeUnits: 20 },
    });
    expect(responseTooLarge).toMatchObject({
      ok: false,
      reason: 'response_too_large',
      rowNumbers: [1],
    });

    const tooManyRows = await importPastedDecklist(
      '1 First BRS 1\n1 Second BRS 2',
      {
        createImage: images.createImage,
        limits: { importRows: 1 },
      }
    );
    expect(tooManyRows).toEqual({ ok: false, reason: 'import_too_large' });
  });

  it('reports core parse/empty failures without provider or image work', async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    const createImage = vi.fn<() => PastedDecklistImageLoader>();
    const invalid = await importPastedDecklist('0 Missing', {
      fetch: fetchRequest,
      createImage,
    });
    expect(invalid).toMatchObject({
      ok: false,
      reason: 'invalid_decklist',
      issues: [{ code: 'invalid_quantity', line: 1 }],
    });
    expect(
      await importPastedDecklist('Pokémon (0)', {
        fetch: fetchRequest,
        createImage,
      })
    ).toEqual({ ok: false, reason: 'empty_decklist' });
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
  });

  it('preserves preload concurrency and reports every failed native image row', async () => {
    const images = imageHarness([true, false, true]);
    const result = await importPastedDecklist(
      '1 First BRS 1\n1 Second BRS 2\n1 Third BRS 3',
      {
        createImage: images.createImage,
        limits: { imageConcurrency: 2 },
      }
    );

    expect(result).toEqual({
      ok: false,
      reason: 'image_load_failed',
      rowNumbers: [2],
    });
    expect(images.maximumActive()).toBe(2);
  });

  it('passes arbitrary bounded image strings directly to native image src', async () => {
    const assigned: string[] = [];
    const row = Object.freeze({
      quantity: 1,
      name: 'Arbitrary',
      imageUrl: 'custom+player-image:opaque-value',
      cardType: 'Unknown' as const,
    });
    const result = await preloadPastedDecklistImages([row], {
      limits: resolveLimitlessDecklistLimits(),
      createImage: () => {
        let source = '';
        const image = {
          onload: null,
          onerror: null,
        } as unknown as PastedDecklistImageLoader;
        Object.defineProperty(image, 'src', {
          get: () => source,
          set: (value: string) => {
            source = value;
            assigned.push(value);
            queueMicrotask(() => image.onload?.(new Event('load')));
          },
        });
        return image;
      },
    });

    expect(result).toEqual({ ok: true });
    expect(assigned).toEqual(['custom+player-image:opaque-value']);
  });

  it('aborts in-flight native loads and detaches their handlers', async () => {
    const controller = new AbortController();
    const images: PastedDecklistImageLoader[] = [];
    const pending = importPastedDecklist('1 Arceus V BRS 122', {
      signal: controller.signal,
      createImage: () => {
        const image = {
          onload: null,
          onerror: null,
          src: '',
        } as PastedDecklistImageLoader;
        images.push(image);
        return image;
      },
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(images).toHaveLength(1);
    expect(images[0]?.onload).toBeNull();
    expect(images[0]?.onerror).toBeNull();
  });
});
