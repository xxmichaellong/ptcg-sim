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
  insetRect,
} from './geometry.js';
import {
  createBoardLayoutSnapshot,
  findBoardLayoutRegion,
  LEGACY_BOARD_RESIZER_V1,
  layoutLegacyContainedCard,
  layoutLegacyOrdinaryEvolutionStack,
  layoutLegacySingleEnergyAttachmentStack,
  legacyPileTopIndex,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type LegacyContainedCardBlockAlignment,
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

const hasExactBounds = (actual: Rect, expected: Rect): boolean =>
  actual.x === expected.x &&
  actual.y === expected.y &&
  actual.width === expected.width &&
  actual.height === expected.height;

const isCharacterizedDefaultInPlayLayout = (
  view: MatchViewState,
  layout: BoardLayoutSnapshot
): boolean => {
  const firstPlayerId = view.playerOrder[0];
  const secondPlayerId = view.playerOrder[1];
  const local = layout.players.find((player) => player.side === 'local');
  const opponent = layout.players.find((player) => player.side === 'opponent');
  const lowerHandle = layout.resizeHandles.find(
    (handle) => handle.id === 'lower'
  );
  const upperHandle = layout.resizeHandles.find(
    (handle) => handle.id === 'upper'
  );
  return (
    firstPlayerId !== undefined &&
    secondPlayerId !== undefined &&
    layout.bottomPlayerId === firstPlayerId &&
    layout.shellMode === 'sidebar' &&
    layout.viewport.width === 1600 &&
    layout.viewport.height === 900 &&
    layout.viewport.devicePixelRatio === 1 &&
    hasExactBounds(layout.playAreaBounds, {
      x: 0,
      y: 0,
      width: 1208,
      height: 900,
    }) &&
    layout.shellGapBounds !== null &&
    hasExactBounds(layout.shellGapBounds, {
      x: 1208,
      y: 0,
      width: 8,
      height: 900,
    }) &&
    layout.sidebarBounds !== null &&
    hasExactBounds(layout.sidebarBounds, {
      x: 1216,
      y: 45,
      width: 384,
      height: 855,
    }) &&
    layout.tabsBounds !== null &&
    hasExactBounds(layout.tabsBounds, {
      x: 1216,
      y: 0,
      width: 384,
      height: 45,
    }) &&
    local !== undefined &&
    local.playerId === firstPlayerId &&
    local.physicalSide === 'lower' &&
    local.rotationQuarterTurns === 0 &&
    hasExactBounds(local.frameBounds, {
      x: 0,
      y: 450,
      width: 1208,
      height: 450,
    }) &&
    opponent !== undefined &&
    opponent.playerId === secondPlayerId &&
    opponent.physicalSide === 'upper' &&
    opponent.rotationQuarterTurns === 2 &&
    hasExactBounds(opponent.frameBounds, {
      x: 0,
      y: 0,
      width: 1208,
      height: 450,
    }) &&
    lowerHandle !== undefined &&
    lowerHandle.controlsPhysicalSide === 'lower' &&
    hasExactBounds(lowerHandle.bounds, {
      x: 1600 * -0.0055,
      y: 434.25,
      width: 20.8,
      height: 22.5,
    }) &&
    upperHandle !== undefined &&
    upperHandle.controlsPhysicalSide === 'upper' &&
    hasExactBounds(upperHandle.bounds, {
      x: 1600 * -0.0055,
      y: 900 * (1 - 0.53 - 0.025 / 2),
      width: 20.8,
      height: 22.5,
    }) &&
    hasExactBounds(layout.shared.stadium.physicalDeclaredBounds, {
      x: 176,
      y: 900 * (1 - 0.42 - 0.16),
      width: 96,
      height: 144,
    }) &&
    layout.shared.boardControlsAnchor.x === 832 &&
    layout.shared.boardControlsAnchor.y === 423 &&
    layout.shared.boardControlsAnchor.height === 54
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
  const base = stack.evolutionCards[0];
  const energy = stack.attachmentCards[0];
  const bounds = region.physicalDeclaredBounds;
  const expectedDeclaredBounds =
    side === 'local'
      ? {
          x: 0.34 * 1208,
          y: 450 + 0.07 * 450,
          width: 0.32 * 1208,
          height: 0.28 * 450,
        }
      : {
          x: (1 - 0.34 - 0.32) * 1208,
          y: (1 - 0.07 - 0.28) * 450,
          width: 0.32 * 1208,
          height: 0.28 * 450,
        };
  const expectedBoxBounds =
    side === 'local'
      ? expectedDeclaredBounds
      : {
          x: 1208 - 0.34 * 1208 - 0.32 * 1208,
          y: 450 - (450 - 0.65 * 450 - 0.28 * 450) - 0.28 * 450,
          width: 0.32 * 1208,
          height: 0.28 * 450,
        };
  const authoredWidth = (Math.round(bounds.height * CARD_ASPECT_RATIO) * 7) / 6;
  return (
    layoutIsCharacterized &&
    region.side === side &&
    region.id === `${side}:active` &&
    region.playerId === playerId &&
    region.physicalSide === (side === 'local' ? 'lower' : 'upper') &&
    region.surface === 'playSlot' &&
    region.kind === 'active' &&
    hasExactBounds(region.playerLocalNormalizedBounds, {
      x: 0.34,
      y: 0.07,
      width: 0.32,
      height: 0.28,
    }) &&
    hasExactBounds(bounds, expectedDeclaredBounds) &&
    hasExactBounds(region.physicalBorderBoxBounds, expectedBoxBounds) &&
    hasExactBounds(region.physicalContentBoxBounds, expectedBoxBounds) &&
    stack.slot === 'active' &&
    board.activeStackId === stack.id &&
    board.benchStackIds.length === 0 &&
    stack.boardPlayerId === playerId &&
    stack.evolutionCards.length === 1 &&
    stack.attachmentCards.length === 1 &&
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
    authoredWidth <= bounds.width &&
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
    energy.abilityUsed === false
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
  stack: MatchViewState['stacks'][string]
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
    markers.push({
      id: `${stack.id}:${kind}`,
      parentCardId: topCard.id,
      kind,
      value,
      bounds: {
        x: topCard.bounds.x + topCard.bounds.width - size,
        y: topCard.bounds.y + offset * size,
        width: size,
        height: size,
      },
      zIndex: topCard.zIndex + 100 + offset,
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
    kind: 'abilityUsed',
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
      const evolutionNodes: CardSceneNode[] = [];
      stack.evolutionCards.forEach((card, index) => {
        const ordinaryCardLayout = ordinaryEvolutionLayout?.cards[index];
        const singleEnergyBaseLayout =
          index === 0 ? singleEnergyAttachmentLayout?.base : undefined;
        const characterizedCardLayout =
          ordinaryCardLayout ?? singleEnergyBaseLayout;
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
        registerCard(
          makeCardNode(view, card, {
            parentId: stack.id,
            side,
            role: 'stackAttachment',
            bounds: singleEnergyLayout
              ? copyRect(singleEnergyLayout.bounds)
              : {
                  x: baseBounds.x + baseBounds.width * 0.42 + index * 8,
                  y: baseBounds.y + baseBounds.height * 0.18 + index * 5,
                  width: attachmentWidth,
                  height: attachmentWidth / CARD_ASPECT_RATIO,
                },
            zIndex: singleEnergyLayout
              ? 300 + singleEnergyLayout.sourceZIndex
              : 250 + index,
            interactive: true,
          }),
          card
        );
      });
      const topCard = evolutionNodes.at(-1);
      if (topCard) addMarkers(markers, topCard, stack);
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
    markers: markers.sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    ),
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
    (node) => node.interactive && containsPoint(node.bounds, x, y)
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
  return { addedCardIds, removedCardIds, updatedCardIds, unchangedCardIds };
};
