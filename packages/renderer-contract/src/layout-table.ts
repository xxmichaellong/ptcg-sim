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
 * The far hand is the one across the table -- usually the opponent's,
 * which a player reads far less than their own -- so it only peeks in from
 * the window's top edge: a strip of each card shows, TABLE_FAR_HAND_REVEAL
 * of it, and a card pointed at (or peeked at by a finger) comes down whole.
 * Its cards are this much of a near hand's of the same height; the room
 * the peek saves goes to both boards.
 */
export const TABLE_FAR_HAND_SCALE = 0.87;
/** The share of each far hand card its strip shows (TABLE_FAR_HAND_SCALE). */
export const TABLE_FAR_HAND_REVEAL = 0.55;
/**
 * Where the far hand's strip is deeper than its peek (the app bar's corner
 * on a short window, `minHandStripPx`), its cards grow to keep showing at
 * most this share -- up to FAR_HAND_CARD_MOST of their half's height, past
 * which they keep the near hand's share (TABLE_HAND_VISIBLE_SHARE).
 */
const FAR_HAND_REVEAL_MOST = 0.62;
const FAR_HAND_CARD_MOST = 0.4;

/**
 * The near half's share of the table where the hands lie inside the
 * halves (the flat table, or a tilted one on an upright window) for boards
 * of the same size: the far hand's strip is the smaller one, a peek since
 * 2026-11-05 (0.54 before).
 */
const DEFAULT_LOWER_SHARE = 0.53;
/** An even split: the halves' frames when they are their boards. */
const EVEN_SPLIT_SHARE = 0.5;
/**
 * How far the frames lean toward the near half where the hands lie inside
 * them, for a board split to hold (the near hand's strip being the deeper).
 */
const HANDS_INSIDE_SHARE = DEFAULT_LOWER_SHARE - EVEN_SPLIT_SHARE;
const MINIMUM_HALF_SHARE = 0.34;
const HANDLE_HEIGHT_RATIO = 0.025 as const;

/**
 * How the boards may be split between the halves: the lower board's share
 * (the player's Split). Even by default, both boards the same size
 * (2026-11-06, the owner: "we should set the default split to 50/50").
 * Neither half may shrink below a third of the table.
 */
export const TABLE_SPLIT = {
  minimumLowerShare: MINIMUM_HALF_SHARE,
  maximumLowerShare: 1 - MINIMUM_HALF_SHARE,
  defaultLowerShare: EVEN_SPLIT_SHARE,
} as const;

/**
 * Whether the hands lie past the board's edges rather than inside the
 * halves: tilted, on a window wider than tall, with both halves shown.
 */
export const tableHandsOutside = (
  state: Pick<
    BoardLayoutState,
    'tiltedTable' | 'hiddenPhysicalSide' | 'viewport'
  >
): boolean =>
  state.tiltedTable === true &&
  state.hiddenPhysicalSide === undefined &&
  state.viewport.width > state.viewport.height;

/**
 * The halves' frames for a board split: the boards themselves where the
 * hands lie outside them; where the hands lie inside, leaning toward the
 * near half by the depth its deeper hand strip takes, so the boards still
 * split as asked.
 */
export const tableVerticalLayoutForBoards = (
  boardShare: number,
  handsOutside: boolean
): BoardVerticalLayoutState => {
  // The boards are held to the Split's range; the frames then lean past
  // it by the deeper strip, so every Split gives its own boards (Codex
  // review, batch 12 r11).
  const boards = Number.isFinite(boardShare)
    ? clampShare(boardShare)
    : EVEN_SPLIT_SHARE;
  return framesAt(handsOutside ? boards : boards + HANDS_INSIDE_SHARE);
};

/** The vertical state for a table whose lower half takes `lowerShare`. */
export const tableVerticalLayout = (
  lowerShare: number
): BoardVerticalLayoutState =>
  framesAt(
    Number.isFinite(lowerShare) ? clampShare(lowerShare) : DEFAULT_LOWER_SHARE
  );

/** A share held to the range either half may take. */
const clampShare = (share: number): number =>
  Math.min(
    TABLE_SPLIT.maximumLowerShare,
    Math.max(TABLE_SPLIT.minimumLowerShare, share)
  );

/** The frames for a lower share, as given. */
const framesAt = (lower: number): BoardVerticalLayoutState => {
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
  handStrip: 0.23,
  margin: 0.045,
  rowGap: 0.025,
  activeShare: 0.54,
};

/** The share of a hand card that shows; the rest runs off the screen. */
export const TABLE_HAND_VISIBLE_SHARE = 0.8;
/**
 * Tilted, the player's own hand is this much larger than its half's strip
 * would make it: lying past the board's edge, it takes none of the board's
 * room, only a little of the band the board is drawn in (2026-11-06, the
 * owner: "our hand actually looks a little bit too small").
 */
const TILTED_NEAR_HAND_SCALE = 1.12;

/**
 * How far up from the player's edge v1's corner controls reach: its
 * VSTAR/GX markers stacked under the hand-sort control. A hand strip
 * shorter than this lays them side by side instead (the web app's chrome),
 * which needs only TABLE_COMPACT_CORNER_HEIGHT_PX; a portrait strip is at
 * least that deep.
 */
export const TABLE_CONTROL_CORNER_HEIGHT_PX = 104;
export const TABLE_COMPACT_CORNER_HEIGHT_PX = 56;

/**
 * The hand's count and its Sort, one pill past the far end of its strip
 * (the web app's TableHandPill): this far past the strip's end and below
 * its top, and at most this wide (a two-digit count beside Sort) and tall.
 */
const HAND_PILL_GAP_PX = 8;
const HAND_PILL_DROP_PX = 6;
const HAND_PILL_WIDTH_PX = 64;
const HAND_PILL_HEIGHT_PX = 26;
/** The least room between the pill and the screen's edge (TableHandPill). */
const HAND_PILL_EDGE_PX = 4;
/**
 * The least room between the pill and a pile beside the hand's end: more
 * than the reach of the pile's count badge, which the pill keeps off too
 * (LegacyBoardChrome keeps it 10px off the piles).
 */
const HAND_PILL_PILE_CLEARANCE_PX = 12;
/**
 * How a mat's hand is judged when a window's mat is chosen (`bestOf`,
 * `jointMat`): by the room it had before its strip ran out into the free
 * corner beside it and made its pill room at its end (2026-10-29) -- short
 * of a corner this wide at its start and of a count slot this wide past
 * the piles at its end. Judged as they were, the wider strips leave every
 * window on the mat the layout probes and the device QA settled for it.
 */
const JUDGED_HAND_CORNER_PX = 96;
const JUDGED_HAND_SLOT_PX = 44;
/**
 * The hand strips a mat is judged by (HalfOptions.judged), as they were
 * before 2026-11-05: a landscape half's near hand this share of its height,
 * the far hand's JUDGED_FAR_HAND_SCALE of that, a portrait half's this
 * share of its bench card.
 */
const JUDGED_HAND_STRIP = 0.27;
const JUDGED_FAR_HAND_SCALE = 0.6;
const JUDGED_PORTRAIT_HAND_STRIP = 0.85;

/**
 * The least a far hand keeps past the app bar: a layout that leaves it less
 * gives way to one that doesn't (`bestOf`).
 */
const MIN_FAR_HAND_PX = 128;
/**
 * How much of each card a hand of seven, fanned across its strip, shows at
 * least: a mat whose hand shows less gives way to one whose hand doesn't
 * (`bestOf`, `jointMat`), however much larger its board's cards.
 */
const MIN_HAND_SLIVER_PX = 20;
const TYPICAL_HAND_CARDS = 7;
/**
 * The bench card that mat keeps at least: a smaller one is no trade for the
 * hand (a near-square window, small either way, keeps the larger cards).
 */
const MIN_HAND_TRADE_BENCH_PX = 40;
/** The least an Active card keeps: the app bar's corner never costs the board more. */
const MIN_BOARD_ROW_PX = 12;
/** The least clear space between a pile and the screen edge. */
const PILE_EDGE_MARGIN_PX = 12;
/**
 * Tilted (`handsOutside`), how far short of the player's edge the board's
 * rows and piles end: room for the mat's own margin round its spots
 * (renderer-dom's MAT_MARGIN_PX, 16px) inside the window, and a hair.
 */
