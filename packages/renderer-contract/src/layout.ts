import type { PlayerId, QuarterTurns } from '@ptcgsim/game-core';

import { assertViewport } from './geometry.js';
import type {
  BoardSide,
  BoardViewport,
  BoardZoneSurface,
  Rect,
} from './model.js';

export const BOARD_LAYOUT_GEOMETRY_VERSION = 1 as const;

export const LEGACY_BOARD_SHELL_V1 = {
  playAreaWidthRatio: 0.755,
  sidebarLeftRatio: 0.76,
  sidebarWidthRatio: 0.24,
  tabsHeightRatio: 0.05,
  sidebarHeightRatio: 0.95,
  fullScreenBoardControlsLeftRatio: 0.67,
  normalBoardControlsLeftRatio: 0.52,
} as const;

export const LEGACY_BOARD_SHARED_V1 = {
  stadiumLeftRatio: 0.11,
  stadiumWidthRatio: 0.06,
  stadiumHeightRatio: 0.16,
  defaultStadiumBottomRatio: 0.42,
  stadiumMidpointOffsetRatio: 0.08,
  stadiumMaximumBottomRatio: 0.84,
  boardControlsHeightRatio: 0.06,
  defaultBoardControlsBottomRatio: 0.47,
  boardControlsMidpointOffsetRatio: 0.03,
  boardControlsMaximumBottomRatio: 0.9,
} as const;

export const LEGACY_BOARD_RESIZER_V1 = {
  leftRatio: -0.0055,
  widthRatio: 0.013,
  baseHeightRatio: 0.025,
  expandedHeightRatio: 0.1,
  lowerExpandBelowRatio: 0.05,
  upperExpandAboveRatio: 0.95,
} as const;

/**
 * Exact numeric z-index values evidenced in v1 CSS/runtime. They are semantic
 * ranks only: iframe stacking contexts prevent a single global numeric order.
 */
export const LEGACY_BOARD_Z_ORDER_V1 = {
  freeBoard: -1,
  zone: 0,
  card: 0,
  draggingCard: 1,
  marker: 1,
  expandedStack: 2,
  openedZone: 3,
  resizeCaptureOverlay: 1_000,
  draggedOpenedZone: 9_999,
} as const;

export type BoardLayoutAffordance =
  | 'selectCard'
  | 'moveSelectedCard'
  | 'previewCard'
  | 'expandStack'
  | 'openCardContextMenu'
  | 'dragCard'
  | 'dropCard'
  | 'openZone'
  | 'resizeBoard'
  | 'editMarker'
  | 'dismissPresentation'
  | 'keyboardShortcuts';

/**
 * Source-observed behavior, not a claim about exact pointer geometry. Exact
 * menu, marker and overflow hit boxes remain browser-characterization gates.
 */
export const LEGACY_BOARD_AFFORDANCES_V1 = {
  ordinaryCard: [
    'selectCard',
    'moveSelectedCard',
    'previewCard',
    'openCardContextMenu',
    'dragCard',
    'dropCard',
  ],
  playStackCard: [
    'selectCard',
    'moveSelectedCard',
    'expandStack',
    'openCardContextMenu',
    'dragCard',
    'dropCard',
  ],
  coverCard: ['openZone', 'openCardContextMenu', 'dragCard', 'dropCard'],
  zone: ['dropCard'],
  resizeHandle: ['resizeBoard'],
  editableMarker: ['editMarker'],
  boardDocument: ['dismissPresentation', 'keyboardShortcuts'],
} as const satisfies Readonly<Record<string, readonly BoardLayoutAffordance[]>>;

export type BoardShellMode = 'sidebar' | 'fullscreen';
export type BoardPhysicalSide = 'lower' | 'upper';
export type BoardSharedPlacement = 'cssDefault' | 'handleMidpoint';
export type BoardResizeHandleId = BoardPhysicalSide;

export interface BoardNormalizedVerticalFrame {
  /** Distance from the outer viewport's bottom edge, divided by its height. */
  readonly bottomRatio: number;
  readonly heightRatio: number;
}

export interface BoardNormalizedResizeHandle {
  /** Authored CSS `bottom`, before the translateY(50%) transform. */
  readonly bottomRatio: number;
  /** Current CSS height; v1 changes this after each resize event. */
  readonly heightRatio: 0.025 | 0.1;
}

export interface BoardVerticalLayoutState {
  readonly lowerFrame: BoardNormalizedVerticalFrame;
  readonly upperFrame: BoardNormalizedVerticalFrame;
  readonly lowerHandle: BoardNormalizedResizeHandle;
  readonly upperHandle: BoardNormalizedResizeHandle;
  readonly sharedPlacement: BoardSharedPlacement;
}

export interface BoardLayoutState {
  readonly geometryVersion: typeof BOARD_LAYOUT_GEOMETRY_VERSION;
  /** Outer browser viewport, not the narrower renderer/play-area viewport. */
  readonly viewport: BoardViewport;
  readonly playerIds: readonly [PlayerId, PlayerId];
  readonly bottomPlayerId: PlayerId;
  readonly shellMode: BoardShellMode;
  readonly vertical: BoardVerticalLayoutState;
}

