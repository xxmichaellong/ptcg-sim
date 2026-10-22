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
 * The corner of each hand strip, beside the hand, that holds that player's
 * VSTAR/GX markers and hand-sort control. Mirrored by the web app's chrome
 * stylesheet.
 */
export const TABLE_CONTROL_CORNER_PX = 96;

/**
 * How far up from the player's edge the corner's controls reach: the
 * VSTAR/GX markers stacked under the hand-sort control. A hand strip
 * shorter than this lays them side by side instead (the web app's chrome),
 * which needs only TABLE_COMPACT_CORNER_HEIGHT_PX.
 */
export const TABLE_CONTROL_CORNER_HEIGHT_PX = 104;
export const TABLE_COMPACT_CORNER_HEIGHT_PX = 56;

/**
 * A marker's room in a corner too short to stack them, side by side (the
 * web app's chrome): VSTAR's and GX's buttons at their largest, 87 and 68
 * pixels, with the gaps around them.
 */
const COMPACT_CORNER_MARKER_PX = 80;

/** Room at the far end of each hand strip for its card-count badge. */
const HAND_COUNT_SLOT_PX = 44;

/**
 * The least a far hand keeps past the app bar on an upright screen; where
 * the markers' corner would leave it less, they take a row of their own
 * below the bar instead (`MARKER_ROW_PX` deep: 24px controls, 6px about).
 */
const MIN_FAR_HAND_PX = 128;
const MARKER_ROW_PX = 36;
/** The least an Active card keeps: a markers' row never costs the board more. */
const MIN_BOARD_ROW_PX = 12;

/**
 * Across the table the corner beside the hand lies under the app bar
 * (ADR-036). Markers that found no place beside the prizes keep a corner
 * of their own past the bar, as deep as the hand strip, and the hand
 * starts after it. `start` is where the bar's reserve ends.
 */
const cornerPastBar = (
  start: number,
  markerCount: number,
  stripTop: number,
  stripHeight: number,
  end: number
): Rect | undefined =>
  start > 0 && markerCount > 0
    ? {
        x: start,
        y: stripTop,
        // Never past the half's far edge, on the narrowest tables.
        width: Math.max(
          0,
          Math.min(
            end - start,
            stripHeight < TABLE_CONTROL_CORNER_HEIGHT_PX
              ? Math.max(
                  TABLE_CONTROL_CORNER_PX,
                  16 + markerCount * COMPACT_CORNER_MARKER_PX
                )
              : TABLE_CONTROL_CORNER_PX
          )
        ),
        height: stripHeight,
      }
    : undefined;
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
   * The optional pieces beside the prizes, and the corner past the app bar
   * for markers that have no place there, in the half's own frame.
   */
  readonly extras?: {
    readonly markers?: Rect;
    readonly control: Rect;
    readonly corner?: Rect;
    /** The corner is a row of its own, between the hand and the mat. */
    readonly markersRow?: true;
  };
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
  readonly boardEndReservePx?: number;
  /**
   * `false`: the markers and Lost Zone keep their old places rather than
   * sit beside the prizes, where the Stadium would lie over them (its
   * reserve not kept: the staging area would be under a card wide).
   */
  readonly piecesBesidePrizes?: boolean;
  /**
   * The Lost Zone is on the table (not optional-and-hidden): it sits beside
   * the prizes toward the centre line rather than at the end of the outer
   * column.
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
   * The far markers sit in a row of their own below the app bar, the hand
   * strip deepened for it: a corner past the bar would leave the hand less
   * than `MIN_FAR_HAND_PX`. `false`: never, the row would leave the board
   * too little; unset, the layout decides.
   */
  readonly markersBelowBar?: boolean;
}

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
/** The add-or-remove control for the optional pieces: a small round button. */
const EXTRAS_CONTROL_PX = 26;
/** The clear space between the Stadium and the far staging area. */
const STADIUM_CLEARANCE_PX = 8;
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
/**
 * A shorter far fit that keeps the markers beside the prizes (rather than
 * moved from under the Stadium, which costs the hand far more) keeps at
 * least this share of the far Active.
 */
const MOVED_MARKERS_ACTIVE_SHARE = 0.85;
/** The bench row must hold this many bench cards side by side. */
const BENCH_FIT_CARDS = 5.5;