const TILTED_EDGE_PX = 24;
/**
 * Tilted, how far past the frame's edge a hand's strip lies: further than
 * a drop reaches past a zone (dropReachFor, at most 56px), so nothing
 * dropped on the board's own edge ever lands in the hand.
 */
const HANDS_OUTSIDE_GAP_PX = 96;

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
   * How tall its hand's cards are: its strip shows TABLE_HAND_VISIBLE_SHARE
   * of them, or across the table a peek (`handPeek`).
   */
  readonly handCard: number;
  /** The width its hand is judged by when the mat is chosen (JUDGED_HAND_*). */
  readonly handRoom: number;
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
   * Where a Lost Zone beside the prizes lies in the Active row: past the
   * pieces' column, or in it under the coin (`LostZoneRoom`).
   */
  readonly lostZonePlace?: LostZonePlace;
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
  /**
   * Where the Lost Zone lies beside the prizes, decided for both halves
   * together; absent, each half chooses.
   */
  readonly lostZonePlace?: LostZonePlace;
  /** How many once-per-game markers sit beside the prizes, 0 to 2. */
  readonly markerCount?: number;
  /**
   * Across the table: the hand peeks in from the window's edge, a strip of
   * each card (TABLE_FAR_HAND_REVEAL), its cards TABLE_FAR_HAND_SCALE of a
   * near hand's.
   */
  readonly handPeek?: boolean;
  /**
   * Laid out to choose its mat by (`bestOf`, `jointMat`): with the hand
   * strips the mats were judged by before the hands grew smaller and the
   * far hand began to peek (JUDGED_HAND_STRIP), so every window keeps the
   * mat the layout probes and the device QA settled for it.
   */
  readonly judged?: boolean;
  /**
   * Room kept clear at the hand strip's start (its left in the half's own
   * frame): across the table that is the window's top-right corner, where
   * the app bar sits.
   */
  readonly handStartReservePx?: number;
  /**
   * Room kept clear past the hand's pill, at the strip's end (its right in
   * the half's own frame): on a mirrored far half (ADR-046) that is the
   * window's top-right corner, where the app bar sits.
   */
  readonly handEndReservePx?: number;
  /**
   * The hand's pill lies before the strip's start (its left in the half's
   * own frame) rather than past its end: the near half's, and a mirrored
   * far half's, so both pills sit on the window's left, one above the
   * other (2026-11-06). A turned far half's end is the window's left.
   */
  readonly handPillAtStart?: boolean;
  /**
   * The tallest the near half's deck, discard and Lost Zone piles may be:
   * the far half's share of its bench card, where the far piles are
   * smaller for their cards (they give way to the app bar), so neither
   * side's piles read as the bigger (2026-11-09).
   */
  readonly pileCapPx?: number;

  /**
   * The table is tilted (BoardLayoutState.tiltedTable): the board is laid
   * out over the whole half, short of the player's edge by
   * TILTED_EDGE_PX, and the hand's strip lies just outside the frame
   * (HANDS_OUTSIDE_GAP_PX past its edge), its strip and cards their usual
   * size. The projection draws the hand back at the window's edge and the
   * board in the band between the hands. Not for the mats a half is judged
   * by (`judged`), so the mat chosen never changes.
   */
  readonly handsOutside?: boolean;
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
 * A hand's strip as it would be, from the cards a near hand of this half
 * would hold (`nearCard` tall): it shows TABLE_HAND_VISIBLE_SHARE of them,
 * or across the table a peek of cards TABLE_FAR_HAND_SCALE their size.
 */
const naturalHandStrip = (nearCard: number, options: HalfOptions): number =>
  options.handPeek
    ? options.judged
      ? nearCard * TABLE_HAND_VISIBLE_SHARE * JUDGED_FAR_HAND_SCALE
      : nearCard * TABLE_FAR_HAND_SCALE * TABLE_FAR_HAND_REVEAL
    : nearCard * TABLE_HAND_VISIBLE_SHARE;

/**
 * How tall a hand's cards are for its strip, `strip` deep in a half
 * `height` tall whose near hand would hold cards `nearCard` tall. A near
 * hand's strip shows TABLE_HAND_VISIBLE_SHARE of them. A peek's cards are
 * TABLE_FAR_HAND_SCALE of a near hand's; a strip made deeper than their
 * peek (the app bar's corner) has them grow to show at most
 * FAR_HAND_REVEAL_MOST, as far as FAR_HAND_CARD_MOST of the half allows,
 * and never show more than a near hand's share.
 */
const handCardFor = (
  strip: number,
  nearCard: number,
  height: number,
  options: HalfOptions
): number => {
  const least = strip / TABLE_HAND_VISIBLE_SHARE;
  if (!options.handPeek) return least;
  return Math.max(
    least,
    Math.min(
      Math.max(nearCard * TABLE_FAR_HAND_SCALE, strip / FAR_HAND_REVEAL_MOST),
      height * FAR_HAND_CARD_MOST
    )
  );
};

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
 * The Active's slot gives up its extra width for a Lost Zone beside the
 * prizes no further than this: the card, and a sliver of its attachments.
 */
const ACTIVE_SLOT_LEAST_CARDS = 1.3;
/**
 * A Lost Zone beside the prizes shrinks, last of all, to this share of a
 * bench card's height (never below the piles' own size).
 */
const LOST_ZONE_LEAST_SHARE = 0.8;
/**
 * Where even that leaves no room (a squarish window, whose cards are sized
 * by its height), the pile goes on shrinking to this share of a bench card.
 */
const LOST_ZONE_FLOOR_SHARE = 0.5;

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

/**
 * The mat's `+` for the optional pieces: the foot of their column, centred
 * under the coin on the Active row's bottom line (the owner, 2026-11-06, of
 * the old place by the column's top: "it looks really random"), so the
 * markers, the coin and the `+` that adds them read as one column. Where
 * the column's foot holds the Lost Zone (`inColumn` false), or the coin
 * would have to shrink below a coin's least size to leave it room
 * (`coinAbove`), it sits just past the column (`besideX`) on that same
 * line.
 */
const extrasControlAtFoot = (place: {
  readonly columnX: number;
  readonly columnWidth: number;
  readonly coin: Rect;
  readonly rowBottom: number;
  readonly besideX: number;
  readonly inColumn: boolean;
  readonly gap: number;
}): Rect => {
  const y = place.rowBottom - EXTRAS_CONTROL_INSET_PX - EXTRAS_CONTROL_PX;
  const centred: Rect = {
    x: place.columnX + (place.columnWidth - EXTRAS_CONTROL_PX) / 2,
    y,
    width: EXTRAS_CONTROL_PX,
    height: EXTRAS_CONTROL_PX,
  };
  if (place.inColumn) {
    const coin = coinAbove(place.coin, centred, place.gap);
    if (coin.width >= Math.min(place.coin.width, TABLE_COIN_MIN_PX)) {
      return centred;
    }
  }
  return { ...centred, x: place.besideX };
};

/**
 * Where a hand strip ends, in its half's own frame (the strip runs left to
 * right): short of the screen's edge by its pill and the pill's room, and,
 * where piles beside the hand's end reach down into the pill's band (a
 * short mat's column), short of those piles and their count badges too.
 */
const handEndFor = (
  width: number,
  handTop: number,
  piles: readonly Rect[],
  /** Room past the pill (`handEndReservePx`). */
  reserve = 0
): number => {
  const pillTop = handTop + HAND_PILL_DROP_PX;
  const pillBottom = pillTop + HAND_PILL_HEIGHT_PX;
  const slot = HAND_PILL_GAP_PX + HAND_PILL_WIDTH_PX;
  let end = width - Math.max(HAND_PILL_EDGE_PX, reserve) - slot;
  for (const pile of piles) {
    if (
      pile.y - HAND_PILL_PILE_CLEARANCE_PX < pillBottom &&
      pile.y + pile.height + HAND_PILL_PILE_CLEARANCE_PX > pillTop
    ) {
      end = Math.min(end, pile.x - HAND_PILL_PILE_CLEARANCE_PX - slot);
    }
  }
  return end;
};

