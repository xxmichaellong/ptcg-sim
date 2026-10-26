import { CARD_ASPECT_RATIO } from './geometry.js';
import {
  createBoardLayoutSnapshot,
  resizeBoardLayoutState,
  type BoardLayoutCountLabel,
  type BoardLayoutRegion,
  type BoardLayoutRegionKind,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type BoardPlayerLayout,
  type BoardResizeHandleId,
  type BoardResizeHandleLayout,
  type BoardVerticalLayoutState,
  type BoxEdgesPx,
} from './layout.js';
import type { BoardSide, BoardViewport, Rect } from './model.js';

/**
 * Geometry v2: the table laid out like the official play mat at sizes you
 * can read (ADR-027). Each half follows the mat -- prizes as a 2 x 3 grid on
 * the outer left, the Active at the centre line with a staging area beside
 * it, five bench slots below, deck, discard and Lost Zone down the right --
 * and the hand runs along the screen edge, its cards partly off-screen until
 * hovered. The opponent's half is the same mat turned around.
 *
 * It produces the same snapshot shape as v1, so scenes, hit-testing and
 * renderers are unchanged; only the numbers differ.
 */
export const TABLE_LAYOUT_GEOMETRY_VERSION = 2 as const;

/**
 * The right-hand rail (log, chat, settings) beside the table. Mirrored by
 * `--rail-width` in the web app's stylesheet.
 */
export const TABLE_SHELL = {
  railMinimumPx: 300,
  railMaximumPx: 380,
  railViewportRatio: 0.23,
} as const;

export const tableRailWidth = (viewportWidth: number): number =>
  Math.round(
    Math.min(
      TABLE_SHELL.railMaximumPx,
      Math.max(
        TABLE_SHELL.railMinimumPx,
        viewportWidth * TABLE_SHELL.railViewportRatio
      )
    )
  );

/**
 * How much of a near hand's strip the far hand's keeps. The far hand is the
 * one across the table -- usually the opponent's, which a player reads far
 * less than their own -- so its cards show smaller and the room goes to both
 * boards.
 */
export const TABLE_FAR_HAND_SCALE = 0.6;

/**
 * The near half's default share of the table: the whole percentage that
 * gives both halves card rows of about the same size (the near ones a hair
 * larger) once the far hand's strip is the smaller one.
 */
const DEFAULT_LOWER_SHARE = 0.54;
/** An even split, where both hands were the same size. */
const EVEN_SPLIT_SHARE = 0.5;
const MINIMUM_HALF_SHARE = 0.34;
const HANDLE_HEIGHT_RATIO = 0.025 as const;

/**
 * How the table may be split between the halves: the lower half's share of
 * the height. Neither half may shrink below a third of the table.
 */
export const TABLE_SPLIT = {
  minimumLowerShare: MINIMUM_HALF_SHARE,
  maximumLowerShare: 1 - MINIMUM_HALF_SHARE,
  defaultLowerShare: DEFAULT_LOWER_SHARE,
} as const;

/** The vertical state for a table whose lower half takes `lowerShare`. */
export const tableVerticalLayout = (
  lowerShare: number
): BoardVerticalLayoutState => {
  const lower = Number.isFinite(lowerShare)
    ? Math.min(
        TABLE_SPLIT.maximumLowerShare,
        Math.max(TABLE_SPLIT.minimumLowerShare, lowerShare)
      )
    : DEFAULT_LOWER_SHARE;
  return {
    lowerFrame: { bottomRatio: 0, heightRatio: lower },
    upperFrame: { bottomRatio: lower, heightRatio: 1 - lower },
    lowerHandle: { bottomRatio: lower, heightRatio: HANDLE_HEIGHT_RATIO },
    upperHandle: {
      bottomRatio: Math.min(1, lower + 0.03),
      heightRatio: HANDLE_HEIGHT_RATIO,
    },
    sharedPlacement: 'handleMidpoint',
  };
};

export const DEFAULT_TABLE_VERTICAL_LAYOUT: BoardVerticalLayoutState =
  tableVerticalLayout(DEFAULT_LOWER_SHARE);

/** Proportions of one half, as fractions of its height (own frame). */
interface HalfProportions {
  /** How much of the hand cards shows above the screen edge. */
  readonly handStrip: number;
  readonly margin: number;
  readonly rowGap: number;
  /** Share of the two card rows given to the Active (the rest to the bench). */
  readonly activeShare: number;
}

const HALF_PROPORTIONS: HalfProportions = {
  handStrip: 0.27,
  margin: 0.045,
  rowGap: 0.025,
  activeShare: 0.54,
};

/** The share of a hand card that shows; the rest runs off the screen. */
export const TABLE_HAND_VISIBLE_SHARE = 0.8;

/**
 * The corner of each hand strip beside the hand, kept clear: the hand
 * starts past it. Mirrored by the web app's chrome stylesheet, which lays
 * v1's markers there.
 */
export const TABLE_CONTROL_CORNER_PX = 96;

/**
 * How far up from the player's edge v1's corner controls reach: its
 * VSTAR/GX markers stacked under the hand-sort control. A hand strip
 * shorter than this lays them side by side instead (the web app's chrome),
 * which needs only TABLE_COMPACT_CORNER_HEIGHT_PX; a portrait strip is at
 * least that deep.
 */
export const TABLE_CONTROL_CORNER_HEIGHT_PX = 104;
export const TABLE_COMPACT_CORNER_HEIGHT_PX = 56;

/** Room at the far end of each hand strip for its card-count badge. */
const HAND_COUNT_SLOT_PX = 44;

/**
 * The least a far hand keeps past the app bar: a layout that leaves it less
 * gives way to one that doesn't (`bestOf`).
 */
const MIN_FAR_HAND_PX = 128;
/** The least an Active card keeps: the app bar's corner never costs the board more. */
const MIN_BOARD_ROW_PX = 12;
/** The least clear space between a pile and the screen edge. */
const PILE_EDGE_MARGIN_PX = 12;

const ZERO_EDGES: BoxEdgesPx = { top: 0, right: 0, bottom: 0, left: 0 };

interface LocalRegion {
  readonly kind: BoardLayoutRegionKind;
  /** In the half's own frame: top is the centre line, bottom the player's edge. */
  readonly rect: Rect;
  readonly countAnchor?: 'pile' | 'hand';
}

interface HalfGeometry {
  readonly regions: readonly LocalRegion[];
  /**
   * The pieces beside the prizes, in the half's own frame: the VSTAR/GX
   * markers (where the viewer keeps them), the coin under them, and the
   * control that adds or removes the optional pieces.
   */
  readonly extras: {
    readonly markers?: Rect;
    readonly coin: Rect;
    readonly control: Rect;
  };
  /** The Lost Zone lies beside the pieces, not in the piles' column. */
  readonly lostZoneBeside: boolean;
  /**
   * The least the staging area keeps when it makes room for the Stadium
   * (`boardStartReservePx`): a pile's width. Short of that it stays whole.
   */
  readonly boardMinWidth: number;
  readonly cardHeights: { readonly active: number; readonly bench: number };
  readonly middle: { readonly left: number; readonly right: number };
  /** The clear band between this half's cards and the centre line. */
  readonly seamMargin: number;
}

/** What a half's layout takes from the layout state beyond its size. */
interface HalfOptions {
  /** The least height of the clear band at the centre line (both halves). */
  readonly seamBandPx?: number;
  /**
   * Room kept clear at the staging area's Active end: on the far half that
   * is where the Stadium straddles the centre line, and the two must not
   * overlap.
   */
  readonly boardStartReservePx?: number;
  /**
   * The Lost Zone is on the table (not optional-and-hidden): it sits beside
   * the pieces by the prizes, toward the centre line, where the row has
   * room, rather than at the end of the piles' column.
   */
  readonly lostZoneBeside?: boolean;
  /** How many once-per-game markers sit beside the prizes, 0 to 2. */
  readonly markerCount?: number;
  /** The hand strip's size against a near hand's: smaller across the table. */
  readonly handScale?: number;
  /**
   * Room kept clear at the hand strip's start (its left in the half's own
   * frame): across the table that is the window's top-right corner, where
   * the app bar sits.
   */
  readonly handStartReservePx?: number;
  /** The least depth of the hand strip: across the table, the bar's corner. */
  readonly minHandStripPx?: number;
  /**
   * Extra clear height at the centre-line edge of a half that fills the
   * table: its top is the window's top, where the app bar sits.
   */
  readonly topReservePx?: number;
  /**
   * Lay the mat out only this tall, at the player's edge; the rest of the
   * half widens the clear band at the centre line. A table too narrow for
   * the cards its height would give keeps them smaller this way.
   */
  readonly fitHeight?: number;
  /**
   * Fit the portrait mat to `fitHeight` too (its rows shrink to it). Only
   * the far half refitted around the app bar asks; the split search's
   * fitting leaves a portrait mat as it is.
   */
  readonly fitPortrait?: boolean;
  /**
   * The portrait mat keeps the Stadium's room beside its pieces, as the
   * mat always does: a half alone, whose Stadium lies in its Active's row
   * rather than in the band at the seam.
   */
  readonly stadiumBeside?: boolean;
  /**
   * The mat this half takes, decided for both halves together when both
   * are shown (`jointMat`), so the two sides of the table match.
   */
  readonly mat?: Mat;
}

/** The mat (columns down the sides) or the portrait mat (rows down the middle). */
type Mat = 'landscape' | 'portrait';

/**
 * The clear band between a half's cards and the centre line. It doubles as
 * the seam band the table controls sit in, so it is generous, and a touch
 * device can ask for more (`seamBandPx`) to give the controls finger-sized
 * targets.
 */
const seamMarginFor = (height: number, options: HalfOptions): number =>
  Math.max(
    Math.max(10, Math.min(24, height * HALF_PROPORTIONS.margin)),
    (options.seamBandPx ?? 0) / 2
  );

