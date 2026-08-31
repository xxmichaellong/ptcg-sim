import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPokemonTcgQuery,
  CARD_PROVIDERS,
  normalizePokemonTcgCard,
  normalizePokemonTcgSearchQuery,
  normalizeReleaseDate,
  queryWithFallback,
} from '../core/card-search.mjs';

// ---------------------------------------------------------------------------
// normalizeReleaseDate
// ---------------------------------------------------------------------------

test('normalizeReleaseDate converts slashes to dashes', () => {
  assert.equal(normalizeReleaseDate('2016/02/03'), '2016-02-03');
});

test('normalizeReleaseDate leaves dash format unchanged', () => {
  assert.equal(normalizeReleaseDate('2016-02-03'), '2016-02-03');
});

test('normalizeReleaseDate tolerates empty input', () => {
  assert.equal(normalizeReleaseDate(''), '');
  assert.equal(normalizeReleaseDate(undefined), '');
  assert.equal(normalizeReleaseDate(null), '');
});

test('normalizePokemonTcgSearchQuery preserves aliases for the fallback provider', () => {
  assert.equal(
    normalizePokemonTcgSearchQuery('Charizard delta'),
    'Charizard δ'
  );
  assert.equal(normalizePokemonTcgSearchQuery('Mewtwo prism star'), 'Mewtwo ◇');
  assert.equal(normalizePokemonTcgSearchQuery('Pikachu *'), 'Pikachu Star');
  assert.equal(normalizePokemonTcgSearchQuery('Infernape E4'), 'Infernape 4');
  assert.equal(
    normalizePokemonTcgSearchQuery('Torterra LV.X'),
    'Torterra LV.X'
  );
});

test('buildPokemonTcgQuery uses wildcards only for safe single-word terms', () => {
  assert.equal(buildPokemonTcgQuery('Pikachu'), 'name:Pikachu*');
  assert.equal(buildPokemonTcgQuery('Mewtwo-EX'), 'name:"Mewtwo-EX"');
  assert.equal(buildPokemonTcgQuery('Porygon?'), 'name:"Porygon?"');
});

test('buildPokemonTcgQuery quotes and escapes multi-word phrases', () => {
  assert.equal(buildPokemonTcgQuery('Lt. "Surge"'), 'name:"Lt. \\"Surge\\""');
});

// ---------------------------------------------------------------------------
// normalizePokemonTcgCard — maps pokemontcg.io shape onto the canonical shape
// ---------------------------------------------------------------------------

test('normalizePokemonTcgCard maps a pokemontcg.io card to the canonical shape', () => {
  const raw = {
    id: 'base1-58',
    name: 'Pikachu',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    number: '58',
    rarity: 'Common',
    set: {
      id: 'base1',
      name: 'Base',
      series: 'Base',
      releaseDate: '1999/01/09',
    },
    images: {
      small: 'https://images.pokemontcg.io/base1/58.png',
      large: 'https://images.pokemontcg.io/base1/58_hires.png',
    },
  };

  const card = normalizePokemonTcgCard(raw);

  assert.equal(card.id, 'base1-58');
  assert.equal(card.name, 'Pikachu');
  assert.equal(card.supertype, 'Pokémon');
  assert.equal(card.stage, 'Basic');
  assert.equal(card.number, '58');
  assert.equal(card.set.id, 'base1');
  assert.equal(card.set.name, 'Base');
  assert.equal(card.set.releaseDate, '1999-01-09'); // slashes normalized
  assert.equal(card.image, 'https://images.pokemontcg.io/base1/58_hires.png');
  assert.equal(
    card.images.large,
    'https://images.pokemontcg.io/base1/58_hires.png'
  );
  assert.equal(card._provider, 'pokemontcg');
});

test('normalizePokemonTcgCard falls back to small image when large is missing', () => {
  const card = normalizePokemonTcgCard({
    id: 'x',
    name: 'X',
    images: { small: 'https://example.com/small.png' },
  });
  assert.equal(card.image, 'https://example.com/small.png');
});