export interface BoxEdgesPx {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type BoardLayoutRegionKind =
  | 'hand'
  | 'bench'
  | 'active'
  | 'prizes'
  | 'lostZone'
  | 'deck'
  | 'discard'
  | 'board';

export type BoardLayoutRegionSurface = BoardZoneSurface;

export interface BoardLayoutRegion {
  readonly id: `${BoardSide}:${BoardLayoutRegionKind}`;
  readonly playerId: PlayerId;
  readonly side: BoardSide;
  readonly physicalSide: BoardPhysicalSide;
  readonly kind: BoardLayoutRegionKind;
  readonly surface: BoardLayoutRegionSurface;
  /** Percent-authored rectangle before the enclosing player rotation. */
  readonly playerLocalNormalizedBounds: Rect;
  /**
   * Percent-authored rectangle mapped to the outer viewport. This deliberately
   * excludes content-box padding and borders, which are retained separately.
   */
  readonly physicalDeclaredBounds: Rect;
  /** Browser border box after content-box padding/border expansion. */
  readonly physicalBorderBoxBounds: Rect;
  /** Browser content box after applying physical padding/border edges. */
  readonly physicalContentBoxBounds: Rect;
  readonly boxSizing: 'content-box';
  /** Authored in player-local coordinates; upper-player rotation also rotates edges. */
  readonly paddingPx: BoxEdgesPx;
  readonly borderPx: BoxEdgesPx;
  /** The authored edges after applying the enclosing player frame's rotation. */
  readonly physicalPaddingPx: BoxEdgesPx;
  readonly physicalBorderPx: BoxEdgesPx;
  /** Pixel adjustment in authored `calc()` relative to the percentage size. */
  readonly contentSizeAdjustmentPx: {
    readonly width: number;
    readonly height: number;
  };
  readonly semanticZOrder: number;
  /** Input on the region container itself (not on any rendered child image). */
  readonly affordances: readonly BoardLayoutAffordance[];
  /** Optional child image input; its browser bounds are not inferred here. */
  readonly childCardAffordances: readonly BoardLayoutAffordance[] | null;
  /**
   * Where the legacy `(N)` card-count text for this region sits, or null for
   * regions v1 never counted.
   */
  readonly countLabel: BoardLayoutCountLabel | null;
}

/**
 * Physical placement of a legacy zone count. v1 authors each count as a
 * `position: fixed` text node inside the player container (`#deckText`,
 * `#discardText`, `#lostZoneText`, `#handText`), anchored by `right`/`left`
 * and `bottom` percentages, and un-rotates the opponent copy with
 * `transform: scale(-1, -1)`. The anchor is therefore the corner of the text
 * box named by the two alignments, mapped through the player frame rotation.
 */
export interface BoardLayoutCountLabel {
  /** Physical corner point of the text box. */
  readonly anchor: { readonly x: number; readonly y: number };
  /** Which horizontal edge of the text box sits on the anchor. */
  readonly horizontalAlign: 'left' | 'right';
  /** Which vertical edge of the text box sits on the anchor. */
  readonly verticalAlign: 'top' | 'bottom';
  /** v1 `clamp(10px, 4vh, 20px)` resolved against the player frame. */
  readonly fontSizePx: number;
}

export interface BoardPlayerLayout {
  readonly playerId: PlayerId;
  readonly side: BoardSide;
  readonly physicalSide: BoardPhysicalSide;
  readonly rotationQuarterTurns: 0 | 2;
  readonly frameBounds: Rect;
  readonly regions: readonly BoardLayoutRegion[];
}

export interface BoardResizeHandleLayout {
  readonly id: 'lower' | 'upper';
  readonly controlsPhysicalSide: BoardPhysicalSide;
  readonly authoredBottomRatio: number;
  readonly bounds: Rect;
  readonly cursor: 'row-resize';
  readonly affordances: readonly ['resizeBoard'];
}

export interface BoardAnchorLayout {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

export interface BoardSharedLayout {
  readonly stadium: {
    readonly physicalDeclaredBounds: Rect;
    readonly semanticZOrder: number;
    /** Empty stadium drop surface; child card input remains a separate target. */
    readonly affordances: readonly BoardLayoutAffordance[];
    readonly childCardAffordances: readonly BoardLayoutAffordance[];
  };
  /** Intrinsic child widths are intentionally not guessed from CSS. */
  readonly boardControlsAnchor: BoardAnchorLayout;
}

export interface BoardLayoutSnapshot {
  readonly geometryVersion: typeof BOARD_LAYOUT_GEOMETRY_VERSION;
  readonly viewport: BoardViewport;
  readonly shellMode: BoardShellMode;
  readonly playAreaBounds: Rect;
  readonly shellGapBounds: Rect | null;
  readonly sidebarBounds: Rect | null;
  readonly tabsBounds: Rect | null;
  readonly bottomPlayerId: PlayerId;
  readonly players: readonly [BoardPlayerLayout, BoardPlayerLayout];
  readonly resizeHandles: readonly [
    BoardResizeHandleLayout,
    BoardResizeHandleLayout,
  ];
  readonly shared: BoardSharedLayout;
}

export interface BoardPlayStackCardHitRegion {
  readonly role: 'evolution' | 'attachment';
  readonly index: number;
  readonly bounds: Rect;
  readonly semanticZOrder: number;
  readonly affordances: typeof LEGACY_BOARD_AFFORDANCES_V1.playStackCard;
}

export interface LegacyOrdinaryEvolutionCardLayout {
  /** Index in the canonical bottom-to-top evolution array. */
  readonly canonicalIndex: number;
  readonly layerFromTop: number;
  readonly bounds: Rect;
  /** The exact image z-index emitted by v1 attachCard. */
  readonly sourceZIndex: number;
}

export interface LegacyOrdinaryEvolutionStackLayout {
  /** Stable post-refresh play-container border box, excluding its flex margin. */
  readonly flexItemBounds: Rect;
  /** Integer CSSOM width used by v1 for width/15 offsets. */
  readonly cssomClientWidth: number;
  /** Returned in the same bottom-to-top order supplied by canonical state. */
  readonly cards: readonly LegacyOrdinaryEvolutionCardLayout[];
}

export interface LegacySingleEnergyAttachmentCardLayout {
  readonly bounds: Rect;
  /** The exact image z-index emitted by v1 attachCard. */
  readonly sourceZIndex: number;
}

export interface LegacySingleEnergyAttachmentStackLayout {
  /** Stable post-refresh play-container border box. */
  readonly flexItemBounds: Rect;
  /** Integer base-image width read by v1 through CSSOM clientWidth. */
  readonly baseCssomClientWidth: number;
  /** Horizontal offset authored by attachCard from base clientWidth / 6. */
  readonly attachmentOffset: number;
  /** Fractional width authored by adjustCards after refresh. */
  readonly authoredWidth: number;
  /** Integer width exposed by the stable wrapper through CSSOM clientWidth. */
  readonly stableCssomClientWidth: number;
  readonly base: LegacySingleEnergyAttachmentCardLayout;
  readonly energy: LegacySingleEnergyAttachmentCardLayout;
}

export interface LegacyTwoEnergyAttachmentStackLayout {
  /** Stable post-refresh play-container border box. */
  readonly flexItemBounds: Rect;
  /** Integer base-image width read by v1 through CSSOM clientWidth. */
  readonly baseCssomClientWidth: number;
  /** Horizontal step authored by attachCard from base clientWidth / 6. */
  readonly attachmentOffset: number;
  /** Fractional width authored by adjustCards after refresh. */
  readonly authoredWidth: number;
  /** Integer width exposed by the stable wrapper through CSSOM clientWidth. */
  readonly stableCssomClientWidth: number;
  readonly base: LegacySingleEnergyAttachmentCardLayout;
  /** Returned in the same inner-to-outer order supplied by canonical state. */
  readonly energies: readonly [
    LegacySingleEnergyAttachmentCardLayout,
    LegacySingleEnergyAttachmentCardLayout,
  ];
}

export interface LegacySingleTrainerToolAttachmentCardLayout {
  readonly bounds: Rect;
  /** The exact image z-index emitted by v1 attachCard. */
  readonly sourceZIndex: number;
}

export interface LegacySingleTrainerToolAttachmentStackLayout {
  /** Stable post-refresh play-container border box, excluding its flex margin. */
  readonly flexItemBounds: Rect;
  /** Integer base-image width read by v1 through CSSOM clientWidth. */
  readonly baseCssomClientWidth: number;
  /** Horizontal offset authored by attachCard from base clientWidth / 6. */
  readonly attachmentOffset: number;
  /** Fractional width authored by adjustCards after refresh. */
  readonly authoredWidth: number;
  /** Integer width exposed by the stable wrapper through CSSOM clientWidth. */
  readonly stableCssomClientWidth: number;
  /** The Tool wrapper's authored 2% trailing flex margin. */
  readonly marginRight: number;
  readonly base: LegacySingleTrainerToolAttachmentCardLayout;
  readonly tool: LegacySingleTrainerToolAttachmentCardLayout;
}

export interface LegacySingleEnergyTrainerToolAttachmentStackLayout {
  /** Stable post-refresh play-container border box, excluding its flex margin. */
  readonly flexItemBounds: Rect;
  /** Integer base-image width read by v1 through CSSOM clientWidth. */
  readonly baseCssomClientWidth: number;
  /** Horizontal step authored by attachCard from base clientWidth / 6. */
  readonly attachmentOffset: number;
  /** Fractional width authored by adjustCards after refresh. */
  readonly authoredWidth: number;
  /** Integer width exposed by the stable wrapper through CSSOM clientWidth. */
  readonly stableCssomClientWidth: number;
  /** The Tool wrapper's authored 2% trailing flex margin. */
  readonly marginRight: number;
  readonly base: LegacySingleEnergyAttachmentCardLayout;
  readonly energy: LegacySingleEnergyAttachmentCardLayout;
  readonly tool: LegacySingleTrainerToolAttachmentCardLayout;
}

export interface LegacyActiveQ0MarkerItemLayout {
  readonly bounds: Rect;
  /** The exact marker z-index emitted by the legacy counter helpers. */
  readonly sourceZIndex: number;
}

export interface LegacyActiveQ0MarkerLayout {
  readonly damage: LegacyActiveQ0MarkerItemLayout;
  readonly specialCondition: LegacyActiveQ0MarkerItemLayout;
  readonly abilityUsed: LegacyActiveQ0MarkerItemLayout;
}

export type LegacyBenchQ0MarkerLayout = Pick<
  LegacyActiveQ0MarkerLayout,
  'damage' | 'abilityUsed'
>;

const ZERO_EDGES: BoxEdgesPx = { top: 0, right: 0, bottom: 0, left: 0 };
const FIVE_PIXEL_PADDING: BoxEdgesPx = {
  top: 5,
  right: 5,
  bottom: 5,
  left: 5,
};
const HAND_TOP_BORDER: BoxEdgesPx = {
  top: 3,
  right: 0,
  bottom: 0,
  left: 0,
};

interface RegionSource {
  readonly normalizedBounds: Rect;
  readonly horizontalAnchor: 'left' | 'right';
  readonly horizontalOffsetRatio: number;
  readonly bottomRatio: number;
  readonly paddingPx?: BoxEdgesPx;
  readonly borderPx?: BoxEdgesPx;
  readonly contentSizeAdjustmentPx?: {
    readonly width: number;
    readonly height: number;
  };
  readonly surface: BoardLayoutRegionSurface;
  readonly semanticZOrder: number;
  readonly affordances: readonly BoardLayoutAffordance[];
  readonly childCardAffordances?: readonly BoardLayoutAffordance[];
  /** Player-local `left`/`right` and `bottom` ratios of the count text. */
  readonly countLabel?: {
    readonly horizontalAnchor: 'left' | 'right';
    readonly horizontalOffsetRatio: number;
    readonly bottomRatio: number;
  };
}

const SHARED_PLAYER_REGION_SOURCES: Readonly<
  Record<Exclude<BoardLayoutRegionKind, 'board'>, RegionSource>
> = {
  hand: {
    countLabel: {
      horizontalAnchor: 'right',
      horizontalOffsetRatio: 0.02,
      bottomRatio: 0.3,
    },
    normalizedBounds: { x: 0, y: 0.7, width: 1, height: 0.3 },
    horizontalAnchor: 'left',
    horizontalOffsetRatio: 0,
    bottomRatio: 0,
    borderPx: HAND_TOP_BORDER,
    contentSizeAdjustmentPx: { width: 0, height: -3 },
    surface: 'zone',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
  },
  bench: {
    normalizedBounds: { x: 0.1, y: 0.4, width: 0.79, height: 0.25 },
    horizontalAnchor: 'left',
    horizontalOffsetRatio: 0.1,
    bottomRatio: 0.35,
    surface: 'playSlot',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
  },
  active: {
    normalizedBounds: { x: 0.34, y: 0.07, width: 0.32, height: 0.28 },
    horizontalAnchor: 'left',
    horizontalOffsetRatio: 0.34,
    bottomRatio: 0.65,
    surface: 'playSlot',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
  },
  prizes: {
    normalizedBounds: { x: 0.01, y: 0.21, width: 0.06, height: 0.43 },
    horizontalAnchor: 'left',
    horizontalOffsetRatio: 0.01,
    bottomRatio: 0.36,
    paddingPx: FIVE_PIXEL_PADDING,
    surface: 'zone',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
  },
  lostZone: {
    countLabel: {
      horizontalAnchor: 'left',
      horizontalOffsetRatio: 0.085,
      bottomRatio: 0.9,
    },
    normalizedBounds: { x: 0.01, y: 0.01, width: 0.07, height: 0.15 },
    horizontalAnchor: 'left',
    horizontalOffsetRatio: 0.01,
    bottomRatio: 0.84,
    surface: 'cover',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
    childCardAffordances: LEGACY_BOARD_AFFORDANCES_V1.coverCard,
  },
  deck: {
    countLabel: {
      horizontalAnchor: 'right',
      horizontalOffsetRatio: 0.02,
      bottomRatio: 0.91,
    },
    normalizedBounds: { x: 0.91, y: 0.09, width: 0.08, height: 0.25 },
    horizontalAnchor: 'right',
    horizontalOffsetRatio: 0.01,
    bottomRatio: 0.66,
    surface: 'cover',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
    childCardAffordances: LEGACY_BOARD_AFFORDANCES_V1.coverCard,
  },
  discard: {
    countLabel: {
      horizontalAnchor: 'right',
      horizontalOffsetRatio: 0.02,
      bottomRatio: 0.6,
    },
    normalizedBounds: { x: 0.91, y: 0.41, width: 0.08, height: 0.23 },
    horizontalAnchor: 'right',
    horizontalOffsetRatio: 0.01,
    bottomRatio: 0.36,
    surface: 'cover',
    semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
    affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
    childCardAffordances: LEGACY_BOARD_AFFORDANCES_V1.coverCard,
  },
};

const boardSource = (side: BoardSide): RegionSource => ({
  normalizedBounds:
    side === 'local'
      ? { x: 0.66, y: 0.09, width: 0.24, height: 0.3 }
      : { x: 0.12, y: 0.09, width: 0.22, height: 0.3 },
  horizontalAnchor: side === 'local' ? 'left' : 'right',
  horizontalOffsetRatio: 0.66,
  bottomRatio: 0.61,
  paddingPx: FIVE_PIXEL_PADDING,
  surface: 'zone',
  semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.freeBoard,
  affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
});

export const DEFAULT_BOARD_VERTICAL_LAYOUT_V1: BoardVerticalLayoutState = {
  lowerFrame: { bottomRatio: 0, heightRatio: 0.5 },
  upperFrame: { bottomRatio: 0.5, heightRatio: 0.5 },
  lowerHandle: { bottomRatio: 0.505, heightRatio: 0.025 },
  upperHandle: { bottomRatio: 0.53, heightRatio: 0.025 },
  sharedPlacement: 'cssDefault',
};

const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};

const assertVerticalState = (state: BoardVerticalLayoutState): void => {
  if (
    state.sharedPlacement !== 'cssDefault' &&
    state.sharedPlacement !== 'handleMidpoint'
  ) {
    throw new Error('Unsupported board shared placement');
  }
  for (const [label, frame] of [
    ['Lower board frame', state.lowerFrame],
    ['Upper board frame', state.upperFrame],
  ] as const) {
    finite(frame.bottomRatio, `${label} bottom ratio`);
    finite(frame.heightRatio, `${label} height ratio`);
    if (frame.heightRatio <= 0) {
      throw new Error(`${label} height ratio must be positive`);
    }
    // The v1 resizer deliberately permits a small off-screen overscan.
    if (
      frame.bottomRatio < -0.025 ||
      frame.bottomRatio > 1.025 ||
      frame.heightRatio > 1.025 ||
      frame.bottomRatio + frame.heightRatio > 1.025
    ) {
      throw new Error(`${label} exceeds the characterized v1 overscan`);
    }
  }
  finite(state.lowerHandle.bottomRatio, 'Lower resize handle bottom ratio');
  finite(state.upperHandle.bottomRatio, 'Upper resize handle bottom ratio');
  if (
    state.lowerHandle.bottomRatio < -0.025 ||
    state.lowerHandle.bottomRatio > 1 ||
    state.upperHandle.bottomRatio < 0 ||
    state.upperHandle.bottomRatio > 1.025
  ) {
    throw new Error('Resize handle bottom ratio exceeds legacy clamping');
  }
  for (const [label, handle] of [
    ['Lower', state.lowerHandle],
    ['Upper', state.upperHandle],
  ] as const) {
    if (
      handle.heightRatio !== LEGACY_BOARD_RESIZER_V1.baseHeightRatio &&
      handle.heightRatio !== LEGACY_BOARD_RESIZER_V1.expandedHeightRatio
    ) {
      throw new Error(`${label} resize handle height is not source-observed`);
    }
  }
};

/**
 * Mirrors v1's unusual `parseInt(computed bottom px) + offsetHeight` test.
 * `offsetHeight` is integer-valued; the model uses nearest-pixel rounding.
 */
export const legacyResizeHandlesCollide = (
  state: Pick<BoardVerticalLayoutState, 'lowerHandle' | 'upperHandle'>,
  viewportHeight: number
): boolean => {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new Error('Resize collision viewport height must be positive');
  }
  const lowerBottomPixels = Math.trunc(
    state.lowerHandle.bottomRatio * viewportHeight
  );
  const upperBottomPixels = Math.trunc(
    state.upperHandle.bottomRatio * viewportHeight
  );
  const currentLowerHandleHeightPixels = Math.round(
    state.lowerHandle.heightRatio * viewportHeight
  );
  return lowerBottomPixels + currentLowerHandleHeightPixels > upperBottomPixels;
};

