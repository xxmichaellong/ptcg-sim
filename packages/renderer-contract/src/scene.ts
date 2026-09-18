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
  findBoardLayoutRegion,
  LEGACY_BOARD_RESIZER_V1,
  layoutLegacyActiveQ0Markers,
  layoutLegacyContainedCard,
  layoutLegacyPlayRow,
  layoutLegacyWorkAreaCards,
  layoutLegacyWorkAreaPanel,
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
  ZoneCountSceneNode,
  ZoneSceneNode,
} from './model.js';
import { topmostFirst } from './paint-order.js';

const isCountedZoneKind = (
  kind: MatchViewState['zones'][string]['kind']
): kind is ZoneCountSceneNode['kind'] =>
  kind === 'deck' ||
  kind === 'discard' ||
  kind === 'lostZone' ||
  kind === 'hand';

/**
 * v1 colours only the hand count, with the owning side's colour
 * (`#handText` in self-containers.css / opp-containers.css); the pile counts
 * inherit the container's default text colour.
 */
// v1 colours each frame's hand count by the frame's owner (#handText is blue
// in the self document and red in the opponent's), so it keeps its colour
// when the board is flipped.
const legacyCountColor = (
  kind: ZoneCountSceneNode['kind'],
  own: boolean
): string =>
  kind !== 'hand'
    ? '#000'
    : own
      ? 'rgba(90, 110, 188, 0.864)'
      : 'rgba(188, 90, 113, 0.864)';

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

/** Half-turn of a rectangle about the centre of its enclosing frame. */
const rotateRectInFrame = (bounds: Rect, frame: Rect): Rect => ({
  x: frame.x + frame.width - (bounds.x - frame.x) - bounds.width,
  y: frame.y + frame.height - (bounds.y - frame.y) - bounds.height,
  width: bounds.width,
  height: bounds.height,
});

/**
 * Transcribes v1's hand row (`#hand img` in self-containers.css): images are
 * `max-height: calc(100% - 3vh)` inside the content box, sit on
 * `margin-bottom: 2vh` with `.25vw` either side, and the flex row is centred
 * until it overflows. Both `vh` and `vw` resolve against the player container,
 * not the outer page, because each side is its own iframe. Where v1 then
 * scrolls, v2 keeps every card in view by compressing the step instead.
 *
 * v1 lets the image's natural aspect set the width; v2 uses the standard card
 * ratio so the row does not depend on which image happens to load.
 */
interface LegacyHandRowLayout {
  readonly cards: readonly Rect[];
  /** Present when the row is wider than the hand and scrolls, as in v1. */
  readonly scroll?: ZoneSceneNode['scroll'];
}

/**
 * v1 `#hand`: a flex row of full-size images (3vh shorter than the row,
 * resting 2vh above its bottom, .25vw side margins), centred while it fits
 * and otherwise `justify-content: flex-start` under `overflow-x: auto` --
 * the cards keep their size and the row scrolls. The scroll offset comes
 * from the renderer and is applied here so every hit test agrees with what
 * is painted. Physically the overflowing row starts at the frame's left on
 * both sides; the renderer's scroll container cannot reach negative space.
 */