test('normalizePokemonTcgCard defaults supertype to Unknown', () => {
  const card = normalizePokemonTcgCard({
    id: 'x',
    name: 'X',
    images: { large: 'u' },
  });
  assert.equal(card.supertype, 'Unknown');
});

// ---------------------------------------------------------------------------
// queryWithFallback — provider failover (error + timeout)
// ---------------------------------------------------------------------------

const okResult = (results) => ({
  results,
  totalSummaries: results.length,
  isHugeResultSet: false,
});

test('queryWithFallback uses the primary provider when it succeeds', async () => {
  const primary = {
    name: 'tcgdex',
    search: async () => okResult([{ id: 'a' }]),
  };
  const fallback = {
    name: 'pokemontcg',
    search: async () => okResult([{ id: 'b' }]),
    fallbackNotice: 'fell back',
  };

  const res = await queryWithFallback('pikachu', {
    providers: [primary, fallback],
  });

  assert.equal(res.provider, 'tcgdex');
  assert.equal(res.usedFallback, false);
  assert.equal(res.notice, '');
  assert.deepEqual(res.results, [{ id: 'a' }]);
});

test('queryWithFallback fails over to the backup provider on error', async () => {
  const primary = {
    name: 'tcgdex',
    search: async () => {
      throw new Error('502 Bad Gateway');
    },
  };
  const fallback = {
    name: 'pokemontcg',
    search: async () => okResult([{ id: 'b' }]),
    fallbackNotice: 'tcgdex is unavailable',
  };

  const res = await queryWithFallback('pikachu', {
    providers: [primary, fallback],
  });

  assert.equal(res.provider, 'pokemontcg');
  assert.equal(res.usedFallback, true);
  assert.equal(res.notice, 'tcgdex is unavailable');
  assert.deepEqual(res.results, [{ id: 'b' }]);
});

test('queryWithFallback fails over when the primary is too slow', async () => {
  const primary = {
    name: 'tcgdex',
    // Never resolves within the timeout window.
    search: (_term, { signal } = {}) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(okResult([{ id: 'slow' }])), 1000);
        if (signal) signal.addEventListener('abort', () => clearTimeout(t));
      }),
  };
  const fallback = {
    name: 'pokemontcg',
    search: async () => okResult([{ id: 'fast' }]),
    fallbackNotice: 'slow',
  };

  const res = await queryWithFallback('pikachu', {
    providers: [primary, fallback],
    timeoutMs: 20,
  });

  assert.equal(res.provider, 'pokemontcg');
  assert.equal(res.usedFallback, true);
  assert.deepEqual(res.results, [{ id: 'fast' }]);
});

test('queryWithFallback throws when every provider fails', async () => {
  const boom = {
    name: 'a',
    search: async () => {
      throw new Error('down');
    },
  };
  const boom2 = {
    name: 'b',
    search: async () => {
      throw new Error('also down');
    },
  };

  await assert.rejects(
    queryWithFallback('pikachu', { providers: [boom, boom2] }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /All card providers failed/);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[1].message, /also down/);
      return true;
    }
  );
});

test('queryWithFallback skips providers that cannot serve Pocket cards', async () => {
  let fallbackCalled = false;
  const primary = {
    name: 'tcgdex',
    cardTypes: ['tcg', 'pocket'],
    search: async () => {
      throw new Error('down');
    },
  };
  const fallback = {
    name: 'pokemontcg',
    cardTypes: ['tcg'],
    search: async () => {
      fallbackCalled = true;
      return okResult([]);
    },
  };

  await assert.rejects(
    queryWithFallback('pikachu', {
      providers: [primary, fallback],
      cardType: 'pocket',
    }),
    /no fallback provider supports TCG Pocket/
  );
  assert.equal(fallbackCalled, false);
});

