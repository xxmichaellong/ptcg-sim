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
 * it, five bench slots below, deck and discard down the right, the Lost Zone
 * in the corner by the hand -- and the hand runs along the screen edge, its
 * cards partly off-screen until hovered. The opponent's half is the same mat
 * turned around, with a slimmer hand strip.
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

/** The viewer's half is the larger: it is where they act. */
const DEFAULT_LOWER_SHARE = 0.54;
const MINIMUM_HALF_SHARE = 0.34;
const HANDLE_HEIGHT_RATIO = 0.025 as const;

export const DEFAULT_TABLE_VERTICAL_LAYOUT: BoardVerticalLayoutState = {
  lowerFrame: { bottomRatio: 0, heightRatio: DEFAULT_LOWER_SHARE },
  upperFrame: {
    bottomRatio: DEFAULT_LOWER_SHARE,
    heightRatio: 1 - DEFAULT_LOWER_SHARE,
  },
  lowerHandle: {
    bottomRatio: DEFAULT_LOWER_SHARE,
    heightRatio: HANDLE_HEIGHT_RATIO,
  },
  upperHandle: {
    bottomRatio: DEFAULT_LOWER_SHARE + 0.03,
    heightRatio: HANDLE_HEIGHT_RATIO,
  },
  sharedPlacement: 'handleMidpoint',
};

/** Proportions of one half, as fractions of its height (own frame). */
interface HalfProportions {
  /** How much of the hand cards shows above the screen edge. */
  readonly handStrip: number;
  readonly margin: number;
  readonly rowGap: number;
  /** Share of the two card rows given to the Active (the rest to the bench). */
  readonly activeShare: number;
}

