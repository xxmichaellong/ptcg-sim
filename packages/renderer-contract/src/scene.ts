import type {
  MatchViewState,
  PlayerId,
  QuarterTurns,
  ViewCard,
  ViewCardId,
} from '@ptcgsim/game-core';
import {
  CARD_ASPECT_RATIO,
  containsPoint,
  insetRect,
  layoutPlayerZone,
  layoutStadium,
  sideForPlayer,
  type PlayerZoneGeometryKind,
} from './geometry.js';
import type {
  BoardLayoutOptions,
  BoardScene,
  BoardSceneDiff,
  BoardSide,
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
  count: number
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
      const top = fitCard(insetRect(bounds, 1), 1);
      return Array.from({ length: count }, () => top);
    }
  }
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

export const createBoardScene = (
  view: MatchViewState,
  options: BoardLayoutOptions
): BoardScene => {
  if (!view.playerOrder.includes(options.bottomPlayerId)) {
    throw new Error('Bottom player must exist in the projected match');
  }
  const zones: ZoneSceneNode[] = [];
  const cards: CardSceneNode[] = [];
  const markers: MarkerSceneNode[] = [];
  const seenCards = new Set<ViewCardId>();
  const registerCard = (card: CardSceneNode) => {
    if (seenCards.has(card.id)) {
      throw new Error(`Projected card appears more than once: ${card.id}`);
    }
    seenCards.add(card.id);
    cards.push(card);
  };

  for (const zone of Object.values(view.zones)) {
    const side = zone.ownerId
      ? sideForPlayer(zone.ownerId, options.bottomPlayerId)
      : 'shared';
    const bounds =
      zone.kind === 'stadium'
        ? layoutStadium(options.viewport)
        : layoutPlayerZone(
            zone.kind as PlayerZoneGeometryKind,
            side as BoardSide,
            options
          );
    zones.push({
      id: zone.id,
      playerId: zone.ownerId,
      side,
      kind: zone.kind,
      bounds,
      count: zone.cards.length,
      zIndex: zone.kind === 'stadium' ? 30 : 10,
      label: zoneLabel(
        zone.kind,
        zone.ownerId ? view.players[zone.ownerId]?.displayName : undefined
      ),
      interactive: true,
    });
    const cardBounds = layoutZoneCards(zone.kind, bounds, zone.cards.length);
    zone.cards.forEach((card, index) => {
      const cardRect = cardBounds[index];
      if (!cardRect) return;
      registerCard(
        makeCardNode(view, card, {
          parentId: zone.id,
          side,
          role: 'zone',
          bounds: cardRect,
          zIndex:
            zone.kind === 'deck' ||
            zone.kind === 'discard' ||
            zone.kind === 'lostZone' ||
            zone.kind === 'stadium'
              ? 100 + zone.cards.length - index
              : 100 + index,
          interactive: true,
        })
      );
    });
  }

  for (const [playerIdValue, board] of Object.entries(view.boards)) {
    const playerId = playerIdValue as PlayerId;
    const side = sideForPlayer(playerId, options.bottomPlayerId);
    const stackIds = [board.activeStackId, ...board.benchStackIds].filter(
      (id): id is string => id !== null
    );
    const slotBounds = {
      active: layoutPlayerZone('active', side, options),
      bench: layoutPlayerZone('bench', side, options),
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
        bounds: slotBounds.active,
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
        bounds: slotBounds.bench,
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
      const evolutionNodes: CardSceneNode[] = [];
      stack.evolutionCards.forEach((card, index) => {
        const node = makeCardNode(view, card, {
          parentId: stack.id,
          side,
          role: 'stackEvolution',
          bounds: {
            ...baseBounds,
            y:
              baseBounds.y -
              evolutionOffset * (stack.evolutionCards.length - index - 1),
          },
          zIndex: 300 + index,
          rotationQuarterTurns: stack.rotationQuarterTurns,
          interactive: true,
        });
        registerCard(node);
        evolutionNodes.push(node);
      });
      const attachmentWidth = baseBounds.width * 0.7;
      stack.attachmentCards.forEach((card, index) => {
        registerCard(
          makeCardNode(view, card, {
            parentId: stack.id,
            side,
            role: 'stackAttachment',
            bounds: {
              x: baseBounds.x + baseBounds.width * 0.42 + index * 8,
              y: baseBounds.y + baseBounds.height * 0.18 + index * 5,
              width: attachmentWidth,
              height: attachmentWidth / CARD_ASPECT_RATIO,
            },
            zIndex: 250 + index,
            interactive: true,
          })
        );
      });
      const topCard = evolutionNodes.at(-1);
      if (topCard) addMarkers(markers, topCard, stack);
    }
  }

  const workAreaBounds: Rect = {
    x: options.viewport.width * 0.2,
    y: options.viewport.height * 0.2,
    width: options.viewport.width * 0.6,
    height: options.viewport.height * 0.6,
  };
  for (const [playerIdValue, workArea] of Object.entries(view.workAreas)) {
    const playerId = playerIdValue as PlayerId;
    const side = sideForPlayer(playerId, options.bottomPlayerId);
    for (const [kind, area] of [
      ['inspection', workArea.inspection],
      ['attachmentResolution', workArea.attachmentResolution],
    ] as const) {
      if (!area) continue;
      zones.push({
        id: area.id,
        playerId,
        side,
        kind,
        bounds: workAreaBounds,
        count: area.cards.length,
        zIndex: 900,
        label:
          kind === 'inspection'
            ? 'Cards being inspected'
            : 'Attached cards being moved',
        interactive: true,
      });
      const rects = layoutRow(workAreaBounds, area.cards.length, 0.55);
      area.cards.forEach((card, index) => {
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
          })
        );
      });
    }
  }

  return {
    matchId: view.matchId,
    revision: view.revision,
    viewport: { ...options.viewport },
    bottomPlayerId: options.bottomPlayerId,
    splitRatio: options.splitRatio,
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