/**
 * A half that fills the whole table (the other one hidden) keeps this much
 * clear at the centre line for the table controls.
 */
const SOLO_SEAM_BAND_PX = 44;
/** The gap between those controls and the Active row beside them. */
const SOLO_CONTROLS_GAP_PX = 6;
/**
 * The app bar's inset from the window's top and right edges (ADR-036). The
 * web app's stylesheet places the bar there; the layout keeps the same box
 * clear, with as much again between the bar and the far hand.
 */
export const APP_BAR_INSET_PX = 8;
/**
 * The VSTAR/GX markers' column beside the prizes, as a share of a pile's
 * width; each marker is half as tall as the column is wide.
 */
const MARKER_COLUMN_SHARE = 0.62;
/**
 * The least a marker keeps, as tall as a finger can press and its art can
 * be read (v1's corner markers were 24px): on a small table the column
 * keeps it, and a row too short to stack two lays them side by side.
 */
const MIN_MARKER_HEIGHT_PX = 22;
/** A VSTAR marker's width for its height (the GX one is narrower). */
const VSTAR_MARKER_ASPECT = 2;
const GX_MARKER_ASPECT = 1.5;
/**
 * Each player's coin lies under their markers, in their column: about a
 * third of an Active card tall, and at least `COIN_ROOMY_PX` where the row
 * has room for that, within the bounds below; never larger than the row's
 * room under the markers.
 */
const COIN_SHARE_OF_ACTIVE = 0.34;
/** The size a smaller third grows to where the row has room. */
const COIN_ROOMY_PX = 34;
/**
 * The least a coin is drawn at: a touch target's least (WCAG 2.5.8). A
 * smaller one is left off the table, and so is the other half's then (the
 * rail offers Coin instead).
 */
export const TABLE_COIN_MIN_PX = 24;
export const TABLE_COIN_MAX_PX = 64;
/** The add-or-remove control for the optional pieces: a small round button. */
const EXTRAS_CONTROL_PX = 26;
/** How far its touch area reaches past it (TableZoneAffordances.css). */
const EXTRAS_CONTROL_REACH_PX = 9;
/** Its inset from the corner of the row it sits in. */
const EXTRAS_CONTROL_INSET_PX = 6;
/**
 * How far a pile's count badge stands out past its corner (the DOM
 * renderer's badge margin), and a little more: the `+` past the Lost Zone
 * keeps clear of its count.
 */
const PILE_BADGE_REACH_PX = 13;
/** The clear space kept between the Stadium and anything beside it. */
const STADIUM_CLEARANCE_PX = 8;
/**
 * The Stadium straddles the centre line beside the Actives, on the near
 * player's left, this share of its width clear of them.
 */
const STADIUM_ACTIVE_GAP_SHARE = 0.35;
/**
 * Less overlap than this, in px², is none: a place found at an obstacle's
 * edge plus the clearance can cover a floating-point sliver of it, and a
 * Stadium that took that for cover would jump as the window resized.
 */
const CLEAR_PX2 = 0.5;
/**
 * Where a Stadium the size of a bench card has no clear place (a small
 * table), it is tried down to these shares of that size before it lies
 * over anything.
 */
const STADIUM_FIT_SHARES = [0.9, 0.8, 0.7] as const;
/**
 * How far below an even split's fit the far half alone may be fitted to
 * keep the Stadium off it with the app bar (a share of that fit).
 */
const FAR_REFIT_FLOOR = 0.8;
/** The far half's refit tries its fits this far apart, then refines. */
const FAR_REFIT_STEP = 0.01;
/** Its first step, just below the fit found, is tried this finely. */
const FAR_REFIT_FINE_STEPS = 10;
/**
 * More of the far half under the Stadium than without the app bar, in
 * px², that is not worth refitting it for (a sliver).
 */
const STADIUM_OVERLAP_SLACK_PX2 = 24;
/** The bench row must hold this many bench cards side by side. */
const BENCH_FIT_CARDS = 5.5;
/** The Active's slot holds a stack with attachments peeking out: this many cards wide. */
const ACTIVE_SLOT_CARDS = 2.2;

/**
 * The clear space between the outer columns (prizes, piles) and the side
 * of the mat: a small, steady inset, so the columns run out to its edges.
 */
const sideMarginFor = (width: number): number =>
  Math.max(8, Math.min(14, width * 0.008));

/**
 * The column beside the prizes, toward the centre line, that holds a
 * player's VSTAR/GX markers (stacked, VSTAR above GX, or side by side where
 * the row is too short to stack them) and their coin under them, at the
 * top of the Active's row: as wide as the wider of the two.
 */
const piecesColumn = (
  x: number,
  top: number,
  pileWidth: number,
  activeHeight: number,
  gap: number,
  markerCount: number
): {
  readonly width: number;
  readonly markers?: Rect;
  readonly coin: Rect;
} => {
  const markerHeight = Math.min(
    activeHeight,
    Math.max(
      (pileWidth * MARKER_COLUMN_SHARE) / VSTAR_MARKER_ASPECT,
      MIN_MARKER_HEIGHT_PX
    )
  );
  const between = gap / 2;
  const stacked = markerCount * markerHeight + (markerCount - 1) * between;
  const sideBySide = markerCount > 1 && stacked > activeHeight;
  const markersHeight = sideBySide ? markerHeight : stacked;
  const markersWidth = sideBySide
    ? markerHeight * (VSTAR_MARKER_ASPECT + GX_MARKER_ASPECT) + between
    : markerHeight * VSTAR_MARKER_ASPECT;
  // As big as a third of the Active, or the roomy size, as the row's room
  // under the markers allows.
  const room = activeHeight - (markerCount > 0 ? markersHeight + gap : 0);
  const coinSize = Math.max(
    0,
    Math.min(
      TABLE_COIN_MAX_PX,
      room,
      Math.max(activeHeight * COIN_SHARE_OF_ACTIVE, COIN_ROOMY_PX)
    )
  );
  const width = Math.max(markersWidth, coinSize);
  const markers: Rect | undefined =
    markerCount > 0
      ? {
          x: x + (width - markersWidth) / 2,
          y: top,
          width: markersWidth,
          height: markersHeight,
        }
      : undefined;
  return {
    width,
    ...(markers ? { markers } : {}),
    coin: {
      x: x + (width - coinSize) / 2,
      y: markers ? markers.y + markers.height + gap : top,
      width: coinSize,
      height: coinSize,
    },
  };
};

/**
 * The coin, ending clear of the `+` and its touch area where a row too
 * narrow for the `+` beside the pieces brings it under the column's edge: a
 * smaller coin, still centred in the column, rather than one a press meant
 * for the `+` can land on.
 */
const coinAbove = (coin: Rect, control: Rect, gap: number): Rect => {
  const reach = Math.max(gap / 2, EXTRAS_CONTROL_REACH_PX);
  const beside =
    control.x - reach >= coin.x + coin.width ||
    control.x + control.width + reach <= coin.x;
  const room = control.y - reach - coin.y;
  if (beside || room >= coin.height) return coin;
  const size = Math.max(0, room);
  return {
    x: coin.x + (coin.width - size) / 2,
    y: coin.y,
    width: size,
    height: size,
  };
};

