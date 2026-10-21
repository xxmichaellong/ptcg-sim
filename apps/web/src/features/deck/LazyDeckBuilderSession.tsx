import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { Trans } from '@lingui/react/macro';

import type { DeckBuilderSession } from './DeckBuilderSession.js';

type DeckBuilderModule = typeof import('./DeckBuilderSession.js');

/** The deck screen's script, once it has arrived. */
let loaded: DeckBuilderModule | undefined;
let loading: Promise<DeckBuilderModule> | undefined;

/** Fetches the deck screen's script, once; a failed fetch may be asked again. */
const loadDeckBuilder = (): Promise<DeckBuilderModule> => {
  loading ??= import('./DeckBuilderSession.js').then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = undefined;
      throw error;
    }
  );
  return loading;
};

const DeckBuilder = lazy(async () => ({
  default: (await loadDeckBuilder()).DeckBuilderSession,
}));

/**
 * The deck screen warms up this long after the table has drawn -- its
 * entrance played, so reading the catalog (a few hundred ms of work) can't
 * stutter it -- and then once the page is idle, or WARMUP_IDLE_TIMEOUT_MS
 * later at the most.
 */
const WARMUP_DELAY_MS = 1_000;
const WARMUP_IDLE_TIMEOUT_MS = 2_000;
/**
 * Fetches the deck screen's built files (listed at build time) into the
 * browser's cache; true once every one arrived. A development server
 * builds nothing ahead and lists no files: there the warm-up only asks
 * that the server answers.
 */
export const deckScreenFilesArrived = async (
  base: string = import.meta.env.BASE_URL,
  development: boolean = import.meta.env.DEV
): Promise<boolean> => {
  const arrives = (url: string, init?: RequestInit): Promise<Response | null> =>
    fetch(url, init).then(
      (response) => (response.ok ? response : null),
      () => null
    );
  if (development)
    return (await arrives('/v2/health', { cache: 'no-store' })) !== null;
  const listed = await arrives(`${base}deck-screen-files.json`, {
    cache: 'no-cache',
  });
  const files: unknown = await listed?.json().catch(() => null);
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    !files.every((file): file is string => typeof file === 'string')
  )
    return false;
  // Read through, so each lands in the cache whole.
  const fetched = await Promise.all(
    files.map(async (file) => {
      const response = await arrives(`${base}${file}`);
      return response
        ? response.arrayBuffer().then(
            () => true,
            () => false
          )
        : false;
    })
  );
  return fetched.every(Boolean);
};

let warming: Promise<void> | undefined;

/**
 * Gets the deck screen ready (warmDeckScreen), once per page: ahead of
 * time, or the moment it is first opened, so its lists and catalog start
 * loading with its script rather than after its first frame.
 */
const preloadDeckScreen = (): Promise<void> => {
  warming ??= loadDeckBuilder()
    .then((module) => module.warmDeckScreen())
    // The screen loads what it needs itself when it opens.
    .catch(() => {
      warming = undefined;
    });
  return warming;
};

/** A connection the player asked to spare, or too slow to spend ahead. */
const sparesData = (): boolean => {
  const connection = (
    navigator as Navigator & {
      readonly connection?: {
        readonly saveData?: boolean;
        readonly effectiveType?: string;
      };
    }
  ).connection;
  return (
    connection?.saveData === true ||
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g'
  );
};

/**
 * Gets the deck screen ready while the table sits idle, before it is first
 * opened: its script, its lists and catalog, and the pictures it opens on
 * (warmDeckScreen). Returns the cancel. Not on a connection saving data.
 */
export const scheduleDeckScreenWarmup = (): (() => void) => {
  if (typeof window === 'undefined' || sparesData()) return () => undefined;
  // The page remembers a script whose fetch failed under its address, and
  // won't fetch it again: a warm-up that met a dropped connection would
  // keep the screen from opening until a reload. So the screen's files are
  // fetched first, which can fail harmlessly, and it is imported only once
  // they are all here (cached for good, `_headers`); otherwise it loads
  // when it opens, as it always did.
  const run = (): void => {
    if (navigator.onLine === false) return;
    void deckScreenFilesArrived().then((arrived) => {
      if (arrived) void preloadDeckScreen();
    });
  };
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    // A browser that can't say when it is idle warms up now.
    if (typeof window.requestIdleCallback === 'function')
      idle = window.requestIdleCallback(run, {
        timeout: WARMUP_IDLE_TIMEOUT_MS,
      });
    else run();
  }, WARMUP_DELAY_MS);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
};

/** Warms the deck screen up once `ready` (the table has drawn). */
export const DeckScreenWarmup = ({ ready }: { readonly ready: boolean }) => {
  useEffect(() => (ready ? scheduleDeckScreenWarmup() : undefined), [ready]);
  return null;
};

/** While the deck screen's script arrives: a way back, and a sign of life. */
const Loading = ({ onClose }: { readonly onClose: () => void }) => (
  <div className="ptcgsim-deck-layer__loading" role="status">
    <button
      id="deckBackButton"
      type="button"
      className="ds-button ds-button--ghost"
      onClick={onClose}
    >
      <ArrowLeftIcon
        aria-hidden="true"
        weight="bold"
        className="ds-mirror-rtl"
      />
      <Trans context="go back to the table">Table</Trans>
    </button>
    <p>
      <CircleNotchIcon aria-hidden="true" weight="bold" className="ds-spin" />
      <Trans>Opening your decks…</Trans>
    </p>
  </div>
);

/**
 * The deck screen is a script of its own, fetched the first time it opens.
 * A fetch that fails (a dropped connection, a deploy that replaced it) must
 * not take the room down with it: unhandled, React would unmount the whole
 * page, and the room would be left. The game carries on instead. (A page
 * cannot fetch a module again once its fetch failed, and reloading would
 * leave the room, so there is nothing to retry here.)
 */
class LoadBoundary extends Component<
  { readonly onClose: () => void; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ptcgsim-deck-layer__unavailable" role="alert">
        <p>
          <Trans>The deck screen didn&apos;t load. Your game carries on.</Trans>
        </p>
        <button
          type="button"
          className="ds-button ds-button--primary"
          onClick={this.props.onClose}
        >
          <Trans>Back to the table</Trans>
        </button>
      </div>
    );
  }
}

export const LazyDeckBuilderSession = (
  props: ComponentProps<typeof DeckBuilderSession>
) => {
  // A script already here (warmed up ahead) draws the screen in its first
  // frame, with no loading step in between. Chosen once: switching later
  // would remount the screen.
  const [Builder] = useState(() => {
    // Opened before it warmed up: it starts now, alongside the script.
    void preloadDeckScreen();
    return loaded?.DeckBuilderSession ?? DeckBuilder;
  });
  return (
    <LoadBoundary onClose={props.onBack ?? props.onRequestClose}>
      <Suspense
        fallback={<Loading onClose={props.onBack ?? props.onRequestClose} />}
      >
        <Builder {...props} />
      </Suspense>
    </LoadBoundary>
  );
};
