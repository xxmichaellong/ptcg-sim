import { describe, expect, it, vi } from 'vitest';

import {
  CurrentDeckFeedError,
  decklistText,
  fetchCurrentDeckFeed,
  readStoredCurrentDeckFeed,
} from './current-decks.js';

const NOW = Date.parse('2026-10-14T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A legal 60-card list: 4 + 4 + 52 basic Energy. */
const list = (main: string, energy = 52) => ({
  pokemon: [
    { count: 4, name: main, set: 'TWM', number: '128' },
    { count: 4, name: 'Pidgey', set: 'MEW', number: '16' },
  ],
  trainer: [],
  energy: [{ count: energy, name: 'Psychic Energy', set: 'MEE', number: '13' }],
});

const id = (n: number) => n.toString(16).padStart(24, '0');

const tournament = (n: number, players: number, ageMs: number) => ({
  id: id(n),
  game: 'PTCG',
  format: 'STANDARD',
  name: `Event ${String(n)}`,
  date: new Date(NOW - ageMs).toISOString(),
  players,
});

const standing = (
  placing: number | null,
  archetype: { id: string; name: string } | null,
  decklist: unknown
) => ({ placing, deck: archetype, decklist, name: 'Player' });

const dragapult = { id: 'dragapult', name: 'Dragapult' };
const gardevoir = { id: 'gardevoir', name: 'Gardevoir' };

/** A fake Limitless serving canned JSON by path. */
const limitless = (routes: Record<string, unknown>, status = 200) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = routes[url.pathname + url.search] ?? routes[url.pathname];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status });
  });

const LIST = '/api/tournaments?game=PTCG&format=STANDARD&limit=300';