/** Lay out one half in its own frame, centre line at the top. */
const layoutHalf = (
  width: number,
  height: number,
  options: HalfOptions = {}
): HalfGeometry => {
  const proportions = HALF_PROPORTIONS;
  const margin = seamMarginFor(height, options);
  // The outer columns run out close to the mat's edges.
  const side = sideMarginFor(width);
  const gap = Math.max(6, height * proportions.rowGap);
  // Across the table on a short screen the strip is at least as deep as
  // the app bar's corner, so nothing else lies under the bar.
  const natural = height * proportions.handStrip * (options.handScale ?? 1);
  // Never so deep that the board keeps no rows to speak of: on the
  // smallest tables the bar's corner gives way first.
  const roomForStrip = Math.max(
    natural,
    height - margin - 2 * gap - MIN_BOARD_ROW_PX / proportions.activeShare
  );
  const handStrip = Math.min(
    height,
    Math.max(natural, Math.min(options.minHandStripPx ?? 0, roomForStrip))
  );
  const rows = Math.max(0, height - handStrip - margin - 2 * gap);
  const active = rows * proportions.activeShare;
  const bench = rows - active;
  const activeTop = margin;
  const benchTop = activeTop + active + gap;
  const handTop = height - handStrip;

  // Prizes: 2 x 3 grid down the outer left, spanning both card rows.
  const prizeGap = Math.max(4, gap * 0.5);
  const prizeHeight = Math.max(0, (active + gap + bench - 2 * prizeGap) / 3);
  const prizeWidth = prizeHeight * CARD_ASPECT_RATIO;
  const prizes: Rect = {
    x: side,
    y: activeTop,
    width: 2 * prizeWidth + prizeGap,
    height: active + gap + bench,
  };
  // Deck, discard and Lost Zone down the right, from the centre line toward
  // the player's edge, each the size of a bench card where the half is tall
  // enough. The Lost Zone is a full pile, not a corner token: Lost Zone decks
  // read its top card and count all game.
  const pileHeight = Math.max(
    0,
    Math.min(
      bench,
      (height - margin - Math.max(PILE_EDGE_MARGIN_PX, margin / 2) - 2 * gap) /
        3
    )
  );
  const pileWidth = pileHeight * CARD_ASPECT_RATIO;

  // Reserve equal space for the outer columns so both Actives and benches
  // share the table's centre, even though prizes are wider than a pile.
  const middleLeft = side + Math.max(prizes.width, pileWidth) + gap * 1.5;
  const middleRight = width - middleLeft;
  const middleWidth = Math.max(0, middleRight - middleLeft);
  const centre = width / 2;
  // Beside the prizes, toward the centre line, the pieces the viewer keeps
  // on the table: the VSTAR/GX markers, which players keep by their prizes,
  // with the coin under them, then the Lost Zone pile where the row has
  // room. Between them and the Active the felt stays clear for the
  // Stadium, which straddles the centre line there on the near player's
  // left (across the table that is the far player's right, where their
  // staging area meets it). The far half keeps the same room, so both
  // halves are the one mat.
  const markerCount = Math.max(0, Math.min(2, options.markerCount ?? 0));
  const column = piecesColumn(
    middleLeft,
    activeTop,
    pileWidth,
    active,
    gap,
    markerCount
  );
  const stadiumRoom =
    bench * CARD_ASPECT_RATIO * (1 + STADIUM_ACTIVE_GAP_SHARE) +
    STADIUM_CLEARANCE_PX;
  const beforeActive = column.width + gap + stadiumRoom + gap;
  // The Active slot is wide enough for a stack with attachments peeking
  // out, and leaves that room on its left (the staging area as much on its
  // right); never narrower than its card.
  const activeWidth = Math.min(
    middleWidth,
    Math.max(
      active * CARD_ASPECT_RATIO,
      Math.min(
        active * CARD_ASPECT_RATIO * ACTIVE_SLOT_CARDS,
        middleWidth - 2 * beforeActive
      )
    )
  );
  const activeRect: Rect = {
    x: centre - activeWidth / 2,
    y: activeTop,
    width: activeWidth,
    height: active,
  };
  const lostZoneBeside =
    options.lostZoneBeside === true &&
    activeRect.x - middleLeft >= beforeActive + pileWidth + gap;
  let piecesRight = middleLeft + column.width;
  let lostZone: Rect | undefined;
  if (lostZoneBeside) {
    lostZone = {
      x: piecesRight + gap,
      y: activeTop,
      width: pileWidth,
      height: Math.min(pileHeight, active),
    };
    piecesRight = lostZone.x + lostZone.width;
  }
  // The control that adds or removes them sits just past them, at the
  // row's edge toward the player, below where the Stadium reaches, and
  // short of the Active.
  const control: Rect = {
    x: Math.min(
      piecesRight + (lostZone ? Math.max(gap, PILE_BADGE_REACH_PX) : gap),
      activeRect.x - gap - EXTRAS_CONTROL_PX
    ),
    y: activeTop + active - EXTRAS_CONTROL_INSET_PX - EXTRAS_CONTROL_PX,
    width: EXTRAS_CONTROL_PX,
    height: EXTRAS_CONTROL_PX,
  };
  // With the Lost Zone beside the prizes, the deck and discard have the
  // outer column to themselves: they grow to fill both card rows, never
  // past the Active's size. Otherwise the column keeps a slot for it.
  const columnPile = lostZoneBeside
    ? Math.max(pileHeight, Math.min(active, (active + bench) / 2))
    : pileHeight;
  const columnWidth = columnPile * CARD_ASPECT_RATIO;
  const columnAt = (index: number): Rect => ({
    x: width - side - columnWidth,
    y: activeTop + index * (columnPile + gap),
    width: columnWidth,
    height: columnPile,
  });
  const deck = columnAt(0);
  const discard = columnAt(1);
  // The bench runs from the prizes to the piles.
  const benchRight = deck.x - gap * 1.5;
  const benchRect: Rect = {
    x: middleLeft,
    y: benchTop,
    width: Math.max(0, benchRight - middleLeft),
    height: bench,
  };
  // The staging area (v1's loose board) beside the Active on its right, out
  // to the piles. Across the table the Stadium lies at its Active end: it
  // starts past it where that leaves it at least a card wide (a narrow
  // table keeps it whole, under the Stadium's edge).
  const boardStart = activeRect.x + activeRect.width + gap;
  const reserve = options.boardStartReservePx ?? 0;
  const boardLeft =
    benchRight - (boardStart + reserve) >= pileWidth
      ? boardStart + reserve
      : boardStart;
  const boardRect: Rect = {
    x: boardLeft,
    y: activeTop,
    width: Math.max(0, benchRight - boardLeft),
    height: active,
  };
  const handLeft =
    margin +
    Math.max(
      TABLE_CONTROL_CORNER_PX,
      pileWidth + gap * 1.5 + HAND_COUNT_SLOT_PX
    );
  const handRight = width - handLeft;
  const handStart = Math.max(handLeft, options.handStartReservePx ?? 0);
  const handRect: Rect = {
    x: handStart,
    y: handTop,
    width: Math.max(0, handRight - handStart),
    height: handStrip,
  };
  return {
    regions: [
      { kind: 'hand', rect: handRect, countAnchor: 'hand' },
      { kind: 'board', rect: boardRect },
      { kind: 'active', rect: activeRect },
      { kind: 'bench', rect: benchRect },
      { kind: 'prizes', rect: prizes },
      { kind: 'deck', rect: deck, countAnchor: 'pile' },
      { kind: 'discard', rect: discard, countAnchor: 'pile' },
      {
        kind: 'lostZone',
        rect: lostZone ?? columnAt(2),
        countAnchor: 'pile',
      },
    ],
    cardHeights: { active, bench },
    middle: { left: middleLeft, right: Math.max(middleRight, benchRight) },
    seamMargin: margin,
    extras: {
      ...(column.markers ? { markers: column.markers } : {}),
      coin: coinAbove(column.coin, control, gap),
      control,
    },
    lostZoneBeside,
    boardMinWidth: pileWidth,
  };
};

/**
 * A portrait half's rows, as multiples of a bench card's height: the Active
 * a little larger, the piles a little smaller, and the visible strip of the
 * hand.
 */
const PORTRAIT_PROPORTIONS = {
  active: 1.15,
  pile: 0.9,
  handStrip: 0.85,
} as const;

/** Piles side by side keep this much between them for their count badges. */
const PORTRAIT_PILE_GAP_PX = 12;

/**
 * One half of a table that is tall for its width -- a phone held upright, a
 * tablet in portrait -- in its own frame, centre line at the top. The mat's
 * columns become rows: the Active (the markers and coin on its left, the
 * staging area on its right), the bench across the full width, then a row
 * of prizes (three by two) and the deck, discard and Lost Zone side by
 * side, and the hand at the edge. Every card is sized from the bench card,
 * the largest that lets five and a half fit across and every row fit down.
 * The rows sit at the player's edge; any height left over widens the clear
 * band at the centre line.
 */
