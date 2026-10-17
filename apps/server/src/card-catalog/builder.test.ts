import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  CARD_CATALOG_LIMITS,
  CARD_CATALOG_NORMALIZATION,
  CARD_CATALOG_STORAGE_KEYS as KEYS,
  CardCatalogBuilder,
  type CatalogStore,
} from './builder.js';

const NOW = Date.parse('2026-10-15T06:17:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

interface FakeSet {
  readonly id: string;
  readonly released: string;
  readonly total: number;
}

/** A TCGdex that knows `sets`, each with `total` simple Pokémon. */
const tcgdex = (initial: readonly FakeSet[]) => {
  let sets = [...initial];
  const failing = new Set<string>();
  let listFails = false;
  const calls: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.tcgdex.net/v2/en/sets/')) {
      calls.push(`rest:${url.slice(url.lastIndexOf('/') + 1)}`);
      return Response.json({ abbreviation: { official: 'NEW' } });
    }
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.startsWith('{ sets')) {
      calls.push('sets');
      if (listFails) return new Response('down', { status: 503 });
      return Response.json({
        data: {
          sets: sets.map((set) => ({
            id: set.id,
            name: `Set ${set.id}`,
            releaseDate: set.released,
            serie: { id: 'sv', name: 'Scarlet & Violet' },
            cardCount: { official: set.total, total: set.total },
          })),
        },
      });
    }
    const id = /id: "([^"]+)-"/u.exec(query)?.[1] ?? '';
    calls.push(`cards:${id}`);
    if (failing.has(id)) return new Response('down', { status: 502 });
    const set = sets.find((candidate) => candidate.id === id);
    return Response.json({
      data: {
        cards: Array.from({ length: set?.total ?? 0 }, (_, index) => ({
          id: `${id}-${String(index + 1)}`,
          localId: String(index + 1),
          name: `Card ${String(index + 1)}`,
          category: 'Pokemon',
          image: `https://assets.tcgdex.net/en/sv/${id}/${String(index + 1)}`,
        })),
      },
    });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls,
    setSets: (next: readonly FakeSet[]) => {
      sets = [...next];
    },
    fail: (id: string) => failing.add(id),
    recover: (id: string) => failing.delete(id),
    failList: (fails: boolean) => {
      listFails = fails;
    },
  };
};

const memoryStore = () => {
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  const store: CatalogStore = {
    get: async <T>(key: string) =>
      structuredClone(values.get(key)) as T | undefined,
    getMany: async <T>(keys: readonly string[]) =>
      new Map(
        keys
          .filter((key) => values.has(key))
          .map((key) => [key, structuredClone(values.get(key)) as T])
      ),
    put: async (key, value) => {
      values.set(key, structuredClone(value));
    },
    delete: async (key) => {
      values.delete(key);
    },
    getAlarm: async () => alarm,
    setAlarm: async (at) => {
      alarm = at;
    },
  };
  return {
    store,
    values,
    alarm: () => alarm,
    takeAlarm: () => {
      const at = alarm;
      alarm = null;
      return at;
    },
  };
};

/** The stored set values, by key. */
const setValues = (values: ReadonlyMap<string, unknown>) =>
  [...values].filter(([key]) => key.startsWith('catalog:set:'));

const sha256 = async (value: string) =>
  createHash('sha256').update(value).digest('hex');