/**
 * A hand strip whose pill lies before its start (`handPillAtStart`): it
 * starts past the pill's slot by the screen's edge, as a turned far
 * strip's end does, and runs to the far edge, short of any pile reaching
 * down into its band (a short mat's column) and of `reserve`.
 */
const handStripPillFirst = (
  width: number,
  handTop: number,
  piles: readonly Rect[],
  reserve = 0
): { readonly start: number; readonly end: number } => {
  const slot = HAND_PILL_GAP_PX + HAND_PILL_WIDTH_PX;
  let end = width - Math.max(HAND_PILL_EDGE_PX, reserve);
  // The same piles keep it short as kept a pill there short: those down
  // in the band a pill would take.
  const pillTop = handTop + HAND_PILL_DROP_PX;
  const pillBottom = pillTop + HAND_PILL_HEIGHT_PX;
  for (const pile of piles) {
    if (
      pile.y - HAND_PILL_PILE_CLEARANCE_PX < pillBottom &&
      pile.y + pile.height + HAND_PILL_PILE_CLEARANCE_PX > pillTop
    ) {
      end = Math.min(end, pile.x - HAND_PILL_PILE_CLEARANCE_PX);
    }
  }
  return { start: HAND_PILL_EDGE_PX + slot, end: Math.max(end, 0) };
};

/**
 * The app bar's corner a hand strip keeps clear, at whichever end it lies:
 * its start on a turned far half, its end on a mirrored one (ADR-046).
 */
const barCornerOf = (options: HalfOptions): number =>
  Math.max(options.handStartReservePx ?? 0, options.handEndReservePx ?? 0);

/**
 * The gap between prize cards, as a share of the prize grid's height: half
 * what it was until 2026-11-06 (the owner: "reduce the spacing between the
 * prize cards by about 50%"), so the six sit close, as a player sets them
 * out. The mat's own prize gap (layoutHalf) halved with it.
 */
const PRIZE_GAP_SHARE = 0.0125;
const PRIZE_GAP_LEAST_PX = 1.5;
const prizeGridGap = (gridHeight: number): number =>
  Math.max(PRIZE_GAP_LEAST_PX, gridHeight * PRIZE_GAP_SHARE);

/** The room past a Lost Zone beside the prizes that its `+` needs. */
const besideControlRoom = (gap: number): number =>
  Math.max(gap, PILE_BADGE_REACH_PX) + EXTRAS_CONTROL_PX + gap;

/**
 * Where a Lost Zone beside the prizes lies in the Active row: past the
 * pieces' column (`beside`), or in the column under the coin (`under`).
 */
type LostZonePlace = 'beside' | 'under';

/** How the mat's Active row makes room for a Lost Zone beside the prizes. */
interface LostZoneRoom {
  readonly activeWidth: number;
  /** The room kept for the Stadium between the pieces and the Active. */
  readonly stadiumRoom: number;
  /** The pile's height. */
  readonly pile: number;
  readonly place: LostZonePlace;
  /** The `+` sits at the row's foot under the pile, not past it. */
  readonly controlUnder: boolean;
}

/**
 * How the mat's Active row makes room for a Lost Zone beside the prizes.
 * Past the pieces' column, giving up in turn until the pile fits:
 * 1. the Active slot's extra width, to `ACTIVE_SLOT_LEAST_CARDS` (never
 *    wider than it was);
 * 2. the Stadium's room between the pile and the Active, to the `+`'s
 *    (the Stadium finds its own spot);
 * 3. the pile, to `least` (`LOST_ZONE_LEAST_SHARE` of a bench card).
 * A row narrower still (a squarish window, its cards sized by its height,
 * its Active row tall) lays the pile in the pieces' column under the coin,
 * where that holds `least` -- or else whichever holds the larger pile of
 * that and, past the column, giving up besides:
 * 4. the Active slot's sliver for attachments: the card alone;
 * 5. the `+`'s room past the pile: it steps to the row's foot under it;
 * 6. the pile, below `least` to `floor`, and on the smallest rows as large
 *    as fits.
 * Never at the end of the piles' column. `place` holds both halves to one
 * arrangement.
 */
const lostZoneRoom = (row: {
  readonly middleWidth: number;
  /** The pieces' column beside the prizes. */
  readonly column: number;
  /** What of it the pieces shown take: the markers' room is kept unused. */
  readonly pieces: number;
  readonly gap: number;
  readonly cardWidth: number;
  /** The Active row's height. */
  readonly rowHeight: number;
  /** The height left in the pieces' column under the coin. */
  readonly under: number;
  /** The Active slot without a Lost Zone beside the prizes. */
  readonly freeActiveWidth: number;
  /** The Stadium's full room between the pieces and the Active. */
  readonly stadiumRoom: number;
  /** The pile's height: full, least and floor. */
  readonly pile: number;
  readonly least: number;
  readonly floor: number;
  readonly place?: LostZonePlace;
}): LostZoneRoom => {
  const { middleWidth, column, gap, cardWidth, freeActiveWidth } = row;
  // Left of the Active: the column, the pile past it, the Stadium's room;
  // the staging area keeps as much on the right.
  const needed = (pileWidth: number, stadium: number): number =>
    column + gap + pileWidth + gap + stadium + gap;
  const leftOf = (activeWidth: number): number =>
    (middleWidth - activeWidth) / 2;
  const fullWidth = row.pile * CARD_ASPECT_RATIO;
  const pileOf = (width: number): number =>
    Math.min(row.pile, Math.max(0, width) / CARD_ASPECT_RATIO);
  const controlRoom = besideControlRoom(gap) - gap;
  // Under the coin, the `+` lies past the pieces at the row's top: clear
  // of the coin by its touch area, of the pile's count by the row.
  const underControlRoom =
    Math.max(gap, EXTRAS_CONTROL_REACH_PX) + EXTRAS_CONTROL_PX + gap;
  const slotActive = Math.min(
    freeActiveWidth,
    cardWidth * ACTIVE_SLOT_LEAST_CARDS
  );
  const cardActive = Math.min(freeActiveWidth, cardWidth);
  const beside = (
    activeWidth: number,
    stadiumRoom: number,
    pile: number,
    controlUnder = false
  ): LostZoneRoom => ({
    activeWidth,
    stadiumRoom,
    pile,
    place: 'beside',
    controlUnder,
  });
  /**
   * In the column under the coin: the pile lies at the column's middle, or
   * from its left edge where it is wider than the column, and with `past`
   * (the room from what the column holds to the Active) must still fit
   * beside the Active (else no pile).
   */
  const under = (activeWidth: number, past: number): LostZoneRoom => {
    const room = leftOf(activeWidth) - past;
    const width = room >= column ? room : 2 * room - column;
    return {
      activeWidth,
      stadiumRoom: Math.max(0, past - 2 * gap),
      pile: width >= row.pieces ? Math.min(row.under, pileOf(width)) : 0,
      place: 'under',
      controlUnder: false,
    };
  };
  const least = (room: LostZoneRoom): boolean => room.pile >= row.least - 0.01;

  // Past the column: 1. the Active slot's extra width.
  const activeWidth = Math.max(
    slotActive,
    Math.min(
      freeActiveWidth,
      middleWidth - 2 * needed(fullWidth, row.stadiumRoom)
    )
  );
  const besides: LostZoneRoom[] = [];
  if (leftOf(activeWidth) >= needed(fullWidth, row.stadiumRoom) - 0.01) {
    besides.push(beside(activeWidth, row.stadiumRoom, row.pile));
  } else {
    // 2. The Stadium's room, down to the `+`'s.
    const stadium = leftOf(slotActive) - needed(fullWidth, 0);
    besides.push(
      stadium >= controlRoom
        ? beside(slotActive, stadium, row.pile)
        : // 3. The pile, down to `least`.
          beside(
            slotActive,
            controlRoom,
            pileOf(leftOf(slotActive) - needed(0, controlRoom))
          )
    );
  }
  const first = besides[0]!;
  if (least(first) && row.place !== 'under') return first;
  // Under the coin, giving up as little as holds `least`.
  const unders = [
    under(freeActiveWidth, gap + row.stadiumRoom + gap),
    under(slotActive, underControlRoom),
    under(cardActive, underControlRoom),
  ];
  const underLeast = unders.find(least);
  if (row.place === 'under') return underLeast ?? largest(unders);
  if (row.place === undefined && underLeast) return underLeast;
  // Past the column, giving up more: 4. the Active slot's sliver.
  const cardPile = pileOf(leftOf(cardActive) - needed(0, controlRoom));
  besides.push(beside(cardActive, controlRoom, cardPile));
  // 5. The `+` under the pile, its room given back, where the row is deep
  //    enough to hold both.
  const underPile = Math.min(
    pileOf(leftOf(cardActive) - needed(0, 0)),
    row.rowHeight -
      Math.max(gap, PILE_BADGE_REACH_PX) -
      EXTRAS_CONTROL_PX -
      EXTRAS_CONTROL_INSET_PX
  );
  if (underPile >= row.floor - 0.01) {
    besides.push(beside(cardActive, 0, underPile, true));
  }
  // 6. The pile below `least` to `floor`; on the smallest rows, as large
  //    as fits.
  const pastColumn =
    besides.find((room) => room !== first && least(room)) ?? largest(besides);
  return row.place === 'beside' || pastColumn.pile >= largest(unders).pile
    ? pastColumn
    : largest(unders);
};

