import { describe, expect, it, vi } from 'vitest';

import {
  archetypeIconUrl,
  decodeDeckSearch,
  decodeTournament,
  decodeTournamentList,
  decodeTournaments,
  fetchArchetypeFinishes,
  fetchDeckSearch,
  fetchTournament,
  fetchTournamentList,
  fetchTournaments,
  searchText,
  TournamentDataBusyError,
  TournamentDataNotFoundError,
  TournamentDataRefusedError,
} from './tournament-decks-client.js';

const respond = (body: unknown, status = 200) =>
  vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      })
  );

const tournament = {
  id: '6ad8a7d1115c12b73a5a8e4b',
  name: 'ASRcristiano # 197',
  date: '2026-10-21T19:00:00.000Z',
  players: 67,
  format: 'STANDARD',
  kind: 'online',
};
const finish = {
  tournament,
  player: { id: 'redthegoat', name: 'REDTHEGOAT', country: 'FR' },
  placing: 1,
  record: { wins: 8, losses: 2, ties: 0 },
};
const archetype = {
  id: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  icons: ['dragapult', 'dusknoir'],
};
const search = {
  available: true,
  updatedAt: '2026-10-22T06:00:00.000Z',
  results: [{ archetype, lists: 812, top8s: 64, best: [finish] }],
};

