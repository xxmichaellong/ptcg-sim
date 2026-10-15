import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../../../tests/fixtures/card-catalog.json';
import {
  CARD_CATALOG_PATH,
  CATALOG_BUILDING_RETRY_MS,
  CATALOG_INCOMPLETE_RECHECK_MS,
  LAST_CATALOG_BODY_KEY,
  cardCatalog,
  createCardCatalogClient,
} from './card-catalog-client.js';

const VERSION = 'aaaaaaaaaaaaaaaaaaaa';
const NEXT = 'bbbbbbbbbbbbbbbbbbbb';
const bodyUrl = (version: string) => `/v2/cards/catalog/${version}.json`;

const manifest = (version = VERSION, complete = true) =>
  Response.json({
    version,
    url: bodyUrl(version),
    builtAt: '2026-10-15T06:17:00.000Z',
    sets: 28,
    cards: 74,
    complete,
  });

type Route = () => Response | Promise<Response>;

/** A server answering each path from a queue of responses (the last repeats). */
const server = (routes: Record<string, Route[]>) => {
  const requests: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    expect(init?.credentials).toBe('omit');
    const queue = routes[url];
    if (!queue || queue.length === 0) throw new TypeError('Failed to fetch');
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return await next();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
};

/** Timers that run when the test says, except zero-delay ones. */
const timers = () => {
  let nextId = 0;
  const pending = new Map<number, { delay: number; callback: () => void }>();
  return {
    setTimeout: (callback: () => void, delay: number) => {
      if (delay === 0) {
        queueMicrotask(callback);
        return -1;
      }
      nextId += 1;
      pending.set(nextId, { delay, callback });
      return nextId;
    },
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number);
    },
    delays: () => [...pending.values()].map((timer) => timer.delay),
    runAll: () => {
      const due = [...pending.values()];
      pending.clear();
      for (const timer of due) timer.callback();
    },
  };
};

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const fixtureBody = () => Response.json(fixture);

const statusOf = (client: { getSnapshot: () => { status: string } }) =>
  client.getSnapshot().status;

