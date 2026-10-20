import {
  Component,
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { Trans } from '@lingui/react/macro';

import type { DeckBuilderSession } from './DeckBuilderSession.js';

const DeckBuilder = lazy(async () => ({
  default: (await import('./DeckBuilderSession.js')).DeckBuilderSession,
}));

/** While the deck screen's script arrives: a way back, and a sign of life. */
const Loading = ({ onClose }: { readonly onClose: () => void }) => (
  <div className="ptcgsim-deck-layer__loading" role="status">
    <button
      id="deckBackButton"
      type="button"
      className="ds-button ds-button--ghost"
      onClick={onClose}
    >
      <ArrowLeftIcon aria-hidden="true" weight="bold" />
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
          <Trans>
            The deck screen didn&apos;t load, so decks can&apos;t be changed
            right now. Your game carries on.
          </Trans>
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
) => (
  <LoadBoundary onClose={props.onBack ?? props.onRequestClose}>
    <Suspense
      fallback={<Loading onClose={props.onBack ?? props.onRequestClose} />}
    >
      <DeckBuilder {...props} />
    </Suspense>
  </LoadBoundary>
);
