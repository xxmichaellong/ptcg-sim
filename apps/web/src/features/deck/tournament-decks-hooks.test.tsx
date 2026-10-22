// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TournamentDataRefusedError,
  type DeckSearchResponse,
  type fetchDeckSearch,
} from './tournament-decks-client.js';
import {
  DECK_SEARCH_DEBOUNCE_MS,
  useDeckSearch,
  usePaged,
  type PagedRemote,
  type Remote,
} from './tournament-decks-hooks.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  vi.useRealTimers();
});

const answer = (name: string): DeckSearchResponse => ({
  available: true,
  updatedAt: '2026-10-22T06:00:00.000Z',
  results: [
    {
      archetype: { id: name.toLowerCase(), name, icons: [] },
      lists: 1,
      top8s: 1,
      best: [],
    },
  ],
});

describe('useDeckSearch', () => {
  it('asks once typing rests, cancels what a newer search overtakes, and keeps the last answer meanwhile', async () => {
    const signals: AbortSignal[] = [];
    const search = vi.fn<typeof fetchDeckSearch>((text, options) => {
      signals.push(options!.signal!);
      return Promise.resolve(answer(text));
    });
    const seen: Remote<unknown>[] = [];
    const Probe = ({ text }: { readonly text: string }) => {
      seen.push(useDeckSearch(text, true, search));
      return null;
    };
    root = createRoot(host);
    act(() => root!.render(<Probe text="d" />));
    expect(seen.at(-1)).toEqual({ status: 'idle' });
    act(() => root!.render(<Probe text="dr" />));
    act(() => root!.render(<Probe text="dra" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]![0]).toBe('dra');
    expect(seen.at(-1)).toMatchObject({ status: 'ready' });

    act(() => root!.render(<Probe text="drag" />));
    // The last answer stays up while the next is asked.
    expect(seen.at(-1)).toMatchObject({
      status: 'loading',
      value: expect.any(Array),
    });
    act(() => root!.render(<Probe text="" />));
    expect(seen.at(-1)).toEqual({ status: 'idle' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_SEARCH_DEBOUNCE_MS);
    });
    expect(search).toHaveBeenCalledOnce();
    expect(signals[0]!.aborted).toBe(true);
  });

  it('says when the index is empty, and when search is offline', async () => {
    const search = vi
      .fn<typeof fetchDeckSearch>()
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(new Error('HTTP 500'));
    const seen: Remote<unknown>[] = [];
    const Probe = ({ text }: { readonly text: string }) => {
      seen.push(useDeckSearch(text, true, search));
      return null;
    };
    root = createRoot(host);
    act(() => root!.render(<Probe text="gardevoir" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_SEARCH_DEBOUNCE_MS);
    });
    expect(seen.at(-1)).toEqual({ status: 'unavailable' });
    act(() => root!.render(<Probe text="charizard" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECK_SEARCH_DEBOUNCE_MS);
    });
    expect(seen.at(-1)).toEqual({ status: 'failed', busy: false });
  });
});

describe('usePaged', () => {
  it('reads the first page, then more on request, and starts over for a new key', async () => {
    const reads: Array<string | undefined> = [];
    const readPage = vi.fn(async (cursor: string | undefined) => {
      reads.push(cursor);
      return cursor
        ? { items: ['c'], nextCursor: null }
        : { items: ['a', 'b'], nextCursor: 'next' };
    });
    let latest: PagedRemote<string> | undefined;
    const Probe = ({ id }: { readonly id: string }) => {
      latest = usePaged(id, readPage);
      return null;
    };
    root = createRoot(host);
    await act(async () => {
      root!.render(<Probe id="one" />);
      await vi.runAllTimersAsync();
    });
    expect(latest?.state).toEqual({ status: 'ready', value: ['a', 'b'] });
    expect(latest?.hasMore).toBe(true);
    await act(async () => {
      latest!.more();
      await vi.runAllTimersAsync();
    });
    expect(latest?.state).toEqual({ status: 'ready', value: ['a', 'b', 'c'] });
    expect(latest?.hasMore).toBe(false);
    await act(async () => {
      root!.render(<Probe id="two" />);
      await vi.runAllTimersAsync();
    });
    expect(reads).toEqual([undefined, 'next', undefined]);
    expect(latest?.state).toEqual({ status: 'ready', value: ['a', 'b'] });
  });
  it('starts over from the first page when the server refuses a cursor', async () => {
    const reads: Array<string | undefined> = [];
    let refuse = true;
    const readPage = vi.fn(async (cursor: string | undefined) => {
      reads.push(cursor);
      if (cursor && refuse) {
        refuse = false;
        throw new TournamentDataRefusedError(400);
      }
      return cursor
        ? { items: ['c'], nextCursor: null }
        : { items: ['a', 'b'], nextCursor: 'stale' };
    });
    let latest: PagedRemote<string> | undefined;
    const Probe = () => {
      latest = usePaged('one', readPage);
      return null;
    };
    root = createRoot(host);
    await act(async () => {
      root!.render(<Probe />);
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      latest!.more();
      await vi.runAllTimersAsync();
    });
    expect(reads).toEqual([undefined, 'stale', undefined]);
    expect(latest?.state).toEqual({ status: 'ready', value: ['a', 'b'] });
    expect(latest?.loadingMore).toBe(false);
    await act(async () => {
      latest!.more();
      await vi.runAllTimersAsync();
    });
    expect(latest?.state).toEqual({ status: 'ready', value: ['a', 'b', 'c'] });
  });
});
