// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferences } from '../../preferences/preference-store.js';
import {
  ArchetypeView,
  TournamentsShelf,
  TournamentView,
} from './TournamentDecks.js';
import { TOURNAMENT_PREFERENCES } from './tournament-preferences.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ONLINE = {
  id: 'a'.repeat(24),
  name: 'Weekly Cup',
  date: '2026-10-20T19:00:00.000Z',
  players: 64,
  format: 'STANDARD',
  kind: 'online',
  organizer: 'League',
  hasLists: true,
};
const NICE = {
  id: 'labs-0077',
  name: 'Regional Nice',
  date: '2026-10-17T06:30:00.000Z',
  players: 2336,
  format: 'STANDARD',
  kind: 'regional',
  organizer: null,
  hasLists: true,
};

let root: Root | undefined;

beforeEach(() => {
  preferences().set(TOURNAMENT_PREFERENCES, {
    format: 'STANDARD',
    online: false,
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe('majors on the deck screen', () => {
  it('lists majors alone at first, online events too when asked, in the format picked', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const majors =
        new URL(String(input), 'http://x').searchParams.get('kind') === 'major';
      return Response.json({
        tournaments: majors ? [NICE] : [ONLINE, NICE],
        nextCursor: null,
      });
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('IntersectionObserver', undefined);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<TournamentsShelf open onOpen={() => undefined} />)
    );
    await settle();
    const metas = () =>
      [...host.querySelectorAll('.deck-event__meta')].map(
        (node) => node.textContent
      );
    // Regionals and up, in Standard, unless asked for more.
    expect(String(fetch.mock.calls.at(-1)![0])).toBe(
      '/v2/tournaments?format=STANDARD&minPlayers=16&kind=major'
    );
    expect(metas()).toEqual(['Regional · Standard · 2,336 players']);
    const online = host.querySelector<HTMLButtonElement>(
      '#deckEventsOnlineToggle'
    )!;
    expect(online.getAttribute('aria-pressed')).toBe('false');
    await act(async () => online.click());
    await settle();
    expect(online.getAttribute('aria-pressed')).toBe('true');
    expect(String(fetch.mock.calls.at(-1)![0])).toBe(
      '/v2/tournaments?format=STANDARD&minPlayers=16'
    );
    expect(metas()).toEqual([
      'Standard · 64 players',
      'Regional · Standard · 2,336 players',
    ]);
    // Kept for the next visit.
    expect(preferences().get(TOURNAMENT_PREFERENCES).online).toBe(true);

    // Majors alone in Expanded: there are none, and the page says so
    // rather than asking for an empty list.
    await act(async () => online.click());
    const asked = fetch.mock.calls.length;
    await act(async () =>
      host
        .querySelector<HTMLInputElement>('#deckEventsFormat-EXPANDED')!
        .click()
    );
    await settle();
    expect(fetch.mock.calls.length).toBe(asked);
    const none = host.querySelector('[data-no-majors]')!;
    expect(none.textContent).toMatch(/^No majors in Expanded/u);
    await act(async () => none.querySelector('button')!.click());
    await settle();
    expect(String(fetch.mock.calls.at(-1)![0])).toBe(
      '/v2/tournaments?format=EXPANDED&minPlayers=16'
    );
    expect(host.querySelector('[data-no-majors]')).toBeNull();
  });

  it('lists a deck’s finishes in the scope picked, each labelled by its event and format', async () => {
    const archetype = {
      id: 'dragapult-ex',
      name: 'Dragapult ex',
      icons: ['dragapult'],
    };
    const finish = (
      tournament: typeof NICE | typeof ONLINE,
      placing: number
    ) => ({
      tournament: {
        id: tournament.id,
        name: tournament.name,
        date: tournament.date,
        players: tournament.players,
        format: tournament.format,
        kind: tournament.kind,
      },
      player: { id: `p${String(placing)}`, name: `P${String(placing)}` },
      placing,
      record: { wins: 9, losses: 2, ties: 1 },
    });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const majors =
        new URL(String(input), 'http://x').searchParams.get('kind') === 'major';
      return Response.json({
        archetype,
        finishes: majors
          ? [finish(NICE, 12)]
          : [finish(NICE, 12), finish(ONLINE, 1)],
        nextCursor: null,
      });
    });
    vi.stubGlobal('fetch', fetch);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ArchetypeView
          archetype={archetype}
          pending={undefined}
          onBack={() => undefined}
          onLoad={() => undefined}
        />
      )
    );
    await settle();
    expect(String(fetch.mock.calls[0]![0])).toBe(
      '/v2/decks/archetype/dragapult-ex?format=STANDARD&kind=major'
    );
    const metas = () =>
      [...host.querySelectorAll('.deck-finish__event-meta')].map(
        (node) => node.textContent
      );
    expect(metas()).toEqual([
      expect.stringMatching(/^Regional · Standard · 2,336 players · /u),
    ]);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('#deckArchetypeOnlineToggle')!
        .click()
    );
    await settle();
    expect(String(fetch.mock.calls.at(-1)![0])).toBe(
      '/v2/decks/archetype/dragapult-ex?format=STANDARD'
    );
    expect(metas()).toEqual([
      expect.stringMatching(/^Regional · Standard · /u),
      expect.stringMatching(/^Standard · 64 players · /u),
    ]);
  });

  it('names a major’s kind over its standings, linked to Limitless Labs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          tournament: {
            ...NICE,
            url: 'https://labs.limitlesstcg.com/0077/standings',
          },
          standings: [],
        })
      )
    );
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <TournamentView
          tournament={{ id: NICE.id, name: NICE.name }}
          pending={undefined}
          onBack={() => undefined}
          onLoad={() => undefined}
        />
      )
    );
    await settle();
    expect(host.querySelector('.deck-subhead__title p')?.textContent).toMatch(
      /^.+ · Regional · Standard · 2,336 players$/u
    );
    expect(host.querySelector<HTMLAnchorElement>('.deck-subhead a')?.href).toBe(
      'https://labs.limitlesstcg.com/0077/standings'
    );
  });
});