describe('current deck feed', () => {
  it('keeps the best top-8 list of each archetype from big, finished, recent events', async () => {
    const fetch = limitless({
      [LIST]: [
        tournament(1, 300, 2 * DAY),
        tournament(2, 120, 3 * DAY),
        // Still running, too small, or too old: never read.
        tournament(3, 500, 2 * HOUR),
        tournament(4, 40, 2 * DAY),
        tournament(5, 400, 20 * DAY),
      ],
      [`/api/tournaments/${id(1)}/standings`]: [
        standing(1, gardevoir, list('Ralts')),
        standing(2, dragapult, list('Dreepy')),
        standing(5, dragapult, list('Drakloak')),
        // Outside the top 8, no archetype, the catch-all, or not 60 cards.
        standing(9, { id: 'lucario', name: 'Lucario' }, list('Riolu')),
        standing(3, null, list('Eevee')),
        standing(4, { id: 'other', name: 'Other' }, list('Ditto')),
        standing(6, { id: 'pidgeot', name: 'Pidgeot' }, list('Pidgey', 51)),
        standing(null, dragapult, list('Dreepy')),
      ],
      [`/api/tournaments/${id(2)}/standings`]: [
        standing(1, dragapult, list('Duskull')),
      ],
    });
    const feed = await fetchCurrentDeckFeed({ fetch, now: () => NOW });

    const requested = fetch.mock.calls.map(([input]) => String(input));
    expect(requested).toEqual([
      `https://play.limitlesstcg.com${LIST}`,
      `https://play.limitlesstcg.com/api/tournaments/${id(1)}/standings`,
      `https://play.limitlesstcg.com/api/tournaments/${id(2)}/standings`,
    ]);
    expect(feed.fetchedAt).toBe('2026-10-14T00:00:00.000Z');
    const group = feed.groups['Current Standard']!;
    // Dragapult made three top 8s, Gardevoir one; each keeps its best finish
    // (a 1st beats a 2nd, even at a smaller event).
    expect(Object.keys(group)).toEqual([
      'Dragapult — 1st of 120',
      'Gardevoir — 1st of 300',
    ]);
    expect(group['Dragapult — 1st of 120']).toBe(
      [
        'Pokémon (8)',
        '4 Duskull TWM 128',
        '4 Pidgey MEW 16',
        '',
        'Energy (52)',
        '52 Psychic Energy MEE 13',
      ].join('\n')
    );
  });

  it('sends the API key only when one is configured', async () => {
    const routes = {
      [LIST]: [tournament(1, 300, 2 * DAY)],
      [`/api/tournaments/${id(1)}/standings`]: [
        standing(1, dragapult, list('Dreepy')),
      ],
    };
    const keyless = limitless(routes);
    await fetchCurrentDeckFeed({ fetch: keyless, now: () => NOW });
    const keyed = limitless(routes);
    await fetchCurrentDeckFeed({ fetch: keyed, now: () => NOW, apiKey: 'k' });
    const header = (fetch: typeof keyless) =>
      new Headers(fetch.mock.calls[0]![1]?.headers).get('X-Access-Key');
    expect(header(keyless)).toBeNull();
    expect(header(keyed)).toBe('k');
  });

  it('fails rather than storing an empty feed', async () => {
    await expect(
      fetchCurrentDeckFeed({
        fetch: limitless({ [LIST]: [tournament(1, 10, 2 * DAY)] }),
        now: () => NOW,
      })
    ).rejects.toMatchObject({ code: 'no_decks' });
    await expect(
      fetchCurrentDeckFeed({
        fetch: limitless({ [LIST]: [] }, 503),
        now: () => NOW,
      })
    ).rejects.toMatchObject({ code: 'request_failed' });
    await expect(
      fetchCurrentDeckFeed({
        fetch: limitless({ [LIST]: { tournaments: [] } }),
        now: () => NOW,
      })
    ).rejects.toBeInstanceOf(CurrentDeckFeedError);
    await expect(
      fetchCurrentDeckFeed({
        fetch: vi.fn(async () => {
          throw new TypeError('offline');
        }),
        now: () => NOW,
      })
    ).rejects.toMatchObject({ code: 'request_failed' });
  });

  it('refuses an oversized response', async () => {
    const huge = `[${'"x",'.repeat(1_100_000)}"x"]`;
    await expect(
      fetchCurrentDeckFeed({
        fetch: vi.fn(async () => new Response(huge)),
        now: () => NOW,
      })
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('decklist text', () => {
  it('keeps only whole, well-formed lists', () => {
    expect(decklistText(list('Dreepy'))).toContain('Energy (52)');
    // A card line without a printing keeps just its name.
    expect(
      decklistText({
        ...list('Dreepy'),
        pokemon: [
          { count: 4, name: 'Dreepy' },
          { count: 4, name: 'Pidgey', set: 'MEW', number: '16' },
        ],
      })
    ).toContain('\n4 Dreepy\n');
    expect(decklistText(list('Dreepy', 53))).toBeNull();
    expect(decklistText(list('Bad\nName'))).toBeNull();
    expect(decklistText({ ...list('Dreepy'), trainer: 'x' })).toBeNull();
    expect(
      decklistText({
        ...list('Dreepy'),
        pokemon: [{ count: 0, name: 'Dreepy' }],
      })
    ).toBeNull();
    expect(decklistText(null)).toBeNull();
  });
});

describe('stored feed', () => {
  it('reads back only a feed this version wrote', () => {
    const feed = {
      version: 1,
      fetchedAt: '2026-10-14T00:00:00.000Z',
      groups: { Standard: { Dragapult: 'list' } },
    };
    expect(readStoredCurrentDeckFeed(feed)).toBe(feed);
    expect(readStoredCurrentDeckFeed({ ...feed, version: 2 })).toBeNull();
    expect(readStoredCurrentDeckFeed({ ...feed, fetchedAt: 'x' })).toBeNull();
    expect(
      readStoredCurrentDeckFeed({ ...feed, groups: { Standard: { a: 1 } } })
    ).toBeNull();
    expect(readStoredCurrentDeckFeed(undefined)).toBeNull();
  });
});
