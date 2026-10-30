import { plural, t } from '@lingui/core/macro';
import type {
  MatchViewState,
  PlayerId,
  QuarterTurns,
  ViewCard,
  ViewCardId,
} from '@ptcgsim/game-core';
import {
  resolveCardPresentation,
  sameCardPresentation,
} from '@ptcgsim/game-core';
import {
  composeCardArtwork,
  fitCardComposition,
  paintedCardBounds,
  turnCardComposition,
} from './card-composition.js';
import {
  CARD_ASPECT_RATIO,
  assertLayoutOptions,
  containsPoint,
  containsPointInRotatedRect,
} from './geometry.js';
import {
  createBoardLayoutSnapshot,
  findBoardLayoutRegion,
  LEGACY_BOARD_RESIZER_V1,
  LEGACY_BOARD_Z_ORDER_V1,
  layoutLegacyActiveQ0Markers,
  layoutLegacyContainedCard,
  layoutLegacyPlayRow,
  layoutLegacyWorkAreaCards,
  layoutLegacyWorkAreaPanel,
  layoutReminderMarkers,
  legacyPileTopIndex,
  type BoardLayoutRegion,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
  type LegacyContainedCardBlockAlignment,
  type LegacyPileKind,
} from './layout.js';
import {
  TABLE_LAYOUT_GEOMETRY_VERSION,
  layoutTableHand,
  layoutTablePile,
  layoutTablePrizes,
  layoutTableRow,
} from './layout-table.js';
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
import { ownSeatOf } from './seat-tone.js';
import { finishForCard } from './card-material.js';
import {
  layoutComposedPlayRow,
  type ComposedPlayRowInput,
} from './composed-play-row.js';

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

/**
 * A zone's name for assistive tech: whose it is and what it is ("Red
 * discard"). Worded when the scene is built, in the language of the moment;
 * the app rebuilds the scene when the language changes.
 */
const zoneLabel = (
  kind: MatchViewState['zones'][string]['kind'] | 'active' | 'bench',
  playerName: string | undefined
): string => {
  if (kind === 'stadium') return t({ message: 'Stadium', context: 'zone' });
  const name = playerName ?? t({ message: 'Player', context: 'unnamed seat' });
  switch (kind) {
    case 'deck':
      return t({
        message: `${name} deck`,
        comment: "A zone's name for screen readers; name is its player.",
      });
    case 'hand':
      return t({
        message: `${name} hand`,
        comment: "A zone's name for screen readers; name is its player.",
      });
    case 'prizes':
      return t({
        message: `${name} prizes`,
        comment:
          "A zone's name for screen readers; name is its player. The Prize cards.",
      });
    case 'discard':
      return t({
        message: `${name} discard`,
        comment:
          "A zone's name for screen readers; name is its player. The discard pile.",
      });
    case 'lostZone':
      return t({
        message: `${name} Lost Zone`,
        comment: "A zone's name for screen readers; name is its player.",
      });
    case 'board':
      return t({
        message: `${name} board`,
        comment:
          "A zone's name for screen readers; name is its player. The open play area.",
      });
    case 'active':
      return t({
        message: `${name} active`,
        comment:
          "A zone's name for screen readers; name is its player. The Active Spot.",
      });
    case 'bench':
      return t({
        message: `${name} bench`,
        comment:
          "A zone's name for screen readers; name is its player. The Bench.",
      });
  }
};

const cardLabel = (view: MatchViewState, card: ViewCard): string => {
  if (card.kind === 'concealed') return t`Face-down card`;
  const definition = view.definitions[card.definitionId];
  return definition?.name ?? t`Unknown card`;
};

/** A pile's count for assistive tech: "47 cards". */
const cardCountLabel = (count: number): string =>
  t`${plural(count, { one: '# card', other: '# cards' })}`;

/**
 * A count badge's tooltip: how many cards, and where. The viewer's own
 * places are "your"; the other seat's carry its player's name.
 */
