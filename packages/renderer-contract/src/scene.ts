import type {
  MatchViewState,
  PlayerId,
  QuarterTurns,
  ViewCard,
  ViewCardId,
} from '@ptcgsim/game-core';
import {
  CARD_ASPECT_RATIO,
  assertLayoutOptions,
  containsPoint,
  containsPointInRotatedRect,
  insetRect,
} from './geometry.js';
import {
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  findBoardLayoutRegion,
  LEGACY_BOARD_RESIZER_V1,
  layoutLegacyActiveQ0Markers,
  layoutLegacyBenchQ0Markers,
  layoutLegacyContainedCard,
  layoutLegacyOrdinaryEvolutionStack,
  layoutLegacyPlaySlotCards,
  layoutLegacySingleEnergyTrainerToolAttachmentStack,
  layoutLegacySingleEnergyAttachmentStack,
  layoutLegacySingleTrainerToolAttachmentStack,
  layoutLegacyTwoEnergyAttachmentStack,
  legacyPileTopIndex,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type BoxEdgesPx,
  type LegacyContainedCardBlockAlignment,
  type LegacyActiveQ0MarkerLayout,
  type LegacyPileKind,
} from './layout.js';
import type {
  BoardLayoutOptions,
  BoardSide,
  BoardScene,
  BoardSceneDiff,
  BoardSceneLayout,
  CardSceneNode,
  MarkerSceneNode,
  Rect,
  ZoneSceneNode,
} from './model.js';

const zoneLabel = (
  kind: MatchViewState['zones'][string]['kind'],
  playerName: string | undefined
): string =>
  kind === 'stadium' ? 'Stadium' : `${playerName ?? 'Player'} ${kind}`;

const cardLabel = (view: MatchViewState, card: ViewCard): string => {
  if (card.kind === 'concealed') return 'Face-down card';
  const definition = view.definitions[card.definitionId];
  return definition?.name ?? 'Unknown card';
};

const cardImageUrl = (view: MatchViewState, card: ViewCard): string => {
  if (card.kind === 'concealed') return card.cardBackUrl;
  if (card.face === 'down')
    return view.players[card.ownerId]?.cardBackUrl ?? '';
  const definition = view.definitions[card.definitionId];
  return definition?.imageUrlSmall ?? definition?.imageUrl ?? '';
};

const isConcealedForRendering = (card: ViewCard): boolean =>
  card.kind === 'concealed' || card.face === 'down';

const copyRect = (bounds: Rect): Rect => ({ ...bounds });

const projectPlayerFrame = (
  player: BoardLayoutSnapshot['players'][number]
): BoardSceneLayout['players'][number] => ({
  playerId: player.playerId,
  side: player.side,
  physicalSide: player.physicalSide,
  rotationQuarterTurns: player.rotationQuarterTurns,
  bounds: copyRect(player.frameBounds),
});

const projectResizeHandle = (
  handle: BoardLayoutSnapshot['resizeHandles'][number]
): BoardSceneLayout['resizeHandles'][number] => ({
  id: handle.id,
  controlsPhysicalSide: handle.controlsPhysicalSide,
  bounds: copyRect(handle.bounds),
});

export const createBoardSceneLayout = (
  snapshot: BoardLayoutSnapshot
): BoardSceneLayout => ({
  geometryVersion: snapshot.geometryVersion,
  outerViewport: { ...snapshot.viewport },
  shellMode: snapshot.shellMode,
  playAreaBounds: copyRect(snapshot.playAreaBounds),
  shellGapBounds: snapshot.shellGapBounds
    ? copyRect(snapshot.shellGapBounds)
    : null,
  sidebarBounds: snapshot.sidebarBounds
    ? copyRect(snapshot.sidebarBounds)
    : null,
  tabsBounds: snapshot.tabsBounds ? copyRect(snapshot.tabsBounds) : null,
  players: [
    projectPlayerFrame(snapshot.players[0]),
    projectPlayerFrame(snapshot.players[1]),
  ],
  resizeHandles: [
    projectResizeHandle(snapshot.resizeHandles[0]),
    projectResizeHandle(snapshot.resizeHandles[1]),
  ],
  shared: {
    stadiumBounds: copyRect(snapshot.shared.stadium.physicalDeclaredBounds),
    boardControlsAnchor: { ...snapshot.shared.boardControlsAnchor },
  },
});

/**
 * Convenience for renderer/controller tests that own a standalone full-screen
 * play-area viewport. Production route composition should pass its complete
 * source-characterized BoardLayoutSnapshot to createBoardScene instead.
 */
export const createBoardSceneForViewport = (
  view: MatchViewState,
  options: BoardLayoutOptions
): BoardScene => {
  assertLayoutOptions(options);
  const firstPlayer = view.playerOrder[0];
  const secondPlayer = view.playerOrder[1];
  if (!firstPlayer || !secondPlayer || view.playerOrder.length !== 2) {
    throw new Error('Board scene requires exactly two projected players');
  }
  const boundary = 1 - options.splitRatio;
  const layoutState: BoardLayoutState = {
    geometryVersion: options.geometryVersion,
    viewport: { ...options.viewport },
    playerIds: [firstPlayer, secondPlayer],
    bottomPlayerId: options.bottomPlayerId,
    shellMode: 'fullscreen',
    vertical: {
      lowerFrame: { bottomRatio: 0, heightRatio: boundary },
      upperFrame: {
        bottomRatio: boundary,
        heightRatio: options.splitRatio,
      },
      lowerHandle: {
        bottomRatio: boundary + 0.005,
        heightRatio: LEGACY_BOARD_RESIZER_V1.baseHeightRatio,
      },
      upperHandle: {
        bottomRatio: boundary + 0.03,
        heightRatio: LEGACY_BOARD_RESIZER_V1.baseHeightRatio,
      },
      sharedPlacement: 'cssDefault',
    },
  };
  return createBoardScene(view, createBoardLayoutSnapshot(layoutState));
};

const fitCard = (bounds: Rect, heightRatio = 0.92): Rect => {
  const height = bounds.height * heightRatio;
  const width = height * CARD_ASPECT_RATIO;
  const scale = Math.min(1, bounds.width / width);
  const finalWidth = width * scale;
  const finalHeight = height * scale;
  return {
    x: bounds.x + (bounds.width - finalWidth) / 2,
    y: bounds.y + bounds.height - finalHeight,
    width: finalWidth,
    height: finalHeight,
  };
};

const layoutRow = (
  bounds: Rect,
  count: number,
  maxHeightRatio: number
): Rect[] => {
  if (count === 0) return [];
  const card = fitCard(bounds, maxHeightRatio);
  const gap = Math.min(bounds.width * 0.005, 6);
  const step = Math.min(
    card.width + gap,
    (bounds.width - card.width) / Math.max(1, count - 1)
  );
  const rowWidth = card.width + step * (count - 1);
  const startX = bounds.x + Math.max(0, (bounds.width - rowWidth) / 2);
  return Array.from({ length: count }, (_, index) => ({
    ...card,
    x: startX + step * index,
  }));
};

