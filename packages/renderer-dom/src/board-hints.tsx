import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltips for what lies on the table: a count badge says how many cards a
 * pile holds, a counter or chip says what it is. They never take the
 * pointer -- a press on a badge or a counter still picks up the card under
 * it -- so they are found by where the pointer is, not by what it is over.
 *
 * Like the app's tooltips (`ui/Tooltip.tsx`, whose look they share): a
 * mouse shows one after a short rest, or at once while another was just
 * showing; a finger shows one with a tap, and the next tap anywhere hides
 * it. Only one shows at a time.
 */

/** An element on the table that has a tooltip (`data-board-hint`). */
export interface BoardHintTarget {
  readonly element: HTMLElement;
  /** Set on a marker's token: a press on it opens the marker's controls. */
  readonly markerId: string | null;
}

/** As the app's tooltips: a rest, or none while one was just showing. */
export const BOARD_HINT_DELAY_MS = 100;
const BOARD_HINT_WARM_MS = 400;
/**
 * How long a hidden hint stays to fade out: longer than its exit
 * (overlays.css) at the slowest animation speed.
 */
const BOARD_HINT_LEAVE_MS = 320;
const BOARD_HINT_GAP_PX = 8;
const BOARD_HINT_EDGE_PX = 8;

const contains = (rect: DOMRect, x: number, y: number): boolean =>
  rect.width > 0 &&
  rect.height > 0 &&
  x >= rect.left &&
  x <= rect.right &&
  y >= rect.top &&
  y <= rect.bottom;

interface MeasuredHint {
  readonly element: HTMLElement;
  readonly rect: DOMRect;
}

/**
 * Every hint and where it is drawn, in the order a point tries them:
 * counters and chips before count badges, and later (painted over) before
 * earlier.
 */
const measureHints = (root: ParentNode): readonly MeasuredHint[] => {
  const targets = Array.from(
    root.querySelectorAll<HTMLElement>('[data-board-hint]')
  );
  return [
    ...targets.filter((element) => element.dataset.markerHintId).reverse(),
    ...targets.filter((element) => !element.dataset.markerHintId).reverse(),
  ].map((element) => ({ element, rect: element.getBoundingClientRect() }));
};

/** One hidden behind a card held up in the hand (`top`) does not count. */
const hintIn = (
  hints: readonly MeasuredHint[],
  x: number,
  y: number,
  top: () => Element | null
): BoardHintTarget | null => {
  const element = hints.find((hint) => contains(hint.rect, x, y))?.element;
  if (!element) return null;
  if (top()?.closest('.ptcgsim-card[data-in-hand], .ptcgsim-card[data-held]')) {
    return null;
  }
  return { element, markerId: element.dataset.markerHintId ?? null };
};

/** The hint under a point, measured now. */
export const boardHintAt = (
  root: ParentNode,
  x: number,
  y: number
): BoardHintTarget | null =>
  hintIn(measureHints(root), x, y, () =>
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(x, y)
      : null
  );

/**
 * The hints as last measured, for a resting mouse. It looks one up every
 * frame it moves, and measuring them then makes the browser restyle and lay
 * out the table mid-frame, on top of the frame's own pass. The table
 * forgets the measure whenever something on it may have moved: a commit,
 * its motion starting or stopping, a card that carries markers painted.
 */
export class BoardHintIndex {
  private hints: readonly MeasuredHint[] | null = null;

  readonly invalidate = (): void => {
    this.hints = null;
  };

  /** `top` is what the pointer is over: its event's target. */
  at(
    root: ParentNode,
    x: number,
    y: number,
    top: Element | null
  ): BoardHintTarget | null {
    this.hints ??= measureHints(root);
    return hintIn(
      this.hints.filter((hint) => hint.element.isConnected),
      x,
      y,
      () => top
    );
  }
}

/** The tooltip showing, and what it is anchored to. */
export interface BoardHintShowing {
  readonly element: HTMLElement;
  /** Opened by a tap: the next press anywhere hides it. */
  readonly tapped: boolean;
}

/**
 * When the board's tooltip shows: the pointer's rest over a hint, a tap on
 * one, and everything that hides it again.
 */
