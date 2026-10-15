import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DAY = 24 * 60 * 60 * 1000;
const feedStub = () => env.PTCG_DECK_FEED.getByName('limitless-standard');

/** One finished 200-player event whose winner played Dragapult. */
const limitlessRoutes = (): Record<string, unknown> => ({
  '/api/tournaments': [
    {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      game: 'PTCG',
      format: 'STANDARD',
      name: 'Weekly',
      date: new Date(Date.now() - 2 * DAY).toISOString(),
      players: 200,
    },
  ],
  '/api/tournaments/aaaaaaaaaaaaaaaaaaaaaaaa/standings': [
    {
      placing: 1,
      deck: { id: 'dragapult', name: 'Dragapult' },
      decklist: {
        pokemon: [{ count: 4, name: 'Dreepy', set: 'TWM', number: '128' }],
        trainer: [],
        energy: [
          { count: 56, name: 'Psychic Energy', set: 'MEE', number: '13' },
        ],
      },
    },
  ],
});

let limitlessCalls = 0;
const serveLimitless = (routes: Record<string, unknown> | null) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== 'https://play.limitlesstcg.com') {
        throw new Error(`unexpected request to ${url.origin}`);
      }
      limitlessCalls += 1;
      const body = routes?.[url.pathname];
      if (body === undefined) return new Response('down', { status: 503 });
      return Response.json(body);
    });

const getCurrentDecks = () =>
  exports.default.fetch(new Request('https://play.example/v2/decks/current'));

beforeEach(async () => {
  limitlessCalls = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await runInDurableObject(feedStub(), async (_instance, state) => {
    await state.storage.deleteAll();
  });
  await evictDurableObject(feedStub());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('current decks from Limitless', () => {
  it('answers 503 until any lists exist, without retrying Limitless on every request', async () => {
    serveLimitless(null);
    const first = await getCurrentDecks();
    expect(first.status).toBe(503);
    expect(first.headers.get('Cache-Control')).toContain('no-store');
    expect(await first.json()).toEqual({ error: 'unavailable' });
    const calls = limitlessCalls;
    expect(calls).toBeGreaterThan(0);
    expect((await getCurrentDecks()).status).toBe(503);
    // A failed attempt holds further ones back for a while, even once the
    // object has been evicted and comes back fresh.
    expect(limitlessCalls).toBe(calls);
    await evictDurableObject(feedStub());
    expect((await getCurrentDecks()).status).toBe(503);
    expect(limitlessCalls).toBe(calls);
  });

  it('fetches once, then serves the stored lists with credit and a short cache', async () => {
    serveLimitless(limitlessRoutes());
    const response = await getCurrentDecks();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=900');
    const body = (await response.json()) as {
      readonly source: string;
      readonly groups: Record<string, Record<string, string>>;
    };
    expect(body.source).toBe('Limitless TCG');
    expect(body.groups['Current Standard']).toEqual({
      'Dragapult — 1st of 200': [
        'Pokémon (4)',
        '4 Dreepy TWM 128',
        '',
        'Energy (56)',
        '56 Psychic Energy MEE 13',
      ].join('\n'),
    });
    const calls = limitlessCalls;
    await evictDurableObject(feedStub());
    expect((await getCurrentDecks()).status).toBe(200);
    expect(limitlessCalls).toBe(calls);
  });

  it('keeps the stored lists when the daily refresh fails', async () => {
    serveLimitless(limitlessRoutes());
    expect(await feedStub().refresh()).toBe(1);
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await evictDurableObject(feedStub());
    serveLimitless(null);
    expect(await feedStub().refresh()).toBe(1);
    expect((await getCurrentDecks()).status).toBe(200);
  });

  it('refuses anything but a plain GET', async () => {
    serveLimitless(null);
    const post = await exports.default.fetch(
      new Request('https://play.example/v2/decks/current', { method: 'POST' })
    );
    expect(post.status).toBe(405);
    const query = await exports.default.fetch(
      new Request('https://play.example/v2/decks/current?all=1')
    );
    expect(query.status).toBe(400);
    expect(limitlessCalls).toBe(0);
  });
});