const frameBounds = (
  viewport: BoardViewport,
  playAreaWidth: number,
  frame: BoardNormalizedVerticalFrame
): Rect => ({
  x: 0,
  y: viewport.height * (1 - frame.bottomRatio - frame.heightRatio),
  width: playAreaWidth,
  height: viewport.height * frame.heightRatio,
});

const rotateNormalizedRect = (bounds: Rect): Rect => ({
  x: 1 - bounds.x - bounds.width,
  y: 1 - bounds.y - bounds.height,
  width: bounds.width,
  height: bounds.height,
});

const physicalDeclaredBounds = (
  normalizedBounds: Rect,
  player: Pick<BoardPlayerLayout, 'side' | 'frameBounds'>
): Rect => {
  const normalized =
    player.side === 'opponent'
      ? rotateNormalizedRect(normalizedBounds)
      : normalizedBounds;
  return {
    x: player.frameBounds.x + normalized.x * player.frameBounds.width,
    y: player.frameBounds.y + normalized.y * player.frameBounds.height,
    width: normalized.width * player.frameBounds.width,
    height: normalized.height * player.frameBounds.height,
  };
};

const edgeTotal = (edges: BoxEdgesPx, axis: 'horizontal' | 'vertical') =>
  axis === 'horizontal' ? edges.left + edges.right : edges.top + edges.bottom;

const physicalEdges = (edges: BoxEdgesPx, side: BoardSide): BoxEdgesPx =>
  side === 'local'
    ? { ...edges }
    : {
        top: edges.bottom,
        right: edges.left,
        bottom: edges.top,
        left: edges.right,
      };

const physicalBorderBoxBounds = (
  source: RegionSource,
  player: Pick<BoardPlayerLayout, 'side' | 'frameBounds'>
): Rect => {
  const padding = source.paddingPx ?? ZERO_EDGES;
  const border = source.borderPx ?? ZERO_EDGES;
  const adjustment = source.contentSizeAdjustmentPx ?? {
    width: 0,
    height: 0,
  };
  const frameWidth = player.frameBounds.width;
  const frameHeight = player.frameBounds.height;
  const width =
    source.normalizedBounds.width * frameWidth +
    adjustment.width +
    edgeTotal(padding, 'horizontal') +
    edgeTotal(border, 'horizontal');
  const height =
    source.normalizedBounds.height * frameHeight +
    adjustment.height +
    edgeTotal(padding, 'vertical') +
    edgeTotal(border, 'vertical');
  const localX =
    source.horizontalAnchor === 'left'
      ? source.horizontalOffsetRatio * frameWidth
      : frameWidth - source.horizontalOffsetRatio * frameWidth - width;
  const localY = frameHeight - source.bottomRatio * frameHeight - height;
  return player.side === 'local'
    ? {
        x: player.frameBounds.x + localX,
        y: player.frameBounds.y + localY,
        width,
        height,
      }
    : {
        x: player.frameBounds.x + frameWidth - localX - width,
        y: player.frameBounds.y + frameHeight - localY - height,
        width,
        height,
      };
};

const contentBoxFromBorderBox = (
  borderBox: Rect,
  padding: BoxEdgesPx,
  border: BoxEdgesPx
): Rect => ({
  x: borderBox.x + border.left + padding.left,
  y: borderBox.y + border.top + padding.top,
  width:
    borderBox.width -
    edgeTotal(padding, 'horizontal') -
    edgeTotal(border, 'horizontal'),
  height:
    borderBox.height -
    edgeTotal(padding, 'vertical') -
    edgeTotal(border, 'vertical'),
});

const createRegions = (
  player: Omit<BoardPlayerLayout, 'regions'>
): readonly BoardLayoutRegion[] =>
  (
    [
      'hand',
      'bench',
      'active',
      'prizes',
      'lostZone',
      'deck',
      'discard',
      'board',
    ] as const
  ).map((kind) => {
    const source =
      kind === 'board'
        ? boardSource(player.side)
        : SHARED_PLAYER_REGION_SOURCES[kind];
    const physicalPadding = physicalEdges(
      source.paddingPx ?? ZERO_EDGES,
      player.side
    );
    const physicalBorder = physicalEdges(
      source.borderPx ?? ZERO_EDGES,
      player.side
    );
    const borderBox = physicalBorderBoxBounds(source, player);
    return {
      id: `${player.side}:${kind}`,
      playerId: player.playerId,
      side: player.side,
      physicalSide: player.physicalSide,
      kind,
      surface: source.surface,
      playerLocalNormalizedBounds: { ...source.normalizedBounds },
      physicalDeclaredBounds: physicalDeclaredBounds(
        source.normalizedBounds,
        player
      ),
      physicalBorderBoxBounds: borderBox,
      physicalContentBoxBounds: contentBoxFromBorderBox(
        borderBox,
        physicalPadding,
        physicalBorder
      ),
      boxSizing: 'content-box',
      paddingPx: { ...(source.paddingPx ?? ZERO_EDGES) },
      borderPx: { ...(source.borderPx ?? ZERO_EDGES) },
      physicalPaddingPx: physicalPadding,
      physicalBorderPx: physicalBorder,
      contentSizeAdjustmentPx: {
        ...(source.contentSizeAdjustmentPx ?? { width: 0, height: 0 }),
      },
      semanticZOrder: source.semanticZOrder,
      affordances: source.affordances,
      childCardAffordances: source.childCardAffordances ?? null,
      countLabel: source.countLabel
        ? physicalCountLabel(source.countLabel, player)
        : null,
    };
  });