const cardCountHint = (
  kind: ZoneCountSceneNode['kind'],
  count: number,
  playerName: string | undefined
): string => {
  if (playerName === undefined) {
    switch (kind) {
      case 'deck':
        return plural(count, {
          one: '# card in your deck',
          other: '# cards in your deck',
        });
      case 'discard':
        return plural(count, {
          one: '# card in your discard pile',
          other: '# cards in your discard pile',
        });
      case 'lostZone':
        return plural(count, {
          one: '# card in your Lost Zone',
          other: '# cards in your Lost Zone',
        });
      case 'hand':
        return plural(count, {
          one: '# card in your hand',
          other: '# cards in your hand',
        });
    }
  }
  const name = playerName;
  switch (kind) {
    case 'deck':
      return plural(count, {
        one: `# card in ${name}'s deck`,
        other: `# cards in ${name}'s deck`,
      });
    case 'discard':
      return plural(count, {
        one: `# card in ${name}'s discard pile`,
        other: `# cards in ${name}'s discard pile`,
      });
    case 'lostZone':
      return plural(count, {
        one: `# card in ${name}'s Lost Zone`,
        other: `# cards in ${name}'s Lost Zone`,
      });
    case 'hand':
      return plural(count, {
        one: `# card in ${name}'s hand`,
        other: `# cards in ${name}'s hand`,
      });
  }
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
  player: BoardLayoutSnapshot['players'][number],
  ownPlayerId: string | undefined
): BoardSceneLayout['players'][number] => ({
  playerId: player.playerId,
  side: player.side,
  tone: player.playerId === ownPlayerId ? 'local' : 'opponent',
  physicalSide: player.physicalSide,
  rotationQuarterTurns: player.rotationQuarterTurns,
  bounds: copyRect(player.frameBounds),
  ...(player.hidden ? { hidden: true as const } : {}),
});

const projectResizeHandle = (
  handle: BoardLayoutSnapshot['resizeHandles'][number]
): BoardSceneLayout['resizeHandles'][number] => ({
  id: handle.id,
  controlsPhysicalSide: handle.controlsPhysicalSide,
  bounds: copyRect(handle.bounds),
});

/**
 * The scene's layout. `ownPlayerId` is the viewer's own seat (ownSeatOf),
 * which decides each seat's colour; it defaults to the seat at the bottom,
 * right only while the board has not been turned around.
 */
export const createBoardSceneLayout = (
  snapshot: BoardLayoutSnapshot,
  ownPlayerId: string | undefined = snapshot.bottomPlayerId
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
    projectPlayerFrame(snapshot.players[0], ownPlayerId),
    projectPlayerFrame(snapshot.players[1], ownPlayerId),
  ],
  resizeHandles: [
    projectResizeHandle(snapshot.resizeHandles[0]),
    projectResizeHandle(snapshot.resizeHandles[1]),
  ],
  shared: {
    stadiumBounds: copyRect(snapshot.shared.stadium.physicalDeclaredBounds),
    boardControlsAnchor: { ...snapshot.shared.boardControlsAnchor },
  },
  ...(snapshot.farCardsUpright ? { farCardsUpright: true as const } : {}),
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

/**
 * v1's prize images are inline, so each line rests on the strut baseline and
 * leaves the font's descent below it. Measured at 4px for v1's 16px stack.
 */
const LEGACY_PRIZE_LINE_GAP_PX = 4;

/**
 * v1 `#prizes`: a plain block of inline images, two per line, each with
 * `margin-left: .1vw`, `max-width: calc(50% - .1vw)` and a `max-height` the
 * prize observer switches between 33% (up to six prizes) and 23% (above six).
 * Whichever constraint binds first sets the size; the aspect does the rest.
 * Beyond the box the lines simply overflow, as v1's block does.
 */
