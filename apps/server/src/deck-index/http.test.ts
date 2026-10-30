import { describe, expect, it, vi } from 'vitest';

import {
  deckIndexRoute,
  handleDeckIndexRequest,
  type DeckIndexReader,
  type DeckIndexRoute,
} from './http.js';

const id = 'a'.repeat(24);
const summary = {
  id,
  name: 'Weekly',
  date: '2026-10-21T19:00:00.000Z',
  format: 'STANDARD' as const,
  players: 67,
  organizer: null,
  hasLists: true,
};
const finish = {
  tournament: {
    id,
    name: 'Weekly',
    date: '2026-10-21T19:00:00.000Z',
    players: 67,
    format: 'STANDARD',
    kind: 'online' as const,
  },
  player: { id: 'redthegoat', name: 'REDTHEGOAT', country: 'FR' },
  placing: 1,
  record: { wins: 8, losses: 2, ties: 0 },
};
const archetype = {
  id: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  icons: ['dragapult', 'dusknoir'],
};

const reader = (overrides: Partial<DeckIndexReader> = {}): DeckIndexReader => ({
  search: vi.fn(async () => ({
    available: true as const,
    updatedAt: '2026-10-22T06:00:00.000Z',
    results: [{ archetype, lists: 12, top8s: 3, best: [finish] }],
  })),
  archetype: vi.fn(async () => ({
    kind: 'ok' as const,
    archetype,
    finishes: [finish],
    next: {
      major: true,
      placing: 1,
      players: 64,
      date: Date.parse('2026-10-01T00:00:00.000Z'),
      tournamentId: id,
      playerId: 'p',
    },
  })),
  tournaments: vi.fn(async () => ({
    tournaments: [summary],
    next: { date: Date.parse(summary.date), id },
  })),
  tournament: vi.fn(async () => ({
    kind: 'ok' as const,
    tournament: summary,
    standings: [],
    settled: true,
  })),
  playerList: vi.fn(async () => ({
    kind: 'ok' as const,
    text: 'Pokémon (4)\n4 Dreepy TWM 128',
    archetype,
    player: finish.player,
    tournament: summary,
    settled: true,
  })),
  ...overrides,
});

const get = async (
  path: string,
  index: DeckIndexReader = reader(),
  method = 'GET'
) => {
  const url = new URL(`https://play.example${path}`);
  const route = deckIndexRoute(url.pathname);
  if (route === undefined) throw new Error(`not a deck index path: ${path}`);
  return handleDeckIndexRequest(new Request(url, { method }), route, index);
};

