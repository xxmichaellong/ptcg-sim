import { CARD_ASPECT_RATIO, type Rect } from '@ptcgsim/renderer-contract';

/**
 * Where the board overlays sit and how large their cards are. Every size is
 * derived from the board area (the scene viewport the overlays are laid over)
 * so a card stays readable whatever the window: a card in a zone browser,
 * work area or stack view is about a third of the board's height, never more
 * than 300px tall, and the panels grow to most of the board to hold them.
 *
 * Pure functions of scene geometry, so they can be unit-tested and so the
 * overlays never measure the DOM to lay themselves out.
 */
export interface OverlayBoardSize {
  readonly width: number;
  readonly height: number;
}

export interface OverlayPanelLayout {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Painted height of each card in the panel; width follows the card shape. */
  readonly cardHeight: number;
}

/** The largest a card in a panel is drawn: a third of the board, at most 300px. */
export const OVERLAY_CARD_HEIGHT_RATIO = 0.34;
export const OVERLAY_CARD_MAX_HEIGHT = 300;
/**
 * The size big piles step down to, so a deck shows more than two rows. Never
 * below v1's largest pile browser (the Lost Zone's, about 25% of the board).
 */
export const OVERLAY_COMPACT_CARD_HEIGHT_RATIO = 0.26;
export const OVERLAY_COMPACT_CARD_MAX_HEIGHT = 280;
/** Below this a card is not worth drawing larger than the table does. */
export const OVERLAY_CARD_MIN_HEIGHT = 72;

/** Panel chrome, in CSS px; the stylesheet draws exactly these. */
export const OVERLAY_PANEL_PADDING = 16;
export const OVERLAY_CARD_GAP = 12;
export const OVERLAY_HEADER_HEIGHT = 56;
export const OVERLAY_ACTIONS_HEIGHT = 58;
export const OVERLAY_PANEL_BORDER = 1;
/** Room for a vertical scrollbar, so a scrolling grid keeps its columns. */
export const OVERLAY_SCROLLBAR_ALLOWANCE = 12;
/** Room for a panel's title bar: its name, count, owner and four buttons. */
export const OVERLAY_PANEL_MIN_WIDTH = 760;
export const OVERLAY_PANEL_MAX_WIDTH = 1480;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

const finiteCount = (count: number): number =>
  Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

/** The gap kept between a panel and the edge of the board. */
export const overlayBoardMargin = (board: OverlayBoardSize): number =>
  clamp(Math.round(Math.min(board.width, board.height) * 0.03), 12, 32);

/** The largest card size for a board: min(34% of its height, 300px). */
export const overlayLargeCardHeight = (board: OverlayBoardSize): number =>
  Math.max(
    OVERLAY_CARD_MIN_HEIGHT,
    Math.min(board.height * OVERLAY_CARD_HEIGHT_RATIO, OVERLAY_CARD_MAX_HEIGHT)
  );

const overlayCompactCardHeight = (board: OverlayBoardSize): number =>
  Math.max(
    OVERLAY_CARD_MIN_HEIGHT,
    Math.min(
      board.height * OVERLAY_COMPACT_CARD_HEIGHT_RATIO,
      OVERLAY_COMPACT_CARD_MAX_HEIGHT
    )
  );

const cardWidthFor = (cardHeight: number): number =>
  cardHeight * CARD_ASPECT_RATIO;

/** How many cards of one height fit across a content width. */
const columnsFor = (contentWidth: number, cardHeight: number): number =>
  Math.max(
    1,
    Math.floor(
      (contentWidth + OVERLAY_CARD_GAP) /
        (cardWidthFor(cardHeight) + OVERLAY_CARD_GAP)
    )
  );

const runLength = (count: number, size: number): number =>
  count * size + Math.max(0, count - 1) * OVERLAY_CARD_GAP;

/**
 * The zone browser (deck, discard, Lost Zone, prizes, ...): a wrapping grid
 * centred on the board. Cards are drawn at the large size while the pile fits
 * in two rows, and at the compact size beyond that; the panel shrinks to its
 * content and grows to the whole board less a margin, scrolling past that.
 */
