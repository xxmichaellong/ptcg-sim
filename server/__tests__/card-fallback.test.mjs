import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createCardFallbackHandler } from '../card-fallback.js';

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.body = undefined;
    this.writableEnded = false;
    this.destroyed = false;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  set(name, value) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  json(body) {
    this.body = body;
    this.writableEnded = true;
    return this;
  }
}

function request(term, ip = '127.0.0.1', extraQuery = {}) {
  return {
    ip,
    query: { term, ...extraQuery },
    socket: { remoteAddress: ip },
  };
}

test('proxy constructs a fixed upstream query and attaches the API key', async () => {
  let observed;
  const handler = createCardFallbackHandler({
    apiKey: 'secret-key',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), {
        status: 200,
      });
    },
  });
  const res = new MockResponse();

  await handler(
    request('Mewtwo-EX', '127.0.0.1', {
      q: 'set.id:base1',
      pageSize: '250',
      orderBy: 'name',
    }),
    res
  );

  const url = new URL(observed.url);
  assert.equal(url.origin, 'https://api.pokemontcg.io');
  assert.equal(url.pathname, '/v2/cards');
  assert.equal(url.searchParams.get('q'), 'name:"Mewtwo-EX"');
  assert.equal(url.searchParams.get('pageSize'), '150');
  assert.equal(url.searchParams.get('orderBy'), '-set.releaseDate');
  assert.equal(
    url.searchParams.get('select'),
    'id,name,supertype,subtypes,number,rarity,set,images'
  );
  assert.equal(observed.options.headers['X-Api-Key'], 'secret-key');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { data: [], totalCount: 0 });
  assert.equal(res.headers.get('x-card-fallback-cache'), 'MISS');
});

test('proxy rejects missing, non-string, and overlong search terms', async () => {
  const handler = createCardFallbackHandler({
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
  });

  for (const term of [undefined, ['Pikachu'], '', 'x'.repeat(121)]) {
    const res = new MockResponse();
    await handler(request(term), res);
    assert.equal(res.statusCode, 400);
  }
});

test('proxy caches successful responses by normalized term', async () => {
  let fetchCalls = 0;
  let currentTime = 1000;
  const payload = { data: [{ id: 'base1-58' }], totalCount: 1 };
  const handler = createCardFallbackHandler({
    now: () => currentTime,
    cacheTtlMs: 5000,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const first = new MockResponse();
  await handler(request('  Pikachu  '), first);
  currentTime += 1000;
  const second = new MockResponse();
  await handler(request('pikachu'), second);

  assert.equal(fetchCalls, 1);
  assert.deepEqual(second.body, payload);
  assert.equal(second.headers.get('x-card-fallback-cache'), 'HIT');
});

test('proxy enforces per-IP, global minute, and global daily rate limits', async () => {
  let fetchCalls = 0;
  const makeHandler = (limits) =>
    createCardFallbackHandler({
      ...limits,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ data: [], totalCount: 0 }), {
          status: 200,
        });
      },
    });

  const perIpHandler = makeHandler({
    perIpRateLimitMax: 1,
    globalRateLimitMax: 10,
  });
  await perIpHandler(request('Pikachu'), new MockResponse());
  const perIpLimited = new MockResponse();
  await perIpHandler(request('Charizard'), perIpLimited);
  assert.equal(perIpLimited.statusCode, 429);
  assert.equal(perIpLimited.headers.get('retry-after'), '60');

  const globalHandler = makeHandler({
    perIpRateLimitMax: 10,
    globalRateLimitMax: 1,
  });
  await globalHandler(request('Mew', 'one'), new MockResponse());
  const globallyLimited = new MockResponse();
  await globalHandler(request('Mewtwo', 'two'), globallyLimited);
  assert.equal(globallyLimited.statusCode, 429);
  assert.equal(fetchCalls, 2);

  const dailyHandler = makeHandler({
    perIpRateLimitMax: 10,
    globalRateLimitMax: 10,
    globalDailyRateLimitMax: 1,
  });
  await dailyHandler(request('Eevee', 'one'), new MockResponse());
  const dailyLimited = new MockResponse();
  await dailyHandler(request('Vaporeon', 'two'), dailyLimited);
  assert.equal(dailyLimited.statusCode, 429);
  assert.equal(fetchCalls, 3);
});

test('proxy maps upstream errors and invalid payloads to 502', async () => {
  const cases = [
    async () => new Response('down', { status: 503 }),
    async () => new Response('<html>', { status: 200 }),
    async () =>
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
  ];

  for (const [index, fetchImpl] of cases.entries()) {
    const handler = createCardFallbackHandler({ fetchImpl });
    const res = new MockResponse();
    await handler(request(`Pikachu ${index}`), res);
    assert.equal(res.statusCode, 502);
  }
});

test('proxy returns 504 when the upstream request times out', async () => {
  const handler = createCardFallbackHandler({
    upstreamTimeoutMs: 5,
    fetchImpl: async (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      }),
  });
  const res = new MockResponse();

  await handler(request('Pikachu'), res);
  assert.equal(res.statusCode, 504);
  assert.deepEqual(res.body, { error: 'Fallback provider unavailable' });
});

test('proxy aborts upstream work when the client disconnects', async () => {
  let upstreamSignal;
  const handler = createCardFallbackHandler({
    fetchImpl: async (_url, { signal }) => {
      upstreamSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      });
    },
  });
  const res = new MockResponse();

  const pending = handler(request('Pikachu'), res);
  res.destroyed = true;
  res.emit('close');
  await pending;

  assert.equal(upstreamSignal.aborted, true);
  assert.equal(res.body, undefined);
});
