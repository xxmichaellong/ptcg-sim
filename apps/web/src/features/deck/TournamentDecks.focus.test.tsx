// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ArchetypeView,
  TournamentsShelf,
  TournamentView,
} from './TournamentDecks.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ARCHETYPE = {
  id: 'dragapult-dusknoir',
  name: 'Dragapult Dusknoir',
  icons: [],
};
const finish = (player: string, n: number) => ({
  tournament: {
    id: `${'a'.repeat(23)}${String(n)}`,
    name: `Event ${String(n)}`,
    date: '2026-10-10T19:00:00.000Z',
    players: 64,
    format: 'STANDARD',
  },
  player: { id: player, name: player },
  placing: 1,
  record: { wins: 9, losses: 0, ties: 0 },
});

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('a deck’s lists from the keyboard', () => {
  it('keep the focus on the view when All time replaces the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const since = new URL(String(input), 'http://x').searchParams.get(
          'since'
        );
        return Response.json({
          archetype: ARCHETYPE,
          finishes:
            since === null
              ? [finish('newwin', 1)]
              : [finish('newwin', 1), finish('oldwin', 2)],
          nextCursor: null,
        });
      })
    );
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ArchetypeView
          archetype={ARCHETYPE}
          pending={undefined}
          onBack={() => undefined}
          onLoad={() => undefined}
        />
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const allTime =
      host.querySelector<HTMLButtonElement>('#deckAllTimeButton')!;
    allTime.focus();
    await act(async () => allTime.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The heading has it: Esc still reaches the deck screen.
    expect(document.activeElement?.tagName).toBe('H2');
    expect(host.contains(document.activeElement)).toBe(true);
  });

  it('keep the focus on More while the next page loads', async () => {
    let release: (() => void) | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), 'http://x').searchParams.get(
        'cursor'
      );
      if (cursor !== null) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return Response.json({
        archetype: ARCHETYPE,
        finishes: [finish(cursor === null ? 'first' : 'second', 1)],
        nextCursor: cursor === null ? 'next' : null,
      });
    });
    vi.stubGlobal('fetch', fetch);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ArchetypeView
          archetype={ARCHETYPE}
          pending={undefined}
          onBack={() => undefined}
          onLoad={() => undefined}
        />
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const more = host.querySelector<HTMLButtonElement>('.deck-show-more')!;
    more.focus();
    await act(async () => more.click());
    // Loading: still focusable (a disabled button drops the focus), and a
    // second press asks for nothing more.
    expect(more.disabled).toBe(false);
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(more);
    await act(async () => more.click());
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent).toContain('second');
  });

  it('keep the focus on a standing’s Load while its list loads', async () => {
    const event = {
      id: 'b'.repeat(24),
      name: 'Cup',
      date: '2026-10-10T19:00:00.000Z',
      players: 64,
      format: 'STANDARD',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          tournament: {
            ...event,
            organizer: 'League',
            hasLists: true,
            url: `https://play.limitlesstcg.com/tournament/${event.id}/standings`,
          },
          standings: [
            {
              player: { id: 'winner', name: 'Winner' },
              placing: 1,
              record: { wins: 9, losses: 0, ties: 0 },
              dropped: false,
              archetype: ARCHETYPE,
              hasList: true,
            },
          ],
        })
      )
    );
    const onLoad = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const draw = (pending: string | undefined) =>
      act(async () =>
        root!.render(
          <TournamentView
            tournament={event}
            pending={pending}
            onBack={() => undefined}
            onLoad={onLoad}
          />
        )
      );
    await draw(undefined);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const load = host.querySelector<HTMLButtonElement>('.deck-standing__load')!;
    load.focus();
    await act(async () => load.click());
    expect(onLoad).toHaveBeenCalledOnce();
    await draw(`${event.id}/winner`);
    // Loading: still focusable, and a second press asks for nothing more.
    expect(load.disabled).toBe(false);
    expect(load.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(load);
    await act(async () => load.click());
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('give the focus to the first event More brought once More goes', async () => {
    const event = (n: number) => ({
      id: `${'c'.repeat(23)}${String(n)}`,
      name: `Event ${String(n)}`,
      date: '2026-10-10T19:00:00.000Z',
      players: 64,
      format: 'STANDARD',
      organizer: 'League',
      hasLists: true,
    });
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const cursor = new URL(String(input), 'http://x').searchParams.get(
          'cursor'
        );
        return Response.json(
          cursor === null
            ? { tournaments: [event(1), event(2)], nextCursor: 'next' }
            : { tournaments: [event(3)], nextCursor: null }
        );
      })
    );
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<TournamentsShelf open onOpen={() => undefined} />)
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const more = host.querySelector<HTMLButtonElement>('.deck-show-more')!;
    more.focus();
    await act(async () => more.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The last page is in: More has gone, and the focus with it would have.
    expect(host.querySelector('.deck-show-more')).toBeNull();
    expect(
      (document.activeElement as HTMLElement | null)?.dataset.openTournament
    ).toBe(event(3).id);
  });

  it('give the focus back to More when the server refuses its cursor and the list starts over', async () => {
    const event = (n: number) => ({
      id: `${'d'.repeat(23)}${String(n)}`,
      name: `Event ${String(n)}`,
      date: '2026-10-10T19:00:00.000Z',
      players: 64,
      format: 'STANDARD',
      organizer: 'League',
      hasLists: true,
    });
    vi.stubGlobal('IntersectionObserver', undefined);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), 'http://x').searchParams.get(
        'cursor'
      );
      return cursor === 'stale'
        ? new Response('{}', { status: 400 })
        : Response.json({
            tournaments: [event(1), event(2)],
            nextCursor: 'stale',
          });
    });
    vi.stubGlobal('fetch', fetch);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<TournamentsShelf open onOpen={() => undefined} />)
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const more = host.querySelector<HTMLButtonElement>('.deck-show-more')!;
    more.focus();
    await act(async () => more.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    // Refused, read again from the first page: More is back, with the focus.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(document.activeElement).toBe(host.querySelector('.deck-show-more'));
  });

  it('give the focus to the first event once Try again has loaded them', async () => {
    const event = {
      id: 'e'.repeat(24),
      name: 'Event',
      date: '2026-10-10T19:00:00.000Z',
      players: 64,
      format: 'STANDARD',
      organizer: 'League',
      hasLists: true,
    };
    vi.stubGlobal('IntersectionObserver', undefined);
    let offline = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        offline
          ? new Response('{}', { status: 500 })
          : Response.json({ tournaments: [event], nextCursor: null })
      )
    );
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<TournamentsShelf open onOpen={() => undefined} />)
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const retry = host.querySelector<HTMLButtonElement>(
      '.deck-results__status button'
    )!;
    retry.focus();
    offline = false;
    await act(async () => retry.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      (document.activeElement as HTMLElement | null)?.dataset.openTournament
    ).toBe(event.id);
  });

  it('leave the focus where it is when nothing on the shelf was pressed', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          tournaments: [
            {
              id: 'f'.repeat(24),
              name: 'Event',
              date: '2026-10-10T19:00:00.000Z',
              players: 64,
              format: 'STANDARD',
              organizer: 'League',
              hasLists: true,
            },
          ],
          nextCursor: null,
        })
      )
    );
    // The focus fell to the page (a pressed Back went away) as the decks
    // came back: the shelf mounting, and its first page, leave it there.
    (document.activeElement as HTMLElement | null)?.blur();
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<TournamentsShelf open onOpen={() => undefined} />)
    );
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector('[data-open-tournament]')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('keep their pages while the screen is put away, and say why More failed', async () => {
    const event = (n: number) => ({
      id: `${'g'.repeat(23)}${String(n)}`,
      name: `Event ${String(n)}`,
      date: '2026-10-10T19:00:00.000Z',
      players: 64,
      format: 'STANDARD',
      organizer: 'League',
      hasLists: true,
    });
    vi.stubGlobal('IntersectionObserver', undefined);
    let offline = false;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), 'http://x').searchParams.get(
        'cursor'
      );
      if (cursor === 'three' && offline) {
        return new Response('{}', { status: 500 });
      }
      return Response.json(
        cursor === null
          ? { tournaments: [event(1)], nextCursor: 'two' }
          : cursor === 'two'
            ? { tournaments: [event(2)], nextCursor: 'three' }
            : { tournaments: [event(3)], nextCursor: null }
      );
    });
    vi.stubGlobal('fetch', fetch);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const draw = (open: boolean) =>
      act(async () =>
        root!.render(<TournamentsShelf open={open} onOpen={() => undefined} />)
      );
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    const shown = () => host.querySelectorAll('[data-open-tournament]').length;
    await draw(true);
    await settle();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.deck-show-more')!.click()
    );
    await settle();
    expect(shown()).toBe(2);
    await draw(false);
    await draw(true);
    await settle();
    // Opened again as it was left, nothing asked again.
    expect(shown()).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    offline = true;
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.deck-show-more')!.click()
    );
    await settle();
    expect(host.textContent).toContain('Tournaments are offline');
    expect(shown()).toBe(2);
  });
});