const layoutLegacyPrizeColumn = (
  contentBounds: Rect,
  frame: Rect,
  side: BoardSide,
  count: number
): Rect[] => {
  if (count === 0) return [];
  const vw = frame.width / 100;
  const local =
    side === 'opponent'
      ? rotateRectInFrame(contentBounds, frame)
      : contentBounds;
  const marginLeft = 0.1 * vw;
  const maxWidth = local.width / 2 - marginLeft;
  const maxHeight = local.height * (count <= 6 ? 0.33 : 0.23);
  const width = Math.max(0, Math.min(maxWidth, maxHeight * CARD_ASPECT_RATIO));
  const height = width / CARD_ASPECT_RATIO;
  const stepX = width + marginLeft;
  const stepY = height + LEGACY_PRIZE_LINE_GAP_PX;
  return Array.from({ length: count }, (_, index) => {
    const rect = {
      x: local.x + marginLeft + (index % 2) * stepX,
      y: local.y + Math.floor(index / 2) * stepY,
      width,
      height,
    };
    return side === 'opponent' ? rotateRectInFrame(rect, frame) : rect;
  });
};

/**
 * The viewer's choice to read the far player's cards the right way up
 * (BoardLayoutState.farCardsUpright). Every card on the far half, and a
 * Stadium its player put down, turns half round where it lies -- a joined
 * card's pieces about the card they make, so its art still reads across
 * them -- and the counters on a card turn with it. Where everything lies is
 * unchanged, and a card a player turned keeps that turn, now counted from
 * upright.
 */
const turnFarCardsToViewer = (
  cards: readonly CardSceneNode[],
  markers: readonly MarkerSceneNode[],
  bottomPlayerId: PlayerId
): {
  readonly cards: readonly CardSceneNode[];
  readonly markers: readonly MarkerSceneNode[];
} => {
  const turned = new Map<ViewCardId, CardSceneNode>();
  const faced = cards.map((card) => {
    const far =
      card.side === 'opponent' ||
      (card.side === 'shared' && card.ownerId !== bottomPlayerId);
    if (!far) return card;
    turned.set(card.id, card);
    return {
      ...card,
      rotationQuarterTurns: ((card.rotationQuarterTurns + 2) %
        4) as QuarterTurns,
      ...(card.composition
        ? { bounds: rotateRectInFrame(card.bounds, card.composition.bounds) }
        : {}),
    };
  });
  return {
    cards: faced,
    markers: markers.map((marker) => {
      const host = turned.get(marker.parentCardId);
      if (!host) return marker;
      return {
        ...marker,
        bounds: rotateRectInFrame(
          marker.bounds,
          host.composition?.bounds ?? host.bounds
        ),
      };
    }),
  };
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
 * not the outer page, because each side is its own iframe. Overflow keeps
 * card size stable and scrolls horizontally, matching v1.
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
    scroll: { axis: 'x', contentLength: rowWidth, offsetPx },
  };
};

/** v1 `#board img { height: 70% }`. */
const LEGACY_LOOSE_BOARD_HEIGHT_RATIO = 0.7;

/**
 * v1 `#board`: a wrapping flex row of images 70% of the content height tall
 * with `.25vw` margins, each line centred and its cards bottom-aligned, under
 * `overflow-y: auto`. Two lines never fit -- 70% twice is more than the box --
 * so a second line always scrolls, and `board-observer.js` scrolls to the
 * bottom whenever cards arrive. As with the hand, an overflowing region is
 * laid out in physical space, because the renderer's scroll container cannot
 * reach negative space.
 */
