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

/** Both players start with equal halves of the table. */
const DEFAULT_LOWER_SHARE = 0.5;
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

/** Room at the far end of each hand strip for its card-count badge. */
const HAND_COUNT_SLOT_PX = 44;
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
  readonly cardHeights: { readonly active: number; readonly bench: number };
  readonly middle: { readonly left: number; readonly right: number };
  /** The clear band between this half's cards and the centre line. */
  readonly seamMargin: number;
}

/** What a half's layout takes from the layout state beyond its size. */
interface HalfOptions {
  /** The least height of the clear band at the centre line (both halves). */
  readonly seamBandPx?: number;
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
 * The table's controls start past this: the rail keeps its left end for the
 * app menu (a 44px button 8px in, and a gap).
 */
const RAIL_START_RESERVE_PX = 8 + 44 + 8;
/** The bench row must hold this many bench cards side by side. */
const BENCH_FIT_CARDS = 5.5;

/** Lay out one half in its own frame, centre line at the top. */
const layoutHalf = (
  width: number,
  height: number,
  options: HalfOptions = {}
): HalfGeometry => {
  const proportions = HALF_PROPORTIONS;
  const margin = seamMarginFor(height, options);
  const gap = Math.max(6, height * proportions.rowGap);
  const handStrip = height * proportions.handStrip;
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
    x: margin,
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
  const pileLeft = width - margin - pileWidth;
  const pileAt = (index: number): Rect => ({
    x: pileLeft,
    y: activeTop + index * (pileHeight + gap),
    width: pileWidth,
    height: pileHeight,
  });
  const deck = pileAt(0);
  const discard = pileAt(1);
  const lostZone = pileAt(2);

  // Reserve equal space for the outer columns so both Actives and benches
  // share the table's centre, even though prizes are wider than a pile.
  const middleLeft = margin + Math.max(prizes.width, pileWidth) + gap * 1.5;
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
  // The staging area (v1's loose board) beside the Active, toward the prizes.
  const boardRect: Rect = {
    x: middleLeft,
    y: activeTop,
    width: Math.max(0, activeRect.x - gap - middleLeft),
    height: active,
  };
  const benchRect: Rect = {
    x: middleLeft,
    y: benchTop,
    width: middleWidth,
    height: bench,
  };
  const handLeft =
    margin +
    Math.max(
      TABLE_CONTROL_CORNER_PX,
      pileWidth + gap * 1.5 + HAND_COUNT_SLOT_PX
    );
  const handRight = width - handLeft;
  const handRect: Rect = {
    x: handLeft,
    y: handTop,
    width: Math.max(0, handRight - handLeft),
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
      { kind: 'lostZone', rect: lostZone, countAnchor: 'pile' },
    ],
    cardHeights: { active, bench },
    middle: { left: middleLeft, right: middleRight },
    seamMargin: margin,
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
  // A portrait hand strip is at least tall enough for the corner's
  // controls side by side, so the pile row above stays clear of them.
  let bench = free / (rowsShare + proportions.handStrip);
  if (bench * proportions.handStrip < TABLE_COMPACT_CORNER_HEIGHT_PX) {
    bench = Math.max(0, free - TABLE_COMPACT_CORNER_HEIGHT_PX) / rowsShare;
  }
  bench = Math.min(
    bench,
    (width - 2 * edge) / (BENCH_FIT_CARDS * CARD_ASPECT_RATIO)
  );
  const active = bench * proportions.active;
  const handStrip = Math.min(
    height,
    Math.max(bench * proportions.handStrip, TABLE_COMPACT_CORNER_HEIGHT_PX)
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
  const handRect: Rect = {
    x: TABLE_CONTROL_CORNER_PX,
    y: handTop,
    width: Math.max(
      0,
      width - edge - HAND_COUNT_SLOT_PX - TABLE_CONTROL_CORNER_PX
    ),
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
 * Whichever of the mat (columns down the sides) and the portrait mat (rows
 * down the middle) shows this half's cards larger. Wide halves -- desktops,
 * a tablet or phone held sideways -- get the mat; tall ones, the portrait.
 */
const bestOf = (
  landscape: HalfGeometry,
  portrait: HalfGeometry
): HalfGeometry =>
  benchCardHeightOf(portrait) > benchCardHeightOf(landscape)
    ? portrait
    : landscape;

const layoutTableHalf = (
  width: number,
  height: number,
  options: HalfOptions
): HalfGeometry =>
  bestOf(
    layoutHalf(width, height, options),
    layoutHalfPortrait(width, height, options)
  );

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
  // The band must hold the table controls and their gaps either side.
  const soloBand = Math.max(
    SOLO_SEAM_BAND_PX,
    (options.seamBandPx ?? 0) + 2 * SOLO_CONTROLS_GAP_PX
  );
  // Tall, the portrait mat takes the whole height: its rows sit at the
  // player's edge and the rest of the height is the band already.
  const portrait = layoutHalfPortrait(width, height, {
    seamBandPx: 2 * soloBand,
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
    fitted = Math.max(low, height * DEFAULT_LOWER_SHARE);
  }
  const geometry = layoutHalf(width, fitted, options);
  const band = height - fitted;
  return bestOf(
    {
      regions: geometry.regions.map((region) => ({
        ...region,
        rect: { ...region.rect, y: region.rect.y + band },
      })),
      cardHeights: geometry.cardHeights,
      middle: geometry.middle,
      seamMargin: geometry.seamMargin + band,
    },
    portrait
  );
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
    hideEmptyLostZone: _lostZone,
    seamBandPx,
    ...semanticState
  } = state;
  if (
    seamBandPx !== undefined &&
    (!Number.isFinite(seamBandPx) || seamBandPx < 0)
  ) {
    throw new Error('Table seam band must be a non-negative number');
  }
  const halfOptions: HalfOptions =
    seamBandPx === undefined ? {} : { seamBandPx };
  // The controls fill the seam band: 32px on a desktop, taller where a
  // finger asked for a wider band.
  const controlsCap =
    seamBandPx === undefined ? 32 : Math.max(32, seamBandPx - 2);
  const semantics = createBoardLayoutSnapshot({
    ...semanticState,
    geometryVersion: 1,
  });
  const fullScreen = state.shellMode === 'fullscreen';
  const rail = fullScreen ? 0 : tableRailWidth(state.viewport.width);
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
    frameBounds: Rect
  ): {
    readonly player: BoardPlayerLayout;
    readonly geometry: HalfGeometry;
  } => {
    const solo = hidden !== undefined && hidden !== template.physicalSide;
    const geometry = (solo ? layoutSoloHalf : layoutTableHalf)(
      frameBounds.width,
      frameBounds.height,
      halfOptions
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
      },
      geometry,
    };
  };

  const lower = buildPlayer(semantics.players[0], frames.lower);
  const upper = buildPlayer(semantics.players[1], frames.upper);
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
    const stadiumHeight = Math.min(
      lower.geometry.cardHeights.bench,
      upper.geometry.cardHeights.bench
    );
    const stadiumWidth = stadiumHeight * CARD_ASPECT_RATIO;
    const lowerActive = activeOf(lower.player);
    stadium = {
      x: Math.min(
        playAreaWidth - stadiumWidth - 8,
        lowerActive.x + lowerActive.width + stadiumWidth * 0.35
      ),
      y: seamY - stadiumHeight / 2,
      width: stadiumWidth,
      height: stadiumHeight,
    };
    // The controls straddle the seam inside the clear band on both sides.
    const controlsHeight = Math.max(
      20,
      Math.min(
        controlsCap,
        2 * Math.min(lower.geometry.seamMargin, upper.geometry.seamMargin) - 2
      )
    );
    controls = { y: seamY - controlsHeight / 2, height: controlsHeight };
    controlsLeft = Math.max(lower.geometry.middle.left, RAIL_START_RESERVE_PX);
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
    controlsLeft = Math.max(shown.geometry.middle.left, RAIL_START_RESERVE_PX);
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
