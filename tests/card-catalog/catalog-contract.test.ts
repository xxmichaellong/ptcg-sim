/**
 * The card catalog's two halves agree: what the server builds from TCGdex
 * (apps/server/src/card-catalog) is what the browser decodes
 * (packages/deck-core/src/catalog-wire.ts), end to end through the body the
 * server assembles.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CardCatalogBuilder,
  type CatalogStore,
} from '../../apps/server/src/card-catalog/builder.js';
import { catalogNumber } from '../../apps/server/src/card-catalog/normalize.js';
import {
  catalogNumberOf,
  decodeCatalog,
} from '../../packages/deck-core/src/catalog-wire.js';

const sets = [
  {
    id: 'sv04',
    name: 'Paradox Rift',
    releaseDate: '2023-11-03',
    serie: { id: 'sv', name: 'Scarlet & Violet' },
    cardCount: { official: 182, total: 266 },
  },
  {
    id: 'me03',
    name: 'Perfect Order',
    releaseDate: '2026-03-27',
    serie: { id: 'me', name: 'Mega Evolution' },
    cardCount: { official: 88, total: 124 },
  },
  {
    id: 'sve',
    name: 'Scarlet & Violet Energy',
    releaseDate: '2023-03-31',
    serie: { id: 'sv', name: 'Scarlet & Violet' },
    cardCount: { official: 24, total: 24 },
  },
  {
    id: 'swshp',
    name: 'SWSH Black Star Promos',
    releaseDate: '2019-11-15',
    serie: { id: 'swsh', name: 'Sword & Shield' },
    cardCount: { official: 307, total: 307 },
  },
];

const cards: Record<string, unknown[]> = {
  sv04: [
    {
      id: 'sv04-163',
      localId: '163',
      name: 'Earthen Vessel',
      category: 'Trainer',
      trainerType: 'Item',
      effect: 'Search your deck for up to 2 Basic Energy cards.',
      regulationMark: 'G',
      legal: { standard: false, expanded: true },
      image: 'https://assets.tcgdex.net/en/sv/sv04/163',
      rarity: 'Uncommon',
    },
    {
      id: 'sv04-176',
      localId: '176',
      name: 'Judge',
      category: 'Trainer',
      trainerType: 'Supporter',
      effect:
        'Each player shuffles their hand into their deck and draws 4 cards.',
      regulationMark: 'G',
      legal: { standard: false, expanded: true },
      image: 'https://assets.tcgdex.net/en/sv/sv04/176',
    },
  ],
  me03: [
    {
      id: 'me03-076',
      localId: '076',
      name: 'Judge',
      category: 'Trainer',
      trainerType: 'Supporter',
      effect:
        'Each player shuffles their hand into their deck and draws 4 cards.',
      regulationMark: 'J',
      legal: { standard: true, expanded: true },
      image: 'https://assets.tcgdex.net/en/me/me03/076',
    },
  ],
  sve: [
    {
      id: 'sve-005',
      localId: '005',
      name: 'Psychic Energy',
      category: 'Energy',
      energyType: 'Normal',
      image: null,
    },
  ],
  swshp: [
    {
      id: 'swshp-SWSH022',
      localId: 'SWSH022',
      name: 'Flapple',
      category: 'Pokemon',
      stage: 'Stage1',
      hp: 90,
      types: ['Grass'],
      evolveFrom: 'Applin',
      legal: { standard: false, expanded: true },
      image: 'https://assets.tcgdex.net/en/swsh/swshp/SWSH022',
    },
  ],
};

const tcgdex = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const query = JSON.parse(String(init?.body)).query as string;
  if (query.startsWith('{ sets')) return Response.json({ data: { sets } });
  const id = /id: "([^"]+)-"/u.exec(query)?.[1] ?? '';
  return Response.json({ data: { cards: cards[id] ?? [] } });
}) as typeof fetch;

const memory = (): { store: CatalogStore; alarm: () => number | null } => {
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    alarm: () => {
      const at = alarm;
      alarm = null;
      return at;
    },
    store: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      getMany: async <T>(keys: readonly string[]) =>
        new Map(
          keys
            .filter((key) => values.has(key))
            .map((key) => [key, values.get(key) as T])
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
    },
  };
};

describe('the card catalog contract', () => {
  it('decodes exactly what the server builds', async () => {
    const { store, alarm } = memory();
    let now = Date.parse('2026-10-15T06:17:00.000Z');
    const builder = new CardCatalogBuilder({
      store,
      fetch: tcgdex,
      now: () => now,
      sha256: async (value) => createHash('sha256').update(value).digest('hex'),
    });
    await builder.refresh();
    for (let at = alarm(); at !== null; at = alarm()) {
      now = Math.max(now, at);
      await builder.step();
    }
    const manifest = (await builder.manifest())!;
    const catalog = decodeCatalog(
      JSON.parse((await builder.body(manifest.version))!.join(''))
    );

    expect(catalog.builtAt).toBe(manifest.builtAt);
    expect(catalog.sets.map((set) => [set.id, set.code])).toEqual([
      ['me03', 'POR'],
      ['sv04', 'PAR'],
      ['sve', 'SVE'],
      ['swshp', 'SP'],
    ]);
    expect(catalog.cards.map((card) => card.id)).toEqual([
      'POR 76',
      'PAR 163',
      'PAR 176',
      'SVE 5',
      'SP 22',
    ]);
    // The rotated Judge is legal through its reprint; Earthen Vessel is not.
    expect(catalog.byId.get('PAR 176')?.legal.standard).toBe(true);
    expect(catalog.byId.get('PAR 163')?.legal).toEqual({
      standard: false,
      expanded: true,
    });
    // Flapple (SP 22) is banned in Expanded by the server's list.
    expect(catalog.byId.get('SP 22')).toMatchObject({
      name: 'Flapple',
      stage: 'Stage 1',
      hp: 90,
      types: ['Grass'],
      evolvesFrom: 'Applin',
      legal: { standard: false, expanded: false },
      image: 'https://assets.tcgdex.net/en/swsh/swshp/SWSH022/high.webp',
    });
    // No TCGdex image: Limitless's scan, by set code and number.
    expect(catalog.byId.get('SVE 5')?.image).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN_LG.png'
    );
    expect(catalog.byId.get('SVE 5')?.legal).toEqual({
      standard: true,
      expanded: true,
    });
  });

  it('writes TCGdex collector numbers the same way on both sides', () => {
    for (const [setId, localId] of [
      ['swshp', 'SWSH022'],
      ['smp', 'SM85'],
      ['xyp', 'XY01'],
      ['bwp', 'BW95'],
      ['hgssp', 'HGSS01'],
      ['dpp', 'DP40'],
      ['30th-c', '1'],
      ['sv04', '163'],
      ['swsh9', 'TG01'],
    ] as const) {
      expect(catalogNumberOf(setId, localId), `${setId} ${localId}`).toBe(
        catalogNumber(setId, localId)
      );
    }
  });
});
