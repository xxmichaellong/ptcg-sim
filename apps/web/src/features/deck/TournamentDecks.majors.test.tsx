// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TournamentsShelf, TournamentView } from './TournamentDecks.js';

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
  it('lists them with online events, labelled by kind, or alone under Majors', async () => {
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
    expect(metas()).toEqual([
      'Standard · 64 players',
      'Regional · Standard · 2,336 players',
    ]);
    const toggle = host.querySelector<HTMLButtonElement>('#deckMajorsToggle')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle.click());
    await settle();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(String(fetch.mock.calls.at(-1)![0])).toBe(
      '/v2/tournaments?minPlayers=16&kind=major'
    );
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-open-tournament]')].map(
        (node) => node.dataset.openTournament
      )
    ).toEqual(['labs-0077']);
    // Off again: every event, as before.
    await act(async () => toggle.click());
    await settle();
    expect(metas()).toHaveLength(2);
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