describe('loading the card catalog', () => {
  it('reads the manifest, then the body it names, and remembers it', async () => {
    const { fetch, requests } = server({
      [CARD_CATALOG_PATH]: [() => manifest()],
      [bodyUrl(VERSION)]: [fixtureBody],
    });
    const storage = memoryStorage();
    const client = createCardCatalogClient({ fetch, storage, ...timers() });
    const seen: string[] = [];
    client.subscribe(() => seen.push(statusOf(client)));
    expect(statusOf(client)).toBe('idle');

    client.load();
    client.load();
    expect(statusOf(client)).toBe('loading');
    await vi.waitFor(() => expect(statusOf(client)).toBe('ready'));

    const snapshot = client.getSnapshot();
    expect(snapshot.status === 'ready' && snapshot.catalog.cards.length).toBe(
      74
    );
    expect(requests).toEqual([CARD_CATALOG_PATH, bodyUrl(VERSION)]);
    expect(seen).toEqual(['loading', 'ready']);
    expect(storage.values.get(LAST_CATALOG_BODY_KEY)).toBe(bodyUrl(VERSION));
    client.dispose();
  });

  it('waits, and asks again, while the server builds its first catalog', async () => {
    const clock = timers();
    const building = () =>
      Response.json({ error: 'unavailable', building: true }, { status: 503 });
    const { fetch, requests } = server({
      [CARD_CATALOG_PATH]: [building, building, () => manifest()],
      [bodyUrl(VERSION)]: [fixtureBody],
    });
    const client = createCardCatalogClient({
      fetch,
      storage: memoryStorage(),
      ...clock,
    });
    client.load();
    await vi.waitFor(() =>
      expect(clock.delays()).toEqual([CATALOG_BUILDING_RETRY_MS[0]])
    );
    expect(statusOf(client)).toBe('loading');
    clock.runAll();
    await vi.waitFor(() =>
      expect(clock.delays()).toEqual([CATALOG_BUILDING_RETRY_MS[1]])
    );
    clock.runAll();
    await vi.waitFor(() => expect(statusOf(client)).toBe('ready'));
    expect(requests.filter((url) => url === CARD_CATALOG_PATH)).toHaveLength(3);
    client.dispose();
  });

  it('uses the last body that loaded when the manifest cannot be had', async () => {
    const { fetch, requests } = server({
      [bodyUrl(VERSION)]: [fixtureBody],
    });
    const client = createCardCatalogClient({
      fetch,
      storage: memoryStorage({ [LAST_CATALOG_BODY_KEY]: bodyUrl(VERSION) }),
      ...timers(),
    });
    client.load();
    await vi.waitFor(() => expect(statusOf(client)).toBe('ready'));
    expect(requests).toEqual([CARD_CATALOG_PATH, bodyUrl(VERSION)]);
    client.dispose();
  });

  it('ignores a remembered value that is not a body URL', async () => {
    const { fetch, requests } = server({});
    const client = createCardCatalogClient({
      fetch,
      storage: memoryStorage({
        [LAST_CATALOG_BODY_KEY]: 'https://evil.example/x.json',
      }),
      ...timers(),
    });
    client.load();
    await vi.waitFor(() => expect(statusOf(client)).toBe('failed'));
    expect(requests).toEqual([CARD_CATALOG_PATH]);
  });

  it('fails when nothing loads, and retries on request', async () => {
    const routes: Record<string, Route[]> = {};
    const { fetch } = server(routes);
    const client = createCardCatalogClient({
      fetch,
      storage: memoryStorage(),
      ...timers(),
    });
    client.load();
    await vi.waitFor(() => expect(statusOf(client)).toBe('failed'));
    client.load();
    expect(statusOf(client)).toBe('failed');

    routes[CARD_CATALOG_PATH] = [() => manifest()];
    routes[bodyUrl(VERSION)] = [fixtureBody];
    client.retry();
    expect(statusOf(client)).toBe('loading');
    await vi.waitFor(() => expect(statusOf(client)).toBe('ready'));
    client.dispose();
  });

  it('fails on a body that does not decode or a manifest it cannot trust', async () => {
    const broken = createCardCatalogClient({
      fetch: server({
        [CARD_CATALOG_PATH]: [() => manifest()],
        [bodyUrl(VERSION)]: [() => Response.json({ v: 99 })],
      }).fetch,
      storage: memoryStorage(),
      ...timers(),
    });
    broken.load();
    await vi.waitFor(() => expect(statusOf(broken)).toBe('failed'));

    const offsite = createCardCatalogClient({
      fetch: server({
        [CARD_CATALOG_PATH]: [
          () =>
            Response.json({
              version: VERSION,
              url: 'https://evil.example/a.json',
            }),
        ],
      }).fetch,
      storage: memoryStorage(),
      ...timers(),
    });
    offsite.load();
    await vi.waitFor(() => expect(statusOf(offsite)).toBe('failed'));
  });

  it('swaps in a fuller catalog while the server is still filling it', async () => {
    const clock = timers();
    const smaller = { ...fixture, sets: fixture.sets.slice(0, 2) };
    const { fetch } = server({
      [CARD_CATALOG_PATH]: [
        () => manifest(VERSION, false),
        () => manifest(NEXT, true),
      ],
      [bodyUrl(VERSION)]: [() => Response.json(smaller)],
      [bodyUrl(NEXT)]: [fixtureBody],
    });
    const client = createCardCatalogClient({
      fetch,
      storage: memoryStorage(),
      ...clock,
    });
    client.load();
    await vi.waitFor(() => expect(statusOf(client)).toBe('ready'));
    const first = client.getSnapshot();
    expect(first.status === 'ready' && first.catalog.cards.length).toBe(2);
    await vi.waitFor(() =>
      expect(clock.delays()).toEqual([CATALOG_INCOMPLETE_RECHECK_MS])
    );
    clock.runAll();
    await vi.waitFor(() => {
      const next = client.getSnapshot();
      expect(next.status === 'ready' && next.catalog.cards.length).toBe(74);
    });
    // Complete now: no more checks.
    await Promise.resolve();
    expect(clock.delays()).toEqual([]);
    client.dispose();
  });

  it('stops everything when disposed', async () => {
    const clock = timers();
    const building = () =>
      Response.json({ error: 'unavailable', building: true }, { status: 503 });
    const { fetch, requests } = server({ [CARD_CATALOG_PATH]: [building] });
    const client = createCardCatalogClient({
      fetch,
      storage: memoryStorage(),
      ...clock,
    });
    const listener = vi.fn();
    client.subscribe(listener);
    client.load();
    await vi.waitFor(() => expect(clock.delays()).toHaveLength(1));
    client.dispose();
    expect(clock.delays()).toEqual([]);
    clock.runAll();
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is one catalog per page', () => {
    expect(cardCatalog()).toBe(cardCatalog());
  });
});