const layoutHalfPortrait = (
  width: number,
  height: number,
  options: HalfOptions = {}
): HalfGeometry => {
  const proportions = PORTRAIT_PROPORTIONS;
  const margin = seamMarginFor(height, options);
  const edge = Math.max(8, Math.min(16, width * 0.02));
  const pileEdge = Math.max(edge, PILE_EDGE_MARGIN_PX);
  const gap = Math.max(6, Math.min(12, height * 0.02));
  const rowsShare = proportions.active + 1 + proportions.pile;
  const free = Math.max(0, height - margin - 3 * gap);
  // A portrait hand strip is at least as deep as v1's corner controls side
  // by side, and across the table as the app bar's corner.
  const wantedStrip = Math.max(
    TABLE_COMPACT_CORNER_HEIGHT_PX,
    options.minHandStripPx ?? 0
  );
  // Never so deep that the board keeps no rows to speak of: on the
  // smallest tables the bar's corner gives way first.
  const minStrip = Math.min(
    wantedStrip,
    Math.max(
      (free * proportions.handStrip) / (rowsShare + proportions.handStrip),
      free - (rowsShare * MIN_BOARD_ROW_PX) / proportions.active
    )
  );
  let bench = free / (rowsShare + proportions.handStrip);
  if (bench * proportions.handStrip < minStrip) {
    bench = Math.max(0, free - minStrip) / rowsShare;
  }
  bench = Math.min(
    bench,
    (width - 2 * edge) / (BENCH_FIT_CARDS * CARD_ASPECT_RATIO)
  );
  const active = bench * proportions.active;
  const handStrip = Math.min(
    height,
    Math.max(bench * proportions.handStrip, minStrip)
  );

  // The pile row: prizes three across and two down at the outer left, the
  // three piles side by side at the right. Narrower than both, the row's
  // cards shrink until they fit.
  const pileGap = Math.max(gap, PORTRAIT_PILE_GAP_PX);
  const prizeGapFor = (pile: number): number => Math.max(3, pile * 0.025);
  const rowWidthFor = (pile: number): number => {
    const prizeGap = prizeGapFor(pile);
    const prizeWidth = ((pile - prizeGap) / 2) * CARD_ASPECT_RATIO;
    return (
      3 * prizeWidth +
      2 * prizeGap +
      gap +
      3 * pile * CARD_ASPECT_RATIO +
      2 * pileGap
    );
  };
  const rowRoom = Math.max(0, width - edge - pileEdge);
  let pile = bench * proportions.pile;
  if (rowWidthFor(pile) > rowRoom) {
    let low = 0;
    let high = pile;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      if (rowWidthFor(middle) <= rowRoom) low = middle;
      else high = middle;
    }
    pile = low;
  }
  const pileWidth = pile * CARD_ASPECT_RATIO;
  const prizeGap = prizeGapFor(pile);

  const handTop = height - handStrip;
  const pileTop = handTop - gap - pile;
  const benchTop = pileTop - gap - bench;
  const activeTop = Math.max(0, benchTop - gap - active);

  // The markers and coin at the row's outer left, as beside the prizes on
  // the mat, with the control for the optional pieces just past them; the
  // Active keeps clear of both, and the staging area takes the room on its
  // right. The Stadium straddles the centre line on the near player's left,
  // in the clear band or past the pieces (createTableLayoutSnapshot).
  const markerCount = Math.max(0, Math.min(2, options.markerCount ?? 0));
  const column = piecesColumn(
    edge,
    activeTop,
    pileWidth,
    active,
    gap,
    markerCount
  );
  const beforeActive =
    column.width +
    gap +
    (options.stadiumBeside
      ? Math.max(
          EXTRAS_CONTROL_PX,
          bench * CARD_ASPECT_RATIO * (1 + STADIUM_ACTIVE_GAP_SHARE) +
            STADIUM_CLEARANCE_PX
        )
      : EXTRAS_CONTROL_PX) +
    gap;
  const centre = width / 2;
  const activeWidth = Math.min(
    width - 2 * edge,
    Math.max(
      active * CARD_ASPECT_RATIO,
      Math.min(
        active * CARD_ASPECT_RATIO * ACTIVE_SLOT_CARDS,
        width - 2 * (edge + beforeActive)
      )
    )
  );
  const activeRect: Rect = {
    x: centre - activeWidth / 2,
    y: activeTop,
    width: activeWidth,
    height: active,
  };
  const control: Rect = {
    x: edge + column.width + gap,
    y: activeTop + active - EXTRAS_CONTROL_INSET_PX - EXTRAS_CONTROL_PX,
    width: EXTRAS_CONTROL_PX,
    height: EXTRAS_CONTROL_PX,
  };
  // The staging area (v1's loose board) beside the Active on its right;
  // across the table it starts past the Stadium where that leaves it a
  // card wide.
  const boardStart = activeRect.x + activeRect.width + gap;
  const boardEnd = width - edge;
  const reserve = options.boardStartReservePx ?? 0;
  const boardLeft =
    boardEnd - (boardStart + reserve) >= pileWidth
      ? boardStart + reserve
      : boardStart;
  const boardRect: Rect = {
    x: boardLeft,
    y: activeTop,
    width: Math.max(0, boardEnd - boardLeft),
    height: active,
  };
  const benchRect: Rect = {
    x: edge,
    y: benchTop,
    width: Math.max(0, width - 2 * edge),
    height: bench,
  };
  const prizes: Rect = {
    x: edge,
    y: pileTop,
    width: 3 * ((pile - prizeGap) / 2) * CARD_ASPECT_RATIO + 2 * prizeGap,
    height: pile,
  };
  const pileAt = (fromRight: number): Rect => ({
    x: width - pileEdge - pileWidth - fromRight * (pileWidth + pileGap),
    y: pileTop,
    width: pileWidth,
    height: pile,
  });
  // Across the table the hand starts past the app bar.
  const handStart = Math.max(
    TABLE_CONTROL_CORNER_PX,
    options.handStartReservePx ?? 0
  );
  const handRect: Rect = {
    x: handStart,
    y: handTop,
    width: Math.max(0, width - edge - HAND_COUNT_SLOT_PX - handStart),
    height: handStrip,
  };
  return {
    regions: [
      { kind: 'hand', rect: handRect, countAnchor: 'hand' },
      { kind: 'board', rect: boardRect },
      { kind: 'active', rect: activeRect },
      { kind: 'bench', rect: benchRect },
      { kind: 'prizes', rect: prizes },
      { kind: 'deck', rect: pileAt(2), countAnchor: 'pile' },
      { kind: 'discard', rect: pileAt(1), countAnchor: 'pile' },
      { kind: 'lostZone', rect: pileAt(0), countAnchor: 'pile' },
    ],
    cardHeights: { active, bench },
    middle: { left: edge, right: width - edge },
    seamMargin: activeTop,
    // On an upright phone the Lost Zone keeps its place in the pile row.
    extras: {
      ...(column.markers ? { markers: column.markers } : {}),
      coin: column.coin,
      control,
    },
    lostZoneBeside: false,
    boardMinWidth: pileWidth,
  };
};

/** The bench card a half actually shows: five and a half must fit across. */
const benchCardHeightOf = (geometry: HalfGeometry): number =>
  Math.min(
    geometry.cardHeights.bench,
    (geometry.middle.right - geometry.middle.left) /
      (BENCH_FIT_CARDS * CARD_ASPECT_RATIO)
  );

const handWidthOf = (geometry: HalfGeometry): number =>
  geometry.regions.find((region) => region.kind === 'hand')?.rect.width ?? 0;

const handCrampedIn = (geometry: HalfGeometry): boolean =>
  handWidthOf(geometry) < MIN_FAR_HAND_PX;

/**
 * Whichever of the mat (columns down the sides) and the portrait mat (rows
 * down the middle) shows this half's cards larger. Wide halves -- desktops,
 * a tablet or phone held sideways -- get the mat; tall ones, the portrait.
 * Either way the hand keeps room to hold its cards apart: across the table,
 * past the app bar, one that leaves it cramped gives way to one that
 * doesn't, and of two cramped (the narrowest phones) the wider hand wins.
 */
const bestOf = (
  landscape: HalfGeometry,
  portrait: HalfGeometry
): HalfGeometry => {
  const cramped = handCrampedIn(landscape);
  if (cramped !== handCrampedIn(portrait)) {
    return cramped ? portrait : landscape;
  }
  if (cramped) {
    const difference = handWidthOf(portrait) - handWidthOf(landscape);
    if (Math.abs(difference) >= 1) return difference > 0 ? portrait : landscape;
  }
  return benchCardHeightOf(portrait) > benchCardHeightOf(landscape)
    ? portrait
    : landscape;
};

/**
 * A half laid out short of its frame, moved to the player's edge: the
 * `band` left over widens the clear band at the centre line.
 */
const atPlayerEdge = (geometry: HalfGeometry, band: number): HalfGeometry => {
  if (band <= 0) return geometry;
  const lowered = (rect: Rect): Rect => ({ ...rect, y: rect.y + band });
  return {
    regions: geometry.regions.map((region) => ({
      ...region,
      rect: lowered(region.rect),
    })),
    cardHeights: geometry.cardHeights,
    middle: geometry.middle,
    seamMargin: geometry.seamMargin + band,
    extras: {
      ...(geometry.extras.markers
        ? { markers: lowered(geometry.extras.markers) }
        : {}),
      coin: lowered(geometry.extras.coin),
      control: lowered(geometry.extras.control),
    },
    lostZoneBeside: geometry.lostZoneBeside,
    boardMinWidth: geometry.boardMinWidth,
  };
};

/** A half's own choice of mat, at the frame's full height. */
const matOf = (width: number, height: number, options: HalfOptions): Mat => {
  const portrait = layoutHalfPortrait(width, height, options);
  return bestOf(layoutHalf(width, height, options), portrait) === portrait
    ? 'portrait'
    : 'landscape';
};

/** A half's frame and the options it is laid out with. */
interface HalfFrame {
  readonly width: number;
  readonly height: number;
  readonly options: HalfOptions;
}

/**
 * A half's pieces -- its markers, its coin and, on the viewer's own half,
 * the `+` -- clear of its zones and of each other.
 */
const piecesClear = (geometry: HalfGeometry, own: boolean): boolean => {
  const { markers, coin, control } = geometry.extras;
  const pieces = [
    ...(markers ? [markers] : []),
    ...(coin.width >= TABLE_COIN_MIN_PX ? [coin] : []),
    ...(own ? [control] : []),
  ];
  const zones = geometry.regions
    .filter((region) => region.kind !== 'hand')
    .map((region) => region.rect);
  return pieces.every((piece, index) =>
    [...zones, ...pieces.slice(index + 1)].every(
      (other) => overlapArea(piece, other) <= CLEAR_PX2
    )
  );
};

/**
 * The one mat both shown halves take: the one each would choose where they
 * agree. Where they don't (a portrait tablet, whose far half is shorter
 * and holds a smaller hand), the mat that leaves neither hand cramped, then
 * the one whose smaller half shows the larger cards -- if both halves lay
 * it out with their pieces clear, else the other mat if they do. Where
 * neither does, each half keeps its own.
 */
const jointMat = (near: HalfFrame, far: HalfFrame): Mat | undefined => {
  const laidOut = [near, far].map(({ width, height, options }) => ({
    landscape: layoutHalf(width, height, options),
    portrait: layoutHalfPortrait(width, height, options),
  }));
  const [nearOwn, farOwn] = laidOut.map(({ landscape, portrait }) =>
    bestOf(landscape, portrait) === portrait ? 'portrait' : 'landscape'
  );
  if (nearOwn === farOwn) return nearOwn;
  const landscape = laidOut.map((half) => half.landscape);
  const portrait = laidOut.map((half) => half.portrait);
  const cramped = (geometries: readonly HalfGeometry[]): boolean =>
    geometries.some(handCrampedIn);
  const least = (
    geometries: readonly HalfGeometry[],
    measure: (geometry: HalfGeometry) => number
  ): number => Math.min(...geometries.map(measure));
  const preferred = ((): Mat => {
    if (cramped(landscape) !== cramped(portrait)) {
      return cramped(landscape) ? 'portrait' : 'landscape';
    }
    if (cramped(landscape)) {
      const difference =
        least(portrait, handWidthOf) - least(landscape, handWidthOf);
      if (Math.abs(difference) >= 1) {
        return difference > 0 ? 'portrait' : 'landscape';
      }
    }
    return least(portrait, benchCardHeightOf) >
      least(landscape, benchCardHeightOf)
      ? 'portrait'
      : 'landscape';
  })();
  const clear = (mat: Mat): boolean =>
    (mat === 'portrait' ? portrait : landscape).every((geometry, index) =>
      piecesClear(geometry, index === 0)
    );
  if (clear(preferred)) return preferred;
  const other = preferred === 'portrait' ? 'landscape' : 'portrait';
  return clear(other) ? other : undefined;
};