const physicalCountLabel = (
  source: NonNullable<RegionSource['countLabel']>,
  player: Pick<BoardPlayerLayout, 'side' | 'frameBounds'>
): BoardLayoutCountLabel => {
  const { x, y, width, height } = player.frameBounds;
  // Player-local corner: `right: r%` puts the text's right edge at (1 - r),
  // `left: l%` its left edge at l; `bottom: b%` puts its bottom edge at (1 - b).
  const localX =
    source.horizontalAnchor === 'left'
      ? source.horizontalOffsetRatio
      : 1 - source.horizontalOffsetRatio;
  const localY = 1 - source.bottomRatio;
  const fontSizePx = Math.min(20, Math.max(10, 0.04 * height));
  if (player.side === 'local') {
    return {
      anchor: { x: x + localX * width, y: y + localY * height },
      horizontalAlign: source.horizontalAnchor,
      verticalAlign: 'bottom',
      fontSizePx,
    };
  }
  // The opponent frame is a half-turn of the local one, and v1 flips the
  // text itself back upright, so the anchored corner swaps to its opposite.
  return {
    anchor: { x: x + (1 - localX) * width, y: y + (1 - localY) * height },
    horizontalAlign: source.horizontalAnchor === 'left' ? 'right' : 'left',
    verticalAlign: 'top',
    fontSizePx,
  };
};

const createPlayerLayout = (
  playerId: PlayerId,
  side: BoardSide,
  physicalSide: BoardPhysicalSide,
  bounds: Rect
): BoardPlayerLayout => {
  const base = {
    playerId,
    side,
    physicalSide,
    rotationQuarterTurns: (side === 'local' ? 0 : 2) as 0 | 2,
    frameBounds: bounds,
  };
  return { ...base, regions: createRegions(base) };
};

const createResizeHandle = (
  id: 'lower' | 'upper',
  viewport: BoardViewport,
  handle: BoardNormalizedResizeHandle
): BoardResizeHandleLayout => {
  return {
    id,
    controlsPhysicalSide: id,
    authoredBottomRatio: handle.bottomRatio,
    bounds: {
      x: viewport.width * LEGACY_BOARD_RESIZER_V1.leftRatio,
      y: viewport.height * (1 - handle.bottomRatio - handle.heightRatio / 2),
      width: viewport.width * LEGACY_BOARD_RESIZER_V1.widthRatio,
      height: viewport.height * handle.heightRatio,
    },
    cursor: 'row-resize',
    affordances: LEGACY_BOARD_AFFORDANCES_V1.resizeHandle,
  };
};

const otherPlayer = (
  playerIds: BoardLayoutState['playerIds'],
  bottomPlayerId: PlayerId
): PlayerId => {
  if (playerIds[0] === bottomPlayerId) return playerIds[1];
  if (playerIds[1] === bottomPlayerId) return playerIds[0];
  throw new Error('Bottom player must be one of the two layout players');
};

const assertBoardLayoutState = (state: BoardLayoutState): PlayerId => {
  assertViewport(state.viewport);
  if (state.geometryVersion !== BOARD_LAYOUT_GEOMETRY_VERSION) {
    throw new Error('Unsupported board layout geometry version');
  }
  if (!Array.isArray(state.playerIds) || state.playerIds.length !== 2) {
    throw new Error('Board layout requires exactly two players');
  }
  if (state.playerIds[0] === state.playerIds[1]) {
    throw new Error('Board layout requires two distinct players');
  }
  if (state.shellMode !== 'sidebar' && state.shellMode !== 'fullscreen') {
    throw new Error('Unsupported board shell mode');
  }
  const topPlayerId = otherPlayer(state.playerIds, state.bottomPlayerId);
  assertVerticalState(state.vertical);
  return topPlayerId;
};

export const createBoardLayoutSnapshot = (
  state: BoardLayoutState
): BoardLayoutSnapshot => {
  const topPlayerId = assertBoardLayoutState(state);

  const fullScreen = state.shellMode === 'fullscreen';
  const playAreaWidth =
    state.viewport.width *
    (fullScreen ? 1 : LEGACY_BOARD_SHELL_V1.playAreaWidthRatio);
  const playAreaBounds: Rect = {
    x: 0,
    y: 0,
    width: playAreaWidth,
    height: state.viewport.height,
  };
  const sidebarBounds: Rect | null = fullScreen
    ? null
    : {
        x: state.viewport.width * LEGACY_BOARD_SHELL_V1.sidebarLeftRatio,
        y: state.viewport.height * LEGACY_BOARD_SHELL_V1.tabsHeightRatio,
        width: state.viewport.width * LEGACY_BOARD_SHELL_V1.sidebarWidthRatio,
        height:
          state.viewport.height * LEGACY_BOARD_SHELL_V1.sidebarHeightRatio,
      };
  const tabsBounds: Rect | null = fullScreen
    ? null
    : {
        x: state.viewport.width * LEGACY_BOARD_SHELL_V1.sidebarLeftRatio,
        y: 0,
        width: state.viewport.width * LEGACY_BOARD_SHELL_V1.sidebarWidthRatio,
        height: state.viewport.height * LEGACY_BOARD_SHELL_V1.tabsHeightRatio,
      };
  const shellGapBounds: Rect | null = fullScreen
    ? null
    : {
        x: playAreaWidth,
        y: 0,
        width:
          state.viewport.width * LEGACY_BOARD_SHELL_V1.sidebarLeftRatio -
          playAreaWidth,
        height: state.viewport.height,
      };

  const lowerPlayer = createPlayerLayout(
    state.bottomPlayerId,
    'local',
    'lower',
    frameBounds(state.viewport, playAreaWidth, state.vertical.lowerFrame)
  );
  const upperPlayer = createPlayerLayout(
    topPlayerId,
    'opponent',
    'upper',
    frameBounds(state.viewport, playAreaWidth, state.vertical.upperFrame)
  );

  const lowerHandle = createResizeHandle(
    'lower',
    state.viewport,
    state.vertical.lowerHandle
  );
  const upperHandle = createResizeHandle(
    'upper',
    state.viewport,
    state.vertical.upperHandle
  );
  const handleMean =
    (state.vertical.lowerHandle.bottomRatio +
      state.vertical.upperHandle.bottomRatio) /
    2;
  const stadiumBottom =
    state.vertical.sharedPlacement === 'cssDefault'
      ? LEGACY_BOARD_SHARED_V1.defaultStadiumBottomRatio
      : Math.min(
          LEGACY_BOARD_SHARED_V1.stadiumMaximumBottomRatio,
          handleMean - LEGACY_BOARD_SHARED_V1.stadiumMidpointOffsetRatio
        );
  const controlsBottom =
    state.vertical.sharedPlacement === 'cssDefault'
      ? LEGACY_BOARD_SHARED_V1.defaultBoardControlsBottomRatio
      : Math.min(
          LEGACY_BOARD_SHARED_V1.boardControlsMaximumBottomRatio,
          handleMean - LEGACY_BOARD_SHARED_V1.boardControlsMidpointOffsetRatio
        );

  return {
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: { ...state.viewport },
    shellMode: state.shellMode,
    playAreaBounds,
    shellGapBounds,
    sidebarBounds,
    tabsBounds,
    bottomPlayerId: state.bottomPlayerId,
    players: [lowerPlayer, upperPlayer],
    resizeHandles: [lowerHandle, upperHandle],
    shared: {
      stadium: {
        physicalDeclaredBounds: {
          x: state.viewport.width * LEGACY_BOARD_SHARED_V1.stadiumLeftRatio,
          y:
            state.viewport.height *
            (1 - stadiumBottom - LEGACY_BOARD_SHARED_V1.stadiumHeightRatio),
          width:
            state.viewport.width * LEGACY_BOARD_SHARED_V1.stadiumWidthRatio,
          height:
            state.viewport.height * LEGACY_BOARD_SHARED_V1.stadiumHeightRatio,
        },
        semanticZOrder: LEGACY_BOARD_Z_ORDER_V1.zone,
        affordances: LEGACY_BOARD_AFFORDANCES_V1.zone,
        childCardAffordances: LEGACY_BOARD_AFFORDANCES_V1.ordinaryCard,
      },
      boardControlsAnchor: {
        x:
          state.viewport.width *
          (fullScreen
            ? LEGACY_BOARD_SHELL_V1.fullScreenBoardControlsLeftRatio
            : LEGACY_BOARD_SHELL_V1.normalBoardControlsLeftRatio),
        y:
          state.viewport.height *
          (1 -
            controlsBottom -
            LEGACY_BOARD_SHARED_V1.boardControlsHeightRatio),
        height:
          state.viewport.height *
          LEGACY_BOARD_SHARED_V1.boardControlsHeightRatio,
      },
    },
  };
};

/** Flip changes player-to-physical-frame ownership; physical geometry is retained. */
export const flipBoardLayoutState = (
  state: BoardLayoutState
): BoardLayoutState => ({
  ...state,
  bottomPlayerId: otherPlayer(state.playerIds, state.bottomPlayerId),
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, maximum));

const legacyResizeHandleHeight = (
  id: BoardResizeHandleId,
  bottomRatio: number
): BoardNormalizedResizeHandle['heightRatio'] =>
  (id === 'upper' &&
    bottomRatio > LEGACY_BOARD_RESIZER_V1.upperExpandAboveRatio) ||
  (id === 'lower' &&
    bottomRatio < LEGACY_BOARD_RESIZER_V1.lowerExpandBelowRatio)
    ? LEGACY_BOARD_RESIZER_V1.expandedHeightRatio
    : LEGACY_BOARD_RESIZER_V1.baseHeightRatio;

/**
 * Pure form of the four v1 split-resizer mousemove branches. The handle ID is
 * physical: `lower` is the shipped `selfResizer` element and `upper` is the
 * shipped `oppResizer` element. Flip changes which branch those elements use,
 * while the resulting state remains expressed in physical coordinates.
 */