describe('deck index routes', () => {
  it('names only its own paths, and refuses a malformed id', () => {
    expect(deckIndexRoute('/v2/decks/search')).toEqual({ kind: 'search' });
    expect(deckIndexRoute('/v2/decks/archetype/dragapult-dusknoir')).toEqual({
      kind: 'archetype',
      id: 'dragapult-dusknoir',
    });
    expect(deckIndexRoute('/v2/tournaments')).toEqual({ kind: 'tournaments' });
    expect(deckIndexRoute(`/v2/tournaments/${id}`)).toEqual({
      kind: 'tournament',
      id,
    });
    expect(
      deckIndexRoute(`/v2/tournaments/${id}/players/red.the_goat-1/list`)
    ).toEqual({ kind: 'player_list', id, playerId: 'red.the_goat-1' });
    expect(deckIndexRoute(`/v2/tournaments/${id}/players/a%2E1/list`)).toEqual({
      kind: 'player_list',
      id,
      playerId: 'a.1',
    });
    for (const path of [
      '/v2/decks/archetype/Bad Id',
      '/v2/decks/archetype/a%2Fb',
      '/v2/decks/archetype/',
      '/v2/tournaments/123',
      `/v2/tournaments/${id}/players/..%2F..%2Fx/list`,
      `/v2/tournaments/${id}/players/%E0%A4%A/list`,
      `/v2/tournaments/${id}/standings`,
    ]) {
      expect(deckIndexRoute(path), path).toBe('invalid');
    }
    expect(deckIndexRoute('/v2/decks/current')).toBeUndefined();
    expect(deckIndexRoute('/v2/health')).toBeUndefined();
  });

  it('searches with checked parameters and a five-minute cache', async () => {
    const index = reader();
    const response = await get(
      '/v2/decks/search?q=%20Dragapult%20&format=expanded&limit=3',
      index
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(index.search).toHaveBeenCalledWith('Dragapult', 'EXPANDED', 3, {});
    expect(await response.json()).toEqual({
      available: true,
      updatedAt: '2026-10-22T06:00:00.000Z',
      results: [{ archetype, lists: 12, top8s: 3, best: [finish] }],
    });
    await get('/v2/decks/search?q=x', index);
    expect(index.search).toHaveBeenLastCalledWith('x', 'STANDARD', 8, {});
    // Majors alone, as the tournaments list asks for them.
    await get('/v2/decks/search?q=x&kind=major', index);
    expect(index.search).toHaveBeenLastCalledWith('x', 'STANDARD', 8, {
      majors: true,
    });
  });

  it('says the index is empty without caching that', async () => {
    const response = await get(
      '/v2/decks/search?q=x',
      reader({ search: vi.fn(async () => ({ available: false as const })) })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({ available: false });
  });

  it('refuses an unknown, repeated or malformed parameter', async () => {
    const index = reader();
    for (const path of [
      '/v2/decks/search',
      '/v2/decks/search?q=',
      `/v2/decks/search?q=${'x'.repeat(61)}`,
      '/v2/decks/search?q=a%0Ab',
      '/v2/decks/search?q=x&format=GLC',
      '/v2/decks/search?q=x&limit=0',
      '/v2/decks/search?q=x&limit=21',
      '/v2/decks/search?q=x&limit=1.5',
      '/v2/decks/search?q=x&q=y',
      '/v2/decks/search?q=x&page=2',
      '/v2/decks/search?q=x&kind=online',
      '/v2/decks/archetype/x?kind=majors',
      // A cursor from before majors came first (no `m`): refused.
      '/v2/decks/archetype/x?cursor=eyJwIjoxLCJuIjo2NCwiZCI6MSwidCI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsInUiOiJwIn0',
      '/v2/decks/archetype/x?since=0',
      '/v2/decks/archetype/x?cursor=%%%',
      '/v2/decks/archetype/x?cursor=eyJvIjotMX0',
      '/v2/tournaments?minPlayers=-1',
      '/v2/tournaments?cursor=eyJkIjoxfQ',
      `/v2/tournaments/${id}?x=1`,
      `/v2/tournaments/${id}/players/p/list?x=1`,
    ]) {
      const response = await get(path, index);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(index.search).not.toHaveBeenCalled();
    expect(index.archetype).not.toHaveBeenCalled();
  });

  it('refuses anything but GET', async () => {
    const response = await get('/v2/tournaments', reader(), 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  it('pages an archetype’s finishes with an opaque cursor', async () => {
    const index = reader();
    const first = await get(
      '/v2/decks/archetype/dragapult-dusknoir?since=30',
      index
    );
    expect(index.archetype).toHaveBeenCalledWith(
      'dragapult-dusknoir',
      'STANDARD',
      30,
      null,
      {}
    );
    const body = (await first.json()) as { nextCursor: string };
    expect(body).toEqual({
      archetype,
      finishes: [finish],
      nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/u),
    });
    await get(
      `/v2/decks/archetype/dragapult-dusknoir?cursor=${body.nextCursor}`,
      index
    );
    expect(index.archetype).toHaveBeenLastCalledWith(
      'dragapult-dusknoir',
      'STANDARD',
      90,
      {
        major: true,
        placing: 1,
        players: 64,
        date: Date.parse('2026-10-01T00:00:00.000Z'),
        tournamentId: id,
        playerId: 'p',
      },
      {}
    );
    await get(
      '/v2/decks/archetype/dragapult-dusknoir?kind=major&format=expanded',
      index
    );
    expect(index.archetype).toHaveBeenLastCalledWith(
      'dragapult-dusknoir',
      'EXPANDED',
      90,
      null,
      { majors: true }
    );
    const missing = await get(
      '/v2/decks/archetype/nope',
      reader({ archetype: vi.fn(async () => ({ kind: 'not_found' as const })) })
    );
    expect(missing.status).toBe(404);
  });

  it('lists tournaments a page at a time', async () => {
    const index = reader();
    const first = await get(
      '/v2/tournaments?q=weekly&format=STANDARD&minPlayers=32',
      index
    );
    expect(index.tournaments).toHaveBeenCalledWith({
      q: 'weekly',
      format: 'STANDARD',
      minimumPlayers: 32,
      before: null,
    });
    const body = (await first.json()) as { nextCursor: string };
    expect(body).toEqual({
      tournaments: [summary],
      nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/u),
    });
    await get(`/v2/tournaments?cursor=${body.nextCursor}`, index);
    expect(index.tournaments).toHaveBeenLastCalledWith({
      q: '',
      format: null,
      minimumPlayers: 0,
      before: { date: Date.parse(summary.date), id },
    });
  });

  it('gives a tournament’s standings with its source, cached a day once settled', async () => {
    const settled = await get(`/v2/tournaments/${id}`);
    expect(settled.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await settled.json()).toEqual({
      tournament: {
        ...summary,
        url: `https://play.limitlesstcg.com/tournament/${id}/standings`,
      },
      standings: [],
    });
    const live = await get(
      `/v2/tournaments/${id}`,
      reader({
        tournament: vi.fn(async () => ({
          kind: 'ok' as const,
          tournament: summary,
          standings: [],
          settled: false,
        })),
      })
    );
    expect(live.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('says when it is busy, and when there is no such tournament', async () => {
    const busy = await get(
      `/v2/tournaments/${id}`,
      reader({
        tournament: vi.fn(async () => ({
          kind: 'busy' as const,
          retryAfterMs: 41_200,
        })),
      })
    );
    expect(busy.status).toBe(503);
    expect(busy.headers.get('Retry-After')).toBe('42');
    expect(busy.headers.get('Cache-Control')).toContain('no-store');
    expect(await busy.json()).toEqual({ error: 'busy', retryAfter: 42 });
    const missing = await get(
      `/v2/tournaments/${id}`,
      reader({
        tournament: vi.fn(async () => ({ kind: 'not_found' as const })),
      })
    );
    expect(missing.status).toBe(404);
  });

  it('gives a player’s list as text, linked to where it was published', async () => {
    const index = reader();
    const response = await get(
      `/v2/tournaments/${id}/players/redthegoat/list`,
      index
    );
    expect(index.playerList).toHaveBeenCalledWith(id, 'redthegoat');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=604800'
    );
    expect(await response.json()).toEqual({
      text: 'Pokémon (4)\n4 Dreepy TWM 128',
      archetype,
      player: finish.player,
      tournament: summary,
      url: `https://play.limitlesstcg.com/tournament/${id}/player/redthegoat/decklist`,
    });
  });

  it('answers a malformed id as a bad request without asking the index', async () => {
    const index = reader();
    const route: DeckIndexRoute | 'invalid' = 'invalid';
    const response = await handleDeckIndexRequest(
      new Request('https://play.example/v2/tournaments/123'),
      route,
      index
    );
    expect(response.status).toBe(400);
    expect(index.tournament).not.toHaveBeenCalled();
  });
});