const layoutTableHalf = (
  width: number,
  height: number,
  options: HalfOptions
): HalfGeometry => {
  // Mat or portrait mat is chosen at the frame's full height, so fitting
  // the mat shorter never turns it into the other.
  const portraitWins =
    (options.mat ?? matOf(width, height, options)) === 'portrait';
  const fitted = options.fitHeight;
  if (fitted === undefined || fitted >= height) {
    return portraitWins
      ? layoutHalfPortrait(width, height, options)
      : layoutHalf(width, height, options);
  }
  if (portraitWins) {
    return options.fitPortrait
      ? atPlayerEdge(
          layoutHalfPortrait(width, fitted, options),
          height - fitted
        )
      : layoutHalfPortrait(width, height, options);
  }
  return atPlayerEdge(layoutHalf(width, fitted, options), height - fitted);
};

/**
 * A half given the whole table. Laid out at full height its cards would
 * outgrow the width (the bench no longer fits across), so it takes the
 * tallest layout whose bench still fits -- never smaller than at an even
 * split -- sits at the player's edge, and leaves the rest as a clear band
 * at the centre line.
 */
const layoutSoloHalf = (
  width: number,
  height: number,
  options: HalfOptions = {}
): HalfGeometry => {
  // The band must hold the table controls and their gaps either side, and
  // below the window's top edge the app bar too.
  const soloBand =
    Math.max(
      SOLO_SEAM_BAND_PX,
      (options.seamBandPx ?? 0) + 2 * SOLO_CONTROLS_GAP_PX
    ) + (options.topReservePx ?? 0);
  // Tall, the portrait mat takes the whole height: its rows sit at the
  // player's edge and the rest of the height is the band already.
  const portrait = layoutHalfPortrait(width, height, {
    seamBandPx: 2 * soloBand,
    stadiumBeside: true,
    ...(options.markerCount ? { markerCount: options.markerCount } : {}),
    ...(options.boardStartReservePx
      ? { boardStartReservePx: options.boardStartReservePx }
      : {}),
    ...(options.handStartReservePx
      ? { handStartReservePx: options.handStartReservePx }
      : {}),
    ...(options.minHandStripPx
      ? { minHandStripPx: options.minHandStripPx }
      : {}),
  });
  const fits = (candidate: number): boolean => {
    const geometry = layoutHalf(width, candidate, options);
    return (
      BENCH_FIT_CARDS * geometry.cardHeights.bench * CARD_ASPECT_RATIO <=
      geometry.middle.right - geometry.middle.left
    );
  };
  const available = Math.max(0, height - soloBand);
  let fitted = available;
  if (!fits(available)) {
    // Taller only ever means bigger cards and a narrower middle.
    let low = 0;
    let high = available;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    fitted = Math.max(low, height * EVEN_SPLIT_SHARE);
  }
  const landscape = atPlayerEdge(
    layoutHalf(width, fitted, options),
    height - fitted
  );
  return bestOf(landscape, portrait) === portrait ? portrait : landscape;
};

/** A rect in a half's own frame placed in the window. */
const toPhysical = (rect: Rect, frame: Rect, side: BoardSide): Rect =>
  side === 'local'
    ? {
        x: frame.x + rect.x,
        y: frame.y + rect.y,
        width: rect.width,
        height: rect.height,
      }
    : {
        // The opponent's mat is the same mat turned around: its centre line
        // is at the bottom of its frame.
        x: frame.x + frame.width - rect.x - rect.width,
        y: frame.y + frame.height - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };

const countLabelFor = (
  anchor: 'pile' | 'hand',
  physical: Rect,
  side: BoardSide
): BoardLayoutCountLabel => {
  // Piles wear their count as a badge on the corner nearest the player; the
  // hand shows its count in the slot kept at the far end of its strip, level
  // with the tops of its cards.
  if (anchor === 'pile') {
    return side === 'local'
      ? {
          anchor: {
            x: physical.x + physical.width,
            y: physical.y + physical.height,
          },
          horizontalAlign: 'right',
          verticalAlign: 'bottom',
          fontSizePx: 13,
        }
      : {
          anchor: { x: physical.x, y: physical.y },
          horizontalAlign: 'left',
          verticalAlign: 'top',
          fontSizePx: 13,
        };
  }
  return side === 'local'
    ? {
        anchor: { x: physical.x + physical.width + 8, y: physical.y + 6 },
        horizontalAlign: 'left',
        verticalAlign: 'top',
        fontSizePx: 13,
      }
    : {
        anchor: { x: physical.x - 8, y: physical.y + physical.height - 6 },
        horizontalAlign: 'right',
        verticalAlign: 'bottom',
        fontSizePx: 13,
      };
};

const frameFor = (
  viewport: BoardViewport,
  playAreaWidth: number,
  frame: BoardVerticalLayoutState['lowerFrame']
): Rect => ({
  x: 0,
  y: viewport.height * (1 - frame.bottomRatio - frame.heightRatio),
  width: playAreaWidth,
  height: viewport.height * frame.heightRatio,
});

/**
 * Where each half sits. With one hidden, the other fills the table and the
 * hidden one lies just past the table's edge on its own side.
 */
const framesFor = (
  state: BoardLayoutState,
  playAreaWidth: number
): {
  readonly lower: Rect;
  readonly upper: Rect;
} => {
  const { viewport, vertical, hiddenPhysicalSide } = state;
  const lower = frameFor(viewport, playAreaWidth, vertical.lowerFrame);
  const upper = frameFor(viewport, playAreaWidth, vertical.upperFrame);
  const whole: Rect = {
    x: 0,
    y: 0,
    width: playAreaWidth,
    height: viewport.height,
  };
  if (hiddenPhysicalSide === 'upper') {
    return { lower: whole, upper: { ...upper, y: -upper.height } };
  }
  if (hiddenPhysicalSide === 'lower') {
    return { lower: { ...lower, y: viewport.height }, upper: whole };
  }
  return { lower, upper };
};

/** The area two rects share. */
const overlapArea = (left: Rect, right: Rect): number =>
  Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  ) *
  Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y)
  );

/** A rect grown by `by` on every side. */
const grown = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + 2 * by,
  height: rect.height + 2 * by,
});

/**
 * The Stadium, beside the Actives on the screen's left (`toLeft`) or right,
 * aimed at `top` and STADIUM_ACTIVE_GAP_SHARE of its width clear of them,
 * never past their edge. Where that would lie on or by anything on the
 * table (`obstacles`: the zones, the pieces, the app bar), or on a staging
 * area (`soft`: one that may run under its edge), it takes the nearest
 * place that covers the least of them -- obstacles first -- along the row
 * before off it.
 */
const placeStadiumAt = (
  size: { readonly width: number; readonly height: number },
  top: number,
  actives: readonly Rect[],
  obstacles: readonly Rect[],
  soft: StagingRoom | undefined,
  toLeft: boolean,
  playArea: Rect
): { readonly rect: Rect; readonly cover: number; readonly under: number } => {
  const { width, height } = size;
  const inner = toLeft
    ? Math.min(...actives.map((active) => active.x))
    : Math.max(...actives.map((active) => active.x + active.width));
  const aside = width * STADIUM_ACTIVE_GAP_SHARE;
  // Within the play area, and on its own side of the Actives.
  const least = Math.max(
    playArea.x + STADIUM_CLEARANCE_PX,
    toLeft ? -Infinity : inner + 1
  );
  const most = Math.min(
    playArea.x + playArea.width - STADIUM_CLEARANCE_PX - width,
    toLeft ? inner - 1 - width : Infinity
  );
  const clampX = (x: number): number => Math.min(most, Math.max(least, x));
  const clampY = (y: number): number =>
    Math.min(playArea.y + playArea.height - height, Math.max(playArea.y, y));
  const aimX = clampX(toLeft ? inner - aside - width : inner + aside);
  const aimY = clampY(top);
  const coverAt = (rect: Rect, among: readonly Rect[], by: number): number =>
    among.reduce(
      (sum, obstacle) => sum + overlapArea(grown(obstacle, by), rect),
      0
    );
  const aimed: Rect = { x: aimX, y: aimY, width, height };
  const all = [...obstacles, ...(soft ? [soft.board] : [])].filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const underAt = (rect: Rect): number => (soft ? stagingUnder(soft, rect) : 0);
  // What lies within a Stadium's size of where it aims.
  const near = all.filter(
    (rect) => overlapArea(grown(rect, Math.max(width, height)), aimed) > 0
  );
  if (
    coverAt(
      aimed,
      near.filter((rect) => rect !== soft?.board),
      STADIUM_CLEARANCE_PX
    ) <= CLEAR_PX2 &&
    underAt(aimed) <= CLEAR_PX2
  ) {
    return { rect: aimed, cover: 0, under: 0 };
  }
  const xs = [
    aimX,
    ...near.flatMap((rect) => [
      rect.x + rect.width + STADIUM_CLEARANCE_PX,
      rect.x - STADIUM_CLEARANCE_PX - width,
    ]),
  ].map(clampX);
  const ys = [
    aimY,
    ...near.flatMap((rect) => [
      rect.y + rect.height + STADIUM_CLEARANCE_PX,
      rect.y - STADIUM_CLEARANCE_PX - height,
    ]),
  ].map(clampY);
  let best:
    | {
        readonly rect: Rect;
        readonly cover: number;
        readonly under: number;
        readonly cost: number;
      }
    | undefined;
  for (const x of xs) {
    for (const y of ys) {
      const rect: Rect = { x, y, width, height };
      const cover = coverAt(rect, obstacles, STADIUM_CLEARANCE_PX);
      const under = underAt(rect);
      // Off the row costs more than along it.
      const cost = Math.abs(x - aimX) + 2 * Math.abs(y - aimY);
      if (
        !best ||
        cover < best.cover - 0.01 ||
        (cover <= best.cover + 0.01 &&
          (under < best.under - 0.5 ||
            (under <= best.under + 0.5 && cost < best.cost)))
      ) {
        best = { rect, cover, under, cost };
      }
    }
  }
  return best ?? { rect: aimed, cover: 0, under: 0 };
};