test('queryWithFallback stops immediately when its parent signal aborts', async () => {
  const controller = new AbortController();
  let fallbackCalled = false;
  const primary = {
    name: 'tcgdex',
    search: (_term, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      }),
  };
  const fallback = {
    name: 'pokemontcg',
    search: async () => {
      fallbackCalled = true;
      return okResult([]);
    },
  };

  setTimeout(() => controller.abort(), 5);
  await assert.rejects(
    queryWithFallback('pikachu', {
      providers: [primary, fallback],
      signal: controller.signal,
      timeoutMs: 100,
    }),
    (error) => error.name === 'AbortError'
  );
  assert.equal(fallbackCalled, false);
});

test('the real TCGdex provider fails over when every detail request fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/v2/en/cards?')) {
      return new Response(JSON.stringify([{ id: 'failed-detail' }]), {
        status: 200,
      });
    }
    if (value.endsWith('/cards/failed-detail')) {
      return new Response('down', { status: 503 });
    }
    throw new Error(`Unexpected URL: ${value}`);
  });

  const fallback = {
    name: 'fallback',
    cardTypes: ['tcg'],
    search: async () => okResult([{ id: 'fallback-card' }]),
    fallbackNotice: 'fell back',
  };
  const result = await queryWithFallback('Pikachu', {
    providers: [CARD_PROVIDERS[0], fallback],
    timeoutMs: 100,
  });

  assert.equal(result.provider, 'fallback');
  assert.deepEqual(result.results, [{ id: 'fallback-card' }]);
});

test('the real TCGdex provider reports partial detail failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/v2/en/cards?')) {
      return new Response(
        JSON.stringify([{ id: 'good-detail' }, { id: 'bad-detail' }]),
        { status: 200 }
      );
    }
    if (value.endsWith('/cards/good-detail')) {
      return new Response(
        JSON.stringify({
          id: 'good-detail',
          name: 'Pikachu',
          category: 'Pokemon',
          image: 'https://example.test/card',
        }),
        { status: 200 }
      );
    }
    if (value.endsWith('/cards/bad-detail')) {
      return new Response('down', { status: 503 });
    }
    throw new Error(`Unexpected URL: ${value}`);
  });

  const result = await CARD_PROVIDERS[0].search('Pikachu');
  assert.equal(result.results.length, 1);
  assert.match(result.notice, /partial results/);
});

test('aborted set hydration is not cached as a missing date', async (t) => {
  let setCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, { signal } = {}) => {
    const value = String(url);
    if (value.includes('/v2/en/cards?')) {
      return new Response(JSON.stringify([{ id: 'cache-test-card' }]), {
        status: 200,
      });
    }
    if (value.endsWith('/cards/cache-test-card')) {
      return new Response(
        JSON.stringify({
          id: 'cache-test-card',
          name: 'Cache Test',
          category: 'Pokemon',
          localId: '1',
          image: 'https://example.test/card',
          set: { id: 'cache-test-set', name: 'Cache Set' },
        }),
        { status: 200 }
      );
    }
    if (value.endsWith('/sets/cache-test-set')) {
      setCalls += 1;
      if (setCalls === 1) {
        return new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }
      return new Response(JSON.stringify({ releaseDate: '2025-01-02' }), {
        status: 200,
      });
    }
    throw new Error(`Unexpected URL: ${value}`);
  });

  await queryWithFallback('Cache Test', {
    providers: [
      CARD_PROVIDERS[0],
      { name: 'fallback', search: async () => okResult([]) },
    ],
    timeoutMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const second = await CARD_PROVIDERS[0].search('Cache Test');
  assert.equal(setCalls, 2);
  assert.equal(second.results[0].set.releaseDate, '2025-01-02');
});

test('the real fallback provider sends only a normalized term to the proxy', async (t) => {
  let requestedUrl = '';
  t.mock.method(globalThis, 'fetch', async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [], totalCount: 0 }), {
      status: 200,
    });
  });

  await CARD_PROVIDERS[1].search('Charizard delta');
  const url = new URL(requestedUrl, 'https://example.test');
  assert.equal(url.pathname, '/api/card-fallback');
  assert.equal(url.searchParams.get('term'), 'Charizard δ');
  assert.deepEqual([...url.searchParams.keys()], ['term']);
});