export const resizeBoardLayoutState = (
  state: BoardLayoutState,
  handleId: BoardResizeHandleId,
  clientY: number
): BoardLayoutState => {
  // Validate the retained input before using it as the untouched half of a
  // transition. This also verifies player identity and the current bottom ID.
  assertBoardLayoutState(state);
  finite(clientY, 'Board resize pointer clientY');
  if (handleId !== 'lower' && handleId !== 'upper') {
    throw new Error('Unsupported board resize handle');
  }

  const viewportHeight = state.viewport.height;
  const flipped = state.bottomPlayerId !== state.playerIds[0];
  const minimumY = flipped
    ? 1 / viewportHeight
    : handleId === 'upper'
      ? -0.01
      : 0;
  const maximumY = flipped
    ? 1 - 1 / viewportHeight
    : handleId === 'lower'
      ? 1.01
      : 1;
  const yRatio = clamp(clientY / viewportHeight, minimumY, maximumY);
  let lowerFrame = { ...state.vertical.lowerFrame };
  let upperFrame = { ...state.vertical.upperFrame };
  let lowerHandle = { ...state.vertical.lowerHandle };
  let upperHandle = { ...state.vertical.upperHandle };

  if (!flipped && handleId === 'lower') {
    lowerFrame = {
      ...lowerFrame,
      heightRatio: Math.max(0.01, 1 - yRatio + 0.01),
    };
    lowerHandle = { ...lowerHandle, bottomRatio: 1 - yRatio };
    const collides = legacyResizeHandlesCollide(
      { lowerHandle, upperHandle },
      viewportHeight
    );
    if (state.vertical.sharedPlacement === 'cssDefault') {
      // Collision sees computed 53%; v1 then installs a distinct 51% inline
      // fallback before calculating the shared midpoint.
      upperHandle = { ...upperHandle, bottomRatio: 0.51 };
    }
    if (collides) {
      upperHandle = { ...upperHandle, bottomRatio: 1.025 - yRatio };
      upperFrame = {
        bottomRatio: 1.015 - yRatio,
        heightRatio: Math.max(0.01, yRatio - 0.01),
      };
    }
  } else if (!flipped && handleId === 'upper') {
    upperHandle = { ...upperHandle, bottomRatio: 1 - yRatio };
    upperFrame = {
      bottomRatio: 0.99 - yRatio,
      heightRatio: Math.max(0.01, yRatio + 0.01),
    };
    const collides = legacyResizeHandlesCollide(
      { lowerHandle, upperHandle },
      viewportHeight
    );
    if (state.vertical.sharedPlacement === 'cssDefault') {
      // Collision sees computed 50.5%; midpoint placement uses v1's 49%
      // inline fallback after the first upper-handle event.
      lowerHandle = { ...lowerHandle, bottomRatio: 0.49 };
    }
    if (collides) {
      lowerFrame = {
        ...lowerFrame,
        heightRatio: Math.max(0.01, 1 - yRatio - 0.01),
      };
      lowerHandle = { ...lowerHandle, bottomRatio: 0.975 - yRatio };
    }
  } else if (handleId === 'lower') {
    lowerFrame = { ...lowerFrame, heightRatio: 1 - yRatio };
    lowerHandle = { ...lowerHandle, bottomRatio: 0.99 - yRatio };
    const collides = legacyResizeHandlesCollide(
      { lowerHandle, upperHandle },
      viewportHeight
    );
    if (state.vertical.sharedPlacement === 'cssDefault') {
      upperHandle = { ...upperHandle, bottomRatio: 0.51 };
    }
    if (collides) {
      upperHandle = { ...upperHandle, bottomRatio: 1.015 - yRatio };
      upperFrame = {
        bottomRatio: 1 - yRatio,
        heightRatio: yRatio,
      };
    }
  } else {
    upperHandle = { ...upperHandle, bottomRatio: 1.01 - yRatio };
    upperFrame = {
      bottomRatio: 1 - yRatio,
      heightRatio: yRatio,
    };
    const collides = legacyResizeHandlesCollide(
      { lowerHandle, upperHandle },
      viewportHeight
    );
    if (state.vertical.sharedPlacement === 'cssDefault') {
      lowerHandle = { ...lowerHandle, bottomRatio: 0.49 };
    }
    if (collides) {
      lowerFrame = { ...lowerFrame, heightRatio: 1 - yRatio };
      lowerHandle = { ...lowerHandle, bottomRatio: 0.985 - yRatio };
    }
  }

  lowerHandle = {
    ...lowerHandle,
    heightRatio: legacyResizeHandleHeight('lower', lowerHandle.bottomRatio),
  };
  upperHandle = {
    ...upperHandle,
    heightRatio: legacyResizeHandleHeight('upper', upperHandle.bottomRatio),
  };
  const next: BoardLayoutState = {
    ...state,
    vertical: {
      lowerFrame,
      upperFrame,
      lowerHandle,
      upperHandle,
      sharedPlacement: 'handleMidpoint',
    },
  };
  // Fail closed if a future arithmetic change produces a state outside the
  // source-observed overscan envelope.
  assertBoardLayoutState(next);
  return next;
};

export const findBoardLayoutRegion = (
  snapshot: BoardLayoutSnapshot,
  side: BoardSide,
  kind: BoardLayoutRegionKind
): BoardLayoutRegion => {
  const region = snapshot.players
    .find((player) => player.side === side)
    ?.regions.find((candidate) => candidate.kind === kind);
  if (!region) throw new Error(`Missing ${side} ${kind} layout region`);
  return region;
};

export type LegacyContainedCardBlockAlignment = 'start' | 'end';
export type LegacyPileKind = 'deck' | 'discard' | 'lostZone' | 'stadium';

/**
 * Source-faithful contained element box for cover and stadium images. Covers
 * explicitly use `object-fit: contain`; stadium images preserve their intrinsic
 * ratio through auto sizing plus max-width/max-height constraints.
 * `start`/`end` describe the physical block edge after any enclosing legacy
 * frame/stadium rotation has been resolved by the caller.
 *
 * The legacy browser also refuses to upscale images past their intrinsic pixel
 * dimensions. MatchViewState intentionally carries no image dimensions, so
 * production scenes use the public canonical card ratio and assume a normal
 * card asset large enough to reach one of the container constraints. Exact
 * small/custom-asset no-upscale behavior remains an asset-metadata gate.
 */
export const layoutLegacyContainedCard = (
  bounds: Rect,
  intrinsicAspectRatio: number,
  blockAlignment: LegacyContainedCardBlockAlignment
): Rect => {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error(
      'Contained-card bounds must have finite positive dimensions'
    );
  }
  if (!Number.isFinite(intrinsicAspectRatio) || intrinsicAspectRatio <= 0) {
    throw new Error('Contained-card aspect ratio must be positive');
  }
  if (blockAlignment !== 'start' && blockAlignment !== 'end') {
    throw new Error('Unsupported contained-card block alignment');
  }

  const containerAspectRatio = bounds.width / bounds.height;
  const widthLimited = intrinsicAspectRatio >= containerAspectRatio;
  const width = widthLimited
    ? bounds.width
    : bounds.height * intrinsicAspectRatio;
  const height = widthLimited
    ? bounds.width / intrinsicAspectRatio
    : bounds.height;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y:
      blockAlignment === 'start' ? bounds.y : bounds.y + bounds.height - height,
    width,
    height,
  };
};

/** Returns the legacy card selected for top paint priority and input. */
export const legacyPileTopIndex = (
  kind: LegacyPileKind,
  count: number
): number | null => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Pile card count must be a non-negative integer');
  }
  if (kind === 'stadium' && count > 1) {
    throw new Error('Stadium zone can contain at most one card');
  }
  if (count === 0) return null;
  switch (kind) {
    case 'deck':
    case 'stadium':
      return 0;
    case 'discard':
    case 'lostZone':
      return count - 1;
  }
};

/**
 * Source-faithful unadorned card boxes for a non-overflowing active/bench flex
 * row. The caller must exclude expanded attachment widths, Rotation/BREAK
 * inline margins and flex shrink; those modes require browser characterization.
 */
export const layoutLegacyPlaySlotCards = (
  region: BoardLayoutRegion,
  intrinsicAspectRatios: readonly number[]
): readonly Rect[] | null => {
  if (region.surface !== 'playSlot') {
    throw new Error('Play-slot card layout requires an active or bench region');
  }
  for (const aspectRatio of intrinsicAspectRatios) {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      throw new Error('Card intrinsic aspect ratios must be positive');
    }
  }
  if (intrinsicAspectRatios.length === 0) return [];
  const cardHeight = region.physicalDeclaredBounds.height;
  const marginRight =
    region.kind === 'bench' ? region.physicalDeclaredBounds.width * 0.01 : 0;
  const cardWidths = intrinsicAspectRatios.map(
    (aspectRatio) => cardHeight * aspectRatio
  );
  const rowWidth =
    cardWidths.reduce((total, width) => total + width, 0) +
    marginRight * intrinsicAspectRatios.length;
  // The authored row is wider than its region, so the browser would flex-shrink
  // and this model has no characterized answer. That is a supported state, not
  // a programming error: the caller falls back to generic layout. Argument
  // faults above still throw.
  if (rowWidth > region.physicalDeclaredBounds.width) return null;
  const startX =
    region.physicalDeclaredBounds.x +
    (region.physicalDeclaredBounds.width - rowWidth) / 2;
  const localX: number[] = [];
  let cursor = startX;
  for (const width of cardWidths) {
    localX.push(cursor);
    cursor += width + marginRight;
  }
  return cardWidths.map((width, index) => ({
    x:
      region.side === 'local'
        ? localX[index]!
        : region.physicalDeclaredBounds.x +
          region.physicalDeclaredBounds.width -
          (localX[index]! - region.physicalDeclaredBounds.x) -
          width,
    y: region.physicalDeclaredBounds.y,
    width,
    height: cardHeight,
  }));
};

/**
 * Exact physical marker boxes for the narrowly characterized pristine-q0
 * active card. Legacy derives each marker from the card's painted box. At q0
 * that box equals the renderer contract's untransformed card box; `side`
 * resolves the enclosing opponent-frame half-turn into physical coordinates.
 */