const layoutPrizeGrid = (bounds: Rect, count: number): Rect[] => {
  if (count === 0) return [];
  const rows = Math.max(3, Math.ceil(count / 2));
  const cellWidth = bounds.width / 2;
  const cellHeight = bounds.height / rows;
  return Array.from({ length: count }, (_, index) => {
    const cell: Rect = {
      x: bounds.x + (index % 2) * cellWidth,
      y: bounds.y + Math.floor(index / 2) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    };
    return fitCard(cell, 0.96);
  });
};

const layoutBoardGrid = (bounds: Rect, count: number): Rect[] => {
  if (count === 0) return [];
  const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(count * 1.5))));
  const rows = Math.ceil(count / columns);
  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;
  return Array.from({ length: count }, (_, index) =>
    fitCard(
      {
        x: bounds.x + (index % columns) * cellWidth,
        y: bounds.y + Math.floor(index / columns) * cellHeight,
        width: cellWidth,
        height: cellHeight,
      },
      0.9
    )
  );
};

const layoutZoneCards = (
  kind: MatchViewState['zones'][string]['kind'],
  bounds: Rect,
  count: number,
  containedBlockAlignment: LegacyContainedCardBlockAlignment = 'start'
): Rect[] => {
  switch (kind) {
    case 'hand':
      return layoutRow(insetRect(bounds, 2), count, 0.84);
    case 'prizes':
      return layoutPrizeGrid(insetRect(bounds, 3), count);
    case 'board':
      return layoutBoardGrid(insetRect(bounds, 5), count);
    case 'stadium':
    case 'deck':
    case 'discard':
    case 'lostZone': {
      const top = layoutLegacyContainedCard(
        bounds,
        CARD_ASPECT_RATIO,
        containedBlockAlignment
      );
      return Array.from({ length: count }, () => top);
    }
  }
};

const isLegacyPileKind = (
  kind: MatchViewState['zones'][string]['kind']
): kind is LegacyPileKind =>
  kind === 'deck' ||
  kind === 'discard' ||
  kind === 'lostZone' ||
  kind === 'stadium';

/**
 * A play slot is authored with no padding or border, so its declared, border,
 * and content boxes describe the same rectangle. Asserting that through the
 * edges is exact; comparing the rectangles is not, because the physical boxes
 * reach the same value by different floating-point paths on the rotated side.
 */
const hasNoBoxEdges = (region: {
  readonly physicalPaddingPx: BoxEdgesPx;
  readonly physicalBorderPx: BoxEdgesPx;
}): boolean =>
  (['top', 'right', 'bottom', 'left'] as const).every(
    (edge) =>
      region.physicalPaddingPx[edge] === 0 &&
      region.physicalBorderPx[edge] === 0
  );

const hasExactBounds = (actual: Rect, expected: Rect): boolean =>
  actual.x === expected.x &&
  actual.y === expected.y &&
  actual.width === expected.width &&
  actual.height === expected.height;

/**
 * The canonical default-split layout for a viewport, memoized because the gate
 * below runs on every scene build. Computing it through the same function the
 * caller used makes the comparison exact rather than tolerance-based. Keep
 * only the latest value: viewport dimensions can change continuously while a
 * resize handle is dragged, so an unbounded per-dimension map would leak.
 */
let canonicalDefaultLayoutCache:
  | {
      readonly geometryVersion: BoardLayoutSnapshot['geometryVersion'];
      readonly viewportWidth: number;
      readonly viewportHeight: number;
      readonly devicePixelRatio: number;
      readonly firstPlayerId: PlayerId;
      readonly secondPlayerId: PlayerId;
      readonly snapshot: BoardLayoutSnapshot;
    }
  | undefined;

const canonicalDefaultLayoutFor = (
  layout: BoardLayoutSnapshot,
  firstPlayerId: PlayerId,
  secondPlayerId: PlayerId
): BoardLayoutSnapshot => {
  const cached = canonicalDefaultLayoutCache;
  if (
    cached?.geometryVersion === layout.geometryVersion &&
    cached.viewportWidth === layout.viewport.width &&
    cached.viewportHeight === layout.viewport.height &&
    cached.devicePixelRatio === layout.viewport.devicePixelRatio &&
    cached.firstPlayerId === firstPlayerId &&
    cached.secondPlayerId === secondPlayerId
  ) {
    return cached.snapshot;
  }
  const canonical = createBoardLayoutSnapshot({
    geometryVersion: layout.geometryVersion,
    viewport: layout.viewport,
    playerIds: [firstPlayerId, secondPlayerId],
    bottomPlayerId: firstPlayerId,
    shellMode: 'sidebar',
    vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  });
  canonicalDefaultLayoutCache = {
    geometryVersion: layout.geometryVersion,
    viewportWidth: layout.viewport.width,
    viewportHeight: layout.viewport.height,
    devicePixelRatio: layout.viewport.devicePixelRatio,
    firstPlayerId,
    secondPlayerId,
    snapshot: canonical,
  };
  return canonical;
};

/**
 * Preconditions the characterized layout helpers assume: two ordered players,
 * the sidebar shell, and the default vertical split.
 *
 * This deliberately does *not* pin a viewport size. Every rectangle is derived
 * from authored ratios, and `tests/browser/legacy-viewport-generalization.spec.ts`
 * measures the checked-in legacy stylesheets in Chromium at 1280x720, 1600x900,
 * and 1920x1080 and holds the model to them. Re-asserting one viewport's pixels
 * here only restricted parity to a single window size.
 *
 * The vertical split, shared placement and handle positions stay pinned because
 * no browser gate varies them yet (legacy applies them as inline styles from
 * its resize handler), not because they are known to break. Extend the browser
 * gate before relaxing them.
 *
 * `devicePixelRatio` is no longer pinned. The model performs no
 * devicePixelRatio-dependent arithmetic, and
 * `tests/browser/legacy-cssom-rounding.spec.ts` measures the whole-CSS-pixel
 * client-width rounding against the real legacy stack at integer and fractional
 * scales, which was the one place device-pixel snapping could have changed the
 * result.
 */