export const zoneBrowserLayout = (
  board: OverlayBoardSize,
  cardCount: number
): OverlayPanelLayout => {
  const count = finiteCount(cardCount);
  const margin = overlayBoardMargin(board);
  const maxWidth = Math.min(board.width - 2 * margin, OVERLAY_PANEL_MAX_WIDTH);
  const maxHeight = board.height - 2 * margin;
  const chromeWidth =
    2 * OVERLAY_PANEL_PADDING +
    2 * OVERLAY_PANEL_BORDER +
    OVERLAY_SCROLLBAR_ALLOWANCE;
  const maxContentWidth = maxWidth - chromeWidth;
  const large = overlayLargeCardHeight(board);
  const cardHeight =
    count <= columnsFor(maxContentWidth, large) * 2
      ? large
      : Math.min(large, overlayCompactCardHeight(board));
  const columns = Math.min(
    Math.max(1, count),
    columnsFor(maxContentWidth, cardHeight)
  );
  const rows = Math.max(1, Math.ceil(count / columns));
  const chromeHeight =
    OVERLAY_HEADER_HEIGHT +
    2 * OVERLAY_PANEL_PADDING +
    2 * OVERLAY_PANEL_BORDER;
  const width = clamp(
    runLength(columns, cardWidthFor(cardHeight)) + chromeWidth,
    Math.min(OVERLAY_PANEL_MIN_WIDTH, maxWidth),
    maxWidth
  );
  const height = clamp(
    chromeHeight + runLength(rows, cardHeight),
    Math.min(chromeHeight + cardHeight, maxHeight),
    maxHeight
  );
  return {
    left: (board.width - width) / 2,
    top: (board.height - height) / 2,
    width,
    height,
    cardHeight,
  };
};

/**
 * A work area ("Looking at cards...", "Move attached cards"): one scrolling
 * row of large cards. The scene still lays the area out where v1's popup sat
 * and paints its own copies of the cards there, so the panel always covers
 * that box; it is centred on it and grows to fit its cards, staying on the
 * board.
 */
export const workAreaPanelLayout = (
  zoneBounds: Rect,
  board: OverlayBoardSize,
  cardCount: number,
  withActions: boolean
): OverlayPanelLayout => {
  const count = Math.max(1, finiteCount(cardCount));
  const margin = overlayBoardMargin(board);
  const maxWidth = board.width - 2 * margin;
  const maxHeight = board.height - 2 * margin;
  const chrome =
    OVERLAY_HEADER_HEIGHT +
    2 * OVERLAY_PANEL_PADDING +
    2 * OVERLAY_PANEL_BORDER +
    OVERLAY_SCROLLBAR_ALLOWANCE +
    (withActions ? OVERLAY_ACTIONS_HEIGHT : 0);
  const cardHeight = Math.max(
    OVERLAY_CARD_MIN_HEIGHT,
    Math.min(overlayLargeCardHeight(board), maxHeight - chrome)
  );
  const width = clamp(
    Math.max(
      zoneBounds.width,
      OVERLAY_PANEL_MIN_WIDTH,
      runLength(count, cardWidthFor(cardHeight)) +
        2 * OVERLAY_PANEL_PADDING +
        2 * OVERLAY_PANEL_BORDER
    ),
    0,
    maxWidth
  );
  const height = clamp(
    Math.max(zoneBounds.height, chrome + cardHeight),
    0,
    maxHeight
  );
  const centerX = zoneBounds.x + zoneBounds.width / 2;
  const centerY = zoneBounds.y + zoneBounds.height / 2;
  return {
    left: clamp(centerX - width / 2, margin, board.width - margin - width),
    top: clamp(centerY - height / 2, margin, board.height - margin - height),
    width,
    height,
    cardHeight,
  };
};

/**
 * The stack view (double-click or V on a card in play): the stack's cards
 * upright and side by side over their player's half, in up to three rows,
 * each card as large as the board allows.
 */
export const stackPreviewLayout = (
  frameBounds: Rect,
  board: OverlayBoardSize,
  cardCount: number
): OverlayPanelLayout => {
  const count = Math.max(1, finiteCount(cardCount));
  const margin = overlayBoardMargin(board);
  const chrome = 2 * OVERLAY_PANEL_PADDING + 2 * OVERLAY_PANEL_BORDER;
  // One pixel of slack keeps sub-pixel rounding from wrapping a column.
  const slack = 1;
  const maxContentWidth = board.width - 2 * margin - chrome - slack;
  const maxContentHeight = board.height - 2 * margin - chrome;
  const large = overlayLargeCardHeight(board);
  let best = { cardHeight: 0, columns: count, rows: 1 };
  for (let rows = 1; rows <= Math.min(3, count); rows += 1) {
    const columns = Math.ceil(count / rows);
    const byWidth =
      (maxContentWidth - (columns - 1) * OVERLAY_CARD_GAP) /
      columns /
      CARD_ASPECT_RATIO;
    const byHeight = (maxContentHeight - (rows - 1) * OVERLAY_CARD_GAP) / rows;
    const cardHeight = Math.min(large, byWidth, byHeight);
    if (cardHeight > best.cardHeight + 0.5) {
      best = { cardHeight, columns, rows };
    }
  }
  const cardHeight = Math.max(OVERLAY_CARD_MIN_HEIGHT, best.cardHeight);
  const width =
    runLength(best.columns, cardWidthFor(cardHeight)) + chrome + slack;
  const height = runLength(best.rows, cardHeight) + chrome;
  const centerX = frameBounds.x + frameBounds.width / 2;
  const centerY = frameBounds.y + frameBounds.height / 2;
  return {
    left: clamp(centerX - width / 2, margin, board.width - margin - width),
    top: clamp(centerY - height / 2, margin, board.height - margin - height),
    width,
    height,
    cardHeight,
  };
};