const layoutLegacyLooseBoardRows = (
  contentBounds: Rect,
  frame: Rect,
  side: BoardSide,
  count: number,
  scrollOffsetPx: number
): LegacyHandRowLayout => {
  if (count === 0) return { cards: [] };
  const vw = frame.width / 100;
  const local =
    side === 'opponent'
      ? rotateRectInFrame(contentBounds, frame)
      : contentBounds;
  const height = Math.max(0, local.height * LEGACY_LOOSE_BOARD_HEIGHT_RATIO);
  const width = height * CARD_ASPECT_RATIO;
  const margin = 0.25 * vw;
  const stepX = width + 2 * margin;
  const stepY = height + 2 * margin;
  const perRow = Math.max(1, Math.floor(local.width / Math.max(stepX, 1)));
  const rows = Math.ceil(count / perRow);
  const lineStart = (row: number): number => {
    const inRow = Math.min(perRow, count - row * perRow);
    return local.x + (local.width - inRow * stepX) / 2 + margin;
  };
  if (rows <= 1) {
    // One line stretches to the whole box and `align-items: flex-end` rests
    // its cards on the bottom.
    const y = local.y + local.height - margin - height;
    const startX = lineStart(0);
    return {
      cards: Array.from({ length: count }, (_, index) => {
        const rect = { x: startX + stepX * index, y, width, height };
        return side === 'opponent' ? rotateRectInFrame(rect, frame) : rect;
      }),
    };
  }
  const contentLength = rows * stepY;
  const offsetPx = Math.max(
    0,
    Math.min(contentLength - contentBounds.height, scrollOffsetPx)
  );
  return {
    cards: Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      return {
        x: contentBounds.x + (lineStart(row) - local.x) + stepX * column,
        y: contentBounds.y + row * stepY + margin - offsetPx,
        width,
        height,
      };
    }),
    scroll: { axis: 'y', contentLength, offsetPx },
  };
};

/** A play row's region as tall as `height`, centred where it was. */
const playRowAt = (
  region: BoardLayoutRegion,
  height: number
): BoardLayoutRegion => {
  const shrink = (rect: Rect): Rect => ({
    ...rect,
    y: rect.y + (rect.height - height) / 2,
    height,
  });
  return {
    ...region,
    physicalDeclaredBounds: shrink(region.physicalDeclaredBounds),
    physicalBorderBoxBounds: shrink(region.physicalBorderBoxBounds),
    physicalContentBoxBounds: shrink(region.physicalContentBoxBounds),
  };
};

/** How far a play row's cards reach across, at a card `height`. */
const playRowReach = (
  region: BoardLayoutRegion,
  stacks: readonly ComposedPlayRowInput[],
  height: number
): { readonly left: number; readonly right: number } => {
  let left = Infinity;
  let right = -Infinity;
  const row = layoutLegacyPlayRow(
    playRowAt(region, height),
    CARD_ASPECT_RATIO,
    stacks
  );
  for (const [index, stack] of row.entries()) {
    const input = stacks[index]!;
    for (const box of [
      stack.flexItemBounds,
      ...stack.evolutionCards.map((card, index) =>
        paintedCardBounds(
          card.bounds,
          input.rotationQuarterTurns + input.evolution[index]!.rotation
        )
      ),
      ...stack.attachmentCards.map((card, index) =>
        paintedCardBounds(
          card.bounds,
          card.rotationQuarterTurns + input.attachmentRotations[index]!
        )
      ),
    ]) {
      left = Math.min(left, box.x);
      right = Math.max(right, box.x + box.width);
    }
  }
  return { left, right };
};

/**
 * A play row whose cards would run past its zone (v1's containers shrink
 * no narrower than their card) stands them shorter, centred in the row, so
 * the whole row fits across: the tallest that does.
 */