const isCharacterizedDefaultInPlayLayout = (
  view: MatchViewState,
  layout: BoardLayoutSnapshot
): boolean => {
  const firstPlayerId = view.playerOrder[0];
  const secondPlayerId = view.playerOrder[1];
  if (firstPlayerId === undefined || secondPlayerId === undefined) return false;
  if (
    layout.bottomPlayerId !== firstPlayerId ||
    layout.shellMode !== 'sidebar' ||
    !Number.isFinite(layout.viewport.devicePixelRatio) ||
    layout.viewport.devicePixelRatio <= 0 ||
    layout.viewport.width <= 0 ||
    layout.viewport.height <= 0 ||
    layout.shellGapBounds === null ||
    layout.sidebarBounds === null ||
    layout.tabsBounds === null
  ) {
    return false;
  }

  const canonical = canonicalDefaultLayoutFor(
    layout,
    firstPlayerId,
    secondPlayerId
  );
  if (
    !canonical.shellGapBounds ||
    !canonical.sidebarBounds ||
    !canonical.tabsBounds ||
    !hasExactBounds(layout.playAreaBounds, canonical.playAreaBounds) ||
    !hasExactBounds(layout.shellGapBounds, canonical.shellGapBounds) ||
    !hasExactBounds(layout.sidebarBounds, canonical.sidebarBounds) ||
    !hasExactBounds(layout.tabsBounds, canonical.tabsBounds) ||
    !hasExactBounds(
      layout.shared.stadium.physicalDeclaredBounds,
      canonical.shared.stadium.physicalDeclaredBounds
    ) ||
    layout.shared.boardControlsAnchor.x !==
      canonical.shared.boardControlsAnchor.x ||
    layout.shared.boardControlsAnchor.y !==
      canonical.shared.boardControlsAnchor.y ||
    layout.shared.boardControlsAnchor.height !==
      canonical.shared.boardControlsAnchor.height
  ) {
    return false;
  }

  for (const side of ['local', 'opponent'] as const) {
    const player = layout.players.find((candidate) => candidate.side === side);
    const expected = canonical.players.find(
      (candidate) => candidate.side === side
    );
    if (!player || !expected) return false;
    if (
      player.playerId !== (side === 'local' ? firstPlayerId : secondPlayerId) ||
      player.physicalSide !== (side === 'local' ? 'lower' : 'upper') ||
      player.rotationQuarterTurns !== (side === 'local' ? 0 : 2) ||
      !hasExactBounds(player.frameBounds, expected.frameBounds)
    ) {
      return false;
    }
  }

  for (const handleId of ['lower', 'upper'] as const) {
    const handle = layout.resizeHandles.find(
      (candidate) => candidate.id === handleId
    );
    const expected = canonical.resizeHandles.find(
      (candidate) => candidate.id === handleId
    );
    if (!handle || !expected) return false;
    if (
      handle.controlsPhysicalSide !== handleId ||
      !hasExactBounds(handle.bounds, expected.bounds)
    ) {
      return false;
    }
  }

  // Every region must be the one the canonical layout derives, so a supplied
  // snapshot cannot present a legacy-shaped board with a shifted region. The
  // per-stack predicates below then only restate which region they need.
  for (const side of ['local', 'opponent'] as const) {
    const player = layout.players.find((candidate) => candidate.side === side);
    const expected = canonical.players.find(
      (candidate) => candidate.side === side
    );
    if (!player || !expected) return false;
    if (player.regions.length !== expected.regions.length) return false;
    for (const expectedRegion of expected.regions) {
      const region = player.regions.find(
        (candidate) => candidate.kind === expectedRegion.kind
      );
      if (!region) return false;
      if (
        region.surface !== expectedRegion.surface ||
        region.physicalSide !== expectedRegion.physicalSide ||
        !hasExactBounds(
          region.playerLocalNormalizedBounds,
          expectedRegion.playerLocalNormalizedBounds
        ) ||
        !hasExactBounds(
          region.physicalDeclaredBounds,
          expectedRegion.physicalDeclaredBounds
        ) ||
        !hasExactBounds(
          region.physicalBorderBoxBounds,
          expectedRegion.physicalBorderBoxBounds
        ) ||
        !hasExactBounds(
          region.physicalContentBoxBounds,
          expectedRegion.physicalContentBoxBounds
        )
      ) {
        return false;
      }
    }
  }

  return true;
};

const isCharacterizedActiveAttachmentStructure = (
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean,
  attachmentCount: 1 | 2
): boolean => {
  const base = stack.evolutionCards[0];
  const attachments = stack.attachmentCards;
  const bounds = region.physicalDeclaredBounds;
  const authoredWidth = (Math.round(bounds.height * CARD_ASPECT_RATIO) * 7) / 6;
  return (
    layoutIsCharacterized &&
    region.side === side &&
    region.id === `${side}:active` &&
    region.playerId === playerId &&
    region.physicalSide === (side === 'local' ? 'lower' : 'upper') &&
    region.surface === 'playSlot' &&
    region.kind === 'active' &&
    // The authored normalized rectangle identifies the legacy active slot. Its
    // physical rectangles follow from the ratios, which the browser viewport
    // gate holds to real legacy CSS at several window sizes.
    hasExactBounds(region.playerLocalNormalizedBounds, {
      x: 0.34,
      y: 0.07,
      width: 0.32,
      height: 0.28,
    }) &&
    hasNoBoxEdges(region) &&
    stack.slot === 'active' &&
    board.activeStackId === stack.id &&
    board.benchStackIds.length === 0 &&
    stack.boardPlayerId === playerId &&
    stack.evolutionCards.length === 1 &&
    attachments.length === attachmentCount &&
    stack.rotationQuarterTurns === 0 &&
    stack.damage === null &&
    stack.specialCondition === null &&
    stack.abilityUsed === false &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    Number.isFinite(authoredWidth) &&
    authoredWidth > 0 &&
    base?.kind === 'known' &&
    base.ownerId === playerId &&
    base.category === 'Pokémon' &&
    base.face === 'up' &&
    base.orientationQuarterTurns === 0 &&
    base.abilityUsed === false &&
    attachments.every(
      (attachment) =>
        attachment.kind === 'known' &&
        attachment.ownerId === playerId &&
        attachment.face === 'up' &&
        attachment.orientationQuarterTurns === 0 &&
        attachment.abilityUsed === false
    )
  );
};

const isCharacterizedSingleEnergyAttachmentStack = (
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  const energy = stack.attachmentCards[0];
  const bounds = region.physicalDeclaredBounds;
  const authoredWidth = (Math.round(bounds.height * CARD_ASPECT_RATIO) * 7) / 6;
  return (
    isCharacterizedActiveAttachmentStructure(
      stack,
      board,
      playerId,
      side,
      region,
      layoutIsCharacterized,
      1
    ) &&
    authoredWidth <= bounds.width &&
    energy?.kind === 'known' &&
    energy.category === 'Energy'
  );
};

const isCharacterizedTwoEnergyAttachmentStack = (
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  const bounds = region.physicalDeclaredBounds;
  const baseCssomClientWidth = Math.round(bounds.height * CARD_ASPECT_RATIO);
  const authoredWidth = baseCssomClientWidth + (2 * baseCssomClientWidth) / 6;
  return (
    isCharacterizedActiveAttachmentStructure(
      stack,
      board,
      playerId,
      side,
      region,
      layoutIsCharacterized,
      2
    ) &&
    authoredWidth <= bounds.width &&
    stack.attachmentCards.every(
      (attachment) =>
        attachment.kind === 'known' && attachment.category === 'Energy'
    )
  );
};

