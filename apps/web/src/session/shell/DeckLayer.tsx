import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useMediaQuery } from '../../ui/breakpoints.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from '../../ui/overlay-surface.js';
import './deck-layer.css';

/**
 * Narrower than this, the builder's search and deck no longer fit beside
 * the decklist column, so the two take turns.
 */
const ONE_AT_A_TIME_QUERY = '(max-width: 899px), (max-height: 499px)';

/** Where a press of Esc belongs to something inside the deck screen. */
const OWNS_ESCAPE =
  '[role="dialog"], [role="menu"], [role="listbox"], .deck-review:not([hidden])';

/**
 * The deck screen (ADR-030): the builder over the whole window, with the
 * decklist column (paste, popular decks, card back) on the right. On a
 * phone the two take turns, chosen at the top. It closes back to the table
 * from its own button, Esc, or the builder's Play.
 */
export const DeckLayer = ({
  open,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The deck builder session, which owns its own open state. */
  readonly children: ReactNode;
}) => {
  const compact = useMediaQuery(ONE_AT_A_TIME_QUERY);
  const [view, setView] = useState<'list' | 'build'>('list');
  const layer = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    // Keys pressed here are the deck's, never the table's.
    layer.current?.focus({ preventScroll: true });
    return () => {
      const target = returnFocus.current;
      // Not kept: an opener that has since left the page (an app-menu item)
      // would otherwise hold its whole closed menu in memory.
      returnFocus.current = null;
      if (target instanceof HTMLElement && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    };
  }, [open]);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      (event.target instanceof Element &&
        event.target.closest(OWNS_ESCAPE) !== null)
    ) {
      return;
    }
    event.preventDefault();
    onClose();
  };
  return (
    <div
      ref={layer}
      className="ptcgsim-deck-layer"
      data-open={open ? 'true' : 'false'}
      data-deck-view={compact ? view : undefined}
      role="region"
      aria-label="Deck"
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'dialog' }}
    >
      <div className="ptcgsim-deck-layer__column">
        <header className="ptcgsim-deck-layer__bar">
          <button
            id="deckBackButton"
            type="button"
            className="ds-button ds-button--ghost ptcgsim-deck-layer__back"
            onClick={onClose}
          >
            <ArrowLeftIcon aria-hidden="true" weight="bold" />
            Table
          </button>
          {compact ? (
            <div
              className="ptcgsim-deck-layer__views"
              role="radiogroup"
              aria-label="Show"
            >
              {(
                [
                  ['list', 'Decklist'],
                  ['build', 'Builder'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  className="ptcgsim-deck-layer__view"
                  onClick={() => setView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
};