/** A half's Lost Zone pile height. */
const lostZoneHeight = (geometry: HalfGeometry): number =>
  geometry.regions.find((region) => region.kind === 'lostZone')?.rect.height ??
  0;

/** Of rooms for the Lost Zone, the one with the largest pile (the first of equals). */
const largest = (rooms: readonly LostZoneRoom[]): LostZoneRoom =>
  rooms.reduce((best, room) => (room.pile > best.pile + 0.01 ? room : best));

/** Lay out one half in its own frame, centre line at the top. */
const layoutHalfAs = (
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
  const ownHandOutside =
    options.handsOutside === true &&
    options.judged !== true &&
    options.handPeek !== true;
  const nearCard =
    ((height * (options.judged ? JUDGED_HAND_STRIP : proportions.handStrip)) /
      TABLE_HAND_VISIBLE_SHARE) *
    (ownHandOutside ? TILTED_NEAR_HAND_SCALE : 1);
  const natural = naturalHandStrip(nearCard, options);
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
  const handCard = handCardFor(handStrip, nearCard, height, options);
  // Tilted, the board takes the whole half and the hand lies past its edge.
  const outside = options.handsOutside === true && options.judged !== true;
  const rows = Math.max(
    0,
    height - (outside ? TILTED_EDGE_PX : handStrip) - margin - 2 * gap
  );
  const active = rows * proportions.activeShare;
  const bench = rows - active;
  const activeTop = margin;
  const benchTop = activeTop + active + gap;
  const handTop = outside ? height + HANDS_OUTSIDE_GAP_PX : height - handStrip;

  // Prizes: 2 x 3 grid down the outer left, spanning both card rows, set
  // close together (PRIZE_GAP_SHARE).
  const prizeGap = Math.max(2, gap * 0.25);
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
      options.pileCapPx ?? Number.POSITIVE_INFINITY,
      (height -
        margin -
        Math.max(outside ? TILTED_EDGE_PX : PILE_EDGE_MARGIN_PX, margin / 2) -
        2 * gap) /
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
  const fullStadiumRoom =
    bench * CARD_ASPECT_RATIO * (1 + STADIUM_ACTIVE_GAP_SHARE) +
    STADIUM_CLEARANCE_PX;
  const beforeActive = column.width + gap + fullStadiumRoom + gap;
  // The Active slot is wide enough for a stack with attachments peeking
  // out, and leaves that room on its left (the staging area as much on its
  // right); never narrower than its card.
  const cardWidth = active * CARD_ASPECT_RATIO;
  const freeActiveWidth = Math.min(
    middleWidth,
    Math.max(
      cardWidth,
      Math.min(cardWidth * ACTIVE_SLOT_CARDS, middleWidth - 2 * beforeActive)
    )
  );
  // A Lost Zone on the table (shown, or holding cards) lies beside the
  // pieces, never at the end of the piles under the discard pile (the
  // owner, 2026-10-29). Its room comes, in turn, from the Active slot's
  // extra width (down to the card and a sliver of its attachments), from
  // the Stadium's reserved room (it finds its own spot; the `+` keeps its
  // own room past the pile), and last from the pile itself.
  const besideRoom = options.lostZoneBeside
    ? lostZoneRoom({
        middleWidth,
        column: column.width,
        pieces: Math.max(column.markers?.width ?? 0, column.coin.width),
        gap,
        cardWidth,
        rowHeight: active,
        under: Math.max(
          0,
          activeTop + active - (column.coin.y + column.coin.height) - gap
        ),
        freeActiveWidth,
        stadiumRoom: fullStadiumRoom,
        pile: Math.min(pileHeight, active),
        least: Math.min(pileHeight, active, bench * LOST_ZONE_LEAST_SHARE),
        floor: Math.min(pileHeight, active, bench * LOST_ZONE_FLOOR_SHARE),
        ...(options.lostZonePlace ? { place: options.lostZonePlace } : {}),
      })
    : undefined;
  const activeWidth = besideRoom?.activeWidth ?? freeActiveWidth;
  const activeRect: Rect = {
    x: centre - activeWidth / 2,
    y: activeTop,
    width: activeWidth,
    height: active,
  };
  const lostZoneBeside = besideRoom !== undefined;
  // In the pieces' column under the coin, the pile lies at the column's
  // middle with the markers and coin; the `+` goes past what the column
  // holds (its markers' room kept free where they are off).
  const lostZoneWidth = (besideRoom?.pile ?? 0) * CARD_ASPECT_RATIO;
  const columnMiddle = middleLeft + column.width / 2;
  const { markers, coin } = column;
  let piecesRight = middleLeft + column.width;
  let lostZone: Rect | undefined;
  if (besideRoom) {
    if (besideRoom.place === 'under') {
      lostZone = {
        x: Math.max(middleLeft, columnMiddle - lostZoneWidth / 2),
        y: coin.y + coin.height + gap,
        width: lostZoneWidth,
        height: besideRoom.pile,
      };
      piecesRight = Math.max(
        coin.x + coin.width,
        markers ? markers.x + markers.width : 0,
        lostZone.x + lostZone.width
      );
    } else {
      lostZone = {
        x: piecesRight + gap,
        y: activeTop,
        width: lostZoneWidth,
        height: besideRoom.pile,
      };
      piecesRight = lostZone.x + lostZone.width;
    }
  }
  // The control that adds or removes them: at the foot of the pieces'
  // column (`extrasControlAtFoot`), or just past what the column holds
  // (clear of a Lost Zone's count badge, or of the coin's touch area with a
  // hair to spare), short of the Active.
  const control = extrasControlAtFoot({
    columnX: middleLeft,
    columnWidth: column.width,
    coin: column.coin,
    rowBottom: activeTop + active,
    besideX: Math.min(
      piecesRight +
        (lostZone
          ? Math.max(gap, PILE_BADGE_REACH_PX)
          : Math.max(gap, EXTRAS_CONTROL_REACH_PX) + 0.5),
      activeRect.x - gap - EXTRAS_CONTROL_PX
    ),
    inColumn: !(lostZone && besideRoom?.place === 'under'),
    gap,
  });
  // With the Lost Zone beside the prizes, the deck and discard have the
  // outer column to themselves: they grow to fill both card rows, never
  // past the Active's size. Otherwise the column keeps a slot for it.
  const columnPile = lostZoneBeside
    ? Math.min(
        options.pileCapPx ?? Number.POSITIVE_INFINITY,
        Math.max(pileHeight, Math.min(active, (active + bench) / 2))
      )
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
  // The hand runs from the mat's edge (across the table, from past the
  // app bar) to its pill, which keeps off the piles where the column runs
  // down beside the hand. Its cards keep to the table's centre while they
  // fit (layoutTableHand), so the strip need not be.
  const lostZoneRect = lostZone ?? columnAt(2);
  // Tilted, the piles are drawn in the band above the hand, never beside it.
  const besideHand = outside
    ? []
    : [deck, discard, ...(lostZone ? [] : [lostZoneRect])];
  const pillFirst = options.handPillAtStart
    ? handStripPillFirst(width, handTop, besideHand, options.handEndReservePx)
    : undefined;
  const handStart =
    pillFirst?.start ?? Math.max(side, options.handStartReservePx ?? 0);
  const handEnd =
    pillFirst?.end ??
    handEndFor(width, handTop, besideHand, options.handEndReservePx);
  const handRect: Rect = {
    x: handStart,
    y: handTop,
    width: Math.max(0, handEnd - handStart),
    height: handStrip,
  };
  const judgedEdge =
    margin +
    Math.max(
      JUDGED_HAND_CORNER_PX,
      pileWidth + gap * 1.5 + JUDGED_HAND_SLOT_PX
    );
  return {
    // The bar's corner counts the same at either end (`barCornerOf`), so a
    // mirrored far half judges its mat as a turned one does.
    handRoom: Math.max(
      0,
      width - judgedEdge - Math.max(judgedEdge, barCornerOf(options))
    ),
    handCard,
    regions: [
      { kind: 'hand', rect: handRect, countAnchor: 'hand' },
      { kind: 'board', rect: boardRect },
      { kind: 'active', rect: activeRect },
      { kind: 'bench', rect: benchRect },
      { kind: 'prizes', rect: prizes },
      { kind: 'deck', rect: deck, countAnchor: 'pile' },
      { kind: 'discard', rect: discard, countAnchor: 'pile' },
      { kind: 'lostZone', rect: lostZoneRect, countAnchor: 'pile' },
    ],
    cardHeights: { active, bench },
    middle: { left: middleLeft, right: Math.max(middleRight, benchRight) },
    seamMargin: margin,
    extras: {
      ...(markers ? { markers } : {}),
      coin: coinAbove(coin, control, gap),
      control,
    },
    lostZoneBeside,
    ...(besideRoom ? { lostZonePlace: besideRoom.place } : {}),
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
  pile: 0.74,
  handStrip: 0.78,
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
const layoutHalfPortraitAs = (
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
  // A near hand's cards, per bench card's height. The rows are sized for a
  // near hand's strip; across the table the hand only peeks, and the room
  // that saves widens the clear band at the centre line, where the
  // Stadium and the rail lie (a portrait mat's band is narrow).
  const handShare = options.judged
    ? JUDGED_PORTRAIT_HAND_STRIP
    : proportions.handStrip;
  const nearCardShare = handShare / TABLE_HAND_VISIBLE_SHARE;
  const stripShare = handShare;
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
      (free * stripShare) / (rowsShare + stripShare),
      free - (rowsShare * MIN_BOARD_ROW_PX) / proportions.active
    )
  );
  let bench = free / (rowsShare + stripShare);
  if (bench * stripShare < minStrip) {
    bench = Math.max(0, free - minStrip) / rowsShare;
  }
  bench = Math.min(
    bench,
    (width - 2 * edge) / (BENCH_FIT_CARDS * CARD_ASPECT_RATIO)
  );
  const active = bench * proportions.active;
  const handStrip = Math.min(
    height,
    Math.max(
      bench *
        (options.judged
          ? stripShare
          : naturalHandStrip(nearCardShare, options)),
      minStrip
    )
  );
  const handCard = handCardFor(
    handStrip,
    bench * nearCardShare,
    height,
    options
  );

  // The pile row: prizes three across and two down at the outer left, the
  // three piles side by side at the right. Narrower than both, the row's
  // cards shrink until they fit.
  const pileGap = Math.max(gap, PORTRAIT_PILE_GAP_PX);
  const prizeGapFor = prizeGridGap;
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
  // At the foot of the pieces' column, as on the landscape mat
  // (`extrasControlAtFoot`); the Stadium straddles the centre line just past
  // the pieces on an upright phone.
  const control = extrasControlAtFoot({
    columnX: edge,
    columnWidth: column.width,
    coin: column.coin,
    rowBottom: activeTop + active,
    besideX: edge + column.width + gap,
    inColumn: true,
    gap,
  });
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
  // The hand runs from the edge (across the table, from past the app bar)
  // to its pill; the pile row ends above the pill's band.
  const pilesAbove = [pileAt(0), pileAt(1), pileAt(2)];
  const pillFirst = options.handPillAtStart
    ? handStripPillFirst(width, handTop, pilesAbove, options.handEndReservePx)
    : undefined;
  const handStart =
    pillFirst?.start ?? Math.max(edge, options.handStartReservePx ?? 0);
  const handEnd =
    pillFirst?.end ??
    handEndFor(width, handTop, pilesAbove, options.handEndReservePx);
  const handRect: Rect = {
    x: handStart,
    y: handTop,
    width: Math.max(0, handEnd - handStart),
    height: handStrip,
  };
  return {
    handRoom: Math.max(
      0,
      width -
        edge -
        JUDGED_HAND_SLOT_PX -
        Math.max(JUDGED_HAND_CORNER_PX, barCornerOf(options))
    ),
    handCard,
    regions: [
      { kind: 'hand', rect: handRect, countAnchor: 'hand' },
      { kind: 'board', rect: boardRect },
      { kind: 'active', rect: activeRect },
      { kind: 'bench', rect: benchRect },
      { kind: 'prizes', rect: prizes },
      { kind: 'deck', rect: pileAt(1), countAnchor: 'pile' },
      { kind: 'discard', rect: pileAt(0), countAnchor: 'pile' },
      { kind: 'lostZone', rect: pileAt(2), countAnchor: 'pile' },
    ],
    cardHeights: { active, bench },
    middle: { left: edge, right: width - edge },
    seamMargin: activeTop,
    // On an upright phone the Lost Zone keeps its place in the pile row.
    extras: {
      ...(column.markers ? { markers: column.markers } : {}),
      coin: coinAbove(column.coin, control, gap),
      control,
    },
    lostZoneBeside: false,
    boardMinWidth: pileWidth,
  };
};