const fitPlayRow = (
  region: BoardLayoutRegion,
  stacks: readonly ComposedPlayRowInput[]
): BoardLayoutRegion => {
  const bounds = region.physicalDeclaredBounds;
  const fits = (height: number): boolean => {
    const reach = playRowReach(region, stacks, height);
    return (
      reach.left >= bounds.x - 0.5 &&
      reach.right <= bounds.x + bounds.width + 0.5
    );
  };
  if (stacks.length === 0 || bounds.height <= 0 || fits(bounds.height)) {
    return region;
  }
  let low = 0;
  let high = bounds.height;
  for (let step = 0; step < 14; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return playRowAt(region, low);
};

/** Every zone whose cards are not laid out as a scrolling row. */
const layoutZoneCards = (
  kind: Exclude<MatchViewState['zones'][string]['kind'], 'hand' | 'board'>,
  bounds: Rect,
  count: number,
  containedBlockAlignment: LegacyContainedCardBlockAlignment,
  owner: { readonly frame: Rect; readonly side: BoardSide } | null
): Rect[] => {
  switch (kind) {
    case 'prizes':
      if (!owner) throw new Error('Prizes must belong to a player');
      return layoutLegacyPrizeColumn(bounds, owner.frame, owner.side, count);
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
    | 'decklistRank'
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
  const definition =
    card.kind === 'known' && !isConcealedForRendering(card)
      ? view.definitions[card.definitionId]
      : undefined;
  return {
    id: card.id,
    ownerId: card.ownerId,
    imageUrl: cardImageUrl(view, card),
    ...(definition
      ? {
          finish: finishForCard(definition),
          presentation: resolveCardPresentation(definition),
        }
      : {}),
    concealed: isConcealedForRendering(card),
    label: cardLabel(view, card),
    ...(card.kind === 'known' && card.decklistRank !== undefined
      ? { decklistRank: card.decklistRank }
      : {}),
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
  presentation: MarkerSceneNode['presentation']
): void => {
  // v1 places every counter from the host image's painted rectangle, which is
  // the rotated bounding box when the stack is quarter-turned.
  const painted = paintedCardBounds(
    topCard.bounds,
    topCard.rotationQuarterTurns
  );
  const layout = layoutLegacyActiveQ0Markers(
    painted,
    topCard.side === 'opponent' ? 'opponent' : 'local'
  );
  const marker = (
    kind: Exclude<MarkerSceneNode['kind'], 'reminder'>,
    value: string
  ) => {
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
  // Its reminders, each a chip of its own in a row.
  const reminders = stack.reminders ?? [];
  const chips = layoutReminderMarkers(
    painted,
    topCard.side === 'opponent' ? 'opponent' : 'local',
    reminders.length
  );
  reminders.forEach((reminder, index) => {
    markers.push({
      id: `${topCard.id}:reminder:${reminder}`,
      parentCardId: topCard.id,
      side: topCard.side,
      kind: 'reminder',
      presentation,
      value: reminder,
      bounds: copyRect(chips[index]!),
      zIndex: topCard.zIndex + LEGACY_BOARD_Z_ORDER_V1.marker,
      label: `reminder: ${reminder}`,
    });
  });
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
  reminder: 3,
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
  const ownPlayerId = ownSeatOf(view);
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
    if (zone.kind === 'stadium' && zone.cards.length > 4)
      throw new Error('Stadium supports at most four pieces');
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
    let bounds = region
      ? copyRect(region.physicalBorderBoxBounds)
      : copyRect(layout.shared.stadium.physicalDeclaredBounds);
    const stadiumArtwork =
      zone.kind === 'stadium'
        ? composeCardArtwork(
            zone.cards.map((card) => ({
              id: card.id,
              presentation:
                card.kind === 'known' && card.face === 'up'
                  ? resolveCardPresentation(
                      view.definitions[card.definitionId] ?? {}
                    )
                  : undefined,
            }))
          )
        : null;
    if (stadiumArtwork) {
      bounds = {
        ...bounds,
        width: Math.min(
          bounds.width * 2,
          layout.playAreaBounds.width - bounds.x - 12
        ),
      };
      if (layout.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION) {
        // Keep wider artwork in the corridor between the Actives and both
        // players' side piles, including the wider opponent prize container.
        // Only what sits level with the Stadium narrows it: a portrait
        // table's piles lie in a row further from the centre line.
        const regions = layout.players.flatMap((player) => player.regions);
        const level = (box: Rect): boolean =>
          box.y < bounds.y + bounds.height && box.y + box.height > bounds.y;
        const activeRight = Math.max(
          ...regions
            .filter((candidate) => candidate.kind === 'active')
            .map((candidate) => {
              const box = candidate.physicalDeclaredBounds;
              return box.x + box.width;
            })
        );
        const left = activeRight + 8;
        const right =
          Math.min(
            layout.playAreaBounds.x + layout.playAreaBounds.width,
            ...regions
              .filter(
                (candidate) =>
                  ['deck', 'discard', 'lostZone', 'prizes'].includes(
                    candidate.kind
                  ) &&
                  candidate.physicalDeclaredBounds.x >= activeRight &&
                  level(candidate.physicalDeclaredBounds)
              )
              .map((candidate) => candidate.physicalDeclaredBounds.x)
          ) - 8;
        const width = Math.max(1, Math.min(bounds.width, right - left));
        bounds = {
          ...bounds,
          x: left + Math.max(0, right - left - width) / 2,
          width,
        };
      }
    }
    const stadiumComposition = stadiumArtwork
      ? fitCardComposition(
          turnCardComposition(
            stadiumArtwork,
            zone.cards[0]?.ownerId === layout.bottomPlayerId ? 0 : 2
          ),
          bounds
        )
      : null;
    const multiStadium = zone.kind === 'stadium' && zone.cards.length > 1;
    const pile =
      isLegacyPileKind(zone.kind) && !stadiumComposition && !multiStadium;
    const contentBounds = region
      ? copyRect(region.physicalContentBoxBounds)
      : copyRect(bounds);
    // v1's hand scrolls sideways and its loose board downwards once the cards
    // overflow; the renderer's scroll offset shifts the cards here so paint
    // and input agree.
    const table = layout.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION;
    const scrollingRow =
      zone.ownerId && (zone.kind === 'hand' || zone.kind === 'board')
        ? table
          ? {
              cards:
                zone.kind === 'hand'
                  ? layoutTableHand(
                      contentBounds,
                      playerLayout(zone.ownerId).side,
                      zone.cards.length,
                      layout.playAreaBounds.x + layout.playAreaBounds.width / 2
                    )
                  : layoutTableRow(
                      contentBounds,
                      playerLayout(zone.ownerId).side,
                      zone.cards.length
                    ),
              scroll: undefined,
            }
          : (zone.kind === 'hand'
              ? layoutLegacyHandRow
              : layoutLegacyLooseBoardRows)(
              contentBounds,
              playerLayout(zone.ownerId).frameBounds,
              playerLayout(zone.ownerId).side,
              zone.cards.length,
              layout.zoneScrollPx[zone.id] ?? 0
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
      ...(scrollingRow?.scroll ? { scroll: scrollingRow.scroll } : {}),
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
        label: cardCountLabel(zone.cards.length),
        hint: cardCountHint(
          zone.kind,
          zone.cards.length,
          view.viewer.kind === 'player' && zone.ownerId === view.viewer.playerId
            ? undefined
            : (view.players[zone.ownerId]?.displayName ??
                t({ message: 'Player', context: 'unnamed seat' }))
        ),
      });
    }
    const pileTopIndex = pile
      ? legacyPileTopIndex(zone.kind as LegacyPileKind, zone.cards.length)
      : null;
    const containedBlockAlignment: LegacyContainedCardBlockAlignment =
      zone.kind === 'stadium'
        ? zone.cards[0]?.ownerId === layout.bottomPlayerId
          ? 'start'
          : 'end'
        : side === 'opponent'
          ? 'end'
          : 'start';
    const cardBounds = multiStadium
      ? layoutTableRow(contentBounds, 'local', zone.cards.length)
      : scrollingRow
        ? [...scrollingRow.cards]
        : table
          ? zone.kind === 'prizes'
            ? layoutTablePrizes(
                contentBounds,
                side === 'opponent' ? 'opponent' : 'local',
                zone.cards.length
              )
            : layoutTablePile(contentBounds, zone.cards.length)
          : layoutZoneCards(
              zone.kind as Exclude<typeof zone.kind, 'hand' | 'board'>,
              contentBounds,
              zone.cards.length,
              containedBlockAlignment,
              zone.ownerId
                ? {
                    frame: playerLayout(zone.ownerId).frameBounds,
                    side: playerLayout(zone.ownerId).side,
                  }
                : null
            );
    zone.cards.forEach((card, index) => {
      const assembled = stadiumComposition?.cards.find(
        (part) => part.id === card.id
      );
      const cardRect = assembled?.bounds ?? cardBounds[index];
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
          zIndex: pile ? pileZIndex : 100 + index,
          interactive: pile ? isPileTop : true,
          ...(stadiumComposition
            ? {
                composition: {
                  kind: stadiumComposition.kind,
                  bounds: stadiumComposition.bounds,
                },
              }
            : {}),
          // A scrolling zone clips what has scrolled out of it, as v1's
          // `overflow` does, instead of painting it over the board.
          ...(scrollingRow?.scroll ? { clipBounds: copyRect(bounds) } : {}),
          ...(pile && !isPileTop ? { renderKey: null } : {}),
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
                rotationQuarterTurns: (assembled
                  ? (assembled.rotationQuarterTurns +
                      (card.kind === 'known'
                        ? card.orientationQuarterTurns
                        : 0)) %
                    4
                  : stadiumRotation) as QuarterTurns,
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
        label: zoneLabel('active', view.players[playerId]?.displayName),
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
        label: zoneLabel('bench', view.players[playerId]?.displayName),
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
      const stackInputs = rowStackIds.map((stackId) => {
        const stack = view.stacks[stackId];
        if (!stack) {
          throw new Error(`Board references missing stack ${stackId}`);
        }
        if (stack.slot !== slot || stack.boardPlayerId !== playerId) {
          throw new Error(`Board slot disagrees with stack ${stackId}`);
        }
        return {
          evolutionCount: stack.evolutionCards.length,
          evolution: stack.evolutionCards.map((card) => ({
            id: card.id,
            presentation:
              card.kind === 'known' && card.face === 'up'
                ? resolveCardPresentation(
                    view.definitions[card.definitionId] ?? {}
                  )
                : undefined,
            rotation: card.kind === 'known' ? card.orientationQuarterTurns : 0,
          })),
          attachmentIds: stack.attachmentCards.map((card) => card.id),
          attachmentRotations: stack.attachmentCards.map((card) =>
            card.kind === 'known' ? card.orientationQuarterTurns : 0
          ),
          attachments: stack.attachmentCards.map((card) =>
            card.kind === 'known' && card.category === 'Trainer'
              ? ('tool' as const)
              : ('energy' as const)
          ),
          rotationQuarterTurns: stack.rotationQuarterTurns,
        };
      });
      // Composed rows already fit their painted silhouettes to the whole
      // region: don't shrink them first by their portrait pieces' widths.
      const composedRow = layoutComposedPlayRow(slotRegions[slot], stackInputs);
      // On the play-mat table a crowded row keeps every card in its zone (a
      // Bench of six to eight, Pokémon carrying Energy, an upright phone's
      // narrow row): its cards stand no taller than lets it fit across.
      const rowRegion =
        layout.geometryVersion === TABLE_LAYOUT_GEOMETRY_VERSION && !composedRow
          ? fitPlayRow(slotRegions[slot], stackInputs)
          : slotRegions[slot];
      const rowLayout = layoutLegacyPlayRow(
        rowRegion,
        CARD_ASPECT_RATIO,
        stackInputs
      );
      rowStackIds.forEach((stackId, rowIndex) => {
        const stack = view.stacks[stackId]!;
        const stackLayout = rowLayout[rowIndex]!;
        const composed = composedRow?.[rowIndex];
        const artwork = composeCardArtwork(stackInputs[rowIndex]!.evolution);
        const composition =
          artwork && composed
            ? { kind: artwork.kind, bounds: composed.mainBounds }
            : undefined;
        const composedCard = (id: string) =>
          composed?.cards.find((card) => card.id === id);
        const evolutionNodes: CardSceneNode[] = [];
        stack.evolutionCards.forEach((card, index) => {
          const cardLayout = stackLayout.evolutionCards[index]!;
          const placed = composedCard(card.id);
          const node = makeCardNode(view, card, {
            parentId: stack.id,
            side,
            role: 'stackEvolution',
            bounds: copyRect(placed?.bounds ?? cardLayout.bounds),
            zIndex: placed ? 300 + placed.layer : 300 + cardLayout.sourceZIndex,
            ...(composition ? { composition } : {}),
            rotationQuarterTurns: placed
              ? (((placed.rotationQuarterTurns +
                  (side === 'opponent' ? 2 : 0)) %
                  4) as QuarterTurns)
              : (((stack.rotationQuarterTurns +
                  (card.kind === 'known' ? card.orientationQuarterTurns : 0)) %
                  4) as QuarterTurns),
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
          const placed = composedCard(card.id);
          // v1 never rotates Energy/Tool images with their host; a Tool keeps
          // the quarter turn syncRotation gave it when it was attached.
          registerCard(
            makeCardNode(view, card, {
              parentId: stack.id,
              side,
              role: 'stackAttachment',
              bounds: copyRect(placed?.bounds ?? cardLayout.bounds),
              zIndex: placed
                ? 299 + placed.layer
                : 300 + cardLayout.sourceZIndex,
              ...(composition ? { composition } : {}),
              rotationQuarterTurns: placed
                ? (((placed.rotationQuarterTurns +
                    (side === 'opponent' ? 2 : 0)) %
                    4) as QuarterTurns)
                : ((((card.kind === 'known'
                    ? card.orientationQuarterTurns
                    : 0) +
                    cardLayout.rotationQuarterTurns) %
                    4) as QuarterTurns),
              interactive: true,
            }),
            card
          );
        });
        const topCard = evolutionNodes.at(-1);
        if (topCard) {
          addMarkers(
            markers,
            composition
              ? {
                  ...topCard,
                  bounds: composition.bounds,
                  rotationQuarterTurns: 0,
                }
              : topCard,
            stack,
            composition
              ? 'generic'
              : slot === 'active'
                ? 'legacyActiveQ0'
                : 'legacyBenchQ0'
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
            ? t`Cards being inspected`
            : t`Attached cards being moved`,
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

  // A half the viewer has hidden is not painted at all: its zones, cards,
  // markers and counts leave the scene, so no renderer, drop target or
  // motion plan ever sees them. The shared Stadium stays.
  const hiddenSides = new Set<BoardSide | 'shared'>(
    layout.players
      .filter((player) => player.hidden)
      .map((player) => player.side)
  );
  // An optional Lost Zone with nothing in it is not on the table at all;
  // the moment a card goes there it is. One the viewer put away is not
  // there even holding cards: its cards leave with it.
  const absentZoneIds = new Set<string>(
    layout.hideLostZone || layout.hideEmptyLostZone
      ? zones
          .filter(
            (zone) =>
              zone.kind === 'lostZone' &&
              (layout.hideLostZone || zone.count === 0)
          )
          .map((zone) => zone.id)
      : []
  );
  const shownCards = cards.filter(
    (card) => !hiddenSides.has(card.side) && !absentZoneIds.has(card.parentId)
  );
  const shownCardIds = new Set<ViewCardId>(shownCards.map((card) => card.id));
  const faced = layout.farCardsUpright
    ? turnFarCardsToViewer(shownCards, markers, layout.bottomPlayerId)
    : { cards: shownCards, markers };

  return {
    matchId: view.matchId,
    revision: view.revision,
    viewport,
    bottomPlayerId: layout.bottomPlayerId,
    layout: createBoardSceneLayout(layout, ownPlayerId),
    zones: zones
      .filter(
        (zone) => !hiddenSides.has(zone.side) && !absentZoneIds.has(zone.id)
      )
      .sort(
        (left, right) =>
          left.zIndex - right.zIndex || left.id.localeCompare(right.id)
      ),
    cards: [...faced.cards].sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.id.localeCompare(right.id)
    ),
    markers: faced.markers
      .filter((marker) => shownCardIds.has(marker.parentCardId))
      .sort(compareMarkerPaintOrder),
    counts: counts
      .filter(
        (count) =>
          !hiddenSides.has(count.side) && !absentZoneIds.has(count.zoneId)
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
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
  left.tableImageUrl === right.tableImageUrl &&
  left.imageFallbackUrl === right.imageFallbackUrl &&
  left.finish === right.finish &&
  sameCardPresentation(left.presentation, right.presentation) &&
  JSON.stringify(left.composition) === JSON.stringify(right.composition) &&
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
