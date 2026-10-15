import { env, exports } from 'cloudflare:workers';
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogStub = () => env.PTCG_CARD_CATALOG.getByName('tcgdex-en');

const SETS = [
  {
    id: 'sv06',
    name: 'Twilight Masquerade',
    releaseDate: '2024-05-24',
    serie: { id: 'sv', name: 'Scarlet & Violet' },
    cardCount: { official: 167, total: 2 },
    logo: 'https://assets.tcgdex.net/en/sv/sv06/logo',
  },
  {
    id: 'me03',
    name: 'Perfect Order',
    releaseDate: '2026-03-27',
    serie: { id: 'me', name: 'Mega Evolution' },
    cardCount: { official: 88, total: 1 },
  },
];

const CARDS: Record<string, unknown[]> = {
  sv06: [
    {
      id: 'sv06-128',
      localId: '128',
      name: 'Dreepy',
      category: 'Pokemon',
      stage: 'Basic',
      hp: 70,
      types: ['Dragon'],
      regulationMark: 'H',
      legal: { standard: true, expanded: true },
      image: 'https://assets.tcgdex.net/en/sv/sv06/128',
    },
    {
      id: 'sv06-130',
      localId: '130',
      name: 'Dragapult ex',
      category: 'Pokemon',
      stage: 'Stage2',
      suffix: 'ex',
      hp: 320,
      types: ['Dragon'],
      regulationMark: 'H',
      legal: { standard: true, expanded: true },
      image: 'https://assets.tcgdex.net/en/sv/sv06/130',
    },
  ],
  me03: [
    {
      id: 'me03-076',
      localId: '076',
      name: 'Judge',
      category: 'Trainer',
      trainerType: 'Supporter',
      regulationMark: 'J',
      legal: { standard: true, expanded: true },
      image: 'https://assets.tcgdex.net/en/me/me03/076',
    },
  ],
};

let tcgdexCalls = 0;
const serveTcgdex = (up: boolean) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== 'https://api.tcgdex.net') {
          throw new Error(`unexpected request to ${url.origin}`);
        }
        tcgdexCalls += 1;
        if (!up) return new Response('down', { status: 503 });
        const query = JSON.parse(String(init?.body)).query as string;
        if (query.startsWith('{ sets'))
          return Response.json({ data: { sets: SETS } });
        const id = /id: "([^"]+)-"/u.exec(query)?.[1] ?? '';
        return Response.json({ data: { cards: CARDS[id] ?? [] } });
      }
    );

const getManifest = () =>
  exports.default.fetch(new Request('https://play.example/v2/cards/catalog'));

/**
 * Runs the object's alarm until its queue of sets is empty. (The test
 * runtime's `runDurableObjectAlarm` clears the alarm a step sets for the
 * next one, so later steps are run directly.)
 */
const runAlarms = async (): Promise<number> => {
  let ran = 0;
  if (await runDurableObjectAlarm(catalogStub())) ran += 1;
  for (; ran < 50; ran += 1) {
    const queued = await runInDurableObject(
      catalogStub(),
      async (_instance, state) =>
        ((await state.storage.get<unknown[]>('catalog:queue')) ?? []).length
    );
    if (queued === 0) break;
    await runInDurableObject(catalogStub(), async (instance) => {
      await instance.alarm?.();
    });
  }
  return ran;
};

beforeEach(async () => {
  tcgdexCalls = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await runInDurableObject(catalogStub(), async (_instance, state) => {
    await state.storage.deleteAll();
    await state.storage.deleteAlarm();
  });
  await evictDurableObject(catalogStub());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the card catalog', () => {
  it('starts building on the first request and serves it once built', async () => {
    serveTcgdex(true);
    const first = await getManifest();
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({
      error: 'unavailable',
      building: true,
    });

    // The request started a build in the background; the cron's entry
    // point queues nothing new on top of it.
    await catalogStub().refresh();
    await runAlarms();

    const response = await getManifest();
    expect(response.status).toBe(200);
    const manifest = (await response.json()) as {
      version: string;
      url: string;
      sets: number;
      cards: number;
      complete: boolean;
    };
    expect(manifest).toMatchObject({ sets: 2, cards: 3, complete: true });
    expect(manifest.url).toBe(`/v2/cards/catalog/${manifest.version}.json`);

    const body = await exports.default.fetch(
      new Request(`https://play.example${manifest.url}`)
    );
    expect(body.status).toBe(200);
    expect(body.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    const catalog = (await body.json()) as {
      v: number;
      sets: { id: string; code: string; cards: { nm: string }[] }[];
    };
    expect(catalog.v).toBe(1);
    expect(
      catalog.sets.map((set) => [
        set.id,
        set.code,
        set.cards.map((card) => card.nm),
      ])
    ).toEqual([
      ['me03', 'POR', ['Judge']],
      ['sv06', 'TWM', ['Dreepy', 'Dragapult ex']],
    ]);

    // Kept across eviction; no new request to TCGdex.
    const calls = tcgdexCalls;
    await evictDurableObject(catalogStub());
    expect((await getManifest()).status).toBe(200);
    expect(tcgdexCalls).toBe(calls);
  });

  it('answers 404 for a version it does not have', async () => {
    serveTcgdex(true);
    const response = await exports.default.fetch(
      new Request(
        'https://play.example/v2/cards/catalog/0123456789abcdef0123.json'
      )
    );
    expect(response.status).toBe(404);
  });

  it('holds back after TCGdex fails, even once evicted', async () => {
    serveTcgdex(false);
    expect(await catalogStub().refresh()).toBe(0);
    const calls = tcgdexCalls;
    expect(calls).toBe(1);
    await evictDurableObject(catalogStub());
    expect(await catalogStub().refresh()).toBe(0);
    expect((await getManifest()).status).toBe(503);
    expect(tcgdexCalls).toBe(calls);
  });

  it('refuses anything but a plain GET', async () => {
    serveTcgdex(true);
    const post = await exports.default.fetch(
      new Request('https://play.example/v2/cards/catalog', { method: 'POST' })
    );
    expect(post.status).toBe(405);
    const query = await exports.default.fetch(
      new Request('https://play.example/v2/cards/catalog?all=1')
    );
    expect(query.status).toBe(400);
  });
});