const layoutLegacyHandRow = (
  contentBounds: Rect,
  frame: Rect,
  side: BoardSide,
  count: number,
  scrollOffsetPx: number
): LegacyHandRowLayout => {
  if (count === 0) return { cards: [] };
  const vh = frame.height / 100;
  const vw = frame.width / 100;
  const local =
    side === 'opponent'
      ? rotateRectInFrame(contentBounds, frame)
      : contentBounds;
  const height = Math.max(0, local.height - 3 * vh);
  const width = height * CARD_ASPECT_RATIO;
  const sideMargin = 0.25 * vw;
  const step = width + 2 * sideMargin;
  const rowWidth = step * count;
  const overflows = rowWidth > local.width;
  const y = local.y + local.height - 2 * vh - height;
  if (!overflows) {
    const startX = local.x + (local.width - rowWidth) / 2 + sideMargin;
    return {
      cards: Array.from({ length: count }, (_, index) => {
        const rect = { x: startX + step * index, y, width, height };
        return side === 'opponent' ? rotateRectInFrame(rect, frame) : rect;
      }),
    };
  }
  const offsetPx = Math.max(
    0,
    Math.min(rowWidth - contentBounds.width, scrollOffsetPx)
  );
  const physicalY =
    side === 'opponent'
      ? rotateRectInFrame({ x: local.x, y, width, height }, frame).y
      : y;
  const startX = contentBounds.x + sideMargin - offsetPx;
  return {
    cards: Array.from({ length: count }, (_, index) => ({
      x: startX + step * index,
      y: physicalY,
      width,
      height,
    })),
    scroll: { contentWidth: rowWidth, offsetPx },
  };
};

const layoutZoneCards = (
  kind: MatchViewState['zones'][string]['kind'],
  bounds: Rect,
  count: number,
  containedBlockAlignment: LegacyContainedCardBlockAlignment,
  owner: {
    readonly frame: Rect;
    readonly side: BoardSide;
    readonly scrollOffsetPx: number;
  } | null
): Rect[] => {
  switch (kind) {
    case 'hand':
      if (!owner) throw new Error('Hand zone must belong to a player');
      return [
        ...layoutLegacyHandRow(
          bounds,
          owner.frame,
          owner.side,
          count,
          owner.scrollOffsetPx
        ).cards,
      ];
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
    | 'renderKey'
    | 'rotationQuarterTurns'
  > & {
    readonly renderKey?: CardSceneNode['renderKey'];
    readonly rotationQuarterTurns?: CardSceneNode['rotationQuarterTurns'];
  }
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
    renderKey:
      input.renderKey === undefined
        ? `card:${String(card.id)}`
        : input.renderKey,
    rotationQuarterTurns,
  };
};

const addMarkers = (
  markers: MarkerSceneNode[],
  topCard: CardSceneNode,
  stack: MatchViewState['stacks'][string],
  presentation: 'legacyActiveQ0' | 'legacyBenchQ0'
): void => {
  // v1 places every counter from the host image's painted rectangle, which is
  // the rotated bounding box when the stack is quarter-turned.
  const painted = paintedCardBounds(topCard);
  const layout = layoutLegacyActiveQ0Markers(
    painted,
    topCard.side === 'opponent' ? 'opponent' : 'local'
  );
  const marker = (kind: MarkerSceneNode['kind'], value: string) => {
    const item = layout[kind];
    markers.push({
      // Marker identity follows the visible host card. This keeps ordinary
      // active/bench movement stable and mirrors legacy evolution: host damage
      // is recreated on the incoming top, while an incoming per-card ability
      // marker is reparented and retained as the new stack marker.
      id: `${topCard.id}:${kind}`,
      parentCardId: topCard.id,
      side: topCard.side,
      kind,
      presentation,
      value,
      bounds: copyRect(item.bounds),
      zIndex: topCard.zIndex + item.sourceZIndex,
      label: `${kind}: ${value}`,
    });
  };
  if (stack.damage !== null) marker('damage', String(stack.damage));
  if (stack.specialCondition !== null)
    marker('specialCondition', stack.specialCondition);
  if (stack.abilityUsed) marker('abilityUsed', 'used');
};