export class BoardHintTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hovered: HTMLElement | null = null;
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private showing: BoardHintShowing | null = null;

  constructor(
    private readonly show: (showing: BoardHintShowing | null) => void,
    private readonly now: () => number = () => performance.now()
  ) {}

  /** A mouse over the table: the hint under it, if any. */
  hover(element: HTMLElement | null): void {
    if (element === this.hovered) return;
    this.hovered = element;
    this.clearTimer();
    if (!element) {
      if (this.showing && !this.showing.tapped) this.set(null);
      return;
    }
    const warm =
      this.showing !== null ||
      this.now() - this.lastShownAt < BOARD_HINT_WARM_MS;
    if (warm) {
      this.set({ element, tapped: false });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.hovered === element) this.set({ element, tapped: false });
    }, BOARD_HINT_DELAY_MS);
  }

  /** A finger's tap on a hint: shows it, or hides it if it was showing. */
  tap(element: HTMLElement): void {
    this.clearTimer();
    this.hovered = null;
    this.set(
      this.showing?.element === element ? null : { element, tapped: true }
    );
  }

  /** A press anywhere, the pointer leaving, or a drag: no tooltip. */
  hide(): void {
    this.clearTimer();
    this.hovered = null;
    this.set(null);
  }

  dispose(): void {
    this.clearTimer();
  }

  private set(showing: BoardHintShowing | null): void {
    if (this.showing) this.lastShownAt = this.now();
    if (
      showing?.element === this.showing?.element &&
      showing?.tapped === this.showing?.tapped
    )
      return;
    this.showing = showing;
    this.show(showing);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

interface Placement {
  readonly left: number;
  readonly top: number;
  readonly side: 'top' | 'bottom';
}

/** Above its anchor, centred, kept on screen; below when there is no room. */
export const placeBoardHint = (
  anchor: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number }
): Placement => {
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.min(
    Math.max(centre - size.width / 2, BOARD_HINT_EDGE_PX),
    Math.max(
      BOARD_HINT_EDGE_PX,
      viewport.width - BOARD_HINT_EDGE_PX - size.width
    )
  );
  const above = anchor.top - BOARD_HINT_GAP_PX - size.height;
  return above >= BOARD_HINT_EDGE_PX ||
    anchor.bottom + BOARD_HINT_GAP_PX + size.height >
      viewport.height - BOARD_HINT_EDGE_PX
    ? { left, top: Math.max(BOARD_HINT_EDGE_PX, above), side: 'top' }
    : { left, top: anchor.bottom + BOARD_HINT_GAP_PX, side: 'bottom' };
};

/**
 * The tooltip itself, over everything on the page. It reads its words from
 * the anchor on every render, so a count that changes under it stays true.
 */
export const BoardHintTooltip = ({
  showing,
  layoutKey,
}: {
  readonly showing: BoardHintShowing | null;
  /** Changes when the table is laid out again: the anchor may have moved. */
  readonly layoutKey?: unknown;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [entered, setEntered] = useState(false);
  // Hidden, the last one fades out where it was (as the app's tooltips
  // do), no longer a tooltip to assistive technology or a query.
  const lastShown = useRef<{ element: HTMLElement; text: string } | null>(null);
  const [leaving, setLeaving] = useState<{
    element: HTMLElement;
    text: string;
  } | null>(null);
  const showingElement = showing?.element ?? null;
  const element = showingElement ?? leaving?.element ?? null;
  const text =
    showingElement === null && leaving
      ? leaving.text
      : element?.isConnected
        ? (element.dataset.boardHint ?? '')
        : '';
  useEffect(() => {
    if (showingElement) {
      setLeaving(null);
      return;
    }
    const last = lastShown.current;
    lastShown.current = null;
    if (!last) return;
    setLeaving(last);
    // Its exit (overlays.css, data-ending-style) ends well within this.
    const timer = setTimeout(() => setLeaving(null), BOARD_HINT_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [showingElement]);
  if (showingElement && text !== '')
    lastShown.current = { element: showingElement, text };
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!element?.isConnected || !popup) {
      setPlacement(null);
      return;
    }
    const size = popup.getBoundingClientRect();
    setPlacement(
      placeBoardHint(
        element.getBoundingClientRect(),
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [element, text, layoutKey]);
  useEffect(() => {
    setEntered(false);
    if (!element) return;
    // One frame at its starting style, so it fades in (overlays.css).
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [element]);
  if (!element || text === '' || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="ptcgsim-ui-tooltip-positioner ptcgsim-board-hint"
      style={
        {
          position: 'fixed',
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          zIndex: 'var(--layer-tooltip, 10000)',
          pointerEvents: 'none',
          visibility: placement ? 'visible' : 'hidden',
          '--transform-origin':
            placement?.side === 'bottom' ? 'top center' : 'bottom center',
        } as CSSProperties
      }
    >
      <div
        ref={ref}
        {...(showingElement
          ? { role: 'tooltip' }
          : { 'aria-hidden': true, 'data-ending-style': '' })}
        className="ptcgsim-ui-tooltip"
        data-side={placement?.side ?? 'top'}
        {...(entered && placement ? {} : { 'data-starting-style': '' })}
      >
        {text}
      </div>
    </div>,
    document.body
  );
};