/**
 * A half laid out with its hands as they are now -- the near hand smaller
 * than before 2026-11-05, the far one a peek -- where the taller rows that
 * leaves make its board larger. On a window too narrow for them (the mat
 * set by its width, whose prizes and piles widen with the rows) they would
 * shrink its bench or crowd its pieces: there it keeps the strips it was
 * judged by (JUDGED_HAND_STRIP), and the hands their former depth.
 */
const withSmallerHands =
  (
    layout: (
      width: number,
      height: number,
      options?: HalfOptions
    ) => HalfGeometry
  ) =>
  (width: number, height: number, options: HalfOptions = {}): HalfGeometry => {
    const laidOut = layout(width, height, options);
    if (options.judged) return laidOut;
    const before = layout(width, height, { ...options, judged: true });
    const clear = piecesClear(laidOut, true);
    if (clear !== piecesClear(before, true)) return clear ? laidOut : before;
    return benchCardHeightOf(before) > benchCardHeightOf(laidOut) + 0.5
      ? before
      : laidOut;
  };

const layoutHalf = withSmallerHands(layoutHalfAs);
const layoutHalfPortrait = withSmallerHands(layoutHalfPortraitAs);

/** The bench card a half actually shows: five and a half must fit across. */
const benchCardHeightOf = (geometry: HalfGeometry): number =>
  Math.min(
    geometry.cardHeights.bench,
    (geometry.middle.right - geometry.middle.left) /
      (BENCH_FIT_CARDS * CARD_ASPECT_RATIO)
  );

const handWidthOf = (geometry: HalfGeometry): number => geometry.handRoom;

const handCrampedIn = (geometry: HalfGeometry): boolean =>
  handWidthOf(geometry) < MIN_FAR_HAND_PX;

/**
 * A hand whose seven cards, fanned across its room, show less than
 * MIN_HAND_SLIVER_PX of each: wide in pixels, but its cards (a share of
 * them off the screen) too large for it.
 */
const handShortIn = (geometry: HalfGeometry): boolean => {
  const hand = geometry.regions.find((region) => region.kind === 'hand');
  if (!hand || hand.rect.height <= 0) return false;
  // Judged by its strip, as a near hand's cards: a peek's larger cards lie
  // mostly off the window, and judged by them a far hand would have the
  // board shrink for cards it barely shows.
  const card =
    (hand.rect.height / TABLE_HAND_VISIBLE_SHARE) * CARD_ASPECT_RATIO;
  return (
    (geometry.handRoom - card) / (TYPICAL_HAND_CARDS - 1) < MIN_HAND_SLIVER_PX
  );
};