export const layoutLegacyActiveQ0Markers = (
  cardBounds: Rect,
  side: BoardSide
): LegacyActiveQ0MarkerLayout => {
  if (
    !Number.isFinite(cardBounds.x) ||
    !Number.isFinite(cardBounds.y) ||
    !Number.isFinite(cardBounds.width) ||
    !Number.isFinite(cardBounds.height) ||
    cardBounds.width <= 0 ||
    cardBounds.height <= 0
  ) {
    throw new Error('Active-marker card bounds must be finite and positive');
  }
  if (side !== 'local' && side !== 'opponent') {
    throw new Error('Active-marker side must be local or opponent');
  }

  const circleSize = cardBounds.width / 3;
  const abilityHeight = cardBounds.width / 5;
  const markerY =
    side === 'local'
      ? cardBounds.y + cardBounds.height / 4
      : cardBounds.y + (cardBounds.height * 3) / 4 - circleSize;
  const damageX =
    side === 'local' ? cardBounds.x + (cardBounds.width * 2) / 3 : cardBounds.x;
  const specialConditionX =
    side === 'local' ? cardBounds.x : cardBounds.x + (cardBounds.width * 2) / 3;
  const circle = (x: number): LegacyActiveQ0MarkerItemLayout => ({
    bounds: {
      x,
      y: markerY,
      width: circleSize,
      height: circleSize,
    },
    sourceZIndex: LEGACY_BOARD_Z_ORDER_V1.marker,
  });
  return {
    damage: circle(damageX),
    specialCondition: circle(specialConditionX),
    abilityUsed: {
      bounds: {
        x: cardBounds.x,
        y:
          side === 'local'
            ? cardBounds.y + cardBounds.height / 2
            : cardBounds.y + cardBounds.height / 2 - abilityHeight,
        width: cardBounds.width,
        height: abilityHeight,
      },
      sourceZIndex: LEGACY_BOARD_Z_ORDER_V1.marker,
    },
  };
};

/**
 * Exact physical marker boxes for the narrowly characterized sole-bench q0
 * card. Canonical bench state permits damage and ability-used markers but not
 * special conditions. Relative q0 placement matches the active helper; the
 * supplied card box already includes the bench flex margin and physical-side
 * transform.
 */
export const layoutLegacyBenchQ0Markers = (
  cardBounds: Rect,
  side: BoardSide
): LegacyBenchQ0MarkerLayout => {
  if (
    !Number.isFinite(cardBounds.x) ||
    !Number.isFinite(cardBounds.y) ||
    !Number.isFinite(cardBounds.width) ||
    !Number.isFinite(cardBounds.height) ||
    cardBounds.width <= 0 ||
    cardBounds.height <= 0
  ) {
    throw new Error('Bench-marker card bounds must be finite and positive');
  }
  if (side !== 'local' && side !== 'opponent') {
    throw new Error('Bench-marker side must be local or opponent');
  }

  const { damage, abilityUsed } = layoutLegacyActiveQ0Markers(cardBounds, side);
  return { damage, abilityUsed };
};

/**
 * Stable geometry for the narrowly characterized ordinary-evolution path.
 * This differs from the older attachment fixture: v1 rebuilds an integer-width
 * flex item during refresh and then derives every evolution offset from that
 * CSSOM `clientWidth`, while the image can retain a fractional painted width.
 * Rotation/BREAK, other attachments, multiple-stack shrink and overflow remain
 * caller-side exclusions.
 */
export const layoutLegacyOrdinaryEvolutionStack = (
  region: BoardLayoutRegion,
  cardAspectRatio: number,
  evolutionCount: number
): LegacyOrdinaryEvolutionStackLayout | null => {
  if (
    region.surface !== 'playSlot' ||
    (region.kind !== 'active' && region.kind !== 'bench')
  ) {
    throw new Error(
      'Ordinary evolution layout requires an active or bench play slot'
    );
  }
  if (!Number.isFinite(cardAspectRatio) || cardAspectRatio <= 0) {
    throw new Error('Evolution card aspect ratio must be positive');
  }
  if (evolutionCount !== 3) {
    throw new Error(
      'Ordinary evolution layout requires exactly three evolution cards'
    );
  }
  const bounds = region.physicalDeclaredBounds;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error('Evolution play-slot bounds must be finite and positive');
  }

  const cardHeight = bounds.height;
  const cardWidth = cardHeight * cardAspectRatio;
  const cssomClientWidth = Math.round(cardWidth);
  if (cssomClientWidth <= 0) {
    throw new Error('Evolution CSSOM client width must be positive');
  }
  const marginRight = region.kind === 'bench' ? bounds.width * 0.01 : 0;
  const flexOuterWidth = cssomClientWidth + marginRight;
  // Uncharacterized flex shrink: degrade to the generic path (see above).
  if (flexOuterWidth > bounds.width) return null;
  const centeredOuterX = bounds.x + (bounds.width - flexOuterWidth) / 2;
  // The authored trailing bench margin becomes a physical leading margin when
  // the enclosing opponent frame rotates. physicalDeclaredBounds is already
  // mirrored, so only the margin edge changes here.
  const flexItemX =
    region.side === 'local' ? centeredOuterX : centeredOuterX + marginRight;
  const cardX =
    region.side === 'local'
      ? flexItemX
      : flexItemX + cssomClientWidth - cardWidth;
  const offsetDirection = region.side === 'local' ? -1 : 1;
  const offsetStep = cssomClientWidth / 15;
  return {
    flexItemBounds: {
      x: flexItemX,
      y: bounds.y,
      width: cssomClientWidth,
      height: cardHeight,
    },
    cssomClientWidth,
    cards: Array.from({ length: evolutionCount }, (_, canonicalIndex) => {
      const layerFromTop = evolutionCount - canonicalIndex - 1;
      return {
        canonicalIndex,
        layerFromTop,
        bounds: {
          x: cardX,
          y: bounds.y + offsetDirection * offsetStep * layerFromTop,
          width: cardWidth,
          height: cardHeight,
        },
        sourceZIndex: layerFromTop === 0 ? 0 : -layerFromTop,
      };
    }),
  };
};

type LegacyAttachmentKind = 'energy' | 'trainerTool' | 'energyTrainerTool';

interface LegacyAttachmentStackGeometry {
  readonly flexItemBounds: Rect;
  readonly baseCssomClientWidth: number;
  readonly attachmentOffset: number;
  readonly authoredWidth: number;
  readonly stableCssomClientWidth: number;
  readonly marginRight: number;
  readonly base: LegacySingleEnergyAttachmentCardLayout;
  readonly attachments: readonly LegacySingleEnergyAttachmentCardLayout[];
}

const layoutLegacyAttachmentStack = (
  region: BoardLayoutRegion,
  cardAspectRatio: number,
  kind: LegacyAttachmentKind,
  attachmentCount: 1 | 2
): LegacyAttachmentStackGeometry | null => {
  let sourceName:
    | 'Single-Energy'
    | 'Two-Energy'
    | 'Single-Trainer-as-Tool'
    | 'Single-Energy/Trainer-as-Tool';
  let marginRightRatio: 0 | 0.02;
  let allowsBench: boolean;
  switch (kind) {
    case 'energy':
      sourceName = attachmentCount === 1 ? 'Single-Energy' : 'Two-Energy';
      marginRightRatio = 0;
      allowsBench = false;
      break;
    case 'trainerTool':
      if (attachmentCount !== 1) {
        throw new Error(
          'Trainer-as-Tool layout requires exactly one attachment'
        );
      }
      sourceName = 'Single-Trainer-as-Tool';
      marginRightRatio = 0.02;
      allowsBench = false;
      break;
    case 'energyTrainerTool':
      if (attachmentCount !== 2) {
        throw new Error(
          'Single-Energy/Trainer-as-Tool layout requires exactly two attachments'
        );
      }
      sourceName = 'Single-Energy/Trainer-as-Tool';
      marginRightRatio = 0.02;
      allowsBench = true;
      break;
  }
  if (
    region.surface !== 'playSlot' ||
    (region.kind !== 'active' && !(allowsBench && region.kind === 'bench'))
  ) {
    throw new Error(
      `${sourceName} layout requires ${allowsBench ? 'an active or bench' : 'an active'} play slot`
    );
  }
  if (!Number.isFinite(cardAspectRatio) || cardAspectRatio <= 0) {
    throw new Error(`${sourceName} card aspect ratio must be positive`);
  }
  const bounds = region.physicalDeclaredBounds;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error(`${sourceName} active bounds must be finite and positive`);
  }

  const cardHeight = bounds.height;
  const cardWidth = cardHeight * cardAspectRatio;
  const baseCssomClientWidth = Math.round(cardWidth);
  if (baseCssomClientWidth <= 0) {
    throw new Error(`${sourceName} CSSOM base width must be positive`);
  }
  const attachmentOffset = baseCssomClientWidth / 6;
  const authoredWidth =
    baseCssomClientWidth + attachmentCount * attachmentOffset;
  const marginRight = bounds.width * marginRightRatio;
  const flexOuterWidth = authoredWidth + marginRight;
  // Uncharacterized flex shrink: degrade to the generic path (see above).
  if (flexOuterWidth > bounds.width) return null;
  const centeredOuterX = bounds.x + (bounds.width - flexOuterWidth) / 2;
  // A trailing Tool margin becomes a physical leading margin when the enclosing
  // opponent frame rotates. Energy passes a zero margin through the same path.
  const flexItemX =
    region.side === 'local' ? centeredOuterX : centeredOuterX + marginRight;
  const baseX =
    region.side === 'local' ? flexItemX : flexItemX + authoredWidth - cardWidth;
  const attachmentDirection = region.side === 'local' ? 1 : -1;
  return {
    flexItemBounds: {
      x: flexItemX,
      y: bounds.y,
      width: authoredWidth,
      height: cardHeight,
    },
    baseCssomClientWidth,
    attachmentOffset,
    authoredWidth,
    stableCssomClientWidth: Math.round(authoredWidth),
    marginRight,
    base: {
      bounds: { x: baseX, y: bounds.y, width: cardWidth, height: cardHeight },
      sourceZIndex: 0,
    },
    attachments: Array.from({ length: attachmentCount }, (_, index) => ({
      bounds: {
        x: baseX + attachmentDirection * attachmentOffset * (index + 1),
        y: bounds.y,
        width: cardWidth,
        height: cardHeight,
      },
      sourceZIndex: -(index + 1),
    })),
  };
};