const setup = (sets: readonly FakeSet[]) => {
  const source = tcgdex(sets);
  const memory = memoryStore();
  let now = NOW;
  const failures: string[] = [];
  const builder = new CardCatalogBuilder({
    store: memory.store,
    fetch: source.fetch,
    now: () => now,
    sha256,
    onFailure: (stage) => failures.push(stage),
  });
  /** Runs alarms until none is set, as the Durable Object would. */
  const drain = async (limit = 100): Promise<number> => {
    let steps = 0;
    for (;;) {
      if (steps >= limit) return steps;
      const at = memory.takeAlarm();
      if (at === null) return steps;
      now = Math.max(now, at);
      await builder.step();
      steps += 1;
    }
  };
  return {
    builder,
    source,
    memory,
    failures,
    drain,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const THREE_SETS: readonly FakeSet[] = [
  { id: 'sv01', released: '2023-03-31', total: 3 },
  { id: 'sv02', released: '2023-06-09', total: 2 },
  { id: 'me05', released: '2026-07-17', total: 4 },
];

describe('building the card catalog', () => {
  it('builds one set per step, newest first, and then publishes', async () => {
    const { builder, source, memory, drain } = setup(THREE_SETS);
    expect(await builder.manifest()).toBeNull();
    expect(await builder.needsRefresh()).toBe(true);

    expect(await builder.refresh()).toBe(3);
    expect(source.calls).toEqual(['sets']);
    expect(memory.alarm()).toBe(NOW);
    expect(await builder.needsRefresh()).toBe(false);

    expect(await drain()).toBe(3);
    expect(source.calls).toEqual([
      'sets',
      'cards:me05',
      'cards:sv02',
      'cards:sv01',
    ]);
    const manifest = await builder.manifest();
    // Built when the last set arrived, steps apart.
    expect(manifest?.builtAt).toBe(
      new Date(NOW + 2 * CARD_CATALOG_LIMITS.stepDelayMs).toISOString()
    );
    expect(manifest).toMatchObject({
      sets: ['me05', 'sv02', 'sv01'],
      cards: 9,
      complete: true,
    });
    expect(manifest?.version).toMatch(/^[a-f0-9]{20}$/u);
  });

  it('serves the published version as one catalog body', async () => {
    const { builder, drain } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    const manifest = (await builder.manifest())!;
    const parts = await builder.body(manifest.version);
    const body = JSON.parse(parts!.join('')) as {
      v: number;
      builtAt: string;
      source: string;
      bans: { expanded: string[] };
      sets: { id: string; code?: string; cards: unknown[] }[];
    };
    expect(body.v).toBe(1);
    expect(body.source).toBe('TCGdex');
    expect(body.builtAt).toBe(manifest.builtAt);
    expect(body.bans.expanded).toContain('PHF 99');
    expect(
      body.sets.map((set) => [set.id, set.code, set.cards.length])
    ).toEqual([
      ['me05', 'PBL', 4],
      ['sv02', 'PAL', 2],
      ['sv01', 'SVI', 3],
    ]);
    expect(await builder.body('0'.repeat(20))).toBeNull();
  });

  it('looks up the code of a set it has never seen, once', async () => {
    const { builder, source, memory, drain } = setup([
      { id: 'me99', released: '2027-01-01', total: 1 },
    ]);
    await builder.refresh();
    await drain();
    expect(source.calls).toEqual(['sets', 'rest:me99', 'cards:me99']);
    expect(memory.values.get(KEYS.codes)).toEqual({ me99: 'NEW' });
    const manifest = (await builder.manifest())!;
    const body = JSON.parse(
      (await builder.body(manifest.version))!.join('')
    ) as {
      sets: { code?: string }[];
    };
    expect(body.sets[0]?.code).toBe('NEW');
  });

  it('refetches only new and changed sets, plus the stalest few', async () => {
    const sets: FakeSet[] = Array.from({ length: 30 }, (_, index) => ({
      id: `s${String(index).padStart(2, '0')}`,
      released: `2020-01-${String(index + 1).padStart(2, '0')}`,
      total: 1,
    }));
    const { builder, source, drain, advance } = setup(sets);
    await builder.refresh();
    await drain();
    const first = (await builder.manifest())!;

    advance(DAY);
    source.calls.length = 0;
    source.setSets([
      ...sets.map((set) => (set.id === 's05' ? { ...set, total: 2 } : set)),
      { id: 'new', released: '2026-10-01', total: 1 },
    ]);
    // New and changed first, then ceil(31 / 14) = 3 of the stalest.
    expect(await builder.refresh()).toBe(5);
    await drain();
    expect(source.calls.slice(0, 3)).toEqual(['sets', 'rest:new', 'cards:new']);
    expect(source.calls).toContain('cards:s05');
    expect(
      source.calls.filter((call) => call.startsWith('cards:'))
    ).toHaveLength(5);
    const second = (await builder.manifest())!;
    expect(second.version).not.toBe(first.version);
    expect(second.sets[0]).toBe('new');
    expect(second.cards).toBe(first.cards + 2);
  });

  it('refetches every set normalized with less, publishing once at the end', async () => {
    const sets: FakeSet[] = Array.from({ length: 30 }, (_, index) => ({
      id: `s${String(index).padStart(2, '0')}`,
      released: `2020-01-${String(index + 1).padStart(2, '0')}`,
      total: 1,
    }));
    const { builder, source, memory, drain, advance } = setup(sets);
    await builder.refresh();
    await drain();
    const first = (await builder.manifest())!;
    // As stored before CARD_CATALOG_NORMALIZATION 2.
    const index = memory.values.get('catalog:index') as Record<
      string,
      Record<string, unknown>
    >;
    for (const entry of Object.values(index)) delete entry.normalized;

    advance(DAY);
    source.calls.length = 0;
    expect(await builder.refresh()).toBe(30);
    await drain(29);
    // The published catalog doesn't change while sets are refetched.
    expect(await builder.manifest()).toEqual(first);
    await drain();
    expect(
      source.calls.filter((call) => call.startsWith('cards:'))
    ).toHaveLength(30);
    const after = memory.values.get('catalog:index') as Record<
      string,
      { readonly normalized?: number }
    >;
    expect(
      Object.values(after).every(
        (entry) => entry.normalized === CARD_CATALOG_NORMALIZATION
      )
    ).toBe(true);
    // Next time, only the rotation.
    advance(DAY);
    expect(await builder.refresh()).toBe(3);
  });

  it('keeps the version, and its build time, when nothing changed', async () => {
    const { builder, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    const first = (await builder.manifest())!;
    advance(DAY);
    await builder.refresh();
    await drain();
    expect(await builder.manifest()).toEqual(first);
  });

  it('publishes as it goes while a first build is long', async () => {
    const sets: FakeSet[] = Array.from({ length: 45 }, (_, index) => ({
      id: `s${String(index).padStart(2, '0')}`,
      released: `2020-02-${String((index % 28) + 1).padStart(2, '0')}`,
      total: 1,
    }));
    const { builder, drain } = setup(sets);
    await builder.refresh();
    await drain(CARD_CATALOG_LIMITS.publishEvery);
    const partial = (await builder.manifest())!;
    expect(partial.complete).toBe(false);
    expect(partial.sets).toHaveLength(CARD_CATALOG_LIMITS.publishEvery);
    await drain();
    const full = (await builder.manifest())!;
    expect(full.complete).toBe(true);
    expect(full.sets).toHaveLength(45);
  });

  it('holds back for ten minutes after a failed request and tries again', async () => {
    const { builder, source, memory, failures, drain } = setup(THREE_SETS);
    source.fail('sv02');
    await builder.refresh();
    await builder.step(); // me05
    memory.takeAlarm();
    await builder.step(); // sv02 fails
    expect(failures).toEqual(['set_cards']);
    expect(memory.values.get(KEYS.retryAfter)).toBe(
      NOW + CARD_CATALOG_LIMITS.retryAfterMs
    );
    expect(memory.alarm()).toBe(NOW + CARD_CATALOG_LIMITS.retryAfterMs);
    // A refresh meanwhile waits too, without asking TCGdex.
    const calls = source.calls.length;
    expect(await builder.refresh()).toBe(0);
    expect(source.calls).toHaveLength(calls);

    source.recover('sv02');
    await drain();
    expect(memory.values.has(KEYS.retryAfter)).toBe(false);
    expect((await builder.manifest())?.sets).toEqual(['me05', 'sv02', 'sv01']);
  });

  it('gives up on a set after three failures and publishes the rest', async () => {
    const { builder, source, failures, drain } = setup(THREE_SETS);
    source.fail('sv01');
    await builder.refresh();
    await drain();
    expect(failures).toEqual(['set_cards', 'set_cards', 'set_cards']);
    const manifest = (await builder.manifest())!;
    expect(manifest.sets).toEqual(['me05', 'sv02']);
    expect(manifest.complete).toBe(true);
  });

  it('keeps the last good list when listing the sets fails', async () => {
    const { builder, source, failures, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    const published = await builder.manifest();
    advance(2 * DAY);
    source.failList(true);
    expect(await builder.refresh()).toBe(0);
    expect(failures).toEqual(['sets']);
    expect(await builder.manifest()).toEqual(published);
  });

  it('keeps a set whose cards TCGdex suddenly answers with none', async () => {
    const { builder, source, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    const published = (await builder.manifest())!;
    advance(DAY);
    source.setSets(
      THREE_SETS.map((set) => (set.id === 'sv02' ? { ...set, total: 0 } : set))
    );
    await builder.refresh();
    await drain();
    // Three failed attempts, then the stored cards stay.
    const manifest = (await builder.manifest())!;
    expect(manifest.cards).toBe(published.cards);
  });

  it('lists a set TCGdex has no cards for as empty, once', async () => {
    const { builder, source, drain, advance, failures } = setup([
      ...THREE_SETS,
      { id: 'jumbo', released: '2000-02-01', total: 160 },
    ]);
    source.setSets([
      ...THREE_SETS,
      { id: 'jumbo', released: '2000-02-01', total: 0 },
    ]);
    await builder.refresh();
    await drain();
    expect(failures).toEqual([]);
    expect((await builder.manifest())?.sets).toContain('jumbo');
    advance(DAY);
    source.calls.length = 0;
    await builder.refresh();
    expect(source.calls).toEqual(['sets']);
  });

  it('drops sets TCGdex no longer lists', async () => {
    const { builder, source, memory, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    advance(DAY);
    source.setSets(THREE_SETS.filter((set) => set.id !== 'sv02'));
    await builder.refresh();
    await drain();
    expect((await builder.manifest())?.sets).toEqual(['me05', 'sv01']);
    expect(setValues(memory.values).map(([key]) => key)).not.toContainEqual(
      expect.stringContaining('sv02')
    );
  });

  it('never changes a published body while a refresh refetches its sets', async () => {
    const { builder, source, memory, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    const first = (await builder.manifest())!;
    const firstBody = (await builder.body(first.version))!.join('');

    advance(DAY);
    source.setSets(
      THREE_SETS.map((set) => (set.id === 'sv02' ? { ...set, total: 5 } : set))
    );
    expect(await builder.refresh()).toBe(2);
    memory.takeAlarm();
    await builder.step(); // sv02, changed; not yet published
    expect(await builder.manifest()).toEqual(first);
    expect((await builder.body(first.version))!.join('')).toBe(firstBody);

    await drain();
    const second = (await builder.manifest())!;
    expect(second.version).not.toBe(first.version);
    expect(await builder.body(first.version)).toBeNull();
    const sets = (
      JSON.parse((await builder.body(second.version))!.join('')) as {
        sets: { id: string; cards: unknown[] }[];
      }
    ).sets;
    expect(sets.map((set) => [set.id, set.cards.length])).toEqual([
      ['me05', 4],
      ['sv02', 5],
      ['sv01', 3],
    ]);
    // One stored value per set: the replaced cards went with their version.
    expect(setValues(memory.values)).toHaveLength(3);
  });

  it('reads, and then moves on from, sets stored without their hash', async () => {
    const { builder, source, memory, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    // As the build before this one stored them.
    const stored = memory.values;
    const meta = stored.get(KEYS.meta) as Record<string, unknown>;
    const index = stored.get(KEYS.index) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [key, value] of setValues(stored)) {
      stored.delete(key);
      stored.set(
        KEYS.set(key.slice('catalog:set:'.length).split('@')[0]!),
        value
      );
    }
    const { keys: _keys, ...legacyMeta } = meta;
    stored.set(KEYS.meta, legacyMeta);
    stored.set(
      KEYS.index,
      Object.fromEntries(
        Object.entries(index).map(([id, { key: _key, ...entry }]) => [
          id,
          entry,
        ])
      )
    );
    const first = (await builder.manifest())!;
    const firstBody = (await builder.body(first.version))!.join('');
    expect(JSON.parse(firstBody).sets).toHaveLength(3);

    advance(DAY);
    source.setSets(
      THREE_SETS.map((set) => (set.id === 'sv02' ? { ...set, total: 5 } : set))
    );
    await builder.refresh();
    memory.takeAlarm();
    await builder.step();
    expect((await builder.body(first.version))!.join('')).toBe(firstBody);
    await drain();
    const second = (await builder.manifest())!;
    expect(
      (
        JSON.parse((await builder.body(second.version))!.join('')) as {
          sets: unknown[];
        }
      ).sets
    ).toHaveLength(3);
    expect(stored.has(KEYS.set('sv02'))).toBe(false);
    expect(setValues(stored)).toHaveLength(3);
  });

  it('asks for a fresh list once the stored one is over a day old', async () => {
    const { builder, drain, advance } = setup(THREE_SETS);
    await builder.refresh();
    await drain();
    expect(await builder.needsRefresh()).toBe(false);
    advance(CARD_CATALOG_LIMITS.staleAfterMs + 1);
    expect(await builder.needsRefresh()).toBe(true);
  });

  it('starts one refresh for requests that all found it stale', async () => {
    const { builder, source, drain, advance } = setup(THREE_SETS);
    await Promise.all(Array.from({ length: 10 }, () => builder.refreshIfDue()));
    expect(source.calls.filter((call) => call === 'sets')).toHaveLength(1);
    await drain();
    advance(CARD_CATALOG_LIMITS.staleAfterMs + 1);
    source.calls.length = 0;
    await Promise.all(Array.from({ length: 10 }, () => builder.refreshIfDue()));
    expect(source.calls.filter((call) => call === 'sets')).toHaveLength(1);
    // The cron's refresh runs whatever.
    await builder.refresh();
    expect(source.calls.filter((call) => call === 'sets')).toHaveLength(2);
  });

  it('never runs two pieces of work at once', async () => {
    const { builder, source, drain } = setup(THREE_SETS);
    await Promise.all([builder.refresh(), builder.refresh(), builder.step()]);
    await drain();
    expect(source.calls.filter((call) => call === 'sets')).toHaveLength(2);
    expect(
      source.calls.filter((call) => call.startsWith('cards:'))
    ).toHaveLength(3);
  });

  it('refuses an answer larger than its bound', async () => {
    const memory = memoryStore();
    const failures: string[] = [];
    const builder = new CardCatalogBuilder({
      store: memory.store,
      fetch: (async () =>
        new Response(
          'x'.repeat(CARD_CATALOG_LIMITS.responseBytes + 1)
        )) as unknown as typeof fetch,
      now: () => NOW,
      sha256,
      onFailure: (stage) => failures.push(stage),
    });
    expect(await builder.refresh()).toBe(0);
    expect(failures).toEqual(['sets']);
  });
});