const isCharacterizedSingleTrainerToolAttachmentStack = (
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  // Legacy persists no separate Tool category/history: current-category
  // Trainer is the only recipient-safe discriminator and matches syncRotation.
  const tool = stack.attachmentCards[0];
  const bounds = region.physicalDeclaredBounds;
  const authoredWidth = (Math.round(bounds.height * CARD_ASPECT_RATIO) * 7) / 6;
  const marginRight = bounds.width * 0.02;
  return (
    isCharacterizedActiveAttachmentStructure(
      stack,
      board,
      playerId,
      side,
      region,
      layoutIsCharacterized,
      1
    ) &&
    Number.isFinite(marginRight) &&
    marginRight >= 0 &&
    authoredWidth + marginRight <= bounds.width &&
    tool?.kind === 'known' &&
    tool.category === 'Trainer'
  );
};

const isCharacterizedMixedStackControl = (
  stack: MatchViewState['stacks'][string] | undefined,
  stackId: string,
  playerId: PlayerId,
  slot: 'active' | 'bench'
): boolean => {
  const base = stack?.evolutionCards[0];
  return (
    stack !== undefined &&
    stack.id === stackId &&
    stack.boardPlayerId === playerId &&
    stack.slot === slot &&
    stack.evolutionCards.length === 1 &&
    stack.attachmentCards.length === 0 &&
    stack.rotationQuarterTurns === 0 &&
    stack.damage === null &&
    stack.specialCondition === null &&
    stack.abilityUsed === false &&
    base?.kind === 'known' &&
    base.ownerId === playerId &&
    base.category === 'Pokémon' &&
    base.face === 'up' &&
    base.orientationQuarterTurns === 0 &&
    base.abilityUsed === false
  );
};