const paintedCardBounds = (card: CardSceneNode): Rect => {
  if (card.rotationQuarterTurns % 2 === 0) return copyRect(card.bounds);
  const centerX = card.bounds.x + card.bounds.width / 2;
  const centerY = card.bounds.y + card.bounds.height / 2;
  return {
    x: centerX - card.bounds.height / 2,
    y: centerY - card.bounds.width / 2,
    width: card.bounds.height,
    height: card.bounds.width,
  };
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
  // The seat the viewer plays from (a spectator watches from the first).
  const ownPlayerId =
    view.viewer.kind === 'player' ? view.viewer.playerId : view.playerOrder[0];
  const zones: ZoneSceneNode[] = [];
  const cards: CardSceneNode[] = [];
  const markers: MarkerSceneNode[] = [];
  const counts: ZoneCountSceneNode[] = [];
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
    // v1's hand scrolls when its full-size cards overflow the row; the
    // renderer's scroll offset shifts the cards here so paint and input agree.
    const handRow =
      zone.kind === 'hand' && zone.ownerId
        ? layoutLegacyHandRow(
            contentBounds,
            playerLayout(zone.ownerId).frameBounds,
            playerLayout(zone.ownerId).side,
            zone.cards.length,
            layout.handScrollPx[zone.ownerId] ?? 0
          )
        : null;
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
      ...(handRow?.scroll ? { scroll: handRow.scroll } : {}),
    });
    if (region?.countLabel && zone.ownerId && isCountedZoneKind(zone.kind)) {
      counts.push({
        id: `count:${zone.id}`,
        zoneId: zone.id,
        playerId: zone.ownerId,
        side: region.side,
        kind: zone.kind,
        count: zone.cards.length,
        anchor: { ...region.countLabel.anchor },
        horizontalAlign: region.countLabel.horizontalAlign,
        verticalAlign: region.countLabel.verticalAlign,
        fontSizePx: region.countLabel.fontSizePx,
        color: legacyCountColor(zone.kind, zone.ownerId === ownPlayerId),
        zIndex: 15,
        label: `${zone.cards.length} cards`,
      });
    }
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
    const cardBounds = handRow
      ? [...handRow.cards]
      : layoutZoneCards(
          zone.kind,
          contentBounds,
          zone.cards.length,
          containedBlockAlignment,
          zone.ownerId
            ? {
                frame: playerLayout(zone.ownerId).frameBounds,
                side: playerLayout(zone.ownerId).side,
                scrollOffsetPx: 0,
              }
            : null
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
          ...(isLegacyPileKind(zone.kind) && !isPileTop
            ? { renderKey: null }
            : {}),
          ...(zone.kind === 'deck' && isPileTop
            ? {
                // The deck cover is always a card back on the table (v1's
                // `#deckCover`), whatever the owner may know of the deck.
                tableImageUrl:
                  view.players[card.ownerId]?.cardBackUrl ??
                  (card.kind === 'concealed' ? card.cardBackUrl : ''),
              }
            : {}),
          ...(region?.surface === 'cover' && isPileTop
            ? {
                renderKey: `cover:${zone.id}`,
                primaryAction: {
                  kind: 'openZone' as const,
                  zoneId: zone.id,
                },
              }
            : {}),
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
    const slotRegions = {
      active: findBoardLayoutRegion(layout, side, 'active'),
      bench: findBoardLayoutRegion(layout, side, 'bench'),
    } as const;
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
    // Every in-play stack takes v1's play-container geometry: the active row
    // holds one container, the bench row centres and flex-shrinks its own.
    const rowStacks = {
      active: board.activeStackId ? [board.activeStackId] : [],
      bench: [...board.benchStackIds],
    } as const;
    for (const slot of ['active', 'bench'] as const) {
      const rowStackIds = rowStacks[slot];
      const rowLayout = layoutLegacyPlayRow(
        slotRegions[slot],
        CARD_ASPECT_RATIO,
        rowStackIds.map((stackId) => {
          const stack = view.stacks[stackId];
          if (!stack) {
            throw new Error(`Board references missing stack ${stackId}`);
          }
          if (stack.slot !== slot || stack.boardPlayerId !== playerId) {
            throw new Error(`Board slot disagrees with stack ${stackId}`);
          }
          return {
            evolutionCount: stack.evolutionCards.length,
            attachments: stack.attachmentCards.map((card) =>
              card.kind === 'known' && card.category === 'Trainer'
                ? 'tool'
                : 'energy'
            ),
            rotationQuarterTurns: stack.rotationQuarterTurns,
          };
        })
      );
      rowStackIds.forEach((stackId, rowIndex) => {
        const stack = view.stacks[stackId]!;
        const stackLayout = rowLayout[rowIndex]!;
        const evolutionNodes: CardSceneNode[] = [];
        stack.evolutionCards.forEach((card, index) => {
          const cardLayout = stackLayout.evolutionCards[index]!;
          const node = makeCardNode(view, card, {
            parentId: stack.id,
            side,
            role: 'stackEvolution',
            bounds: copyRect(cardLayout.bounds),
            zIndex: 300 + cardLayout.sourceZIndex,
            rotationQuarterTurns: ((stack.rotationQuarterTurns +
              (card.kind === 'known' ? card.orientationQuarterTurns : 0)) %
              4) as QuarterTurns,
            interactive: true,
          });
          // Canonical evolution cards cannot carry their own ability marker;
          // in-play annotations belong to the stack and are rendered once on
          // its visible top card. Suppressing malformed per-card state here
          // also prevents duplicate marker identities after an evolution
          // transfer.
          registerCard(node, card, false);
          evolutionNodes.push(node);
        });
        stack.attachmentCards.forEach((card, index) => {
          const cardLayout = stackLayout.attachmentCards[index]!;
          // v1 never rotates Energy/Tool images with their host; a Tool keeps
          // the quarter turn syncRotation gave it when it was attached.
          registerCard(
            makeCardNode(view, card, {
              parentId: stack.id,
              side,
              role: 'stackAttachment',
              bounds: copyRect(cardLayout.bounds),
              zIndex: 300 + cardLayout.sourceZIndex,
              rotationQuarterTurns: (((card.kind === 'known'
                ? card.orientationQuarterTurns
                : 0) +
                cardLayout.rotationQuarterTurns) %
                4) as QuarterTurns,
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
            slot === 'active' ? 'legacyActiveQ0' : 'legacyBenchQ0'
          );
        }
      });
    }
  }

  for (const [playerIdValue, workArea] of Object.entries(view.workAreas)) {
    const playerId = playerIdValue as PlayerId;
    const player = playerLayout(playerId);
    const side = player.side;
    // Both work areas present as v1's popup over the player's own frame; the
    // route paints that popup's chrome, so the cards are laid out exactly
    // where its inline images sit.
    const panel = layoutLegacyWorkAreaPanel(player.frameBounds, side);
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
        bounds: copyRect(panel.bounds),
        contentBounds: copyRect(panel.contentBounds),
        surface: 'zone',
        count: areaCards.length,
        zIndex: 900,
        label:
          kind === 'inspection'
            ? 'Cards being inspected'
            : 'Attached cards being moved',
        interactive: true,
      });
      const rects = layoutLegacyWorkAreaCards(
        panel,
        side,
        areaCards.length,
        CARD_ASPECT_RATIO
      );
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
    counts: counts.sort((left, right) => left.id.localeCompare(right.id)),
  };
};

export const hitTestBoardScene = (
  scene: BoardScene,
  x: number,
  y: number
): { readonly kind: 'card' | 'zone'; readonly id: string } | null => {
  const cards = topmostFirst(scene.cards);
  const card = cards.find(
    (node) =>
      node.interactive &&
      containsPointInRotatedRect(node.bounds, node.rotationQuarterTurns, x, y)
  );
  if (card) return { kind: 'card', id: card.id };
  const zones = topmostFirst(scene.zones);
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
  left.renderKey === right.renderKey &&
  left.primaryAction?.kind === right.primaryAction?.kind &&
  left.primaryAction?.zoneId === right.primaryAction?.zoneId &&
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
