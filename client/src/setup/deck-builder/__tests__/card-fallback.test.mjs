import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePokemonTcgCard,
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
    /also down/
  );
});
