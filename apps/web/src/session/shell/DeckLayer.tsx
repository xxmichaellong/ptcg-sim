import { useLingui } from '@lingui/react/macro';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import {
  isOverlaySurfaceTarget,
  OVERLAY_SURFACE_ATTRIBUTE,
} from '../../ui/overlay-surface.js';
import './deck-layer.css';

/** Where a press of Esc belongs to something inside the deck screen. */
const OWNS_ESCAPE = '[role="dialog"], [role="menu"], [role="listbox"]';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab reaches inside `root`, in order. */
const tabStops = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0
  );

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
  const { t } = useLingui();
  const layer = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Focus lost to the page while the screen is open (a pressed button went
  // away): a key pressed there is the screen's, and the focus comes back
  // to it. Esc closes. A key the screen has used already (Esc back to the
  // decks) is left to it, and so is where the focus goes.
  useEffect(() => {
    if (!open) return;
    const fromPage = (event: globalThis.KeyboardEvent): void => {
      if (event.target !== document.body || event.defaultPrevented) return;
      if (document.activeElement === document.body) {
        layer.current?.focus({ preventScroll: true });
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener('keydown', fromPage);
    return () => document.removeEventListener('keydown', fromPage);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    // Keys pressed here are the deck's, never the table's.
    layer.current?.focus({ preventScroll: true });
    // The table it covers can't be reached from the keyboard either: focus
    // that leaves the deck screen (Tab past its last control, Shift+Tab
    // past its first) comes back round to its other end. Its own menus and
    // dialogs, portalled elsewhere, are overlays and keep their focus.
    const keepFocus = (event: FocusEvent): void => {
      const root = layer.current;
      const target = event.target;
      if (
        !root ||
        !(target instanceof Node) ||
        root.contains(target) ||
        isOverlaySurfaceTarget(target)
      ) {
        return;
      }
      const stops = tabStops(root);
      const before =
        (root.compareDocumentPosition(target) &
          Node.DOCUMENT_POSITION_PRECEDING) !==
        0;
      const end = before ? stops.at(-1) : stops[0];
      (end ?? root).focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('focusin', keepFocus);
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
    // Tab past either end comes round to the other, never out to the
    // browser or the table.
    if (event.key === 'Tab' && layer.current) {
      const stops = tabStops(layer.current);
      const first = stops[0];
      const last = stops.at(-1);
      const active = document.activeElement;
      const wrapTo = event.shiftKey
        ? active === first || active === layer.current
          ? last
          : undefined
        : active === last
          ? first
          : undefined;
      if (wrapTo) {
        event.preventDefault();
        wrapTo.focus({ preventScroll: true });
      }
      return;
    }
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
      aria-label={t({ message: 'Deck', context: 'the deck screen' })}
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