const isCharacterizedMixedStackRegion = (
  playerId: PlayerId,
  side: BoardSide,
  slot: 'active' | 'bench',
  region: BoardLayoutSnapshot['players'][number]['regions'][number]
): boolean => {
  const normalized =
    slot === 'active'
      ? { x: 0.34, y: 0.07, width: 0.32, height: 0.28 }
      : { x: 0.1, y: 0.4, width: 0.79, height: 0.25 };
  const bounds = region.physicalDeclaredBounds;
  return (
    region.side === side &&
    region.id === `${side}:${slot}` &&
    region.playerId === playerId &&
    region.physicalSide === (side === 'local' ? 'lower' : 'upper') &&
    region.surface === 'playSlot' &&
    region.kind === slot &&
    // As above: pin the authored ratios, not one viewport's pixels.
    hasExactBounds(region.playerLocalNormalizedBounds, normalized) &&
    hasNoBoxEdges(region) &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
};

const isCharacterizedSingleEnergyTrainerToolAttachmentStack = (
  view: MatchViewState,
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  const base = stack.evolutionCards[0];
  const energy = stack.attachmentCards[0];
  const tool = stack.attachmentCards[1];
  const bounds = region.physicalDeclaredBounds;
  const baseCssomClientWidth = Math.round(bounds.height * CARD_ASPECT_RATIO);
  const authoredWidth = baseCssomClientWidth * (1 + 2 / 6);
  const marginRight = bounds.width * 0.02;
  const placementIsCharacterized =
    stack.slot === 'active'
      ? board.activeStackId === stack.id &&
        (board.benchStackIds.length === 0 ||
          (board.benchStackIds.length === 1 &&
            isCharacterizedMixedStackControl(
              view.stacks[board.benchStackIds[0]!],
              board.benchStackIds[0]!,
              playerId,
              'bench'
            )))
      : board.benchStackIds.length === 1 &&
        board.benchStackIds[0] === stack.id &&
        board.activeStackId !== null &&
        isCharacterizedMixedStackControl(
          view.stacks[board.activeStackId],
          board.activeStackId,
          playerId,
          'active'
        );
  return (
    layoutIsCharacterized &&
    placementIsCharacterized &&
    isCharacterizedMixedStackRegion(playerId, side, stack.slot, region) &&
    stack.boardPlayerId === playerId &&
    stack.evolutionCards.length === 1 &&
    stack.attachmentCards.length === 2 &&
    stack.rotationQuarterTurns === 0 &&
    stack.damage === null &&
    stack.specialCondition === null &&
    stack.abilityUsed === false &&
    Number.isFinite(authoredWidth) &&
    authoredWidth > 0 &&
    Number.isFinite(marginRight) &&
    marginRight >= 0 &&
    authoredWidth + marginRight <= bounds.width &&
    base?.kind === 'known' &&
    base.ownerId === playerId &&
    base.category === 'Pokémon' &&
    base.face === 'up' &&
    base.orientationQuarterTurns === 0 &&
    base.abilityUsed === false &&
    energy?.kind === 'known' &&
    energy.ownerId === playerId &&
    energy.category === 'Energy' &&
    energy.face === 'up' &&
    energy.orientationQuarterTurns === 0 &&
    energy.abilityUsed === false &&
    tool?.kind === 'known' &&
    tool.ownerId === playerId &&
    tool.category === 'Trainer' &&
    tool.face === 'up' &&
    tool.orientationQuarterTurns === 0 &&
    tool.abilityUsed === false
  );
};

const isCharacterizedPristineActiveQ0MarkerStack = (
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  const base = stack.evolutionCards[0];
  return (
    layoutIsCharacterized &&
    isCharacterizedMixedStackRegion(playerId, side, 'active', region) &&
    stack.id === board.activeStackId &&
    stack.boardPlayerId === playerId &&
    stack.slot === 'active' &&
    board.benchStackIds.length === 0 &&
    stack.evolutionCards.length === 1 &&
    stack.attachmentCards.length === 0 &&
    stack.rotationQuarterTurns === 0 &&
    (stack.damage !== null ||
      stack.specialCondition !== null ||
      stack.abilityUsed) &&
    base?.kind === 'known' &&
    base.ownerId === playerId &&
    base.category === 'Pokémon' &&
    base.face === 'up' &&
    base.orientationQuarterTurns === 0 &&
    base.abilityUsed === false
  );
};

const isCharacterizedCanonicalBenchQ0Stack = (
  view: MatchViewState,
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  side: BoardSide,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  const base = stack.evolutionCards[0];
  return (
    layoutIsCharacterized &&
    isCharacterizedMixedStackRegion(playerId, side, 'bench', region) &&
    board.activeStackId !== null &&
    isCharacterizedMixedStackControl(
      view.stacks[board.activeStackId],
      board.activeStackId,
      playerId,
      'active'
    ) &&
    board.benchStackIds.length === 1 &&
    board.benchStackIds[0] === stack.id &&
    stack.boardPlayerId === playerId &&
    stack.slot === 'bench' &&
    stack.evolutionCards.length === 1 &&
    stack.attachmentCards.length === 0 &&
    stack.rotationQuarterTurns === 0 &&
    stack.specialCondition === null &&
    base?.kind === 'known' &&
    base.ownerId === playerId &&
    base.category === 'Pokémon' &&
    base.face === 'up' &&
    base.orientationQuarterTurns === 0 &&
    base.abilityUsed === false
  );
};

const isCharacterizedOrdinaryEvolutionStack = (
  stack: MatchViewState['stacks'][string],
  board: MatchViewState['boards'][string],
  playerId: PlayerId,
  region: BoardLayoutSnapshot['players'][number]['regions'][number],
  layoutIsCharacterized: boolean
): boolean => {
  const isOnlyStackInSlot =
    stack.slot === 'active'
      ? board.activeStackId === stack.id
      : board.benchStackIds.length === 1 && board.benchStackIds[0] === stack.id;
  const bounds = region.physicalDeclaredBounds;
  const flexOuterWidth =
    Math.round(bounds.height * CARD_ASPECT_RATIO) +
    (region.kind === 'bench' ? bounds.width * 0.01 : 0);
  return (
    layoutIsCharacterized &&
    isOnlyStackInSlot &&
    stack.boardPlayerId === playerId &&
    stack.evolutionCards.length === 3 &&
    stack.attachmentCards.length === 0 &&
    stack.rotationQuarterTurns === 0 &&
    stack.damage === null &&
    stack.specialCondition === null &&
    stack.abilityUsed === false &&
    flexOuterWidth <= bounds.width &&
    stack.evolutionCards.every(
      (card) =>
        card.kind === 'known' &&
        card.ownerId === playerId &&
        card.category === 'Pokémon' &&
        card.face === 'up' &&
        card.orientationQuarterTurns === 0 &&
        card.abilityUsed === false
    )
  );
};

const makeCardNode = (
  view: MatchViewState,
  card: ViewCard,
  input: Omit<
    CardSceneNode,
    | 'id'
    | 'ownerId'
    | 'imageUrl'
    | 'concealed'
    | 'label'
    | 'rotationQuarterTurns'
  > & { readonly rotationQuarterTurns?: CardSceneNode['rotationQuarterTurns'] }
): CardSceneNode => {
  const baseRotation =
    input.rotationQuarterTurns ??
    (card.kind === 'known' ? card.orientationQuarterTurns : 0);
  const rotationQuarterTurns = ((baseRotation +
    (input.side === 'opponent' ? 2 : 0)) %
    4) as QuarterTurns;
  return {
    id: card.id,
    ownerId: card.ownerId,
    imageUrl: cardImageUrl(view, card),
    concealed: isConcealedForRendering(card),
    label: cardLabel(view, card),
    ...input,
    rotationQuarterTurns,
  };
};

const addMarkers = (
  markers: MarkerSceneNode[],
  topCard: CardSceneNode,
  stack: MatchViewState['stacks'][string],
  characterizedLayout: {
    readonly presentation: Exclude<MarkerSceneNode['presentation'], 'generic'>;
    readonly markers: Partial<
      Record<MarkerSceneNode['kind'], LegacyActiveQ0MarkerLayout['damage']>
    >;
  } | null = null
): void => {
  const size = Math.max(
    14,
    Math.min(topCard.bounds.width, topCard.bounds.height) * 0.22
  );
  const marker = (
    kind: MarkerSceneNode['kind'],
    value: string,
    offset: number
  ) => {
    const characterized = characterizedLayout?.markers[kind];
    markers.push({
      id: `${stack.id}:${kind}`,
      parentCardId: topCard.id,
      side: topCard.side,
      kind,
      presentation: characterized
        ? characterizedLayout.presentation
        : 'generic',
      value,
      bounds: characterized
        ? copyRect(characterized.bounds)
        : {
            x: topCard.bounds.x + topCard.bounds.width - size,
            y: topCard.bounds.y + offset * size,
            width: size,
            height: size,
          },
      zIndex: characterized
        ? topCard.zIndex + characterized.sourceZIndex
        : topCard.zIndex + 100 + offset,
      label: `${kind}: ${value}`,
    });
  };
  if (stack.damage !== null) marker('damage', String(stack.damage), 0);
  if (stack.specialCondition !== null)
    marker('specialCondition', stack.specialCondition, 1);
  if (stack.abilityUsed) marker('abilityUsed', 'used', 2);
};

const addCardAbilityMarker = (
  markers: MarkerSceneNode[],
  node: CardSceneNode
): void => {
  const size = Math.max(
    14,
    Math.min(node.bounds.width, node.bounds.height) * 0.22
  );
  markers.push({
    id: `${node.id}:abilityUsed`,
    parentCardId: node.id,
    side: node.side,
    kind: 'abilityUsed',
    presentation: 'generic',
    value: 'used',
    bounds: {
      x: node.bounds.x + node.bounds.width - size,
      y: node.bounds.y,
      width: size,
      height: size,
    },
    zIndex: node.zIndex + 100,
    label: 'abilityUsed: used',
  });
};

// Legacy appends equal-z markers in this order; renderers consume scene order
// back-to-front. Presentation and parent keys make the comparison a global
// total order before applying that per-parent rank, including for prefix-shaped
// opaque aliases. Generic markers retain their prior ID order.
const MARKER_PAINT_ORDER: Readonly<Record<MarkerSceneNode['kind'], number>> = {
  damage: 0,
  specialCondition: 1,
  abilityUsed: 2,
};

const MARKER_PRESENTATION_ORDER: Readonly<
  Record<MarkerSceneNode['presentation'], number>
> = {
  generic: 0,
  legacyActiveQ0: 1,
  legacyBenchQ0: 2,
};

const compareMarkerPaintOrder = (
  left: MarkerSceneNode,
  right: MarkerSceneNode
): number => {
  const zOrder = left.zIndex - right.zIndex;
  if (zOrder !== 0) return zOrder;

  const presentationOrder =
    MARKER_PRESENTATION_ORDER[left.presentation] -
    MARKER_PRESENTATION_ORDER[right.presentation];
  if (presentationOrder !== 0) return presentationOrder;
  if (left.presentation === 'generic') return left.id.localeCompare(right.id);

  const parentOrder = left.parentCardId.localeCompare(right.parentCardId);
  if (parentOrder !== 0) return parentOrder;
  return (
    MARKER_PAINT_ORDER[left.kind] - MARKER_PAINT_ORDER[right.kind] ||
    left.id.localeCompare(right.id)
  );
};

export const createBoardScene = (
  view: MatchViewState,
  layout: BoardLayoutSnapshot
): BoardScene => {
  const projectedPlayers = new Set(view.playerOrder);
  if (
    view.playerOrder.length !== 2 ||
    layout.players.length !== 2 ||
    layout.players.some((player) => !projectedPlayers.has(player.playerId)) ||
    view.playerOrder.some(
      (playerId) =>
        !layout.players.some((player) => player.playerId === playerId)
    )
  ) {
    throw new Error(
      'Board layout players must exactly match the projected match'
    );
  }
  const viewport = {
    width: layout.playAreaBounds.width,
    height: layout.playAreaBounds.height,
    devicePixelRatio: layout.viewport.devicePixelRatio,
  };
  const defaultInPlayLayoutIsCharacterized = isCharacterizedDefaultInPlayLayout(
    view,
    layout
  );
  const zones: ZoneSceneNode[] = [];
  const cards: CardSceneNode[] = [];
  const markers: MarkerSceneNode[] = [];
  const seenCards = new Set<ViewCardId>();
  const registerCard = (
    node: CardSceneNode,
    card: ViewCard,
    showAbilityMarker = true
  ) => {
    if (!projectedPlayers.has(card.ownerId)) {
      throw new Error(
        `Projected card owner is not a board player: ${card.ownerId}`
      );
    }
    if (seenCards.has(node.id)) {
      throw new Error(`Projected card appears more than once: ${node.id}`);
    }
    seenCards.add(node.id);
    cards.push(node);
    if (showAbilityMarker && card.kind === 'known' && card.abilityUsed) {
      addCardAbilityMarker(markers, node);
    }
  };

  const playerLayout = (playerId: PlayerId) => {
    const player = layout.players.find(
      (candidate) => candidate.playerId === playerId
    );
    if (!player) throw new Error(`Missing board layout player ${playerId}`);
    return player;
  };

  for (const zone of Object.values(view.zones)) {
    let region = null;
    if (zone.ownerId) {
      if (zone.kind === 'stadium') {
        throw new Error('Stadium zone must be shared');
      }
      region = findBoardLayoutRegion(
        layout,
        playerLayout(zone.ownerId).side,
        zone.kind
      );
    } else if (zone.kind !== 'stadium') {
      throw new Error(`${zone.kind} zone must belong to a player`);
    }
    const side = region?.side ?? 'shared';
    const bounds = region
      ? copyRect(region.physicalBorderBoxBounds)
      : copyRect(layout.shared.stadium.physicalDeclaredBounds);
    const contentBounds = region
      ? copyRect(region.physicalContentBoxBounds)
      : copyRect(bounds);
    zones.push({
      id: zone.id,
      playerId: zone.ownerId,
      side,
      kind: zone.kind,
      bounds,
      contentBounds,
      surface: region?.surface ?? 'zone',
      count: zone.cards.length,
      zIndex: zone.kind === 'stadium' ? 30 : 10,
      label: zoneLabel(
        zone.kind,
        zone.ownerId ? view.players[zone.ownerId]?.displayName : undefined
      ),
      interactive: true,
    });
    const pileTopIndex = isLegacyPileKind(zone.kind)
      ? legacyPileTopIndex(zone.kind, zone.cards.length)
      : null;
    const containedBlockAlignment: LegacyContainedCardBlockAlignment =
      zone.kind === 'stadium'
        ? zone.cards[0]?.ownerId === layout.bottomPlayerId
          ? 'start'
          : 'end'
        : side === 'opponent'
          ? 'end'
          : 'start';
    const cardBounds = layoutZoneCards(
      zone.kind,
      contentBounds,
      zone.cards.length,
      containedBlockAlignment
    );
    zone.cards.forEach((card, index) => {
      const cardRect = cardBounds[index];
      if (!cardRect) return;
      const isPileTop = pileTopIndex === index;
      const pileZIndex =
        zone.kind === 'deck' ? 100 + zone.cards.length - index : 100 + index;
      const stadiumRotation =
        zone.kind === 'stadium'
          ? ((card.kind === 'known' ? card.orientationQuarterTurns : 0) +
              (card.ownerId === layout.bottomPlayerId ? 0 : 2)) %
            4
          : undefined;
      registerCard(
        makeCardNode(view, card, {
          parentId: zone.id,
          side,
          role: 'zone',
          bounds: cardRect,
          zIndex: isLegacyPileKind(zone.kind) ? pileZIndex : 100 + index,
          interactive: isLegacyPileKind(zone.kind) ? isPileTop : true,
          ...(stadiumRotation === undefined
            ? {}
            : {
                rotationQuarterTurns: stadiumRotation as QuarterTurns,
              }),
        }),
        card,
        zone.kind !== 'deck' &&
          zone.kind !== 'discard' &&
          zone.kind !== 'lostZone'
      );
    });
  }

  for (const [playerIdValue, board] of Object.entries(view.boards)) {
    const playerId = playerIdValue as PlayerId;
    const player = playerLayout(playerId);
    const side = player.side;
    const stackIds = [board.activeStackId, ...board.benchStackIds].filter(
      (id): id is string => id !== null
    );
    const slotRegions = {
      active: findBoardLayoutRegion(layout, side, 'active'),
      bench: findBoardLayoutRegion(layout, side, 'bench'),
    } as const;
    const slotBounds = {
      active: copyRect(slotRegions.active.physicalContentBoxBounds),
      bench: copyRect(slotRegions.bench.physicalContentBoxBounds),
    } as const;
    const activeRects = layoutRow(
      slotBounds.active,
      board.activeStackId ? 1 : 0,
      1
    );
    const benchRects = layoutRow(
      slotBounds.bench,
      board.benchStackIds.length,
      1
    );
    zones.push(
      {
        id: `slot:${playerId}:active`,
        playerId,
        side,
        kind: 'active',
        bounds: copyRect(slotRegions.active.physicalBorderBoxBounds),
        contentBounds: copyRect(slotRegions.active.physicalContentBoxBounds),
        surface: slotRegions.active.surface,
        count: board.activeStackId ? 1 : 0,
        zIndex: 20,
        label: `${view.players[playerId]?.displayName ?? 'Player'} active`,
        interactive: true,
      },
      {
        id: `slot:${playerId}:bench`,
        playerId,
        side,
        kind: 'bench',
        bounds: copyRect(slotRegions.bench.physicalBorderBoxBounds),
        contentBounds: copyRect(slotRegions.bench.physicalContentBoxBounds),
        surface: slotRegions.bench.surface,
        count: board.benchStackIds.length,
        zIndex: 20,
        label: `${view.players[playerId]?.displayName ?? 'Player'} bench`,
        interactive: true,
      }
    );
    for (const stackId of stackIds) {
      const stack = view.stacks[stackId];
      if (!stack) throw new Error(`Board references missing stack ${stackId}`);
      const slotIndex =
        stack.slot === 'active' ? 0 : board.benchStackIds.indexOf(stackId);
      const baseBounds =
        stack.slot === 'active' ? activeRects[0] : benchRects[slotIndex];
      if (!baseBounds) throw new Error(`No layout slot for stack ${stackId}`);
      const evolutionOffset = Math.min(10, baseBounds.height * 0.035);
      const singleEnergyAttachmentLayout =
        isCharacterizedSingleEnergyAttachmentStack(
          stack,
          board,
          playerId,
          side,
          slotRegions[stack.slot],
          defaultInPlayLayoutIsCharacterized
        )
          ? layoutLegacySingleEnergyAttachmentStack(
              slotRegions[stack.slot],
              CARD_ASPECT_RATIO
            )
          : null;
      const twoEnergyAttachmentLayout = isCharacterizedTwoEnergyAttachmentStack(
        stack,
        board,
        playerId,
        side,
        slotRegions[stack.slot],
        defaultInPlayLayoutIsCharacterized
      )
        ? layoutLegacyTwoEnergyAttachmentStack(
            slotRegions[stack.slot],
            CARD_ASPECT_RATIO
          )
        : null;
      const singleTrainerToolAttachmentLayout =
        isCharacterizedSingleTrainerToolAttachmentStack(
          stack,
          board,
          playerId,
          side,
          slotRegions[stack.slot],
          defaultInPlayLayoutIsCharacterized
        )
          ? layoutLegacySingleTrainerToolAttachmentStack(
              slotRegions[stack.slot],
              CARD_ASPECT_RATIO
            )
          : null;
      const singleEnergyTrainerToolAttachmentLayout =
        isCharacterizedSingleEnergyTrainerToolAttachmentStack(
          view,
          stack,
          board,
          playerId,
          side,
          slotRegions[stack.slot],
          defaultInPlayLayoutIsCharacterized
        )
          ? layoutLegacySingleEnergyTrainerToolAttachmentStack(
              slotRegions[stack.slot],
              CARD_ASPECT_RATIO
            )
          : null;
      const ordinaryEvolutionLayout = isCharacterizedOrdinaryEvolutionStack(
        stack,
        board,
        playerId,
        slotRegions[stack.slot],
        defaultInPlayLayoutIsCharacterized
      )
        ? layoutLegacyOrdinaryEvolutionStack(
            slotRegions[stack.slot],
            CARD_ASPECT_RATIO,
            3
          )
        : null;
      const activeQ0MarkerStackIsCharacterized =
        isCharacterizedPristineActiveQ0MarkerStack(
          stack,
          board,
          playerId,
          side,
          slotRegions[stack.slot],
          defaultInPlayLayoutIsCharacterized
        );
      const benchQ0StackIsCharacterized = isCharacterizedCanonicalBenchQ0Stack(
        view,
        stack,
        board,
        playerId,
        side,
        slotRegions[stack.slot],
        defaultInPlayLayoutIsCharacterized
      );
      // The play-slot helper returns null when the authored row would
      // flex-shrink. Both the card box and its markers then fall back to the
      // generic path together, so legacy marker formulas are never applied to
      // generic card bounds.
      const legacyQ0MarkerCardBounds =
        activeQ0MarkerStackIsCharacterized || benchQ0StackIsCharacterized
          ? (layoutLegacyPlaySlotCards(slotRegions[stack.slot], [
              CARD_ASPECT_RATIO,
            ])?.[0] ?? null)
          : null;
      const usesLegacyActiveQ0Markers =
        activeQ0MarkerStackIsCharacterized && legacyQ0MarkerCardBounds !== null;
      const usesLegacyBenchQ0Layout =
        benchQ0StackIsCharacterized && legacyQ0MarkerCardBounds !== null;
      const legacyQ0MarkerCardLayout = legacyQ0MarkerCardBounds
        ? { bounds: legacyQ0MarkerCardBounds, sourceZIndex: 0 }
        : null;
      const evolutionNodes: CardSceneNode[] = [];
      stack.evolutionCards.forEach((card, index) => {
        const ordinaryCardLayout = ordinaryEvolutionLayout?.cards[index];
        const singleEnergyBaseLayout =
          index === 0 ? singleEnergyAttachmentLayout?.base : undefined;
        const twoEnergyBaseLayout =
          index === 0 ? twoEnergyAttachmentLayout?.base : undefined;
        const singleTrainerToolBaseLayout =
          index === 0 ? singleTrainerToolAttachmentLayout?.base : undefined;
        const singleEnergyTrainerToolBaseLayout =
          index === 0
            ? singleEnergyTrainerToolAttachmentLayout?.base
            : undefined;
        const characterizedCardLayout =
          ordinaryCardLayout ??
          singleEnergyBaseLayout ??
          twoEnergyBaseLayout ??
          singleTrainerToolBaseLayout ??
          singleEnergyTrainerToolBaseLayout ??
          (index === 0 ? legacyQ0MarkerCardLayout : null);
        const node = makeCardNode(view, card, {
          parentId: stack.id,
          side,
          role: 'stackEvolution',
          bounds: characterizedCardLayout
            ? copyRect(characterizedCardLayout.bounds)
            : {
                ...baseBounds,
                y:
                  baseBounds.y -
                  evolutionOffset * (stack.evolutionCards.length - index - 1),
              },
          zIndex: characterizedCardLayout
            ? 300 + characterizedCardLayout.sourceZIndex
            : 300 + index,
          rotationQuarterTurns: ((stack.rotationQuarterTurns +
            (card.kind === 'known' ? card.orientationQuarterTurns : 0)) %
            4) as 0 | 1 | 2 | 3,
          interactive: true,
        });
        registerCard(node, card);
        evolutionNodes.push(node);
      });
      const attachmentWidth = baseBounds.width * 0.7;
      stack.attachmentCards.forEach((card, index) => {
        const singleEnergyLayout =
          index === 0 ? singleEnergyAttachmentLayout?.energy : undefined;
        const twoEnergyLayout = twoEnergyAttachmentLayout?.energies[index];
        const singleTrainerToolLayout =
          index === 0 ? singleTrainerToolAttachmentLayout?.tool : undefined;
        const singleEnergyTrainerToolLayout =
          index === 0
            ? singleEnergyTrainerToolAttachmentLayout?.energy
            : index === 1
              ? singleEnergyTrainerToolAttachmentLayout?.tool
              : undefined;
        const characterizedAttachmentLayout =
          singleEnergyLayout ??
          twoEnergyLayout ??
          singleTrainerToolLayout ??
          singleEnergyTrainerToolLayout;
        registerCard(
          makeCardNode(view, card, {
            parentId: stack.id,
            side,
            role: 'stackAttachment',
            bounds: characterizedAttachmentLayout
              ? copyRect(characterizedAttachmentLayout.bounds)
              : {
                  x: baseBounds.x + baseBounds.width * 0.42 + index * 8,
                  y: baseBounds.y + baseBounds.height * 0.18 + index * 5,
                  width: attachmentWidth,
                  height: attachmentWidth / CARD_ASPECT_RATIO,
                },
            zIndex: characterizedAttachmentLayout
              ? 300 + characterizedAttachmentLayout.sourceZIndex
              : 250 + index,
            rotationQuarterTurns:
              singleTrainerToolLayout ||
              (singleEnergyTrainerToolAttachmentLayout !== null && index === 1)
                ? 1
                : undefined,
            interactive: true,
          }),
          card
        );
      });
      const topCard = evolutionNodes.at(-1);
      if (topCard) {
        addMarkers(
          markers,
          topCard,
          stack,
          usesLegacyActiveQ0Markers
            ? {
                presentation: 'legacyActiveQ0',
                markers: layoutLegacyActiveQ0Markers(topCard.bounds, side),
              }
            : usesLegacyBenchQ0Layout
              ? {
                  presentation: 'legacyBenchQ0',
                  markers: layoutLegacyBenchQ0Markers(topCard.bounds, side),
                }
              : null
        );
      }
    }
  }

  const workAreaBounds: Rect = {
    x: viewport.width * 0.2,
    y: viewport.height * 0.2,
    width: viewport.width * 0.6,
    height: viewport.height * 0.6,
  };
  for (const [playerIdValue, workArea] of Object.entries(view.workAreas)) {
    const playerId = playerIdValue as PlayerId;
    const side = playerLayout(playerId).side;
    for (const [kind, area] of [
      ['inspection', workArea.inspection],
      ['attachmentResolution', workArea.attachmentResolution],
    ] as const) {
      if (!area) continue;
      const areaCards =
        kind === 'inspection'
          ? area.cards
          : [...area.evolutionCards, ...area.attachmentCards];
      zones.push({
        id: area.id,
        playerId,
        side,
        kind,
        bounds: workAreaBounds,
        contentBounds: copyRect(workAreaBounds),
        surface: 'zone',
        count: areaCards.length,
        zIndex: 900,
        label:
          kind === 'inspection'
            ? 'Cards being inspected'
            : 'Attached cards being moved',
        interactive: true,
      });
      const rects = layoutRow(workAreaBounds, areaCards.length, 0.55);
      areaCards.forEach((card, index) => {
        const bounds = rects[index];
        if (!bounds) return;
        registerCard(
          makeCardNode(view, card, {
            parentId: area.id,
            side,
            role: kind,
            bounds,
            zIndex: 1000 + index,
            interactive: true,
          }),
          card
        );
      });
    }
  }

  return {
    matchId: view.matchId,
    revision: view.revision,
    viewport,
    bottomPlayerId: layout.bottomPlayerId,
    layout: createBoardSceneLayout(layout),
    zones: zones.sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    ),
    cards: cards.sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    ),
    markers: markers.sort(compareMarkerPaintOrder),
  };
};