/**
 * The Stadium as large as a bench card (`size`) where it has a clear place
 * (placeStadiumAt), or else the largest of STADIUM_FIT_SHARES of it that
 * has one: on a small table a smaller Stadium is better than one over a
 * zone. With none clear, the full size's best place.
 */
const placeStadium = (
  size: { readonly width: number; readonly height: number },
  top: number,
  actives: readonly Rect[],
  obstacles: readonly Rect[],
  soft: StagingRoom | undefined,
  toLeft: boolean,
  playArea: Rect
): ReturnType<typeof placeStadiumAt> => {
  const full = placeStadiumAt(
    size,
    top,
    actives,
    obstacles,
    soft,
    toLeft,
    playArea
  );
  if (full.cover <= CLEAR_PX2 && full.under <= CLEAR_PX2) return full;
  for (const share of STADIUM_FIT_SHARES) {
    const smaller = placeStadiumAt(
      { width: size.width * share, height: size.height * share },
      // Still level with where the full size was aimed.
      top + (size.height * (1 - share)) / 2,
      actives,
      obstacles,
      soft,
      toLeft,
      playArea
    );
    if (smaller.cover <= CLEAR_PX2 && smaller.under <= CLEAR_PX2) {
      return smaller;
    }
  }
  return full;
};

/**
 * A staging area beside the Stadium's place: it makes room for it from its
 * Active end (`fromRight`: that end on the screen's right) while it keeps
 * `minWidth`.
 */
interface StagingRoom {
  readonly board: Rect;
  readonly fromRight: boolean;
  readonly minWidth: number;
}

/** How much of a staging area a Stadium there lies over, once it makes room. */
const stagingUnder = (room: StagingRoom, stadium: Rect): number => {
  const { board, fromRight, minWidth } = room;
  if (overlapArea(board, stadium) === 0) return 0;
  const kept = fromRight
    ? stadium.x - STADIUM_CLEARANCE_PX - board.x
    : board.x +
      board.width -
      (stadium.x + stadium.width + STADIUM_CLEARANCE_PX);
  return kept >= minWidth ? 0 : overlapArea(board, stadium);
};

/**
 * The v2 snapshot. Region semantics (surface, input affordances, paint
 * order) are taken from v1's regions so behaviour cannot drift; only the
 * geometry is new.
 */