/**
 * Stable geometry for the narrow one-base/one-Energy active-stack path. The
 * public canonical card ratio determines paint size; v1 derives the Energy
 * offset and refreshed wrapper width from the rounded CSSOM base width. Tool
 * rotation/margins, multiple attachments, bench placement, flex shrink, and
 * every noncanonical state remain caller-side exclusions.
 */
export const layoutLegacySingleEnergyAttachmentStack = (
  region: BoardLayoutRegion,
  cardAspectRatio: number
): LegacySingleEnergyAttachmentStackLayout | null => {
  const result = layoutLegacyAttachmentStack(
    region,
    cardAspectRatio,
    'energy',
    1
  );
  if (!result) return null;
  const energy = result.attachments[0];
  if (!energy) throw new Error('Single-Energy layout lost its attachment');
  return {
    flexItemBounds: result.flexItemBounds,
    baseCssomClientWidth: result.baseCssomClientWidth,
    attachmentOffset: result.attachmentOffset,
    authoredWidth: result.authoredWidth,
    stableCssomClientWidth: result.stableCssomClientWidth,
    base: result.base,
    energy,
  };
};

/**
 * Stable geometry for the narrow one-base/two-Energy active-stack path. The
 * public canonical card ratio determines paint size; v1 derives the two
 * inner-to-outer offsets and refreshed wrapper width from the rounded CSSOM
 * base width. Every noncanonical state remains a caller-side exclusion.
 */
export const layoutLegacyTwoEnergyAttachmentStack = (
  region: BoardLayoutRegion,
  cardAspectRatio: number
): LegacyTwoEnergyAttachmentStackLayout | null => {
  const result = layoutLegacyAttachmentStack(
    region,
    cardAspectRatio,
    'energy',
    2
  );
  if (!result) return null;
  const firstEnergy = result.attachments[0];
  const secondEnergy = result.attachments[1];
  if (!firstEnergy || !secondEnergy) {
    throw new Error('Two-Energy layout lost an attachment');
  }
  return {
    flexItemBounds: result.flexItemBounds,
    baseCssomClientWidth: result.baseCssomClientWidth,
    attachmentOffset: result.attachmentOffset,
    authoredWidth: result.authoredWidth,
    stableCssomClientWidth: result.stableCssomClientWidth,
    base: result.base,
    energies: [firstEnergy, secondEnergy],
  };
};

/**
 * Stable geometry for the narrow one-base/one-Trainer-as-Tool active-stack
 * path. Like the Energy path, v1 derives the attachment offset and wrapper
 * width from the rounded CSSOM base width. The Tool additionally contributes a
 * 2% trailing flex margin. Its presentation-only quarter-turn is deliberately
 * owned by the scene rather than encoded in these pre-transform boxes.
 */
export const layoutLegacySingleTrainerToolAttachmentStack = (
  region: BoardLayoutRegion,
  cardAspectRatio: number
): LegacySingleTrainerToolAttachmentStackLayout | null => {
  const result = layoutLegacyAttachmentStack(
    region,
    cardAspectRatio,
    'trainerTool',
    1
  );
  if (!result) return null;
  const tool = result.attachments[0];
  if (!tool)
    throw new Error('Single-Trainer-as-Tool layout lost its attachment');
  return {
    flexItemBounds: result.flexItemBounds,
    baseCssomClientWidth: result.baseCssomClientWidth,
    attachmentOffset: result.attachmentOffset,
    authoredWidth: result.authoredWidth,
    stableCssomClientWidth: result.stableCssomClientWidth,
    marginRight: result.marginRight,
    base: result.base,
    tool,
  };
};

/**
 * Canonical stable geometry for one base with one Energy followed by one
 * current-category Trainer-as-Tool. Source-observed active/sole-bench movement
 * rebuilds both cards with width/6 offsets, a 2% trailing wrapper margin, and
 * z indices 0/-1/-2. The Tool's presentation-only quarter-turn remains scene
 * state; these are the pre-transform card boxes.
 */
export const layoutLegacySingleEnergyTrainerToolAttachmentStack = (
  region: BoardLayoutRegion,
  cardAspectRatio: number
): LegacySingleEnergyTrainerToolAttachmentStackLayout | null => {
  const result = layoutLegacyAttachmentStack(
    region,
    cardAspectRatio,
    'energyTrainerTool',
    2
  );
  if (!result) return null;
  const energy = result.attachments[0];
  const tool = result.attachments[1];
  if (!energy || !tool) {
    throw new Error('Single-Energy/Trainer-as-Tool layout lost an attachment');
  }
  return {
    flexItemBounds: result.flexItemBounds,
    baseCssomClientWidth: result.baseCssomClientWidth,
    attachmentOffset: result.attachmentOffset,
    authoredWidth: result.authoredWidth,
    stableCssomClientWidth: result.stableCssomClientWidth,
    marginRight: result.marginRight,
    base: result.base,
    energy,
    tool,
  };
};

/**
 * v1's `#viewCards` / `#attachedCards` popup: a fixed panel centred in the
 * player's frame, 69% x 75% of it plus a 20px padding and 1px border, whose
 * images are inline at 33% of the content height with 0.5% margins. Inside the
 * rotated opponent frame the same box sits at the frame's authored top, which
 * is physically the edge nearest the table centre.
 */
export const LEGACY_WORK_AREA_PANEL_V1 = {
  widthRatio: 0.69,
  heightRatio: 0.75,
  paddingPx: 20,
  borderPx: 1,
  cardHeightRatio: 0.33,
  cardMarginRatio: 0.005,
  /** The inline strut below a baseline-aligned image in v1's 16px line box. */
  lineStrutPx: 4,
} as const;

export interface LegacyWorkAreaPanelLayout {
  /** Border box of the popup. */
  readonly bounds: Rect;
  /** Content box the cards flow in. */
  readonly contentBounds: Rect;
  readonly cardHeight: number;
  readonly cardMargin: number;
}

export const layoutLegacyWorkAreaPanel = (
  frame: Rect,
  side: BoardSide
): LegacyWorkAreaPanelLayout => {
  if (
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width < 0 ||
    frame.height < 0
  ) {
    throw new Error('Work-area panel frame must be finite and non-negative');
  }
  const spec = LEGACY_WORK_AREA_PANEL_V1;
  const contentWidth = frame.width * spec.widthRatio;
  const contentHeight = frame.height * spec.heightRatio;
  const edge = spec.paddingPx + spec.borderPx;
  const width = contentWidth + 2 * edge;
  const height = contentHeight + 2 * edge;
  const x = frame.x + (frame.width - width) / 2;
  // `.self-view` centres the box; `.opp-view` pins its authored top to the
  // frame's authored top, i.e. its physical bottom to the frame's bottom.
  const y =
    side === 'local'
      ? frame.y + (frame.height - height) / 2
      : frame.y + frame.height - height;
  return {
    bounds: { x, y, width, height },
    contentBounds: {
      x: x + edge,
      y: y + edge,
      width: contentWidth,
      height: contentHeight,
    },
    cardHeight: contentHeight * spec.cardHeightRatio,
    cardMargin: contentWidth * spec.cardMarginRatio,
  };
};

/**
 * Inline-flow card boxes inside the popup: left to right, wrapping when the
 * next image would overflow the content width. The opponent's frame is
 * rotated, so its flow runs right-to-left and bottom-up.
 */
export const layoutLegacyWorkAreaCards = (
  panel: LegacyWorkAreaPanelLayout,
  side: BoardSide,
  count: number,
  cardAspectRatio: number
): readonly Rect[] => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Work-area card count must be a non-negative integer');
  }
  if (!Number.isFinite(cardAspectRatio) || cardAspectRatio <= 0) {
    throw new Error('Work-area card aspect ratio must be positive');
  }
  const { contentBounds, cardHeight, cardMargin } = panel;
  const cardWidth = cardHeight * cardAspectRatio;
  const pitchX = cardWidth + 2 * cardMargin;
  const pitchY =
    cardHeight + 2 * cardMargin + LEGACY_WORK_AREA_PANEL_V1.lineStrutPx;
  const perRow =
    pitchX > 0 ? Math.max(1, Math.floor(contentBounds.width / pitchX)) : 1;
  return Array.from({ length: count }, (_, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const localX = contentBounds.x + cardMargin + column * pitchX;
    const localY = contentBounds.y + cardMargin + row * pitchY;
    return side === 'local'
      ? { x: localX, y: localY, width: cardWidth, height: cardHeight }
      : {
          x:
            contentBounds.x +
            contentBounds.width -
            (localX - contentBounds.x) -
            cardWidth,
          y:
            contentBounds.y +
            contentBounds.height -
            (localY - contentBounds.y) -
            cardHeight,
          width: cardWidth,
          height: cardHeight,
        };
  });
};

export type LegacyPlayRowAttachmentKind = 'energy' | 'tool';

export interface LegacyPlayRowStackInput {
  /** Bottom-to-top evolution card count; at least one. */
  readonly evolutionCount: number;
  /** Attachments in canonical stack order. */
  readonly attachments: readonly LegacyPlayRowAttachmentKind[];
  /** Whole-stack rotation; Energy attachments never follow it. */
  readonly rotationQuarterTurns: QuarterTurns;
}

export interface LegacyPlayRowCardBox {
  /** Pre-transform card box; renderers rotate it around its centre. */
  readonly bounds: Rect;
  /** The exact image z-index emitted by v1 attachCard/resetImage. */
  readonly sourceZIndex: number;
}

