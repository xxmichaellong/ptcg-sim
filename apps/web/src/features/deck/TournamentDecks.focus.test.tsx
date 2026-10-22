// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchetypeView } from './TournamentDecks.js';

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
});
