import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { parsePastedDecklist } from '@ptcgsim/deck-core';
import { describe, expect, it, vi } from 'vitest';

import {
  LEGACY_POPULAR_DECKLIST_SOURCE_SHA256,
  PopularDecklistError,
  createPopularDecklistSource,
  decodePopularDecklists,
  popularDecklistSource,
} from './popular-decklists.js';

const smallCorpus = () => ({
  First: {
    Alpha: '\n1 Alpha BRS 1',
    Beta: '\n1 Beta BRS 2',
  },
  Second: {
    Gamma: '\n1 Gamma BRS 3',
  },
});

/**
 * Sets newer than v1's card-type table, which ends at Phantasmal Flames.
 * The importer's local half can't type their cards; the catalog does.
 */
const SETS_AFTER_V1_TYPES = new Set(['ASC', 'POR', 'CRI', 'PBL']);

describe('popular deck-list source', () => {
  it('loads the checked-in corpus lazily in menu order', async () => {
    // v1's own lists, which the corpus began as, are still where they came
    // from; the corpus has grown past them.
    const legacySource = await readFile(
      new URL(
        '../../../../../client/src/setup/deck-constructor/sample.decklists.js',
        import.meta.url
      )
    );
    expect(createHash('sha256').update(legacySource).digest('hex')).toBe(
      LEGACY_POPULAR_DECKLIST_SOURCE_SHA256
    );
    const collection = await popularDecklistSource.load();

    expect(collection.groups.map((group) => group.name)).toEqual([
      '2025-2026 ME',
      '2024-2025 S&V',
      '2023-2024 S&V',
      '2022-2023 S&S',
      '2021-2022 S&S',
      '2020-2021 S&S',
      '2019-2020 S&S',
      '2018-2019 S&M',
      '2017-2018 S&M',
      '2016-2017 S&M',
      '2015-2016 X&Y',
      '2014-2015 X&Y',
      '2013-2014 X&Y',
      '2012-2013 B&W',
      '2011-2012 B&W',
      '2010-2011 HS',
      '2007-2009 D&P/P',
      '2003-2007 ex',
      '2003 e-Card',
      '2000-2002 Neo-On',
      '2000 Prop 15/3',
      '2000 Base-Gym',
      '2000 Base–Team R',
      '1999 Base-Fossil',
      'GLC',
      'Legacy (HGSS–LTR)',
    ]);
    expect(collection.deckCount).toBe(353);
    expect(collection.totalDecklistCodeUnits).toBe(289_078);
    expect(collection.groups[0]?.decks[0]?.name).toBe('Dragapult ex');
    expect(collection.groups[0]?.decks[0]?.decklist).toContain(
      '4 Dreepy ASC 158'
    );
    // v1's first list keeps its place in its season.
    expect(collection.groups[2]?.decks[0]?.name).toBe('Charizard');
    expect(collection.groups[2]?.decks[0]?.decklist).toContain(
      '3 Charmander MEW 4'
    );
    expect(collection.groups.at(-1)?.decks.at(-1)?.name).toBe(
      'Ninetales Amoonguss'
    );
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.groups)).toBe(true);
    expect(Object.isFrozen(collection.groups[0]?.decks)).toBe(true);
  });

  it('keeps every list at 60 cards, each line with an image and a type', async () => {
    const collection = await popularDecklistSource.load();
    const untyped: string[] = [];
    for (const group of collection.groups) {
      for (const deck of group.decks) {
        const parsed = parsePastedDecklist(deck.decklist);
        expect(parsed.ok, `${group.name} / ${deck.name}`).toBe(true);
        if (!parsed.ok) continue;
        expect(
          parsed.rows.reduce((total, row) => total + row.quantity, 0),
          `${group.name} / ${deck.name}`
        ).toBe(60);
        for (const row of parsed.rows) {
          // A card from a set newer than v1's type table is typed by the
          // catalog, by its set and number.
          const newer =
            row.setCode !== undefined &&
            row.number !== undefined &&
            SETS_AFTER_V1_TYPES.has(row.setCode);
          if (!row.imageUrl || (row.cardType === 'Unknown' && !newer)) {
            untyped.push(`${group.name} / ${deck.name}: ${row.name}`);
          }
        }
      }
    }
    expect(untyped).toEqual([]);
  });

  it('does no work before first use and shares one decode across callers', async () => {
    const loader = vi.fn(async () => ({ default: smallCorpus() }));
    const source = createPopularDecklistSource(loader);

    expect(loader).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([source.load(), source.load()]);
    expect(loader).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(await source.load()).toBe(first);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('preserves the source two-draw random selection order', async () => {
    const source = createPopularDecklistSource(async () => smallCorpus());
    const firstRandom = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    await expect(source.selectRandom({ random: firstRandom })).resolves.toEqual(
      {
        name: 'Beta',
        decklist: '\n1 Beta BRS 2',
      }
    );
    expect(firstRandom).toHaveBeenCalledTimes(2);

    const lastRandom = vi
      .fn()
      .mockReturnValueOnce(0.999_999)
      .mockReturnValueOnce(0.999_999);
    await expect(source.selectRandom({ random: lastRandom })).resolves.toEqual({
      name: 'Gamma',
      decklist: '\n1 Gamma BRS 3',
    });
  });

  it('rejects malformed, oversized, and invalid-random data without caching failure', async () => {
    expect(() => decodePopularDecklists({ Empty: {} })).toThrowError(
      expect.objectContaining({ code: 'invalid_corpus' })
    );
    expect(() =>
      decodePopularDecklists({ TooLarge: { Deck: 'x'.repeat(8_193) } })
    ).toThrowError(expect.objectContaining({ code: 'corpus_too_large' }));

    const loader = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(smallCorpus());
    const source = createPopularDecklistSource(loader);
    await expect(source.load()).rejects.toEqual(
      expect.objectContaining({ code: 'load_failed' })
    );
    await expect(source.load()).resolves.toMatchObject({ deckCount: 3 });
    expect(loader).toHaveBeenCalledTimes(2);
    await expect(source.selectRandom({ random: () => 1 })).rejects.toEqual(
      expect.objectContaining({ code: 'invalid_random_source' })
    );
  });

  it('makes aborted callers inert without poisoning a shared successful load', async () => {
    let finish: ((value: unknown) => void) | undefined;
    const source = createPopularDecklistSource(
      async () => await new Promise<unknown>((resolve) => (finish = resolve))
    );
    const controller = new AbortController();
    const aborted = source.load({ signal: controller.signal });
    const current = source.load();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    finish?.(smallCorpus());

    await expect(aborted).rejects.toBeInstanceOf(PopularDecklistError);
    await expect(aborted).rejects.toEqual(
      expect.objectContaining({ code: 'aborted' })
    );
    await expect(current).resolves.toMatchObject({ deckCount: 3 });
  });
  it('puts current tournament groups first, credited, and lets Random pick them', async () => {
    const source = createPopularDecklistSource(
      async () => smallCorpus(),
      async () =>
        decodePopularDecklists({
          'Current Standard': {
            'Dragapult — 1st of 300': '\n4 Dreepy TWM 128',
          },
          // A name the built-in corpus already uses is left out.
          First: { Zeta: '\n1 Zeta BRS 9' },
        }).groups.map((group) => ({
          ...group,
          source: { name: 'Limitless', url: 'https://x', fetchedAt: 'today' },
        }))
    );
    const collection = await source.load();
    expect(collection.groups.map((group) => group.name)).toEqual([
      'Current Standard',
      'First',
      'Second',
    ]);
    expect(collection.groups[0]!.source?.name).toBe('Limitless');
    expect(collection.groups[1]!.source).toBeUndefined();
    expect(collection.deckCount).toBe(4);
    expect(await source.load()).toBe(collection);
    await expect(
      source.selectRandom({ random: () => 0 })
    ).resolves.toMatchObject({ name: 'Dragapult — 1st of 300' });
  });

  it('falls back to the built-in groups when current ones cannot load, and retries later', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const current = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        decodePopularDecklists({ Current: { Deck: '\n1 Deck BRS 1' } }).groups
      );
    const source = createPopularDecklistSource(
      async () => smallCorpus(),
      current
    );
    expect((await source.load()).groups).toHaveLength(2);
    // Within a minute the failure stands; after it, one more try.
    now += 30_000;
    expect((await source.load()).groups).toHaveLength(2);
    expect(current).toHaveBeenCalledOnce();
    now += 31_000;
    expect((await source.load()).groups.map((group) => group.name)).toEqual([
      'Current',
      'First',
      'Second',
    ]);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('loads ahead without holding a failed fetch against the screen', async () => {
    const current = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        decodePopularDecklists({ Current: { Deck: '\n1 Deck BRS 1' } }).groups
      );
    const source = createPopularDecklistSource(
      async () => smallCorpus(),
      current
    );
    expect(source.peek!()).toBeUndefined();
    expect((await source.prefetch!()).groups).toHaveLength(2);
    // Failed ahead: nothing settled to show, and the screen asks again.
    expect(source.peek!()).toBeUndefined();
    const collection = await source.load();
    expect(collection.groups.map((group) => group.name)).toEqual([
      'Current',
      'First',
      'Second',
    ]);
    expect(current).toHaveBeenCalledTimes(2);
    // Settled: a screen draws it at once.
    expect(source.peek!()).toBe(collection);
  });

  it('can run without current groups at all', async () => {
    const source = createPopularDecklistSource(async () => smallCorpus(), null);
    expect((await source.load()).groups).toHaveLength(2);
  });
});