/**
 * The clear space between the outer columns (prizes, piles) and the side
 * of the mat: a small, steady inset, so the columns run out to its edges.
 */
const sideMarginFor = (width: number): number =>
  Math.max(8, Math.min(14, width * 0.008));

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
  // the app bar's corner, so nothing else lies under the bar (and the
  // markers' row below it, where they have one).
  const markerRow = options.markersBelowBar ? MARKER_ROW_PX : 0;
  const natural = height * proportions.handStrip * (options.handScale ?? 1);
  // Never so deep that the board keeps no rows to speak of: on the
  // smallest tables the bar's corner gives way first.
  const roomForStrip = Math.max(
    natural,
    height - margin - 2 * gap - MIN_BOARD_ROW_PX / proportions.activeShare
  );
  const handStrip = Math.min(
    height,
    Math.max(
      natural,
      Math.min((options.minHandStripPx ?? 0) + markerRow, roomForStrip)
    )
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
  const pileLeft = width - side - pileWidth;
  const pileAt = (index: number): Rect => ({
    x: pileLeft,
    y: activeTop + index * (pileHeight + gap),
    width: pileWidth,
    height: pileHeight,
  });

  // Reserve equal space for the outer columns so both Actives and benches
  // share the table's centre, even though prizes are wider than a pile.
  const middleLeft = side + Math.max(prizes.width, pileWidth) + gap * 1.5;
  const middleRight = width - middleLeft;
  const middleWidth = Math.max(0, middleRight - middleLeft);
  const centre = width / 2;
  // The Active slot is wide enough for a stack with attachments peeking out.
  const activeWidth = Math.min(middleWidth, active * CARD_ASPECT_RATIO * 2.2);
  const activeRect: Rect = {
    x: centre - activeWidth / 2,
    y: activeTop,
    width: activeWidth,
    height: active,
  };
  // Beside the prizes, toward the centre line, the optional pieces the
  // viewer keeps on the table: the VSTAR/GX markers, which players keep by
  // their prizes, then the Lost Zone pile. The staging area (v1's loose
  // board) takes the rest of the row up to the Active. Where that would
  // leave it less than a card wide, the pieces keep their old places
  // instead: the Lost Zone at the end of the outer column, the markers by
  // the hand.
  // Kept clear of the Stadium where that leaves the staging area at least a
  // card wide; a narrow table keeps it whole, under the Stadium's edge.
  const reserve = options.boardEndReservePx ?? 0;
  const boardEnd =
    activeRect.x - gap - reserve - middleLeft >= pileWidth
      ? activeRect.x - gap - reserve
      : activeRect.x - gap;
  const markerCount = Math.max(0, Math.min(2, options.markerCount ?? 0));
  const markerWidth = pileWidth * MARKER_COLUMN_SHARE;
  // Markers given a row below the bar sit in it, not beside the prizes.
  const markersBeside = markerCount > 0 && options.markersBelowBar !== true;
  const piecesWidth =
    (options.lostZoneBeside ? pileWidth + gap : 0) +
    (markersBeside ? markerWidth + gap : 0);
  // Nor where the Stadium would lie over them (`piecesBesidePrizes`).
  const besidePrizes =
    options.piecesBesidePrizes !== false &&
    piecesWidth > 0 &&
    boardEnd - middleLeft - piecesWidth >= pileWidth;
  let boardLeft = middleLeft;
  let lostZone = pileAt(2);
  let markers: Rect | undefined;
  if (besidePrizes && markersBeside) {
    markers = {
      x: boardLeft,
      y: activeTop,
      width: markerWidth,
      height: markerCount * (markerWidth / 2) + (markerCount - 1) * (gap / 2),
    };
    boardLeft += markerWidth + gap;
  }
  if (besidePrizes && options.lostZoneBeside) {
    lostZone = {
      x: boardLeft,
      y: activeTop,
      width: pileWidth,
      height: Math.min(pileHeight, active),
    };
    boardLeft += pileWidth + gap;
  }
  const boardRect: Rect = {
    x: boardLeft,
    y: activeTop,
    width: Math.max(0, boardEnd - boardLeft),
    height: active,
  };
  // The control that adds or removes them sits in the staging area's
  // corner by the prizes, toward the player's edge, clear of its label.
  const control: Rect = {
    x: boardRect.x + 6,
    y: activeTop + active - 6 - EXTRAS_CONTROL_PX,
    width: EXTRAS_CONTROL_PX,
    height: EXTRAS_CONTROL_PX,
  };
  // With the Lost Zone beside the prizes, the deck and discard have the
  // outer column to themselves: they grow to fill both card rows, never
  // past the Active's size. Otherwise the column keeps a slot for it.
  const columnPile =
    besidePrizes && options.lostZoneBeside
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
  if (!(besidePrizes && options.lostZoneBeside)) lostZone = columnAt(2);
  // The bench runs from the prizes to the piles.
  const benchRight = deck.x - gap * 1.5;
  const benchRect: Rect = {
    x: middleLeft,
    y: benchTop,
    width: Math.max(0, benchRight - middleLeft),
    height: bench,
  };
  const handLeft =
    margin +
    Math.max(
      TABLE_CONTROL_CORNER_PX,
      pileWidth + gap * 1.5 + HAND_COUNT_SLOT_PX
    );
  const handRight = width - handLeft;
  const pastBar = options.handStartReservePx ?? 0;
  const cornerMarkers = markers ? 0 : markerCount;
  if (options.markersBelowBar !== true) {
    const past = cornerPastBar(
      pastBar,
      cornerMarkers,
      handTop,
      handStrip,
      width - side
    );
    // Past the bar, the markers would leave the hand too little: they take
    // a row below the bar instead, where it fits wholly below it.
    if (
      past &&
      handRight - Math.max(handLeft, past.x + past.width) < MIN_FAR_HAND_PX &&
      (options.minHandStripPx ?? 0) + MARKER_ROW_PX <= roomForStrip
    ) {
      const below = layoutHalf(width, height, {
        ...options,
        markersBelowBar: true,
      });
      // Unless the row leaves the board next to nothing: the hand is then
      // cramped, and the board kept.
      if (below.cardHeights.active >= MIN_BOARD_ROW_PX) return below;
    }
  }
  const corner: Rect | undefined =
    options.markersBelowBar && cornerMarkers > 0
      ? {
          x: side,
          y: handTop,
          width: Math.min(
            width - 2 * side,
            16 + cornerMarkers * COMPACT_CORNER_MARKER_PX
          ),
          height: markerRow,
        }
      : cornerPastBar(pastBar, cornerMarkers, handTop, handStrip, width - side);
  const handStart = Math.max(
    handLeft,
    corner && !options.markersBelowBar ? corner.x + corner.width : pastBar
  );
  const handRect: Rect = {
    x: handStart,
    y: handTop + markerRow,
    width: Math.max(0, handRight - handStart),
    height: handStrip - markerRow,
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
      { kind: 'lostZone', rect: lostZone, countAnchor: 'pile' },
    ],
    cardHeights: { active, bench },
    middle: { left: middleLeft, right: Math.max(middleRight, benchRight) },
    seamMargin: margin,
    extras: {
      ...(markers ? { markers } : {}),
      control,
      ...(corner ? { corner } : {}),
      ...(corner && options.markersBelowBar
        ? { markersRow: true as const }
        : {}),
    },
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
 * columns become rows: the Active (with the staging area beside it), the
 * bench across the full width, then a row of prizes (three by two) and the
 * deck, discard and Lost Zone side by side, and the hand at the edge. Every
 * card is sized from the bench card, the largest that lets five and a half
 * fit across and every row fit down. The rows sit at the player's edge; any
 * height left over widens the clear band at the centre line.
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
  // Across the table the hand starts past the app bar. Its markers, in a
  // corner past the bar, would leave it too little on a narrow screen:
  // they sit below the bar instead, in a row the strip makes room for.
  const pastBar = options.handStartReservePx ?? 0;
  const markerCount = Math.max(0, Math.min(2, options.markerCount ?? 0));
  const markersBelowBar =
    options.markersBelowBar !== false &&
    pastBar > 0 &&
    markerCount > 0 &&
    width -
      edge -
      HAND_COUNT_SLOT_PX -
      pastBar -
      Math.max(
        TABLE_CONTROL_CORNER_PX,
        16 + markerCount * COMPACT_CORNER_MARKER_PX
      ) <
      MIN_FAR_HAND_PX;
  // A portrait hand strip is at least tall enough for the corner's
  // controls side by side, so the pile row above stays clear of them.
  // At least as deep as the app bar's corner, across the table.
  const wantedStrip = Math.max(
    TABLE_COMPACT_CORNER_HEIGHT_PX,
    (options.minHandStripPx ?? 0) + (markersBelowBar ? MARKER_ROW_PX : 0)
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
  // A markers' row that leaves the board next to nothing gives way: the
  // markers take the corner past the bar, the hand cramped.
  if (
    markersBelowBar &&
    (active < MIN_BOARD_ROW_PX || minStrip < wantedStrip)
  ) {
    return layoutHalfPortrait(width, height, {
      ...options,
      markersBelowBar: false,
    });
  }
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

  const centre = width / 2;
  const activeWidth = Math.min(
    width - 2 * edge,
    active * CARD_ASPECT_RATIO * 2.2
  );
  const activeRect: Rect = {
    x: centre - activeWidth / 2,
    y: activeTop,
    width: activeWidth,
    height: active,
  };
  // The staging area (v1's loose board) beside the Active, toward the prizes.
  const boardRect: Rect = {
    x: edge,
    y: activeTop,
    width: Math.max(0, activeRect.x - gap - edge),
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
  const corner: Rect | undefined = markersBelowBar
    ? {
        x: edge,
        y: handTop,
        width: Math.min(
          width - 2 * edge,
          16 + markerCount * COMPACT_CORNER_MARKER_PX
        ),
        height: MARKER_ROW_PX,
      }
    : cornerPastBar(pastBar, markerCount, handTop, handStrip, width - edge);
  const handStart = Math.max(
    TABLE_CONTROL_CORNER_PX,
    corner && !markersBelowBar ? corner.x + corner.width : pastBar
  );
  // Below the bar, the markers' row lies between the hand and the piles.
  const handInset = markersBelowBar ? MARKER_ROW_PX : 0;
  const handRect: Rect = {
    x: handStart,
    y: handTop + handInset,
    width: Math.max(0, width - edge - HAND_COUNT_SLOT_PX - handStart),
    height: handStrip - handInset,
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
    // On an upright phone the optional pieces keep their places (the Lost
    // Zone in the pile row, the markers by the hand); the control that adds
    // them sits in the staging area's corner.
    extras: {
      control: {
        x: boardRect.x + 6,
        y: activeTop + active - 6 - EXTRAS_CONTROL_PX,
        width: EXTRAS_CONTROL_PX,
        height: EXTRAS_CONTROL_PX,
      },
      ...(corner ? { corner } : {}),
      ...(corner && markersBelowBar ? { markersRow: true as const } : {}),
    },
  };
};

/** The bench card a half actually shows: five and a half must fit across. */
const benchCardHeightOf = (geometry: HalfGeometry): number =>
  Math.min(
    geometry.cardHeights.bench,
    (geometry.middle.right - geometry.middle.left) /
      (BENCH_FIT_CARDS * CARD_ASPECT_RATIO)
  );

/**
 * Whether the portrait mat is the one, chosen as the half would be without
 * its markers: where they go (past the bar or below it) costs a layout up
 * to a row, and must not swap mat and portrait back and forth as the
 * window grows a pixel at a time.
 */
const portraitChosen = (
  options: HalfOptions,
  candidates: (options: HalfOptions) => {
    readonly landscape: HalfGeometry;
    readonly portrait: HalfGeometry;
  }
): boolean => {
  const { landscape, portrait } = candidates(
    options.markerCount ? { ...options, markerCount: 0 } : options
  );
  return bestOf(landscape, portrait) === portrait;
};

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
    ...(geometry.extras
      ? {
          extras: {
            ...(geometry.extras.markers
              ? { markers: lowered(geometry.extras.markers) }
              : {}),
            control: lowered(geometry.extras.control),
            ...(geometry.extras.corner
              ? { corner: lowered(geometry.extras.corner) }
              : {}),
            ...(geometry.extras.markersRow
              ? { markersRow: true as const }
              : {}),
          },
        }
      : {}),
  };
};