/**
 * Whichever of the mat (columns down the sides) and the portrait mat (rows
 * down the middle) shows this half's cards larger. Wide halves -- desktops,
 * a tablet or phone held sideways -- get the mat; tall ones, the portrait.
 * Either way the hand keeps room to hold its cards apart: across the table,
 * past the app bar, one that leaves it cramped gives way to one that
 * doesn't, and of two cramped (the narrowest phones) the wider hand wins.
 * Nor does a hand too short for its cards (handShortIn: a short portrait
 * phone's mat) win the larger board, where the other mat keeps a bench card
 * of MIN_HAND_TRADE_BENCH_PX.
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
  } else {
    const short = handShortIn(landscape);
    const roomy = short ? portrait : landscape;
    if (
      short !== handShortIn(portrait) &&
      benchCardHeightOf(roomy) >= MIN_HAND_TRADE_BENCH_PX
    ) {
      return roomy;
    }
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
    handRoom: geometry.handRoom,
    handCard: geometry.handCard,
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
    ...(geometry.lostZonePlace
      ? { lostZonePlace: geometry.lostZonePlace }
      : {}),
    boardMinWidth: geometry.boardMinWidth,
  };
};

/**
 * The options a half's mat is chosen by: without its Lost Zone, which the
 * mat makes room for wherever it is chosen, so the first card into the Lost
 * Zone never turns the table into the other mat.
 */
const withoutLostZone = (options: HalfOptions): HalfOptions => {
  const { lostZoneBeside: _beside, lostZonePlace: _place, ...rest } = options;
  return rest;
};