export const createTableLayoutSnapshot = (
  state: BoardLayoutState
): BoardLayoutSnapshot => {
  if (state.geometryVersion !== TABLE_LAYOUT_GEOMETRY_VERSION) {
    throw new Error('Table layout requires geometry version 2');
  }
  const hidden = state.hiddenPhysicalSide;
  if (hidden !== undefined && hidden !== 'lower' && hidden !== 'upper') {
    throw new Error('Unsupported hidden board side');
  }
  // v1's validated snapshot supplies the region semantics, the player
  // pairing and every input check.
  const {
    hiddenPhysicalSide: _hidden,
    hideEmptyLostZone,
    seamBandPx,
    appBarPx,
    sidePanelReveal,
    oncePerGameMarkers,
    ...semanticState
  } = state;
  if (
    seamBandPx !== undefined &&
    (!Number.isFinite(seamBandPx) || seamBandPx < 0)
  ) {
    throw new Error('Table seam band must be a non-negative number');
  }
  if (
    oncePerGameMarkers !== undefined &&
    !(
      Number.isInteger(oncePerGameMarkers) &&
      oncePerGameMarkers >= 0 &&
      oncePerGameMarkers <= 2
    )
  ) {
    throw new Error('Once-per-game markers must number 0, 1 or 2');
  }
  if (
    appBarPx !== undefined &&
    !(
      Number.isFinite(appBarPx.width) &&
      Number.isFinite(appBarPx.height) &&
      appBarPx.width >= 0 &&
      appBarPx.height >= 0
    )
  ) {
    throw new Error('Table app bar must have a non-negative size');
  }
  // The app bar's corner: the far hand ends short of it, and a half that
  // fills the table keeps its top clear of it.
  const barReserve = appBarPx
    ? {
        handStartReservePx: appBarPx.width + 2 * APP_BAR_INSET_PX,
        minHandStripPx: appBarPx.height + 2 * APP_BAR_INSET_PX,
        topReservePx: appBarPx.height + APP_BAR_INSET_PX,
      }
    : {};
  const sharedOptions: HalfOptions = {
    ...(seamBandPx === undefined ? {} : { seamBandPx }),
    ...(hideEmptyLostZone ? {} : { lostZoneBeside: true }),
    ...(oncePerGameMarkers ? { markerCount: oncePerGameMarkers } : {}),
  };
  // The controls fill the seam band: 32px on a desktop, taller where a
  // finger asked for a wider band.
  const controlsCap =
    seamBandPx === undefined ? 32 : Math.max(32, seamBandPx - 2);
  const semantics = createBoardLayoutSnapshot({
    ...semanticState,
    geometryVersion: 1,
  });
  if (
    sidePanelReveal !== undefined &&
    !(sidePanelReveal >= 0 && sidePanelReveal <= 1)
  ) {
    throw new Error('Side panel reveal must be between 0 and 1');
  }
  const fullScreen = state.shellMode === 'fullscreen';
  const rail = fullScreen
    ? 0
    : tableRailWidth(state.viewport.width) * (sidePanelReveal ?? 1);
  const playAreaWidth = Math.max(1, state.viewport.width - rail);
  const playAreaBounds: Rect = {
    x: 0,
    y: 0,
    width: playAreaWidth,
    height: state.viewport.height,
  };

  const frames = framesFor(state, playAreaWidth);
  // Across the table, the hand is the smaller one, and ends short of the
  // app bar in the window's top-right corner.
  const farReserve: HalfOptions = {
    ...(hidden === undefined ? { handScale: TABLE_FAR_HAND_SCALE } : {}),
    ...(appBarPx
      ? {
          handStartReservePx: barReserve.handStartReservePx,
          minHandStripPx: barReserve.minHandStripPx,
        }
      : {}),
  };
  // Both halves shown take one mat, so the two sides of the table match
  // (ADR-039). It is chosen as without the app bar, as the split is, so the
  // bar never changes the near half (ADR-036).
  const mat =
    hidden === undefined
      ? jointMat(
          { ...frames.lower, options: sharedOptions },
          {
            ...frames.upper,
            options: { ...sharedOptions, handScale: TABLE_FAR_HAND_SCALE },
          }
        )
      : undefined;
  const halfOptions: HalfOptions = mat
    ? { ...sharedOptions, mat }
    : sharedOptions;
  const buildPlayer = (
    template: BoardPlayerLayout,
    frameBounds: Rect,
    options: HalfOptions = halfOptions
  ): {
    readonly player: BoardPlayerLayout;
    readonly geometry: HalfGeometry;
  } => {
    const solo = hidden !== undefined && hidden !== template.physicalSide;
    const geometry = (solo ? layoutSoloHalf : layoutTableHalf)(
      frameBounds.width,
      frameBounds.height,
      options
    );
    const regions: BoardLayoutRegion[] = geometry.regions.map((local) => {
      const source = template.regions.find(
        (region) => region.kind === local.kind
      );
      if (!source) throw new Error(`Missing ${local.kind} region semantics`);
      const physical = toPhysical(local.rect, frameBounds, template.side);
      return {
        id: source.id,
        playerId: template.playerId,
        side: template.side,
        physicalSide: template.physicalSide,
        kind: local.kind,
        surface: source.surface,
        playerLocalNormalizedBounds: {
          x: frameBounds.width > 0 ? local.rect.x / frameBounds.width : 0,
          y: frameBounds.height > 0 ? local.rect.y / frameBounds.height : 0,
          width:
            frameBounds.width > 0 ? local.rect.width / frameBounds.width : 0,
          height:
            frameBounds.height > 0 ? local.rect.height / frameBounds.height : 0,
        },
        physicalDeclaredBounds: { ...physical },
        physicalBorderBoxBounds: { ...physical },
        physicalContentBoxBounds: { ...physical },
        boxSizing: 'content-box',
        paddingPx: ZERO_EDGES,
        borderPx: ZERO_EDGES,
        physicalPaddingPx: ZERO_EDGES,
        physicalBorderPx: ZERO_EDGES,
        contentSizeAdjustmentPx: { width: 0, height: 0 },
        semanticZOrder: source.semanticZOrder,
        affordances: source.affordances,
        childCardAffordances: source.childCardAffordances,
        countLabel: local.countAnchor
          ? countLabelFor(local.countAnchor, physical, template.side)
          : null,
      };
    });
    return {
      player: {
        playerId: template.playerId,
        side: template.side,
        physicalSide: template.physicalSide,
        rotationQuarterTurns: template.rotationQuarterTurns,
        frameBounds,
        regions,
        ...(hidden === template.physicalSide ? { hidden: true as const } : {}),
        extras: {
          ...(geometry.extras.markers
            ? {
                markers: toPhysical(
                  geometry.extras.markers,
                  frameBounds,
                  template.side
                ),
              }
            : {}),
          coin: toPhysical(geometry.extras.coin, frameBounds, template.side),
          control: toPhysical(
            geometry.extras.control,
            frameBounds,
            template.side
          ),
        },
      },
      geometry,
    };
  };

  // A half alone fills the table from the window's top: its centre-line
  // edge keeps clear of the app bar.
  let lower = buildPlayer(
    semantics.players[0],
    frames.lower,
    hidden === 'upper' && appBarPx
      ? { ...halfOptions, topReservePx: barReserve.topReservePx }
      : halfOptions
  );
  const farOptions: HalfOptions = { ...halfOptions, ...farReserve };
  let upper = buildPlayer(semantics.players[1], frames.upper, farOptions);
  const regionOf = (
    player: BoardPlayerLayout,
    kind: BoardLayoutRegionKind
  ): Rect | undefined =>
    player.regions.find((region) => region.kind === kind)
      ?.physicalDeclaredBounds;
  const activeOf = (player: BoardPlayerLayout): Rect =>
    regionOf(player, 'active')!;
  /**
   * What the Stadium keeps clear of on a half: its zones (its hand too) and
   * pieces, all but its staging area where that makes room for it
   * (`board`: false).
   */
  const obstaclesOf = (player: BoardPlayerLayout, board: boolean): Rect[] => {
    const extras = player.extras;
    return [
      ...player.regions
        .filter((region) => board || region.kind !== 'board')
        .map((region) => region.physicalDeclaredBounds),
      ...(extras?.markers ? [extras.markers] : []),
      ...(extras ? [extras.coin, extras.control] : []),
    ];
  };
  /** A half's staging area, making room from its end on that side of the screen. */
  const stagingOf = (
    built: {
      readonly player: BoardPlayerLayout;
      readonly geometry: HalfGeometry;
    },
    fromRight: boolean
  ): StagingRoom | undefined => {
    const board = regionOf(built.player, 'board');
    return board
      ? { board, fromRight, minWidth: built.geometry.boardMinWidth }
      : undefined;
  };
  // The app bar in the window's top-right corner (ADR-036).
  const barBox: Rect[] = appBarPx
    ? [
        {
          x: playAreaWidth - APP_BAR_INSET_PX - appBarPx.width,
          y: APP_BAR_INSET_PX,
          width: appBarPx.width,
          height: appBarPx.height,
        },
      ]
    : [];
  /**
   * How much of the shown halves, and their pieces, the Stadium lies over;
   * `boards: false`, but for their staging areas.
   */
  const coveredBy = (
    stadium: Rect,
    built: readonly { readonly player: BoardPlayerLayout }[],
    boards = true
  ): number => {
    let area = 0;
    for (const { player } of built) {
      if (player.hidden) continue;
      const extras = player.extras;
      for (const box of [
        ...player.regions
          .filter(
            (region) =>
              region.kind !== 'hand' && (boards || region.kind !== 'board')
          )
          .map((region) => region.physicalDeclaredBounds),
        ...(extras?.markers ? [extras.markers] : []),
        ...(extras ? [extras.coin, extras.control] : []),
      ]) {
        area += overlapArea(box, stadium);
      }
    }
    return area;
  };

  let stadium: Rect;
  let controls: { readonly y: number; readonly height: number };
  let controlsLeft: number;
  if (hidden === undefined) {
    // The seam between the halves: the Stadium straddles it to the left of
    // the Actives, the board controls sit at its left.
    const seamY = lower.player.frameBounds.y;
    // Both halves laid out `scale` of their frames tall, at the players'
    // edges, with the Stadium straddling the seam to the left of the
    // Actives.
    //
    // The search lays the far half out as it would be without the app bar,
    // so the bar never changes the near half (ADR-036); the far half is
    // laid out with the bar once, at the scale found.
    const farWithoutBar: HalfOptions = {
      ...halfOptions,
      ...(farOptions.handScale ? { handScale: farOptions.handScale } : {}),
    };
    // `farScale`: the far half refitted on its own, portrait mat too.
    const splitAt = (scale: number, withBar = false, farScale?: number) => {
      const fit = (frame: Rect, share: number): HalfOptions =>
        share < 1 ? { fitHeight: frame.height * share } : {};
      let nearFit: HalfOptions = {
        ...halfOptions,
        ...fit(frames.lower, scale),
      };
      let farFit: HalfOptions = {
        ...(withBar ? farOptions : farWithoutBar),
        ...(farScale === undefined
          ? fit(frames.upper, scale)
          : { ...fit(frames.upper, farScale), fitPortrait: true }),
      };
      let near = buildPlayer(semantics.players[0], frames.lower, nearFit);
      let far = buildPlayer(semantics.players[1], frames.upper, farFit);
      // One mat on both sides: the Lost Zone lies beside the prizes on both
      // halves or on neither.
      if (near.geometry.lostZoneBeside !== far.geometry.lostZoneBeside) {
        nearFit = { ...nearFit, lostZoneBeside: false };
        farFit = { ...farFit, lostZoneBeside: false };
        near = buildPlayer(semantics.players[0], frames.lower, nearFit);
        far = buildPlayer(semantics.players[1], frames.upper, farFit);
      }
      const stadiumHeight = Math.min(
        near.geometry.cardHeights.bench,
        far.geometry.cardHeights.bench
      );
      const placed = placeStadium(
        {
          width: stadiumHeight * CARD_ASPECT_RATIO,
          height: stadiumHeight,
        },
        seamY - stadiumHeight / 2,
        [activeOf(near.player), activeOf(far.player)],
        [
          ...obstaclesOf(near.player, true),
          ...obstaclesOf(far.player, false),
          ...barBox,
        ],
        stagingOf(far, true),
        true,
        playAreaBounds
      ).rect;
      // The far half's staging area lies beside its Active on the
      // Stadium's side of the table; it starts past the Stadium instead of
      // running under it (layoutHalf keeps it whole where that would leave
      // it less than a pile wide).
      const farBoard = regionOf(far.player, 'board');
      const reserve = farBoard
        ? farBoard.x + farBoard.width - (placed.x - STADIUM_CLEARANCE_PX)
        : 0;
      if (farBoard && reserve > 0 && overlapArea(farBoard, placed) > 0) {
        far = buildPlayer(semantics.players[1], frames.upper, {
          ...farFit,
          boardStartReservePx: reserve,
        });
      }
      const staged = regionOf(far.player, 'board');
      return {
        near,
        far,
        stadium: placed,
        // The far staging area still holds a card beside the Stadium, clear
        // of it (with a hair to spare, so the search never settles a
        // rounding short).
        fits:
          staged !== undefined &&
          staged.width >= placed.width + 0.5 &&
          overlapArea(staged, placed) <= STADIUM_OVERLAP_SLACK_PX2,
        covered: coveredBy(placed, [near, far]),
      };
    };
    let scale = 1;
    if (!splitAt(1).fits) {
      // The cards the halves' heights would give leave the far staging
      // area under a card wide on this table: take the tallest mats that
      // keep it, never smaller than an even split's (taller only ever
      // means bigger cards and a narrower middle).
      const floor = EVEN_SPLIT_SHARE / DEFAULT_LOWER_SHARE;
      let low = floor;
      let high = 1;
      if (splitAt(low).fits) {
        for (let step = 0; step < 16; step += 1) {
          const middle = (low + high) / 2;
          if (splitAt(middle).fits) low = middle;
          else high = middle;
        }
      }
      scale = low;
    }
    let split = splitAt(scale, true);
    if (appBarPx) {
      // The bar can change the far half -- its hand strip deeper, its rows
      // shorter -- so that the Stadium lies over more of it than it would
      // without the bar. The far half alone then takes the tallest fit
      // that clears it as well; the near half is kept as it was.
      const plain = splitAt(scale);
      const clear = (candidate: typeof split): boolean =>
        (candidate.fits || !plain.fits) &&
        candidate.covered <= plain.covered + STADIUM_OVERLAP_SLACK_PX2;
      if (!clear(split)) {
        // Shorter is not steadily clearer (piles shrink, the Lost Zone
        // moves, the staging area's reserve comes and goes), so the fits
        // are tried downward and the first clear one refined.
        const lowest =
          Math.min(scale, EVEN_SPLIT_SHARE / DEFAULT_LOWER_SHARE) *
          FAR_REFIT_FLOOR;
        let fallback = split;
        let above = scale;
        let found: number | undefined;
        // Finely just below the fit found, where a clear window can be
        // narrower than a step, then a step at a time.
        const tries: number[] = [];
        for (let fine = 1; fine < FAR_REFIT_FINE_STEPS; fine += 1) {
          tries.push(scale - (FAR_REFIT_STEP * fine) / FAR_REFIT_FINE_STEPS);
        }
        for (
          let farScale = scale - FAR_REFIT_STEP;
          farScale >= lowest - 1e-9;
          farScale -= FAR_REFIT_STEP
        ) {
          tries.push(farScale);
        }
        for (const farScale of tries) {
          const candidate = splitAt(scale, true, farScale);
          if (clear(candidate)) {
            found = farScale;
            break;
          }
          // None clear: the one covered least, as good otherwise.
          if (
            (candidate.fits || !split.fits) &&
            candidate.covered < fallback.covered - STADIUM_OVERLAP_SLACK_PX2
          ) {
            fallback = candidate;
          }
          above = farScale;
        }
        if (found === undefined) {
          split = fallback;
        } else {
          let low = found;
          let high = above;
          for (let step = 0; step < 8; step += 1) {
            const middle = (low + high) / 2;
            if (clear(splitAt(scale, true, middle))) low = middle;
            else high = middle;
          }
          split = splitAt(scale, true, low);
        }
      }
    }
    lower = split.near;
    upper = split.far;
    stadium = split.stadium;
    // The controls straddle the seam inside the clear band on both sides.
    const controlsHeight = Math.max(
      20,
      Math.min(
        controlsCap,
        2 * Math.min(lower.geometry.seamMargin, upper.geometry.seamMargin) - 2
      )
    );
    controls = { y: seamY - controlsHeight / 2, height: controlsHeight };
    controlsLeft = lower.geometry.middle.left;
  } else {
    // One half fills the table. The Stadium lies beside its Active on the
    // player's own left, beside their pieces, as on the near half with
    // both shown (the staging area is on their right): in the row, level
    // with its centre-line edge; the controls just past that edge of the
    // row, as they sit at the seam; the rest of the clear band is where the
    // hidden half would be.
    const atTop = hidden === 'upper';
    const template = semantics.players[atTop ? 0 : 1]!;
    const frame = atTop ? frames.lower : frames.upper;
    const options = atTop
      ? appBarPx
        ? { ...halfOptions, topReservePx: barReserve.topReservePx }
        : halfOptions
      : farOptions;
    let shown = atTop ? lower : upper;
    const active = activeOf(shown.player);
    const band = shown.geometry.seamMargin;
    const controlsHeight = Math.max(
      20,
      Math.min(controlsCap, band - 2 * SOLO_CONTROLS_GAP_PX)
    );
    controls = {
      y: atTop
        ? Math.max(0, active.y - SOLO_CONTROLS_GAP_PX - controlsHeight)
        : Math.min(
            state.viewport.height - controlsHeight,
            active.y + active.height + SOLO_CONTROLS_GAP_PX
          ),
      height: controlsHeight,
    };
    controlsLeft = shown.geometry.middle.left;
    // The controls' band stays clear: the Stadium may lie beyond it, in
    // the band, but never on it -- its edge by the row as clear as the row
    // is of it, and the far edge as far again as the controls are tall:
    // tilted, the band is drawn shorter while the controls keep their
    // size.
    const reach = STADIUM_CLEARANCE_PX - SOLO_CONTROLS_GAP_PX;
    const controlsBand: Rect = {
      x: playAreaBounds.x,
      y: atTop ? controls.y - controls.height : controls.y + reach,
      width: playAreaBounds.width,
      height: Math.max(0, 2 * controls.height - reach),
    };
    const stadiumHeight = shown.geometry.cardHeights.bench;
    const size = {
      width: stadiumHeight * CARD_ASPECT_RATIO,
      height: stadiumHeight,
    };
    const top = atTop ? active.y : active.y + active.height - stadiumHeight;
    /** The Stadium on the screen's left of the Active, or its right. */
    const placedOn = (toLeft: boolean) => {
      // The staging area lies on the player's own right: across the table
      // that is the screen's left.
      const boardSide = atTop !== toLeft;
      const board = regionOf(shown.player, 'board');
      const found = placeStadium(
        size,
        top,
        [active],
        [...obstaclesOf(shown.player, !boardSide), ...barBox, controlsBand],
        boardSide ? stagingOf(shown, toLeft) : undefined,
        toLeft,
        playAreaBounds
      );
      const placed = found.rect;
      const reserve =
        !boardSide || !board
          ? 0
          : toLeft
            ? board.x + board.width - (placed.x - STADIUM_CLEARANCE_PX)
            : placed.x + placed.width + STADIUM_CLEARANCE_PX - board.x;
      return {
        found,
        placed,
        built:
          board && reserve > 0 && overlapArea(board, placed) > 0
            ? buildPlayer(template, frame, {
                ...options,
                boardStartReservePx: reserve,
              })
            : shown,
      };
    };
    // The player's own left: across the table, the screen's right.
    let chosen = placedOn(atTop);
    if (chosen.found.cover > CLEAR_PX2) {
      // No clear place there (a small table): the other side, if clearer.
      const other = placedOn(!atTop);
      if (
        other.found.cover < chosen.found.cover - 0.5 ||
        (other.found.cover <= chosen.found.cover + 0.5 &&
          other.found.under < chosen.found.under - 0.5)
      ) {
        chosen = other;
      }
    }
    stadium = chosen.placed;
    shown = chosen.built;
    if (atTop) lower = shown;
    else upper = shown;
  }

  const handle = (
    id: BoardResizeHandleId,
    bottomRatio: number
  ): BoardResizeHandleLayout => ({
    id,
    controlsPhysicalSide: id,
    authoredBottomRatio: bottomRatio,
    bounds: {
      x: -state.viewport.width * 0.0055,
      y: state.viewport.height * (1 - bottomRatio - HANDLE_HEIGHT_RATIO / 2),
      width: state.viewport.width * 0.013,
      height: state.viewport.height * HANDLE_HEIGHT_RATIO,
    },
    cursor: 'row-resize',
    affordances: semantics.resizeHandles[id === 'lower' ? 0 : 1].affordances,
  });

  return {
    geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
    viewport: { ...state.viewport },
    shellMode: state.shellMode,
    playAreaBounds,
    shellGapBounds: null,
    sidebarBounds: fullScreen
      ? null
      : { x: playAreaWidth, y: 0, width: rail, height: state.viewport.height },
    tabsBounds: null,
    bottomPlayerId: state.bottomPlayerId,
    players: [lower.player, upper.player],
    resizeHandles: [
      handle('lower', state.vertical.lowerHandle.bottomRatio),
      handle('upper', state.vertical.upperHandle.bottomRatio),
    ],
    shared: {
      stadium: {
        ...semantics.shared.stadium,
        physicalDeclaredBounds: stadium,
      },
      boardControlsAnchor: {
        x: controlsLeft,
        y: controls.y,
        height: controls.height,
      },
    },
    zoneScrollPx: {},
    ...(state.hideEmptyLostZone ? { hideEmptyLostZone: true as const } : {}),
    ...(state.farCardsUpright ? { farCardsUpright: true as const } : {}),
  };
};

