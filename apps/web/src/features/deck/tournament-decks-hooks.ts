import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchDeckSearch,
  TournamentDataBusyError,
  TournamentDataRefusedError,
  type DeckSearchResult,
  type TournamentRequestOptions,
} from './tournament-decks-client.js';

/** Something asked of the server: not yet, on its way, here, or not. */
export type Remote<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly value?: T }
  | { readonly status: 'ready'; readonly value: T }
  /** The server has nothing yet (its index is still empty). */
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed'; readonly busy: boolean };

const failureOf = (error: unknown): Remote<never> => ({
  status: 'failed',
  busy: error instanceof TournamentDataBusyError,
});

/** How long typing rests before the search goes out. */
export const DECK_SEARCH_DEBOUNCE_MS = 220;
/** A search needs a couple of letters to mean anything. */
export const DECK_SEARCH_MINIMUM = 2;

/**
 * Tournament decks matching what is typed: asked once typing rests, the
 * last answer kept on screen while the next is on its way, and any request
 * a newer search (or leaving) overtakes cancelled.
 */
export const useDeckSearch = (
  text: string,
  enabled: boolean,
  search: typeof fetchDeckSearch = fetchDeckSearch
): Remote<readonly DeckSearchResult[]> => {
  const [state, setState] = useState<Remote<readonly DeckSearchResult[]>>({
    status: 'idle',
  });
  const query = text.trim();
  const active = enabled && query.length >= DECK_SEARCH_MINIMUM;
  useEffect(() => {
    if (!active) {
      setState({ status: 'idle' });
      return;
    }
    setState((previous) =>
      previous.status === 'ready'
        ? { status: 'loading', value: previous.value }
        : previous.status === 'loading'
          ? previous
          : { status: 'loading' }
    );
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(query, { signal: controller.signal }).then(
        (answer) => {
          if (controller.signal.aborted) return;
          setState(
            answer.available
              ? { status: 'ready', value: answer.results }
              : { status: 'unavailable' }
          );
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setState(failureOf(error));
        }
      );
    }, DECK_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, query, search]);
  return active ? state : { status: 'idle' };
};

/** One page of something listed, and where the next one starts. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface PagedRemote<T> {
  readonly state: Remote<readonly T[]>;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly more: () => void;
  readonly retry: () => void;
}

/**
 * A list read a page at a time (tournaments, an archetype's finishes): the
 * first page when `key` changes, the next on `more()`. A new key cancels
 * whatever the old one was still reading.
 */
export const usePaged = <T>(
  key: string | undefined,
  readPage: (
    cursor: string | undefined,
    options: TournamentRequestOptions
  ) => Promise<Page<T>>
): PagedRemote<T> => {
  const [state, setState] = useState<Remote<readonly T[]>>({ status: 'idle' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reader = useRef(readPage);
  reader.current = readPage;
  const live = useRef<AbortController | undefined>(undefined);
  // Starting over from a refused cursor: the first page the browser kept
  // would carry that cursor again.
  const fresh = useRef(false);

  useEffect(() => {
    if (key === undefined) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    live.current = controller;
    setState({ status: 'loading' });
    setCursor(null);
    setLoadingMore(false);
    const cache = fresh.current ? ('no-cache' as const) : undefined;
    fresh.current = false;
    reader
      .current(undefined, {
        signal: controller.signal,
        ...(cache ? { cache } : {}),
      })
      .then(
        (page) => {
          if (controller.signal.aborted) return;
          setState({ status: 'ready', value: page.items });
          setCursor(page.nextCursor);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setState(failureOf(error));
        }
      );
    return () => {
      controller.abort();
      if (live.current === controller) live.current = undefined;
    };
  }, [key, attempt]);

  const more = useCallback(() => {
    const controller = live.current;
    if (!controller || !cursor || loadingMore || state.status !== 'ready') {
      return;
    }
    const shown = state.value;
    setLoadingMore(true);
    reader.current(cursor, { signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', value: [...shown, ...page.items] });
        setCursor(page.nextCursor);
        setLoadingMore(false);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadingMore(false);
        // A cursor the server no longer takes (one from before an update):
        // the list starts over from its first page.
        if (error instanceof TournamentDataRefusedError) {
          fresh.current = true;
          // Loading again at once, so nothing reads the old list as the
          // answer to this More.
          setState({ status: 'loading' });
          setCursor(null);
          setAttempt((count) => count + 1);
        }
      }
    );
  }, [cursor, loadingMore, state]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return {
    state,
    hasMore: cursor !== null,
    loadingMore,
    more,
    retry,
  };
};

/** One thing read by id (a tournament's standings), cancelled on leaving. */
export const useRemote = <T>(
  key: string | undefined,
  read: (options: TournamentRequestOptions) => Promise<T>
): { readonly state: Remote<T>; readonly retry: () => void } => {
  const [state, setState] = useState<Remote<T>>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    if (key === undefined) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    reader.current({ signal: controller.signal }).then(
      (value) => {
        if (!controller.signal.aborted) setState({ status: 'ready', value });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState(failureOf(error));
      }
    );
    return () => controller.abort();
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
};