/** A half's own choice of mat, at the frame's full height. */
const matOf = (width: number, height: number, options: HalfOptions): Mat => {
  const chosenBy: HalfOptions = { ...withoutLostZone(options), judged: true };
  const portrait = layoutHalfPortrait(width, height, chosenBy);
  return bestOf(layoutHalf(width, height, chosenBy), portrait) === portrait
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
  const laidOut = [near, far].map(({ width, height, options }) => {
    const judged: HalfOptions = { ...withoutLostZone(options), judged: true };
    return {
      landscape: layoutHalf(width, height, judged),
      portrait: layoutHalfPortrait(width, height, judged),
    };
  });
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
    } else {
      const short = (geometries: readonly HalfGeometry[]): boolean =>
        geometries.some(handShortIn);
      const roomy = short(landscape) ? portrait : landscape;
      if (
        short(landscape) !== short(portrait) &&
        least(roomy, benchCardHeightOf) >= MIN_HAND_TRADE_BENCH_PX
      ) {
        return roomy === portrait ? 'portrait' : 'landscape';
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
  const portraitOptions: HalfOptions = {
    seamBandPx: 2 * soloBand,
    stadiumBeside: true,
    ...(options.markerCount ? { markerCount: options.markerCount } : {}),
    ...(options.boardStartReservePx
      ? { boardStartReservePx: options.boardStartReservePx }
      : {}),
    ...(options.handStartReservePx
      ? { handStartReservePx: options.handStartReservePx }
      : {}),
    ...(options.handEndReservePx
      ? { handEndReservePx: options.handEndReservePx }
      : {}),
    // The pill before the strip keeps its room alone too (Codex review r7).
    ...(options.handPillAtStart ? { handPillAtStart: true } : {}),
    ...(options.minHandStripPx
      ? { minHandStripPx: options.minHandStripPx }
      : {}),
  };
  const portrait = layoutHalfPortrait(width, height, portraitOptions);
  const available = Math.max(0, height - soloBand);
  /** The tallest landscape layout whose bench still fits, at the edge. */
  const landscapeWith = (laidOut: HalfOptions): HalfGeometry => {
    // Its height is found as without the Lost Zone (`withoutLostZone`).
    const chosenBy = withoutLostZone(laidOut);
    const fits = (candidate: number): boolean => {
      const geometry = layoutHalf(width, candidate, chosenBy);
      return (
        BENCH_FIT_CARDS * geometry.cardHeights.bench * CARD_ASPECT_RATIO <=
        geometry.middle.right - geometry.middle.left
      );
    };
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
    return atPlayerEdge(layoutHalf(width, fitted, laidOut), height - fitted);
  };
  const landscape = landscapeWith(options);
  // Chosen as judged (`judged`) and without the Lost Zone.
  const judged = (laidOut: HalfOptions): HalfOptions => ({
    ...withoutLostZone(laidOut),
    judged: true,
  });
  const judgedPortrait = layoutHalfPortrait(
    width,
    height,
    judged(portraitOptions)
  );
  return bestOf(landscapeWith(judged(options)), judgedPortrait) ===
    judgedPortrait
    ? portrait
    : landscape;
};

/**
 * A rect in a half's own frame placed in the window. The opponent's mat is
 * the same mat turned around, its centre line at the bottom of its frame;
 * `mirrored` (ADR-046), it is the near mat reflected across the centre line
 * instead, so its left is the window's left.
 */
const toPhysical = (
  rect: Rect,
  frame: Rect,
  side: BoardSide,
  mirrored = false
): Rect =>
  side === 'local'
    ? {
        x: frame.x + rect.x,
        y: frame.y + rect.y,
        width: rect.width,
        height: rect.height,
      }
    : {
        x: mirrored
          ? frame.x + rect.x
          : frame.x + frame.width - rect.x - rect.width,
        y: frame.y + frame.height - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };

const countLabelFor = (
  anchor: 'pile' | 'hand',
  physical: Rect,
  side: BoardSide,
  mirrored = false
): BoardLayoutCountLabel => {
  // Piles wear their count as a badge on the corner nearest the player; the
  // hand shows its count in the slot kept at the far end of its strip, level
  // with the tops of its cards. A mirrored far half keeps the near half's
  // right-hand corner and end (ADR-046).
  const right = side === 'local' || mirrored;
  if (anchor === 'pile') {
    return {
      anchor: {
        x: right ? physical.x + physical.width : physical.x,
        y: side === 'local' ? physical.y : physical.y + physical.height,
      },
      horizontalAlign: right ? 'right' : 'left',
      verticalAlign: side === 'local' ? 'top' : 'bottom',
      fontSizePx: 13,
    };
  }
  // Every hand's pill lies on the window's left, before its strip, both
  // set against the slot's left so they line up one above the other; a
  // wider one (Solo's cover beside the count and Sort) grows over the
  // strip's empty start, never off the window (2026-11-06).
  return {
    anchor: {
      x: physical.x - HAND_PILL_GAP_PX - HAND_PILL_WIDTH_PX,
      y:
        side === 'local'
          ? physical.y + HAND_PILL_DROP_PX
          : physical.y + physical.height - HAND_PILL_DROP_PX,
    },
    horizontalAlign: 'left',
    verticalAlign: side === 'local' ? 'top' : 'bottom',
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
 * area (`soft`: those that may run under its edge), it takes the nearest
 * place that covers the least of them -- obstacles first -- along the row
 * before off it.
 */
const placeStadiumAt = (
  size: { readonly width: number; readonly height: number },
  top: number,
  actives: readonly Rect[],
  obstacles: readonly Rect[],
  soft: readonly StagingRoom[],
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
  const softBoards = soft.map((room) => room.board);
  const all = [...obstacles, ...softBoards].filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const underAt = (rect: Rect): number =>
    soft.reduce((sum, room) => sum + stagingUnder(room, rect), 0);
  // What lies within a Stadium's size of where it aims.
  const near = all.filter(
    (rect) => overlapArea(grown(rect, Math.max(width, height)), aimed) > 0
  );
  if (
    coverAt(
      aimed,
      near.filter((rect) => !softBoards.includes(rect)),
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
  soft: readonly StagingRoom[],
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
  // A board split given: the frames follow from it for where the hands lie
  // on this window, as it is now.
  if (state.boardSplit !== undefined) {
    const { boardSplit, ...framed } = state;
    return createTableLayoutSnapshot({
      ...framed,
      vertical: tableVerticalLayoutForBoards(
        boardSplit,
        tableHandsOutside(state)
      ),
    });
  }
  // v1's validated snapshot supplies the region semantics, the player
  // pairing and every input check.
  const {
    hiddenPhysicalSide: _hidden,
    hideEmptyLostZone,
    lostZoneInUse,
    hideLostZone,
    seamBandPx,
    appBarPx,
    sidePanelReveal,
    oncePerGameMarkers,
    tiltedTable: _tiltedTable,
    mirroredFarSide,
    ...semanticState
  } = state;
  // The far half reflected across the centre line, not turned (ADR-046).
  const mirrored = mirroredFarSide === true;
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
    // A Lost Zone on the table lies beside the prizes: one shown even while
    // empty, and one holding cards whatever the viewer's setting (both
    // halves alike: one mat). Put away, cards and all, none is there.
    ...(!hideLostZone && (!hideEmptyLostZone || lostZoneInUse)
      ? { lostZoneBeside: true }
      : {}),
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
  // Turned, the far hand starts at the bar's corner; mirrored, it ends
  // there, its pill just short of the bar (ADR-046).
  const farReserve: HalfOptions = {
    ...(hidden === undefined ? { handPeek: true } : {}),
    // On the window's left too: before a mirrored strip's start, past a
    // turned one's end.
    handPillAtStart: mirrored,
    ...(appBarPx
      ? {
          ...(mirrored
            ? { handEndReservePx: barReserve.handStartReservePx }
            : { handStartReservePx: barReserve.handStartReservePx }),
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
            options: { ...sharedOptions, handPeek: true },
          }
        )
      : undefined;
  // Tilted on a window wider than tall with both halves shown, the board
  // takes each half whole and the hands lie past its edges (`handsOutside`).
  const tilted = tableHandsOutside(state);
  const halfOptions: HalfOptions = {
    ...sharedOptions,
    ...(mat ? { mat } : {}),
    ...(tilted ? { handsOutside: true } : {}),
    // The near hand's pill on the window's left (2026-11-06).
    handPillAtStart: true,
  };
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
    const reflected = mirrored && template.side !== 'local';
    const place = (rect: Rect): Rect =>
      toPhysical(rect, frameBounds, template.side, reflected);
    // The Bench's stacks centre under the Active while they have room.
    const activeLocal = geometry.regions.find(
      (region) => region.kind === 'active'
    );
    const activePhysical = activeLocal ? place(activeLocal.rect) : undefined;
    const regions: BoardLayoutRegion[] = geometry.regions.map((local) => {
      const source = template.regions.find(
        (region) => region.kind === local.kind
      );
      if (!source) throw new Error(`Missing ${local.kind} region semantics`);
      const physical = place(local.rect);
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
          ? countLabelFor(local.countAnchor, physical, template.side, reflected)
          : null,
        ...(reflected ? { mirrored: true as const } : {}),
        ...(local.kind === 'bench' && activePhysical
          ? { rowCentreX: activePhysical.x + activePhysical.width / 2 }
          : {}),
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
        ...(reflected ? { mirrored: true as const } : {}),
        handCardHeight: geometry.handCard,
        extras: {
          ...(geometry.extras.markers
            ? { markers: place(geometry.extras.markers) }
            : {}),
          coin: place(geometry.extras.coin),
          control: place(geometry.extras.control),
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
      ...(farOptions.handPeek ? { handPeek: true } : {}),
      handPillAtStart: mirrored,
    };
    // `farScale`: the far half refitted on its own, portrait mat too. The
    // search lays the halves out with their Lost Zone: where a row made
    // room for it, the Stadium finds its spot anew.
    const splitAt = (
      scale: number,
      withBar = false,
      farScale?: number,
      nearPileCapPx?: number
    ) => {
      const fit = (frame: Rect, share: number): HalfOptions =>
        share < 1 ? { fitHeight: frame.height * share } : {};
      const nearFit: HalfOptions = {
        ...halfOptions,
        ...fit(frames.lower, scale),
        ...(nearPileCapPx === undefined ? {} : { pileCapPx: nearPileCapPx }),
      };
      let farFit: HalfOptions = {
        ...(withBar ? farOptions : farWithoutBar),
        ...(farScale === undefined
          ? fit(frames.upper, scale)
          : { ...fit(frames.upper, farScale), fitPortrait: true }),
      };
      let near = buildPlayer(semantics.players[0], frames.lower, nearFit);
      let far = buildPlayer(semantics.players[1], frames.upper, farFit);
      // One mat on both sides: a Lost Zone beside the prizes lies the same
      // way on both halves -- past the pieces' column on both, or under
      // the coin on both, whichever leaves the smaller of the two piles
      // the larger. (A portrait half keeps its pile row.)
      const nearPlace = near.geometry.lostZonePlace;
      const farPlace = far.geometry.lostZonePlace;
      if (nearPlace && farPlace && nearPlace !== farPlace) {
        // Each half laid out its own way already; only the other half
        // is laid out again each way.
        const farAsNear = buildPlayer(semantics.players[1], frames.upper, {
          ...farFit,
          lostZonePlace: nearPlace,
        });
        const nearAsFar = buildPlayer(semantics.players[0], frames.lower, {
          ...nearFit,
          lostZonePlace: farPlace,
        });
        const pileOf = (nearBuilt: typeof near, farBuilt: typeof far): number =>
          Math.min(
            lostZoneHeight(nearBuilt.geometry),
            lostZoneHeight(farBuilt.geometry)
          );
        const chosen =
          pileOf(nearAsFar, far) > pileOf(near, farAsNear) + 0.01
            ? { place: farPlace, near: nearAsFar, far }
            : { place: nearPlace, near, far: farAsNear };
        farFit = { ...farFit, lostZonePlace: chosen.place };
        near = chosen.near;
        far = chosen.far;
      }
      const stadiumHeight = Math.min(
        near.geometry.cardHeights.bench,
        far.geometry.cardHeights.bench
      );
      const stadiumSize = {
        width: stadiumHeight * CARD_ASPECT_RATIO,
        height: stadiumHeight,
      };
      const stadiumTop = seamY - stadiumHeight / 2;
      const actives = [activeOf(near.player), activeOf(far.player)];
      let placed: Rect;
      let onRight = false;
      if (!mirrored) {
        placed = placeStadium(
          stadiumSize,
          stadiumTop,
          actives,
          [
            ...obstaclesOf(near.player, true),
            ...obstaclesOf(far.player, false),
            ...barBox,
          ],
          // The far staging area meets it there, and makes room.
          [stagingOf(far, true)].filter((room) => room !== undefined),
          true,
          playAreaBounds
        ).rect;
      } else {
        // Mirrored (ADR-046), both halves keep their pieces on the left and
        // their staging areas on the right. The Stadium lies on the left,
        // between the two pieces' columns, wherever it has a clear place
        // there (smaller, if need be, as everywhere); only with none does it
        // go where the two staging areas meet at the centre line on the
        // right, each making room for it from its Active end.
        const left = placeStadium(
          stadiumSize,
          stadiumTop,
          actives,
          [
            ...obstaclesOf(near.player, true),
            ...obstaclesOf(far.player, true),
            ...barBox,
          ],
          [],
          true,
          playAreaBounds
        );
        placed = left.rect;
        const clearAt = (found: typeof left): boolean =>
          found.cover <= CLEAR_PX2 && found.under <= CLEAR_PX2;
        if (!clearAt(left)) {
          const right = placeStadium(
            stadiumSize,
            stadiumTop,
            actives,
            [
              ...obstaclesOf(near.player, false),
              ...obstaclesOf(far.player, false),
              ...barBox,
            ],
            [stagingOf(near, false), stagingOf(far, false)].filter(
              (room) => room !== undefined
            ),
            false,
            playAreaBounds
          );
          const better =
            right.cover < left.cover - 0.5 ||
            (right.cover <= left.cover + 0.5 &&
              (right.under < left.under - 0.5 ||
                (right.under <= left.under + 0.5 &&
                  right.rect.width > left.rect.width + 0.5)));
          if (better) {
            placed = right.rect;
            onRight = true;
          }
        }
      }
      // The far half's staging area lies beside its Active on the
      // Stadium's side of the table; it starts past the Stadium instead of
      // running under it (layoutHalf keeps it whole where that would leave
      // it less than a pile wide).
      const farBoard = regionOf(far.player, 'board');
      const reserve =
        farBoard && !mirrored
          ? farBoard.x + farBoard.width - (placed.x - STADIUM_CLEARANCE_PX)
          : 0;
      if (farBoard && reserve > 0 && overlapArea(farBoard, placed) > 0) {
        far = buildPlayer(semantics.players[1], frames.upper, {
          ...farFit,
          boardStartReservePx: reserve,
        });
      }
      if (onRight) {
        // Both staging areas start past the Stadium at their Active end.
        const past = (board: Rect | undefined): number =>
          board && overlapArea(board, placed) > 0
            ? placed.x + placed.width + STADIUM_CLEARANCE_PX - board.x
            : 0;
        const nearReserve = past(regionOf(near.player, 'board'));
        if (nearReserve > 0) {
          near = buildPlayer(semantics.players[0], frames.lower, {
            ...nearFit,
            boardStartReservePx: nearReserve,
          });
        }
        const farReserve = past(regionOf(far.player, 'board'));
        if (farReserve > 0) {
          far = buildPlayer(semantics.players[1], frames.upper, {
            ...farFit,
            boardStartReservePx: farReserve,
          });
        }
      }
      const staged = regionOf(far.player, 'board');
      // A Lost Zone on the table keeps a pile, however small: a mat that
      // leaves it none is laid out smaller (2026-11-06; before, a 600px
      // window kept a 13px one by chance).
      const pileKept = (built: typeof near): boolean =>
        !built.geometry.lostZoneBeside || lostZoneHeight(built.geometry) > 0;
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
          overlapArea(staged, placed) <= STADIUM_OVERLAP_SLACK_PX2 &&
          pileKept(near) &&
          pileKept(far),
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
    let farScaleChosen: number | undefined;
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
        let fallbackScale: number | undefined;
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
            fallbackScale = farScale;
          }
          above = farScale;
        }
        if (found === undefined) {
          split = fallback;
          farScaleChosen = fallbackScale;
        } else {
          let low = found;
          let high = above;
          for (let step = 0; step < 8; step += 1) {
            const middle = (low + high) / 2;
            if (clear(splitAt(scale, true, middle))) low = middle;
            else high = middle;
          }
          split = splitAt(scale, true, low);
          farScaleChosen = low;
        }
      }
    }
    // The near piles never larger beside their cards than the far ones:
    // where the far half's are smaller for its cards (they give way to the
    // app bar), the near half's come down to the same share of its own
    // bench card. Even halves get one pile size; a far half smaller all
    // round (a phone on its side) leaves the near piles as they are, and
    // the far piles are never made smaller (2026-11-09).
    const rowOf = (
      built: typeof split.near,
      kind: BoardLayoutRegionKind
    ): number => regionOf(built.player, kind)?.height ?? 0;
    const share = (built: typeof split.near): number => {
      const bench = rowOf(built, 'bench');
      return bench > 0 ? rowOf(built, 'deck') / bench : 0;
    };
    const farShare = share(split.far);
    // Smaller piles can let the near half take its taller rows, so the cap
    // is found again against the Bench it gives, a pass or two; where that
    // swings between the two, the layout kept is the one whose piles are
    // the largest without outgrowing the far ones beside their cards.
    const fitsFar = (built: typeof split.near): boolean =>
      share(built) <= farShare + 0.001;
    let best = fitsFar(split.near) ? split : undefined;
    let pileCap: number | undefined;
    for (let pass = 0; pass < 3; pass += 1) {
      const want = farShare * rowOf(split.near, 'bench');
      const deck = rowOf(split.near, 'deck');
      const held = pileCap !== undefined && deck >= pileCap - 0.01;
      if (deck <= want + 0.01 && (!held || deck >= want - 0.5)) break;
      pileCap = want;
      split = splitAt(scale, true, farScaleChosen, pileCap);
      if (
        fitsFar(split.near) &&
        (best === undefined ||
          rowOf(split.near, 'deck') > rowOf(best.near, 'deck'))
      ) {
        best = split;
      }
    }
    if (best && !fitsFar(split.near)) split = best;
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
    // The far half reads right to left on the screen, unless mirrored.
    const leftToRight = atTop || mirrored;
    /** The Stadium on the screen's left of the Active, or its right. */
    const placedOn = (toLeft: boolean) => {
      // The staging area lies on the player's own right: across the table
      // that is the screen's left (a mirrored far half's right).
      const boardSide = leftToRight !== toLeft;
      const board = regionOf(shown.player, 'board');
      const found = placeStadium(
        size,
        top,
        [active],
        [...obstaclesOf(shown.player, !boardSide), ...barBox, controlsBand],
        boardSide
          ? [stagingOf(shown, toLeft)].filter((room) => room !== undefined)
          : [],
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
    // The player's own left: across the table, the screen's right (a
    // mirrored far half's left).
    let chosen = placedOn(leftToRight);
    if (chosen.found.cover > CLEAR_PX2) {
      // No clear place there (a small table): the other side, if clearer.
      const other = placedOn(!leftToRight);
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
    ...(state.hideLostZone ? { hideLostZone: true as const } : {}),
    ...(state.farCardsUpright ? { farCardsUpright: true as const } : {}),
    ...(tilted ? { tiltedTable: true as const } : {}),
    ...(mirrored ? { mirroredFarSide: true as const } : {}),
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
  // The seam where the pointer is: frames, no longer a board split.
  const { boardSplit: _split, ...framed } = state;
  return {
    ...framed,
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

/**
 * Cards side by side across a row, overlapping evenly once they run out of
 * room: centred in the row, or on `centre` as far as the row allows.
 */
const spreadRow = (
  content: Rect,
  count: number,
  cardWidth: number,
  reversed: boolean,
  centre?: number
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
  const start =
    centre === undefined || !Number.isFinite(centre)
      ? content.x + (content.width - total) / 2
      : Math.max(
          content.x,
          Math.min(content.x + content.width - total, centre - total / 2)
        );
  return Array.from({ length: count }, (_, index) =>
    reversed ? start + total - cardWidth - index * step : start + index * step
  );
};

/**
 * The hand along the screen edge. Its strip shows the top of each card; the
 * rest runs off the edge until hovered. The opponent's mat is turned, so
 * their hand runs off the top and in mirrored order. The strip runs from
 * one side of the table to the hand's pill at the other, so the cards keep
 * to the table's centre (`centre`, the play area's) while they fit, and
 * take the whole strip only when crowded.
 */
export const layoutTableHand = (
  content: Rect,
  side: BoardSide,
  count: number,
  centre?: number,
  /** Its cards' height (BoardPlayerLayout.handCardHeight); else a near hand's. */
  cardHeightPx?: number,
  /** A mirrored far half (ADR-046): its hand runs left to right too. */
  mirrored = false
): Rect[] => {
  const cardHeight =
    cardHeightPx !== undefined &&
    Number.isFinite(cardHeightPx) &&
    cardHeightPx >= content.height
      ? cardHeightPx
      : content.height / TABLE_HAND_VISIBLE_SHARE;
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const y =
    side === 'local' ? content.y : content.y + content.height - cardHeight;
  return spreadRow(
    content,
    count,
    cardWidth,
    side !== 'local' && !mirrored,
    centre
  ).map((x) => ({
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
  count: number,
  /** A mirrored far half (ADR-046): its row runs left to right too. */
  mirrored = false
): Rect[] => {
  const cardHeight = Math.min(
    content.height,
    content.width / CARD_ASPECT_RATIO
  );
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const y = content.y + (content.height - cardHeight) / 2;
  return spreadRow(
    content,
    count,
    cardWidth,
    side !== 'local' && !mirrored
  ).map((x) => ({
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
  count: number,
  /**
   * A mirrored far half (ADR-046): its grid reflected across the centre line,
   * the first prize at the left by the centre line.
   */
  mirrored = false
): Rect[] => {
  if (count <= 0) return [];
  const columns = content.width > content.height ? 3 : 2;
  const rows = Math.max(6 / columns, Math.ceil(count / columns));
  const gap = prizeGridGap(content.height);
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
    // The opponent's view of their grid is turned half way round, or
    // reflected across the centre line where their half is mirrored.
    const column =
      side === 'local' || mirrored ? ownColumn : columns - 1 - ownColumn;
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