export const hitTestBoardScene = (
  scene: BoardScene,
  x: number,
  y: number
): { readonly kind: 'card' | 'zone'; readonly id: string } | null => {
  const cards = [...scene.cards].sort(
    (left, right) => right.zIndex - left.zIndex
  );
  const card = cards.find(
    (node) =>
      node.interactive &&
      containsPointInRotatedRect(node.bounds, node.rotationQuarterTurns, x, y)
  );
  if (card) return { kind: 'card', id: card.id };
  const zones = [...scene.zones].sort(
    (left, right) => right.zIndex - left.zIndex
  );
  const zone = zones.find(
    (node) => node.interactive && containsPoint(node.bounds, x, y)
  );
  return zone ? { kind: 'zone', id: zone.id } : null;
};

const sameCard = (left: CardSceneNode, right: CardSceneNode): boolean =>
  left.parentId === right.parentId &&
  left.side === right.side &&
  left.role === right.role &&
  left.zIndex === right.zIndex &&
  left.rotationQuarterTurns === right.rotationQuarterTurns &&
  left.imageUrl === right.imageUrl &&
  left.concealed === right.concealed &&
  left.label === right.label &&
  left.interactive === right.interactive &&
  left.bounds.x === right.bounds.x &&
  left.bounds.y === right.bounds.y &&
  left.bounds.width === right.bounds.width &&
  left.bounds.height === right.bounds.height;