export interface LegacyPlayRowAttachmentBox extends LegacyPlayRowCardBox {
  /** Tools paint a quarter turn from the host; Energy stays upright. */
  readonly rotationQuarterTurns: 0 | 1;
}

export interface LegacyPlayRowStackLayout {
  /** The play-container border box after flex centring and shrink. */
  readonly flexItemBounds: Rect;
  /** Integer CSSOM base width v1 uses for its width/6 and width/15 steps. */
  readonly cssomClientWidth: number;
  /** Indexed like the input's evolution cards (bottom-to-top). */
  readonly evolutionCards: readonly LegacyPlayRowCardBox[];
  /** Indexed like the input's attachments. */
  readonly attachmentCards: readonly LegacyPlayRowAttachmentBox[];
}

const legacyPlayContainerMargins = (
  kind: BoardLayoutRegionKind,
  rotationQuarterTurns: QuarterTurns,
  hasTool: boolean
): { readonly left: number; readonly right: number } => {
  // v1 rotateCard: a quarter-turned bench container takes 2%/3% margins and
  // a container rotated back to 0/180 takes 0%/1%; syncRotation gives a Tool
  // host a 2% trailing margin; otherwise the bench's stylesheet 1% applies.
  if (rotationQuarterTurns === 1 || rotationQuarterTurns === 3) {
    if (kind === 'bench') return { left: 0.02, right: 0.03 };
    return { left: 0, right: hasTool ? 0.02 : 0 };
  }
  if (rotationQuarterTurns === 2) return { left: 0, right: 0.01 };
  if (hasTool) return { left: 0, right: 0.02 };
  return { left: 0, right: kind === 'bench' ? 0.01 : 0 };
};

/**
 * Lays out every play-container of one active or bench row the way v1's
 * flex row does, for any stack shape: the container is an inline-block whose
 * width v1 grows by one sixth of the rounded base width per attachment; lower
 * evolution stages sit width/15 higher per layer behind the top card; Energy
 * then Tool attachments step width/6 to the right behind the host, each one
 * layer further back; a Tool paints a quarter turn from its host. Containers
 * are centred in the row and flex-shrink proportionally (never below the base
 * image) when their margins and widths overflow it. Opponent rows are the
 * same layout mirrored through the rotated player frame.
 */
export const layoutLegacyPlayRow = (
  region: BoardLayoutRegion,
  cardAspectRatio: number,
  stacks: readonly LegacyPlayRowStackInput[]
): readonly LegacyPlayRowStackLayout[] => {
  if (
    region.surface !== 'playSlot' ||
    (region.kind !== 'active' && region.kind !== 'bench')
  ) {
    throw new Error('Play-row layout requires an active or bench play slot');
  }
  if (!Number.isFinite(cardAspectRatio) || cardAspectRatio <= 0) {
    throw new Error('Play-row card aspect ratio must be positive');
  }
  // The play slots carry no padding or border, so the authored rectangle is
  // the flex container's content box.
  const bounds = region.physicalDeclaredBounds;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 0 ||
    bounds.height < 0
  ) {
    throw new Error('Play-row bounds must be finite and non-negative');
  }
  for (const stack of stacks) {
    if (
      !Number.isSafeInteger(stack.evolutionCount) ||
      stack.evolutionCount < 1
    ) {
      throw new Error('Play-row stacks need at least one evolution card');
    }
  }
  if (stacks.length === 0) return [];

  // A frame dragged shut leaves a zero-height row; its cards collapse with it
  // rather than failing the scene.
  const cardHeight = bounds.height;
  const cardWidth = cardHeight * cardAspectRatio;
  const cssomClientWidth = Math.round(cardWidth);
  const attachmentStep = cssomClientWidth / 6;
  const evolutionStep = cssomClientWidth / 15;

  const items = stacks.map((stack) => {
    const margins = legacyPlayContainerMargins(
      region.kind,
      stack.rotationQuarterTurns,
      stack.attachments.includes('tool')
    );
    return {
      // A lone basic keeps `width: auto`, i.e. the image's painted width; v1
      // writes the rounded CSSOM width back once it evolves the card or grows
      // the container for an attachment (adjustCards later rounds a lone
      // basic too, a sub-pixel difference the oracles do not resolve).
      basis:
        stack.attachments.length === 0 && stack.evolutionCount === 1
          ? cardWidth
          : cssomClientWidth + stack.attachments.length * attachmentStep,
      marginLeft: bounds.width * margins.left,
      marginRight: bounds.width * margins.right,
    };
  });

  // CSS flex shrink: each unfrozen item gives up overflow in proportion to
  // its basis, but never below its min-content size, the base image.
  const widths = items.map((item) => item.basis);
  const outer = items.reduce(
    (total, item) => total + item.basis + item.marginLeft + item.marginRight,
    0
  );
  let free = bounds.width - outer;
  if (free < 0) {
    const frozen = new Set<number>();
    let remaining = -free;
    for (let pass = 0; pass < items.length && remaining > 0; pass += 1) {
      const unfrozen = items
        .map((_, index) => index)
        .filter((index) => !frozen.has(index));
      const basisTotal = unfrozen.reduce(
        (total, index) => total + items[index]!.basis,
        0
      );
      if (unfrozen.length === 0 || basisTotal <= 0) break;
      let clamped = false;
      let recovered = 0;
      for (const index of unfrozen) {
        const target =
          items[index]!.basis - (remaining * items[index]!.basis) / basisTotal;
        if (target < cardWidth) {
          frozen.add(index);
          recovered += items[index]!.basis - cardWidth;
          widths[index] = cardWidth;
          clamped = true;
        } else {
          widths[index] = target;
        }
      }
      if (!clamped) break;
      remaining -= recovered;
    }
    const shrunkOuter = items.reduce(
      (total, item, index) =>
        total + widths[index]! + item.marginLeft + item.marginRight,
      0
    );
    free = bounds.width - shrunkOuter;
  }

  // justify-content: center also centres an overflowing row. The opponent
  // frame is the same row turned half a turn, so it is walked right-to-left
  // with its margins swapped and every card measured from the container's
  // far edge.
  const mirror = region.side !== 'local';
  const order = stacks.map((_, index) => index);
  if (mirror) order.reverse();
  let cursor = bounds.x + free / 2;
  const layouts: LegacyPlayRowStackLayout[] = [];
  for (const index of order) {
    const stack = stacks[index]!;
    const item = items[index]!;
    const width = widths[index]!;
    const leading = mirror ? item.marginRight : item.marginLeft;
    const trailing = mirror ? item.marginLeft : item.marginRight;
    const containerX = cursor + leading;
    cursor = containerX + width + trailing;
    const baseX = mirror ? containerX + width - cardWidth : containerX;
    const stepDirection = mirror ? -1 : 1;
    const evolutionCards: LegacyPlayRowCardBox[] = Array.from(
      { length: stack.evolutionCount },
      (_, canonicalIndex) => {
        const layerFromTop = stack.evolutionCount - canonicalIndex - 1;
        return {
          bounds: {
            x: baseX,
            y: bounds.y - stepDirection * evolutionStep * layerFromTop,
            width: cardWidth,
            height: cardHeight,
          },
          sourceZIndex: layerFromTop === 0 ? 0 : -layerFromTop,
        };
      }
    );
    // Energy attachments keep the low layers; v1 re-attaches Tools behind
    // every Energy so they always end up furthest right and furthest back.
    const energyCount = stack.attachments.filter(
      (kind) => kind === 'energy'
    ).length;
    let energyLayer = 0;
    let toolLayer = energyCount;
    const attachmentCards = stack.attachments.map(
      (kind): LegacyPlayRowAttachmentBox => {
        const layer = kind === 'energy' ? (energyLayer += 1) : (toolLayer += 1);
        return {
          bounds: {
            x: baseX + stepDirection * attachmentStep * layer,
            y: bounds.y,
            width: cardWidth,
            height: cardHeight,
          },
          sourceZIndex: -layer,
          rotationQuarterTurns: kind === 'tool' ? 1 : 0,
        };
      }
    );
    layouts[index] = {
      flexItemBounds: { x: containerX, y: bounds.y, width, height: cardHeight },
      cssomClientWidth,
      evolutionCards,
      attachmentCards,
    };
  }
  return layouts;
};

/**
 * Captures v1's width/15 evolution and width/6 Energy/Tool offsets. The base
 * bounds must come from a non-overflowing active/bench layout.
 */
export const layoutLegacyPlayStackHitRegions = (
  baseBounds: Rect,
  side: BoardSide,
  evolutionCount: number,
  attachmentCount: number
): readonly BoardPlayStackCardHitRegion[] => {
  for (const [label, count] of [
    ['Evolution', evolutionCount],
    ['Attachment', attachmentCount],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${label} count must be a non-negative integer`);
    }
  }
  if (evolutionCount === 0 && attachmentCount > 0) {
    throw new Error('Attachments require an evolution/base card');
  }
  const evolutionStep = baseBounds.width / 15;
  const attachmentStep = baseBounds.width / 6;
  const yDirection = side === 'local' ? -1 : 1;
  const xDirection = side === 'local' ? 1 : -1;
  const result: BoardPlayStackCardHitRegion[] = [];
  for (let index = 0; index < evolutionCount; index += 1) {
    result.push({
      role: 'evolution',
      index,
      bounds: {
        ...baseBounds,
        y: baseBounds.y + yDirection * evolutionStep * index,
      },
      semanticZOrder: index === 0 ? LEGACY_BOARD_Z_ORDER_V1.card : -index,
      affordances: LEGACY_BOARD_AFFORDANCES_V1.playStackCard,
    });
  }
  for (let index = 0; index < attachmentCount; index += 1) {
    const layer = index + 1;
    result.push({
      role: 'attachment',
      index,
      bounds: {
        ...baseBounds,
        x: baseBounds.x + xDirection * attachmentStep * layer,
      },
      semanticZOrder: -layer,
      affordances: LEGACY_BOARD_AFFORDANCES_V1.playStackCard,
    });
  }
  return result;
};