const LOCAL_HALF: HalfProportions = {
  handStrip: 0.27,
  margin: 0.045,
  rowGap: 0.025,
  activeShare: 0.54,
};
const OPPONENT_HALF: HalfProportions = {
  handStrip: 0.17,
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

/** Lay out one half in its own frame, centre line at the top. */
const layoutHalf = (
  width: number,
  height: number,
  proportions: HalfProportions
): HalfGeometry => {
  // The margin at the centre line doubles as the seam band the table
  // controls sit in, so it is generous.
  const margin = Math.max(10, Math.min(24, height * proportions.margin));
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
  // Deck over discard down the right, each the size of a bench card.
  const pileWidth = bench * CARD_ASPECT_RATIO;
  const pileLeft = width - margin - pileWidth;
  const deck: Rect = {
    x: pileLeft,
    y: activeTop + (active - bench) / 2,
    width: pileWidth,
    height: bench,
  };
  const discard: Rect = {
    x: pileLeft,
    y: benchTop,
    width: pileWidth,
    height: bench,
  };
  // The Lost Zone sits in the corner by the hand, below the discard.
  const lostHeight = Math.max(0, Math.min(bench * 0.82, handStrip - margin));
  const lostWidth = lostHeight * CARD_ASPECT_RATIO;
  const lostZone: Rect = {
    x: width - margin - lostWidth,
    y: handTop + Math.max(0, (handStrip - lostHeight) / 2),
    width: lostWidth,
    height: lostHeight,
  };

  const middleLeft = prizes.x + prizes.width + gap * 1.5;
  const middleRight = pileLeft - gap * 1.5;
  const middleWidth = Math.max(0, middleRight - middleLeft);
  const centre = middleLeft + middleWidth / 2;
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
  const handLeft = margin + TABLE_CONTROL_CORNER_PX;
  const handRight = lostZone.x - gap * 1.5;
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
  // hand shows its count at the end of its strip.
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
        anchor: { x: physical.x, y: physical.y },
        horizontalAlign: 'left',
        verticalAlign: 'bottom',
        fontSizePx: 13,
      }
    : {
        anchor: {
          x: physical.x + physical.width,
          y: physical.y + physical.height,
        },
        horizontalAlign: 'right',
        verticalAlign: 'top',
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
  // v1's validated snapshot supplies the region semantics, the player
  // pairing and every input check.
  const semantics = createBoardLayoutSnapshot({
    ...state,
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

  const buildPlayer = (
    template: BoardPlayerLayout,
    frame: BoardVerticalLayoutState['lowerFrame']
  ): {
    readonly player: BoardPlayerLayout;
    readonly geometry: HalfGeometry;
  } => {
    const frameBounds = frameFor(state.viewport, playAreaWidth, frame);
    const geometry = layoutHalf(
      frameBounds.width,
      frameBounds.height,
      template.side === 'local' ? LOCAL_HALF : OPPONENT_HALF
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
      },
      geometry,
    };
  };

  const lower = buildPlayer(semantics.players[0], state.vertical.lowerFrame);
  const upper = buildPlayer(semantics.players[1], state.vertical.upperFrame);

  // The seam between the halves: the stadium straddles it to the right of
  // the Actives, the board controls sit at its left.
  const seamY = lower.player.frameBounds.y;
  const stadiumHeight = Math.min(
    lower.geometry.cardHeights.bench,
    upper.geometry.cardHeights.bench
  );
  const stadiumWidth = stadiumHeight * CARD_ASPECT_RATIO;
  const lowerActive = lower.player.regions.find(
    (region) => region.kind === 'active'
  )!;
  const stadiumX = Math.min(
    playAreaWidth - stadiumWidth - 8,
    lowerActive.physicalDeclaredBounds.x +
      lowerActive.physicalDeclaredBounds.width +
      stadiumWidth * 0.35
  );
  // The controls straddle the seam inside the clear band on both sides.
  const controlsHeight = Math.max(
    20,
    Math.min(
      32,
      2 * Math.min(lower.geometry.seamMargin, upper.geometry.seamMargin) - 2
    )
  );

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
        physicalDeclaredBounds: {
          x: stadiumX,
          y: seamY - stadiumHeight / 2,
          width: stadiumWidth,
          height: stadiumHeight,
        },
      },
      boardControlsAnchor: {
        x: lower.geometry.middle.left,
        y: seamY - controlsHeight / 2,
        height: controlsHeight,
      },
    },
    zoneScrollPx: {},
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
  const seam = Math.min(
    1 - MINIMUM_HALF_SHARE,
    Math.max(MINIMUM_HALF_SHARE, clientY / state.viewport.height)
  );
  const lowerShare = 1 - seam;
  return {
    ...state,
    vertical: {
      lowerFrame: { bottomRatio: 0, heightRatio: lowerShare },
      upperFrame: { bottomRatio: lowerShare, heightRatio: seam },
      lowerHandle: {
        bottomRatio: lowerShare,
        heightRatio: HANDLE_HEIGHT_RATIO,
      },
      upperHandle: {
        bottomRatio: Math.min(1, lowerShare + 0.03),
        heightRatio: HANDLE_HEIGHT_RATIO,
      },
      sharedPlacement: 'handleMidpoint',
    },
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
 * the first prize at the top left of its owner's view.
 */
export const layoutTablePrizes = (
  content: Rect,
  side: BoardSide,
  count: number
): Rect[] => {
  if (count <= 0) return [];
  const rows = Math.max(3, Math.ceil(count / 2));
  const gap = Math.max(3, content.height * 0.025);
  const cardHeight = Math.max(
    0,
    Math.min(
      (content.height - (rows - 1) * gap) / rows,
      (content.width - gap) / 2 / CARD_ASPECT_RATIO
    )
  );
  const cardWidth = cardHeight * CARD_ASPECT_RATIO;
  const gridWidth = 2 * cardWidth + gap;
  const gridHeight = rows * cardHeight + (rows - 1) * gap;
  const left = content.x + (content.width - gridWidth) / 2;
  const top = content.y + (content.height - gridHeight) / 2;
  return Array.from({ length: count }, (_, index) => {
    const ownColumn = index % 2;
    const ownRow = Math.floor(index / 2);
    // The opponent's view of their grid is turned half way round.
    const column = side === 'local' ? ownColumn : 1 - ownColumn;
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