describe('tournament deck search', () => {
  it('asks the server for decks by name, without cookies or redirects', async () => {
    const fetch = respond(search);
    const answer = await fetchDeckSearch('  Dragapult  ', {
      fetch,
      format: 'STANDARD',
    });
    expect(answer).toEqual(search);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/v2/decks/search?q=Dragapult&format=STANDARD');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    // Majors alone (ADR-037 §9), as the tournaments list asks for them.
    await fetchDeckSearch('Dragapult', {
      fetch,
      format: 'EXPANDED',
      majors: true,
    });
    expect(fetch.mock.calls[1]![0]).toBe(
      '/v2/decks/search?q=Dragapult&format=EXPANDED&kind=major'
    );
    const finishes = respond({ archetype, finishes: [], nextCursor: null });
    await fetchArchetypeFinishes('dragapult-dusknoir', {
      fetch: finishes,
      majors: true,
    });
    expect(finishes.mock.calls[0]![0]).toBe(
      '/v2/decks/archetype/dragapult-dusknoir?kind=major'
    );
  });

  it('reads which kind of event each finish was at, online from an older server', () => {
    const { kind: _kind, ...older } = tournament;
    const decoded = decodeDeckSearch({
      ...search,
      results: [
        {
          archetype,
          lists: 2,
          top8s: 1,
          best: [
            { ...finish, tournament: { ...tournament, kind: 'regional' } },
            { ...finish, tournament: older },
          ],
        },
      ],
    });
    expect(
      decoded.available &&
        decoded.results[0]!.best.map((row) => row.tournament.kind)
    ).toEqual(['regional', 'online']);
  });

  it('says so while the server has nothing yet', () => {
    expect(decodeDeckSearch({ available: false })).toEqual({
      available: false,
    });
  });

  it('rejects anything that is not the shape it should be', () => {
    for (const body of [
      null,
      [],
      { ...search, results: 'x' },
      { ...search, updatedAt: 'not a date' },
      {
        ...search,
        results: [
          { ...search.results[0], archetype: { ...archetype, id: '../x' } },
        ],
      },
      {
        ...search,
        results: [
          {
            ...search.results[0],
            archetype: { ...archetype, name: 'a\u0000b' },
          },
        ],
      },
      {
        ...search,
        results: [
          {
            ...search.results[0],
            best: [{ ...finish, player: { id: 'a/b', name: 'x' } }],
          },
        ],
      },
      {
        ...search,
        results: [
          {
            ...search.results[0],
            best: [{ ...finish, record: { wins: -1, losses: 0, ties: 0 } }],
          },
        ],
      },
    ]) {
      expect(() => decodeDeckSearch(body)).toThrow();
    }
  });

  it('sends a pasted tab or line break in a search as a space', async () => {
    const search = respond({ available: false });
    await fetchDeckSearch(' 1st\tGardevoir \n ex ', { fetch: search });
    const events = respond({ tournaments: [], nextCursor: null });
    await fetchTournaments({ fetch: events, q: 'Gdańsk\tCup' });
    const q = (mock: typeof search) =>
      new URL(String(mock.mock.calls[0]![0]), 'http://x').searchParams.get('q');
    expect(q(search)).toBe('1st Gardevoir ex');
    expect(q(events)).toBe('Gdańsk Cup');
    // Cut to length, it ends on a whole character, never a space or half
    // an emoji, so a second pass changes nothing.
    for (const text of [`${'a'.repeat(59)} bc`, `${'a'.repeat(59)}😀`]) {
      const once = searchText(text);
      expect(searchText(once)).toBe(once);
      expect(once).toBe('a'.repeat(59));
    }
  });

  it('caps what it will read', async () => {
    const fetch = respond('x'.repeat(4_000_001));
    await expect(fetchDeckSearch('x', { fetch })).rejects.toThrow(/too large/u);
  });

  it('tells a refused request (a cursor from before an update) from a failure', async () => {
    const refused = await fetchTournaments({
      fetch: respond({ error: 'bad cursor' }, 400),
      cursor: 'old',
    }).catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(TournamentDataRefusedError);
    const failed = await fetchTournaments({
      fetch: respond({ error: 'oops' }, 500),
    }).catch((caught: unknown) => caught);
    expect(failed).not.toBeInstanceOf(TournamentDataRefusedError);
    const gone = await fetchTournamentList(tournament.id, 'someone', {
      fetch: respond({ error: 'not found' }, 404),
    }).catch((caught: unknown) => caught);
    expect(gone).toBeInstanceOf(TournamentDataNotFoundError);
    expect(failed).not.toBeInstanceOf(TournamentDataNotFoundError);
    // Asked to, it skips the browser's copy.
    const fresh = respond({ tournaments: [], nextCursor: null });
    await fetchTournaments({ fetch: fresh, cache: 'no-cache' });
    expect(fresh.mock.calls[0]![1]).toMatchObject({ cache: 'no-cache' });
    const usual = respond({ tournaments: [], nextCursor: null });
    await fetchTournaments({ fetch: usual });
    expect(usual.mock.calls[0]![1]).not.toHaveProperty('cache');
  });

  it('reads a busy answer as busy, with how long to wait', async () => {
    const fetch = respond({ error: 'busy', retryAfter: 42 }, 503);
    const error = await fetchTournament(tournament.id, { fetch }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(TournamentDataBusyError);
    expect((error as TournamentDataBusyError).retryAfterSeconds).toBe(42);
  });

  it('lists majors alone when asked, each with its kind, linked to Limitless Labs', async () => {
    const major = {
      id: 'labs-0077',
      name: 'Regional Nice',
      date: '2026-10-17T06:30:00.000Z',
      format: 'STANDARD',
      players: 2336,
      kind: 'regional',
      organizer: null,
      hasLists: true,
    };
    const fetch = respond({ tournaments: [major], nextCursor: null });
    const page = await fetchTournaments({
      fetch,
      majors: true,
      minPlayers: 16,
    });
    expect(fetch.mock.calls[0]![0]).toBe(
      '/v2/tournaments?minPlayers=16&kind=major'
    );
    expect(page.tournaments[0]).toMatchObject({
      id: 'labs-0077',
      kind: 'regional',
      organizer: '',
    });
    // A server from before majors names no kind; a kind this page doesn't
    // know is shown as no kind.
    const { kind: _omitted, ...unnamed } = major;
    expect(
      decodeTournaments({
        tournaments: [unnamed, { ...major, kind: 'cup' }],
        nextCursor: null,
      }).tournaments.map((row) => row.kind)
    ).toEqual(['online', 'online']);
    expect(() =>
      decodeTournaments({
        tournaments: [{ ...major, kind: 'Regional <b>' }],
        nextCursor: null,
      })
    ).toThrow();
    const detail = respond({
      tournament: {
        ...major,
        url: 'https://labs.limitlesstcg.com/0077/standings',
      },
      standings: [],
    });
    await expect(
      fetchTournament('labs-0077', { fetch: detail })
    ).resolves.toMatchObject({
      tournament: { url: 'https://labs.limitlesstcg.com/0077/standings' },
    });
    expect(detail.mock.calls[0]![0]).toBe('/v2/tournaments/labs-0077');

    // A major's standings run past any online event's: Worlds' Masters
    // could pass 5,000. The server keeps up to 8,192.
    const crowded = decodeTournament({
      tournament: {
        ...major,
        url: 'https://labs.limitlesstcg.com/0077/standings',
      },
      standings: Array.from({ length: 8_192 }, (_, index) => ({
        player: {
          id: String(index + 1).padStart(4, '0'),
          name: `Player ${String(index + 1)}`,
        },
        placing: index + 1,
        record: { wins: 0, losses: 0, ties: 0 },
        dropped: false,
        archetype: null,
        hasList: false,
      })),
    });
    expect(crowded.standings).toHaveLength(8_192);
  });

  it('pages through tournaments and an archetype by an opaque cursor', async () => {
    const page = {
      tournaments: [
        { ...tournament, kind: 'online', organizer: 'League', hasLists: true },
      ],
      nextCursor: 'abc_123',
    };
    const fetch = respond(page);
    await expect(
      fetchTournaments({ fetch, q: 'gdansk', minPlayers: 16, cursor: 'abc' })
    ).resolves.toEqual(page);
    expect(fetch.mock.calls[0]![0]).toBe(
      '/v2/tournaments?q=gdansk&minPlayers=16&cursor=abc'
    );
    const finishes = respond({
      archetype,
      finishes: [finish],
      nextCursor: null,
    });
    await expect(
      fetchArchetypeFinishes('dragapult-dusknoir', { fetch: finishes })
    ).resolves.toMatchObject({ nextCursor: null });
    expect(finishes.mock.calls[0]![0]).toBe(
      '/v2/decks/archetype/dragapult-dusknoir'
    );
    await expect(fetchArchetypeFinishes('../etc', { fetch })).rejects.toThrow();
    // A player id of dots would be a path of its own: never asked for.
    const never = respond({});
    await expect(
      fetchTournamentList(tournament.id, '..', { fetch: never })
    ).rejects.toThrow();
    expect(never).not.toHaveBeenCalled();
    expect(() => decodeTournaments({ ...page, nextCursor: 'a b' })).toThrow();
    // A deck's finishes page on from a long key (a long player id in it).
    const long = 'A'.repeat(180);
    expect(decodeTournaments({ ...page, nextCursor: long }).nextCursor).toBe(
      long
    );
    expect(() =>
      decodeTournaments({ ...page, nextCursor: 'A'.repeat(201) })
    ).toThrow();
    // An event whose standings the server hasn't read yet: no organizer,
    // and whether it has lists isn't known.
    expect(
      decodeTournaments({
        tournaments: [{ ...tournament, organizer: null, hasLists: null }],
        nextCursor: null,
      }).tournaments[0]
    ).toMatchObject({ organizer: '', hasLists: null });
  });

  it("reads a tournament's standings, linked only to Limitless", () => {
    const body = {
      tournament: {
        ...tournament,
        organizer: 'League',
        hasLists: true,
        url: `https://play.limitlesstcg.com/tournament/${tournament.id}/standings`,
      },
      standings: [
        {
          player: { id: 'redthegoat', name: 'REDTHEGOAT' },
          placing: 1,
          record: { wins: 8, losses: 2, ties: 0 },
          dropped: false,
          archetype,
          hasList: true,
        },
        {
          player: { id: 'gone', name: 'Gone' },
          placing: null,
          record: { wins: 1, losses: 2, ties: 0 },
          dropped: true,
          archetype: null,
          hasList: false,
        },
      ],
    };
    const detail = decodeTournament(body);
    expect(detail.standings[1]).toMatchObject({
      placing: null,
      dropped: true,
      archetype: null,
    });
    expect(() =>
      decodeTournament({
        ...body,
        tournament: { ...body.tournament, url: 'https://evil.example/x' },
      })
    ).toThrow();
    expect(() =>
      decodeTournament({
        ...body,
        tournament: { ...body.tournament, url: 'javascript:alert(1)' },
      })
    ).toThrow();
  });

  it("fetches a player's list as text the importer reads", async () => {
    const body = {
      text: 'Pokémon: 4\n4 Dreepy TWM 128',
      archetype,
      player: { id: 'redthegoat', name: 'REDTHEGOAT' },
      tournament,
      url: `https://play.limitlesstcg.com/tournament/${tournament.id}/player/redthegoat/decklist`,
    };
    const fetch = respond(body);
    await expect(
      fetchTournamentList(tournament.id, 'redthegoat', { fetch })
    ).resolves.toMatchObject({ text: body.text });
    expect(fetch.mock.calls[0]![0]).toBe(
      `/v2/tournaments/${tournament.id}/players/redthegoat/list`
    );
    await expect(
      fetchTournamentList(tournament.id, '../admin', { fetch })
    ).rejects.toThrow();
    expect(() =>
      decodeTournamentList({ ...body, text: 'x'.repeat(20_001) })
    ).toThrow();
  });

  it('makes icon addresses only from icon names', () => {
    expect(archetypeIconUrl('dragapult')).toBe(
      'https://r2.limitlesstcg.net/pokemon/gen9/dragapult.png'
    );
    expect(archetypeIconUrl('../x')).toBeUndefined();
    expect(archetypeIconUrl('A B')).toBeUndefined();
  });

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      const pending = fetchDeckSearch('dragapult', { fetch });
      const settled = pending.catch((error: unknown) => error);
      // Not before the server's own 15 s wait for Limitless is up.
      await vi.advanceTimersByTimeAsync(15_001);
      let given = false;
      void settled.then(() => {
        given = true;
      });
      await Promise.resolve();
      expect(given).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await settled).toBeInstanceOf(DOMException);
    } finally {
      vi.useRealTimers();
    }
  });
});