const sameMarker = (left: MarkerSceneNode, right: MarkerSceneNode): boolean =>
  left.parentCardId === right.parentCardId &&
  left.side === right.side &&
  left.kind === right.kind &&
  left.presentation === right.presentation &&
  left.value === right.value &&
  left.zIndex === right.zIndex &&
  left.label === right.label &&
  left.bounds.x === right.bounds.x &&
  left.bounds.y === right.bounds.y &&
  left.bounds.width === right.bounds.width &&
  left.bounds.height === right.bounds.height;

export const diffBoardScenes = (
  previous: BoardScene,
  next: BoardScene
): BoardSceneDiff => {
  const previousById = new Map(previous.cards.map((card) => [card.id, card]));
  const nextById = new Map(next.cards.map((card) => [card.id, card]));
  const addedCardIds: ViewCardId[] = [];
  const removedCardIds: ViewCardId[] = [];
  const updatedCardIds: ViewCardId[] = [];
  const unchangedCardIds: ViewCardId[] = [];
  for (const [id, card] of nextById) {
    const previousCard = previousById.get(id);
    if (!previousCard) addedCardIds.push(id);
    else if (sameCard(previousCard, card)) unchangedCardIds.push(id);
    else updatedCardIds.push(id);
  }
  for (const id of previousById.keys()) {
    if (!nextById.has(id)) removedCardIds.push(id);
  }
  const previousMarkersById = new Map(
    previous.markers.map((marker) => [marker.id, marker])
  );
  const nextMarkersById = new Map(
    next.markers.map((marker) => [marker.id, marker])
  );
  const addedMarkerIds: string[] = [];
  const removedMarkerIds: string[] = [];
  const updatedMarkerIds: string[] = [];
  const unchangedMarkerIds: string[] = [];
  for (const [id, marker] of nextMarkersById) {
    const previousMarker = previousMarkersById.get(id);
    if (!previousMarker) addedMarkerIds.push(id);
    else if (sameMarker(previousMarker, marker)) unchangedMarkerIds.push(id);
    else updatedMarkerIds.push(id);
  }
  for (const id of previousMarkersById.keys()) {
    if (!nextMarkersById.has(id)) removedMarkerIds.push(id);
  }
  return {
    addedCardIds,
    removedCardIds,
    updatedCardIds,
    unchangedCardIds,
    addedMarkerIds,
    removedMarkerIds,
    updatedMarkerIds,
    unchangedMarkerIds,
  };
};
