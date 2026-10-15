import {
  Component,
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from 'react';

import type { LegacyDeckBuilderSession as DeckBuilderSession } from './LegacyDeckBuilderSession.js';

const DeckBuilder = lazy(async () => ({
  default: (await import('./LegacyDeckBuilderSession.js'))
    .LegacyDeckBuilderSession,
}));

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
          The deck screen didn&apos;t load, so decks can&apos;t be changed right
          now. Your game carries on.
        </p>
        <button
          type="button"
          className="ds-button ds-button--primary"
          onClick={this.props.onClose}
        >
          Back to the table
        </button>
      </div>
    );
  }
}

export const LazyDeckBuilderSession = (
  props: ComponentProps<typeof DeckBuilderSession>
) => (
  <LoadBoundary onClose={props.onRequestClose}>
    <Suspense fallback={null}>
      <DeckBuilder {...props} />
    </Suspense>
  </LoadBoundary>
);