const layoutTableHalf = (
  width: number,
  height: number,
  options: HalfOptions
): HalfGeometry => {
  // Mat or portrait mat is chosen at the frame's full height, so fitting
  // the mat shorter never turns it into the other.
  const candidates = (
    chosen: HalfOptions
  ): { readonly landscape: HalfGeometry; readonly portrait: HalfGeometry } => ({
    landscape: layoutHalf(width, height, chosen),
    portrait: layoutHalfPortrait(width, height, chosen),
  });
  const { landscape, portrait } = candidates(options);
  const portraitWins = options.markerCount
    ? portraitChosen(options, candidates)
    : bestOf(landscape, portrait) === portrait;
  const fitted = options.fitHeight;
  if (fitted === undefined || fitted >= height) {
    return portraitWins ? portrait : landscape;
  }
  if (portraitWins) {
    return options.fitPortrait
      ? atPlayerEdge(
          layoutHalfPortrait(width, fitted, options),
          height - fitted
        )
      : portrait;
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
  const candidates = (
    chosen: HalfOptions
  ): { readonly landscape: HalfGeometry; readonly portrait: HalfGeometry } => {
    // Tall, the portrait mat takes the whole height: its rows sit at the
    // player's edge and the rest of the height is the band already.
    const portrait = layoutHalfPortrait(width, height, {
      seamBandPx: 2 * soloBand,
      ...(chosen.markerCount ? { markerCount: chosen.markerCount } : {}),
      ...(chosen.handStartReservePx
        ? { handStartReservePx: chosen.handStartReservePx }
        : {}),
      ...(chosen.minHandStripPx
        ? { minHandStripPx: chosen.minHandStripPx }
        : {}),
    });
    const fits = (candidate: number): boolean => {
      const geometry = layoutHalf(width, candidate, chosen);
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
    return {
      landscape: atPlayerEdge(
        layoutHalf(width, fitted, chosen),
        height - fitted
      ),
      portrait,
    };
  };
  const { landscape, portrait } = candidates(options);
  const portraitWins = options.markerCount
    ? portraitChosen(options, candidates)
    : bestOf(landscape, portrait) === portrait;
  return portraitWins ? portrait : landscape;
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
  const halfOptions: HalfOptions = {
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
        ...(geometry.extras
          ? {
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
                control: toPhysical(
                  geometry.extras.control,
                  frameBounds,
                  template.side
                ),
                ...(geometry.extras.corner
                  ? {
                      corner: toPhysical(
                        geometry.extras.corner,
                        frameBounds,
                        template.side
                      ),
                    }
                  : {}),
                ...(geometry.extras.markersRow
                  ? { markersRow: true as const }
                  : {}),
              },
            }
          : {}),
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
  // Across the table, the hand is the smaller one, and ends short of the
  // app bar in the window's top-right corner.
  const farOptions: HalfOptions = {
    ...halfOptions,
    ...(hidden === undefined ? { handScale: TABLE_FAR_HAND_SCALE } : {}),
    ...(appBarPx
      ? {
          handStartReservePx: barReserve.handStartReservePx,
          minHandStripPx: barReserve.minHandStripPx,
        }
      : {}),
  };
  let upper = buildPlayer(semantics.players[1], frames.upper, farOptions);
  const activeOf = (player: BoardPlayerLayout): Rect =>
    player.regions.find((region) => region.kind === 'active')!
      .physicalDeclaredBounds;

  let stadium: Rect;
  let controls: { readonly y: number; readonly height: number };
  let controlsLeft: number;
  if (hidden === undefined) {
    // The seam between the halves: the stadium straddles it to the right of
    // the Actives, the board controls sit at its left.
    const seamY = lower.player.frameBounds.y;
    // Both halves laid out `scale` of their frames tall, at the players'
    // edges, with the Stadium straddling the seam to the right of the
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
      const near = buildPlayer(semantics.players[0], frames.lower, {
        ...halfOptions,
        ...fit(frames.lower, scale),
      });
      const farFit = {
        ...(withBar ? farOptions : farWithoutBar),
        ...(farScale === undefined
          ? fit(frames.upper, scale)
          : { ...fit(frames.upper, farScale), fitPortrait: true }),
      };
      let far = buildPlayer(semantics.players[1], frames.upper, farFit);
      let stagingFar = far;
      let markersMoved = false;
      const stadiumHeight = Math.min(
        near.geometry.cardHeights.bench,
        far.geometry.cardHeights.bench
      );
      const stadiumWidth = stadiumHeight * CARD_ASPECT_RATIO;
      const nearActive = activeOf(near.player);
      const placed: Rect = {
        x: Math.min(
          playAreaWidth - stadiumWidth - 8,
          nearActive.x + nearActive.width + stadiumWidth * 0.35
        ),
        y: seamY - stadiumHeight / 2,
        width: stadiumWidth,
        height: stadiumHeight,
      };
      // How much of the far half's board, and its markers, the Stadium
      // lies over.
      const coveredBy = (built: typeof far): number => {
        let area = 0;
        const markers = built.player.extras?.markers;
        for (const box of [
          ...built.player.regions
            .filter((region) => region.kind !== 'hand')
            .map((region) => region.physicalDeclaredBounds),
          ...(markers ? [markers] : []),
        ]) {
          area +=
            Math.max(
              0,
              Math.min(box.x + box.width, placed.x + placed.width) -
                Math.max(box.x, placed.x)
            ) *
            Math.max(
              0,
              Math.min(box.y + box.height, placed.y + placed.height) -
                Math.max(box.y, placed.y)
            );
        }
        return area;
      };
      // The far half's staging area lies beside its Active on the Stadium's
      // side of the table; it stops short of the Stadium instead of running
      // under it (layoutHalf keeps it whole where that would leave it less
      // than a pile wide).
      const farBoard = far.player.regions.find(
        (region) => region.kind === 'board'
      )?.physicalDeclaredBounds;
      const reserve = farBoard
        ? placed.x + placed.width + STADIUM_CLEARANCE_PX - farBoard.x
        : 0;
      if (
        farBoard &&
        reserve > 0 &&
        farBoard.y < placed.y + placed.height &&
        farBoard.y + farBoard.height > placed.y &&
        farBoard.x < placed.x + placed.width
      ) {
        far = buildPlayer(semantics.players[1], frames.upper, {
          ...farFit,
          boardEndReservePx: reserve,
        });
        // The staging area's room is read before the pieces below move:
        // what they leave it lies under the Stadium.
        stagingFar = far;
        // The markers and Lost Zone beside the prizes are never under it
        // beyond a sliver (a press there would turn a marker over): what is
        // under goes back to its old place -- the Lost Zone to its column,
        // the markers by the hand -- and the staging area, which may run
        // under its edge, takes the room.
        const under = (box: Rect | undefined): boolean => {
          if (!box) return false;
          const across =
            Math.min(box.x + box.width, placed.x + placed.width) -
            Math.max(box.x, placed.x);
          const down =
            Math.min(box.y + box.height, placed.y + placed.height) -
            Math.max(box.y, placed.y);
          return (
            across > 0 && down > 0 && across * down > STADIUM_OVERLAP_SLACK_PX2
          );
        };
        const lostZoneUnder = under(
          far.player.regions.find((region) => region.kind === 'lostZone')
            ?.physicalDeclaredBounds
        );
        if (!under(far.player.extras?.markers) && lostZoneUnder) {
          far = buildPlayer(semantics.players[1], frames.upper, {
            ...farFit,
            boardEndReservePx: reserve,
            lostZoneBeside: false,
          });
        }
        if (under(far.player.extras?.markers)) {
          far = buildPlayer(semantics.players[1], frames.upper, {
            ...farFit,
            boardEndReservePx: reserve,
            piecesBesidePrizes: false,
          });
          markersMoved = true;
        }
      }
      const staging =
        stagingFar.player.regions.find((region) => region.kind === 'board')
          ?.physicalDeclaredBounds.width ?? Infinity;
      const covered = coveredBy(far);
      return {
        near,
        far,
        stadium: placed,
        // The far staging area still holds a card beside the Stadium (with
        // a hair to spare, so the search never settles a rounding short).
        fits: staging >= stadiumWidth + 0.5,
        covered,
        // The markers were moved off the prizes, from under the Stadium.
        markersMoved,
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
      // The bar can change the far half -- a cramped hand there takes the
      // mat, its cards bigger; a markers' row below the bar pushes its rows
      // toward the seam -- so that the Stadium lies over more of it than it
      // would without the bar. The far half alone then takes the tallest
      // fit that clears it as well, keeping its markers' row; the near half
      // is kept as it was.
      const plain = splitAt(scale);
      const unfitted = split;
      const rowed = (candidate: typeof split): boolean =>
        candidate.far.player.extras?.markersRow === true;
      // A row the markers took only because they were moved off the prizes
      // is no row to keep.
      const keepsRow = (candidate: typeof split): boolean =>
        !rowed(unfitted) || unfitted.markersMoved || rowed(candidate);
      const activeOf = (candidate: typeof split): number =>
        candidate.far.geometry.cardHeights.active;
      // Markers moved off the prizes cost the far half its hand's room or
      // a row: a slightly shorter fit that keeps them there, clear, is
      // better, while it keeps most of the far Active.
      const keepsActive = (candidate: typeof split): boolean =>
        activeOf(candidate) >= activeOf(unfitted) * MOVED_MARKERS_ACTIVE_SHARE;
      const handOf = (candidate: typeof split): number =>
        candidate.far.player.regions.find((region) => region.kind === 'hand')
          ?.physicalDeclaredBounds.width ?? 0;
      // By the prizes in fact (a fit whose markers never fit there moved
      // none, but keeps none there either), and only where moving them
      // cost the far half: a smaller Active, or a hand cramped by a fifth.
      const keepsMarkers = (candidate: typeof split): boolean =>
        !unfitted.markersMoved ||
        (candidate.far.player.extras?.markers !== undefined &&
          keepsActive(candidate) &&
          (activeOf(candidate) > activeOf(unfitted) + 0.5 ||
            handOf(candidate) > handOf(unfitted) * 1.25));
      const clear = (candidate: typeof split): boolean =>
        (candidate.fits || !plain.fits) &&
        candidate.covered <= plain.covered + STADIUM_OVERLAP_SLACK_PX2 &&
        keepsRow(candidate) &&
        keepsMarkers(candidate);
      if (!clear(split)) {
        // Shorter is not steadily clearer (piles shrink, the Lost Zone and
        // the markers move, the staging area's reserve comes and goes), so
        // the fits are tried downward and the first clear one refined.
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
        const clearButMarkers =
          (unfitted.fits || !plain.fits) &&
          unfitted.covered <= plain.covered + STADIUM_OVERLAP_SLACK_PX2 &&
          keepsRow(unfitted);
        let aboveMoved = unfitted.markersMoved;
        for (const farScale of tries) {
          const candidate = splitAt(scale, true, farScale);
          // Between a fit whose markers were moved from under the Stadium
          // and one with no room for them beside the prizes lies, where
          // there is one, a window where they sit there clear -- often
          // narrower than a step: its edge is found and tried.
          if (
            unfitted.markersMoved &&
            aboveMoved &&
            !candidate.markersMoved &&
            candidate.far.player.extras?.markers === undefined
          ) {
            let high = above;
            let low = farScale;
            for (let step = 0; step < 16; step += 1) {
              const middle = (low + high) / 2;
              if (splitAt(scale, true, middle).markersMoved) high = middle;
              else low = middle;
            }
            if (clear(splitAt(scale, true, low))) {
              found = low;
              above = high;
              break;
            }
          }
          aboveMoved = candidate.markersMoved;
          if (clear(candidate)) {
            found = farScale;
            break;
          }
          // None clear: the one covered least, as good otherwise -- unless
          // the fit found was clear but for its markers, moved: it stays,
          // never traded for less cover than the table has without the bar.
          if (
            !clearButMarkers &&
            (candidate.fits || !unfitted.fits) &&
            keepsRow(candidate) &&
            (!unfitted.markersMoved || keepsActive(candidate)) &&
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
    // One half fills the table. The stadium sits beside its Active on the
    // player's own right (the staging area is on their left), level with
    // the centre-line edge of the row, and the controls just past that edge
    // of the row, as they sit at the seam; the rest of the clear band is
    // where the hidden half would be.
    const shown = hidden === 'upper' ? lower : upper;
    const active = activeOf(shown.player);
    const stadiumHeight = shown.geometry.cardHeights.bench;
    const stadiumWidth = stadiumHeight * CARD_ASPECT_RATIO;
    const atTop = hidden === 'upper';
    stadium = {
      x: atTop
        ? Math.min(
            playAreaWidth - stadiumWidth - 8,
            active.x + active.width + stadiumWidth * 0.35
          )
        : Math.max(8, active.x - stadiumWidth * 1.35),
      y: atTop ? active.y : active.y + active.height - stadiumHeight,
      width: stadiumWidth,
      height: stadiumHeight,
    };
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
