import { afterEach, describe, expect, it, vi } from 'vitest';

import { deckScreenFilesArrived } from './LazyDeckBuilderSession.js';

const ok = (body: string) => new Response(body, { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deckScreenFilesArrived', () => {
  it('fetches every listed file of the deck screen before it may be imported', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(url);
        return url.endsWith('deck-screen-files.json')
          ? ok('["assets/Deck-a1.js","assets/Deck-b2.css"]')
          : ok('/* code */');
      })
    );
    await expect(deckScreenFilesArrived('/', false)).resolves.toBe(true);
    expect(asked).toEqual([
      '/deck-screen-files.json',
      '/assets/Deck-a1.js',
      '/assets/Deck-b2.css',
    ]);
  });

  it('says no when any file fails, so nothing is imported to be remembered as failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('deck-screen-files.json'))
          return ok('["assets/Deck-a1.js","assets/Shared-c3.js"]');
        if (url.endsWith('Shared-c3.js'))
          throw new TypeError('Failed to fetch');
        return ok('/* code */');
      })
    );
    await expect(deckScreenFilesArrived('/', false)).resolves.toBe(false);
  });

  it('says no without a list, or with one that is not a list of files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );
    await expect(deckScreenFilesArrived('/', false)).resolves.toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok('{"files":1}'))
    );
    await expect(deckScreenFilesArrived('/', false)).resolves.toBe(false);
  });

  it('asks only that the server answers on a development server', async () => {
    const fetch = vi.fn(async () => ok('{}'));
    vi.stubGlobal('fetch', fetch);
    await expect(deckScreenFilesArrived('/', true)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('/v2/health', { cache: 'no-store' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    await expect(deckScreenFilesArrived('/', true)).resolves.toBe(false);
  });
});
