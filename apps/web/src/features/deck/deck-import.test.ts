import type {
  CatalogCard,
  CatalogSet,
  LoadedCatalog,
} from '@ptcgsim/deck-core';
import { describe, expect, it, vi } from 'vitest';

import { importDeckText, suggestDeckName } from './deck-import.js';
import { LIMITLESS_DECKLIST_IMPORT_URL } from './limitless-decklist-contract.js';
import { completeRowsWithLimitless } from './pasted-decklist-import.js';

const set = (
  id: string,
  code: string,
  released: string,
  official = 200
): CatalogSet => ({
  id,
  code,
  name: `Set ${code}`,
  series: 'Scarlet & Violet',
  released,
  official,
});

const TWM = set('sv06', 'TWM', '2024-05-24', 167);
const MEE = set('mee', 'MEE', '2025-09-25', 8);
const POR = set('me03', 'POR', '2026-03-27', 124);

const card = (
  cardSet: CatalogSet,
  number: string,
  name: string,
  extra: Partial<CatalogCard> = {}
): CatalogCard => ({
  id: `${cardSet.code} ${number}`,
  name,
  category: 'Pokémon',
  set: cardSet,
  number,
  image: `https://assets/${cardSet.id}/${number}/high.webp`,
  imageSmall: `https://assets/${cardSet.id}/${number}/low.webp`,
  tags: [],
  types: [],
  abilities: [],
  attacks: [],
  dex: [],
  legal: { standard: true, expanded: true },
  printGroup: name,
  stage: 'Basic',
  ...extra,
});

const CARDS = [
  card(TWM, '128', 'Dreepy'),
  card(TWM, '129', 'Drakloak', { stage: 'Stage 1', evolvesFrom: 'Dreepy' }),
  card(TWM, '130', 'Dragapult ex', {
    stage: 'Stage 2',
    evolvesFrom: 'Drakloak',
    tags: ['ex', 'Tera'],
  }),
  card(POR, '76', 'Judge', {
    category: 'Trainer',
    stage: undefined,
    trainerType: 'Supporter',
  }),
  card(MEE, '2', 'Fire Energy', {
    category: 'Energy',
    stage: undefined,
    energyType: 'Basic',
  }),
];

const catalog: LoadedCatalog = {
  builtAt: '2026-10-15T00:00:00Z',
  cards: CARDS,
  sets: [TWM, MEE, POR],
  byId: new Map(CARDS.map((entry) => [entry.id, entry])),
  byName: new Map(),
};

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });

const LIST = `Pokémon: 7
4 Dreepy TWM 128
3 Dragapult ex TWM 130

Trainer: 2
2 Judge POR 76

Energy: 4
4 Fire Energy MEE 10`;

