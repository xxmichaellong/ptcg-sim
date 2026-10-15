import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { OVERLAY_SURFACE_ATTRIBUTE } from '../../ui/overlay-surface.js';
import './deck-layer.css';

/** Where a press of Esc belongs to something inside the deck screen. */
const OWNS_ESCAPE = '[role="dialog"], [role="menu"], [role="listbox"]';

/**
 * The deck screen (ADR-030, ADR-032) over the whole window. The deck
 * session inside draws its own header; this layer owns focus while it is
 * open and closes back to the table on Esc.
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
      role="region"
      aria-label="Deck"
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'dialog' }}
    >
      {children}
    </div>
  );
};