/**
 * Dragging the split between the halves. Both handles move the one seam;
 * neither half may shrink below a third of the table.
 */
export const resizeTableLayoutState = (
  state: BoardLayoutState,
  _handleId: BoardResizeHandleId,
  clientY: number
): BoardLayoutState => {
  if (!Number.isFinite(clientY)) {
    throw new Error('Board resize pointer clientY must be finite');
  }
  return {
    ...state,
    vertical: tableVerticalLayout(1 - clientY / state.viewport.height),
  };
};

/** The snapshot for either geometry. */
export const createLayoutSnapshotFor = (
  state: BoardLayoutState
): BoardLayoutSnapshot =>
  state.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION
    ? createTableLayoutSnapshot(state)
    : createBoardLayoutSnapshot(state);

/** The split-resize transition for either geometry. */
export const resizeLayoutStateFor = (
  state: BoardLayoutState,
  handleId: BoardResizeHandleId,
  clientY: number
): BoardLayoutState =>
  state.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION
    ? resizeTableLayoutState(state, handleId, clientY)
    : resizeBoardLayoutState(state, handleId, clientY);

/** Cards side by side across a row, overlapping evenly once they run out of room. */
const spreadRow = (
  content: Rect,
  count: number,
  cardWidth: number,
  reversed: boolean
): number[] => {
  if (count <= 0) return [];
  const gap = Math.max(4, cardWidth * 0.06);
  const natural = count * cardWidth + (count - 1) * gap;
  const step =
    natural <= content.width
      ? cardWidth + gap
      : count > 1
        ? Math.max(0, (content.width - cardWidth) / (count - 1))
        : 0;
  const total = cardWidth + step * (count - 1);
  const start = content.x + (content.width - total) / 2;
  return Array.from({ length: count }, (_, index) =>
    reversed ? start + total - cardWidth - index * step : start + index * step
  );
};

/**
 * The hand along the screen edge. Its strip shows the top of each card; the
 * rest runs off the edge until hovered. The opponent's mat is turned, so
 * their hand runs off the top and in mirrored order.
 */
export const layoutTableHand = (
  content: Rect,
  side: BoardSide,
  count: number
): Rect[] => {
  const cardHeight = content.height / TABLE_HAND_VISIBLE_SHARE;
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const y =
    side === 'local' ? content.y : content.y + content.height - cardHeight;
  return spreadRow(content, count, cardWidth, side !== 'local').map((x) => ({
    x,
    y,
    width: cardWidth,
    height: cardHeight,
  }));
};

/** The staging area: whole cards in a row, overlapping when crowded. */
export const layoutTableRow = (
  content: Rect,
  side: BoardSide,
  count: number
): Rect[] => {
  const cardHeight = Math.min(
    content.height,
    content.width / CARD_ASPECT_RATIO
  );
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const y = content.y + (content.height - cardHeight) / 2;
  return spreadRow(content, count, cardWidth, side !== 'local').map((x) => ({
    x,
    y,
    width: cardWidth,
    height: cardHeight,
  }));
};

/**
 * Prizes as on the mat: two columns, three rows (more rows if more prizes),
 * the first prize at the top left of its owner's view. A portrait table's
 * prizes lie in a row wider than tall, so there they go three across and two
 * down instead.
 */
export const layoutTablePrizes = (
  content: Rect,
  side: BoardSide,
  count: number
): Rect[] => {
  if (count <= 0) return [];
  const columns = content.width > content.height ? 3 : 2;
  const rows = Math.max(6 / columns, Math.ceil(count / columns));
  const gap = Math.max(3, content.height * 0.025);
  const cardHeight = Math.max(
    0,
    Math.min(
      (content.height - (rows - 1) * gap) / rows,
      (content.width - (columns - 1) * gap) / columns / CARD_ASPECT_RATIO
    )
  );
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const gridWidth = columns * cardWidth + (columns - 1) * gap;
  const gridHeight = rows * cardHeight + (rows - 1) * gap;
  const left = content.x + (content.width - gridWidth) / 2;
  const top = content.y + (content.height - gridHeight) / 2;
  return Array.from({ length: count }, (_, index) => {
    const ownColumn = index % columns;
    const ownRow = Math.floor(index / columns);
    // The opponent's view of their grid is turned half way round.
    const column = side === 'local' ? ownColumn : columns - 1 - ownColumn;
    const row = side === 'local' ? ownRow : rows - 1 - ownRow;
    return {
      x: left + column * (cardWidth + gap),
      y: top + row * (cardHeight + gap),
      width: cardWidth,
      height: cardHeight,
    };
  });
};

/** A pile (deck, discard, Lost Zone, stadium): one card-sized spot. */
export const layoutTablePile = (content: Rect, count: number): Rect[] => {
  const cardHeight = Math.min(
    content.height,
    content.width / CARD_ASPECT_RATIO
  );
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const rect = {
    x: content.x + (content.width - cardWidth) / 2,
    y: content.y + (content.height - cardHeight) / 2,
    width: cardWidth,
    height: cardHeight,
  };
  return Array.from({ length: count }, () => ({ ...rect }));
};