describe('importing a decklist', () => {
  it('places every line against the catalog, offline and in one step', async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    const result = await importDeckText(LIST, { catalog, fetch: fetchRequest });
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      name: 'Dragapult ex',
      format: 'standard',
      missing: [],
    });
    if (!result.ok) return;
    expect(result.cards.map((entry) => [entry.card.id, entry.count])).toEqual([
      ['TWM 128', 4],
      ['TWM 130', 3],
      ['POR 76', 2],
      ['MEE 2', 4],
    ]);
    // The catalog's facts come along, so the rules can check the deck.
    expect(result.cards[1]!.card.facts).toMatchObject({
      stage: 'Stage 2',
      evolvesFrom: 'Drakloak',
      line: 'Dreepy',
      legal: { standard: true },
    });
  });

  it('asks Limitless only about lines the catalog cannot place', async () => {
    const fetchRequest = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        cards: [
          {
            name: 'Mystery Card',
            set: 'XYZ',
            number: '7',
            region: 'int',
            card_type: 'trainer',
          },
        ],
      })
    );
    const result = await importDeckText(
      `${LIST}\n1 Mystery Card\n2 Nothing At All`,
      {
        catalog,
        fetch: fetchRequest,
      }
    );
    expect(fetchRequest).toHaveBeenCalledOnce();
    const [url, request] = fetchRequest.mock.calls[0]!;
    expect(url).toBe(LIMITLESS_DECKLIST_IMPORT_URL);
    expect(JSON.parse(String(request?.body))).toEqual({
      input: '1 Mystery Card\n2 Nothing At All',
    });
    expect(result.ok && result.cards.at(-1)).toMatchObject({
      count: 1,
      card: {
        name: 'Mystery Card',
        category: 'Trainer',
        image:
          'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/XYZ/XYZ_007_R_EN.png',
      },
    });
    // What nobody knows comes back to look at, and the rest still imports.
    expect(result.ok && result.missing).toEqual([
      { quantity: 2, name: 'Nothing At All' },
    ]);
  });

  it('takes a printing the catalog lacks as the line says, never another card of its name', async () => {
    // The catalog has Dreepy, but not this printing of it.
    const fetchRequest = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        cards: [
          {
            name: 'Dreepy',
            set: 'PGO',
            number: '99',
            region: 'int',
            card_type: 'pokemon',
          },
        ],
      })
    );
    const result = await importDeckText('4 Dreepy PGO 99', {
      catalog,
      fetch: fetchRequest,
    });
    expect(result.ok && result.cards[0]!.card).toMatchObject({
      id: 'PGO 99',
      name: 'Dreepy',
      image: expect.stringContaining('/tpci/PGO/PGO_099_R_EN'),
    });
    expect(result.ok && result.missing).toEqual([]);
  });

  it("takes an old list's id the catalog lacks as the line says too", async () => {
    // The catalog has Dreepy, but not the printing this id names.
    const fetchRequest = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        cards: [
          { name: 'Dreepy', set: 'TWM', number: '128', card_type: 'pokemon' },
        ],
      })
    );
    const result = await importDeckText('4 Dreepy xy99-12', {
      catalog,
      fetch: fetchRequest,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.cards[0]!.card.id).not.toBe('TWM 128');
    expect(result.cards[0]!.card).toMatchObject({
      name: 'Dreepy',
      image: 'https://images.pokemontcg.io/xy99/12_hires.png',
    });
  });

  it('keeps going without the catalog, and without Limitless', async () => {
    const result = await importDeckText('2 Arceus V BRS 122\n1 Who Knows', {
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('offline');
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      missing: [{ quantity: 1, name: 'Who Knows' }],
    });
    expect(result.ok && result.cards[0]!.card).toMatchObject({
      id: 'BRS 122',
      name: 'Arceus V',
      image:
        'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_122_R_EN.png',
    });
  });

  it('reads simulator CSV files, getting catalogued cards their facts back', async () => {
    const csv =
      'QTY,Name,Type,URL\n4,Dreepy,Pokémon,https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_128_R_EN.png\n1,Homemade,Trainer,https://example.com/x.png';
    const result = await importDeckText(csv, { catalog });
    expect(result.ok && result.cards.map((entry) => entry.card.id)).toEqual([
      'TWM 128',
      expect.stringMatching(/^custom:/u),
    ]);
    // The file's own image is kept, small as well as large.
    expect(result.ok && result.cards[0]!.card.image).toContain('limitlesstcg');
    expect(result.ok && result.cards[0]!.card.imageSmall).toBeUndefined();
    expect(result.ok && result.cards[0]!.card.facts?.stage).toBe('Basic');
  });

  it('keeps two scans of one printing apart, and a row typed by hand as typed', async () => {
    const scan = (language: string) =>
      `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TWM/TWM_128_R_${language}.png`;
    const csv = `QTY,Name,Type,URL\n2,Dreepy,Pokémon,${scan('EN')}\n2,Dreepy,Pokémon,${scan('DE')}\n1,Dreepy,Trainer,${scan('JP')}`;
    const result = await importDeckText(csv, { catalog });
    if (!result.ok) throw new Error(result.message);
    expect(
      result.cards.map((entry) => [entry.card.image, entry.count])
    ).toEqual([
      [scan('EN'), 2],
      [scan('DE'), 2],
      [scan('JP'), 1],
    ]);
    expect(new Set(result.cards.map((entry) => entry.card.id)).size).toBe(3);
    // The scans are still the catalogued card; the Trainer is the file's.
    expect(result.cards[1]!.card.facts?.stage).toBe('Basic');
    expect(result.cards[2]!.card).toMatchObject({ category: 'Trainer' });
    expect(result.cards[2]!.card.facts).toBeUndefined();
  });

  it('names a deck from its header or its main attackers', async () => {
    const named = await importDeckText(`### Spooky Ghosts\n${LIST}`, {
      catalog,
    });
    expect(named.ok && named.name).toBe('Spooky Ghosts');
    const mon = (name: string, stage: string, count: number) => ({
      card: {
        id: name,
        name,
        category: 'Pokémon' as const,
        image: 'x',
        facts: { stage },
      },
      count,
    });
    expect(
      suggestDeckName([
        mon('Pidgey', 'Basic', 2),
        mon('Charizard ex', 'Stage 2', 3),
        mon('Pidgeot ex', 'Stage 2', 2),
        mon('Fezandipiti ex', 'Basic', 1),
      ])
    ).toBe('Charizard ex / Pidgeot ex');
    // A one-of support ex is not what the deck is.
    expect(
      suggestDeckName([
        mon('Dragapult ex', 'Stage 2', 3),
        mon('Fezandipiti ex', 'Basic', 1),
      ])
    ).toBe('Dragapult ex');
    expect(
      suggestDeckName([
        mon('Raging Bolt ex', 'Basic', 4),
        mon('Teal Mask Ogerpon ex', 'Basic', 4),
      ])
    ).toBe('Raging Bolt ex / Teal Mask Ogerpon ex');
    expect(
      suggestDeckName([
        {
          card: { id: 'a', name: 'Pikachu', category: 'Pokémon', image: 'x' },
          count: 4,
        },
      ])
    ).toBe('Pikachu deck');
  });

  it('refuses text with no cards, and lines that break the bounds', async () => {
    expect(await importDeckText('   ')).toMatchObject({
      ok: false,
      reason: 'empty',
    });
    expect(await importDeckText('Pokémon: 0\n\nnot a card line')).toMatchObject(
      { ok: false, reason: 'empty' }
    );
    expect(await importDeckText('0 Pikachu SVI 1')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await importDeckText(LIST, { signal: aborted.signal })
    ).toMatchObject({ ok: false, reason: 'aborted' });
  });
});

describe('the Limitless fallback', () => {
  it('contains a provider failure and says why', async () => {
    const completion = await completeRowsWithLimitless(
      [{ quantity: 1, name: 'Unknown', cardType: 'Unknown' }],
      'legacy',
      {
        fetch: vi.fn<typeof fetch>(
          async () => new Response('', { status: 503 })
        ),
      }
    );
    expect(completion.rows).toEqual([
      { quantity: 1, name: 'Unknown', cardType: 'Unknown' },
    ]);
    expect(completion.failure).toMatchObject({
      code: 'request_failed',
      status: 503,
    });
  });

  it('asks nothing when every row is complete', async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    const rows = [
      { quantity: 1, name: 'A', cardType: 'Trainer' as const, imageUrl: 'x' },
    ];
    expect(
      await completeRowsWithLimitless(rows, 'legacy', { fetch: fetchRequest })
    ).toEqual({ rows });
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});
