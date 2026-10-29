import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import {
  BoardDragController,
  canDetachFromStack,
  dropReachFor,
  resolveBoardDropTarget,
  zoneDropTargetAt,
} from './drag.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
} from './layout.js';
import type {
  BoardIntent,
  BoardPresentationUpdate,
  BoardScene,
} from './model.js';
import { createBoardSceneLayout } from './scene.js';

const playerId = asPlayerId('player');
const opponentId = asPlayerId('opponent');
const sourceId = asViewCardId('source');
const targetCardId = asViewCardId('target-card');

const layout = createBoardSceneLayout(
  createBoardLayoutSnapshot({
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    playerIds: [playerId, opponentId],
    bottomPlayerId: playerId,
    shellMode: 'fullscreen',
    vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  })
);

const scene = (): BoardScene => ({
  matchId: 'drag-test',
  revision: 1,
  viewport: { width: 800, height: 600, devicePixelRatio: 1 },
  bottomPlayerId: playerId,
  layout,
  zones: [
    {
      id: 'source-zone',
      playerId,
      side: 'local',
      kind: 'hand',
      bounds: { x: 0, y: 400, width: 300, height: 200 },
      contentBounds: { x: 0, y: 400, width: 300, height: 200 },
      surface: 'zone',
      count: 1,
      zIndex: 10,
      label: 'Source',
      interactive: true,
    },
    {
      id: 'target-zone',
      playerId,
      side: 'local',
      kind: 'bench',
      bounds: { x: 400, y: 100, width: 300, height: 200 },
      contentBounds: { x: 400, y: 100, width: 300, height: 200 },
      surface: 'playSlot',
      count: 1,
      zIndex: 20,
      label: 'Target',
      interactive: true,
    },
  ],
  cards: [
    {
      id: sourceId,
      ownerId: playerId,
      parentId: 'source-zone',
      side: 'local',
      role: 'zone',
      bounds: { x: 20, y: 430, width: 80, height: 112 },
      zIndex: 100,
      rotationQuarterTurns: 0,
      imageUrl: '/source.png',
      concealed: false,
      label: 'Source card',
      interactive: true,
      renderKey: `card:${String(sourceId)}`,
    },
    {
      id: targetCardId,
      ownerId: playerId,
      parentId: 'target-stack',
      side: 'local',
      role: 'stackEvolution',
      bounds: { x: 500, y: 140, width: 80, height: 112 },
      zIndex: 200,
      rotationQuarterTurns: 0,
      imageUrl: '/target.png',
      concealed: false,
      label: 'Target card',
      interactive: true,
      renderKey: `card:${String(targetCardId)}`,
    },
  ],
  markers: [],
  counts: [],
});

const input = (x: number, y: number, pointerId = 7) => ({
  pointerId,
  x,
  y,
  button: 0,
});

describe('renderer-neutral drag controller', () => {
  it('lifts a Pokémon card off its stack on a long press, then moves it alone', () => {
    const energyId = asViewCardId('energy');
    const withEnergy = (): BoardScene => {
      const base = scene();
      const target = base.cards.find((card) => card.id === targetCardId)!;
      return {
        ...base,
        cards: [
          ...base.cards,
          {
            ...target,
            id: energyId,
            role: 'stackAttachment',
            bounds: { ...target.bounds, x: target.bounds.x + 16 },
            zIndex: 150,
            renderKey: `card:${String(energyId)}`,
          },
        ],
      };
    };
    // Only a card of a Pokémon that has a stack to leave.
    expect(canDetachFromStack(scene(), targetCardId)).toBe(false);
    expect(canDetachFromStack(withEnergy(), targetCardId)).toBe(true);
    expect(canDetachFromStack(withEnergy(), energyId)).toBe(false);
    expect(canDetachFromStack(withEnergy(), sourceId)).toBe(false);

    const updates: BoardPresentationUpdate[] = [];
    const intents: BoardIntent[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: (update) => updates.push(update),
    });
    expect(
      controller.pointerDown(withEnergy(), targetCardId, input(540, 196))
    ).toBe(true);
    expect(controller.detach(withEnergy(), 99)).toBe(false);
    expect(controller.detach(withEnergy(), 7)).toBe(true);
    // It rises where it is, alone, before the pointer moves.
    expect(updates.at(-1)).toMatchObject({
      kind: 'DragChanged',
      drag: { cardId: targetCardId, x: 540, y: 196, detached: true },
    });
    expect(controller.detach(withEnergy(), 7)).toBe(false);
    controller.pointerMove(withEnergy(), input(150, 470));
    expect(updates.at(-1)).toMatchObject({ drag: { detached: true } });
    controller.pointerUp(withEnergy(), input(150, 470));
    expect(intents).toEqual([
      expect.objectContaining({
        kind: 'CardDropRequested',
        cardId: targetCardId,
        targetId: 'source-zone',
        detached: true,
      }),
    ]);
  });

  it('does not lift a card off once its drag has started', () => {
    const controller = new BoardDragController({
      emitIntent: () => undefined,
      emitPresentationUpdate: () => undefined,
    });
    controller.pointerDown(scene(), targetCardId, input(540, 196));
    controller.pointerMove(scene(), input(600, 260));
    expect(controller.detach(scene(), 7)).toBe(false);
  });

  it('picks up the card a press slid onto, held where it is painted', () => {
    const neighbourId = asViewCardId('neighbour');
    const hand = (): BoardScene => {
      const base = scene();
      const source = base.cards.find((card) => card.id === sourceId)!;
      return {
        ...base,
        cards: [
          ...base.cards,
          {
            ...source,
            id: neighbourId,
            bounds: { ...source.bounds, x: source.bounds.x + 20 },
            zIndex: 101,
            label: 'Neighbour card',
            renderKey: `card:${String(neighbourId)}`,
          },
        ],
      };
    };
    const updates: BoardPresentationUpdate[] = [];
    const intents: BoardIntent[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: (update) => updates.push(update),
    });
    // Only a press of this pointer that has not started dragging.
    expect(controller.pick(hand(), neighbourId, input(70, 470))).toBe(false);
    controller.pointerDown(hand(), sourceId, input(40, 470));
    expect(controller.pick(hand(), neighbourId, input(70, 470, 8))).toBe(false);
    // Raised out of the hand, its centre painted 120px above where it lies.
    expect(
      controller.pick(hand(), neighbourId, input(70, 470), { x: 80, y: 366 })
    ).toBe(true);
    expect(updates).toEqual([
      {
        kind: 'DragChanged',
        drag: { cardId: neighbourId, x: 80, y: 366, targetId: 'source-zone' },
      },
    ]);
    expect(controller.pick(hand(), sourceId, input(70, 470))).toBe(false);
    controller.pointerMove(hand(), input(510, 230));
    expect(updates.at(-1)).toMatchObject({
      drag: { cardId: neighbourId, x: 520, y: 126 },
    });
    expect(controller.pointerUp(hand(), input(510, 230))).toBe(true);
    expect(intents).toEqual([
      expect.objectContaining({
        kind: 'CardDropRequested',
        cardId: neighbourId,
      }),
    ]);
    expect(controller.consumeSuppressedClick(neighbourId)).toBe(true);
  });

  it('does not convert a click-sized gesture into a drag', () => {
    const updates: BoardPresentationUpdate[] = [];
    const intents: BoardIntent[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: (update) => updates.push(update),
    });

    expect(controller.pointerDown(scene(), sourceId, input(40, 450))).toBe(
      true
    );
    expect(controller.pointerMove(scene(), input(43, 453))).toBe(false);
    expect(controller.pointerUp(scene(), input(43, 453))).toBe(false);
    expect(updates).toEqual([]);
    expect(intents).toEqual([]);
    expect(controller.consumeSuppressedClick(sourceId)).toBe(false);
  });

  it('preserves grab offset and resolves a card hit to its semantic parent', () => {
    const updates: BoardPresentationUpdate[] = [];
    const intents: BoardIntent[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: (update) => updates.push(update),
    });
    controller.pointerDown(scene(), sourceId, input(30, 440));
    expect(controller.pointerMove(scene(), input(520, 160))).toBe(true);
    expect(updates[0]).toEqual({
      kind: 'DragChanged',
      drag: {
        cardId: sourceId,
        x: 550,
        y: 206,
        targetId: 'target-stack',
      },
    });
    expect(controller.pointerUp(scene(), input(520, 160))).toBe(true);
    expect(updates.at(-1)).toEqual({ kind: 'DragChanged', drag: null });
    expect(intents).toEqual([
      {
        kind: 'CardDropRequested',
        cardId: sourceId,
        targetId: 'target-stack',
        // Centred where the card was held, not at the pointer.
        x: 550,
        y: 206,
      },
    ]);
    expect(controller.consumeSuppressedClick(sourceId)).toBe(true);
    expect(controller.consumeSuppressedClick(sourceId)).toBe(false);
  });

  it('drops the click a drag off a pile ends with, though its cover now shows the next card', () => {
    const controller = new BoardDragController({
      emitIntent: () => undefined,
      emitPresentationUpdate: () => undefined,
    });
    const pile = (): BoardScene => ({
      ...scene(),
      cards: scene().cards.map((card) =>
        card.id === sourceId
          ? {
              ...card,
              renderKey: 'cover:deck',
              primaryAction: { kind: 'openZone' as const, zoneId: 'deck' },
            }
          : card
      ),
    });
    const nextTop = asViewCardId('next-top');
    controller.pointerDown(pile(), sourceId, input(30, 440));
    controller.pointerMove(pile(), input(520, 160));
    expect(controller.pointerUp(pile(), input(520, 160))).toBe(true);
    // The cover's click arrives after the drop, standing for the next card.
    expect(controller.consumeSuppressedClick(nextTop, 'cover:deck')).toBe(true);
    // Only that one click.
    expect(controller.consumeSuppressedClick(nextTop, 'cover:deck')).toBe(
      false
    );

    // Another element's click is never taken for it.
    controller.pointerDown(pile(), sourceId, input(30, 440));
    controller.pointerMove(pile(), input(520, 160));
    controller.pointerUp(pile(), input(520, 160));
    expect(
      controller.consumeSuppressedClick(targetCardId, 'card:target-card')
    ).toBe(false);
    expect(controller.consumeSuppressedClick(targetCardId)).toBe(false);
  });

  it('aims with the pointer and puts the card down centred where it is held', () => {
    const updates: BoardPresentationUpdate[] = [];
    const intents: BoardIntent[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: (update) => updates.push(update),
    });
    // On the redesigned table, which arranges freely.
    const table: BoardScene = {
      ...scene(),
      layout: { ...layout, geometryVersion: 2 },
    };
    // Gripped by its top-left corner: the face is 35px right and 51px
    // below the pointer, which is over the bench.
    controller.pointerDown(table, sourceId, input(25, 435));
    controller.pointerMove(table, input(450, 120));
    expect(updates.at(-1)).toEqual({
      kind: 'DragChanged',
      drag: {
        cardId: sourceId,
        x: 485,
        y: 171,
        targetId: 'target-zone',
        // The bench keeps an order: first, as it holds nothing yet.
        index: 0,
      },
    });
    controller.pointerUp(table, input(450, 120));
    // It lands where its face was, not with its centre under the pointer.
    expect(intents).toEqual([
      {
        kind: 'CardDropRequested',
        cardId: sourceId,
        targetId: 'target-zone',
        x: 485,
        y: 171,
        index: 0,
      },
    ]);
  });

  it('lets a zone on the table take a card held just past its edge', () => {
    const table: BoardScene = {
      ...scene(),
      layout: { ...layout, geometryVersion: 2 },
    };
    const reach = dropReachFor(table);
    expect(reach).toBeGreaterThanOrEqual(12);
    // Just left of the bench, and just below it.
    expect(zoneDropTargetAt(table, 400 - reach + 1, 150)).toBe('target-zone');
    expect(zoneDropTargetAt(table, 450, 300 + reach - 1)).toBe('target-zone');
    // Well clear of every zone it is the felt again.
    expect(zoneDropTargetAt(table, 400 - reach - 30, 150)).not.toBe(
      'target-zone'
    );
    // Just past the hand's corner.
    expect(zoneDropTargetAt(table, 305, 397)).toBe('source-zone');
    // v1's own board keeps exact zones.
    expect(dropReachFor(scene())).toBe(0);
    expect(zoneDropTargetAt(scene(), 395, 150)).toBeNull();
  });

  it('lets the held card aim where the pointer is over bare felt', () => {
    const table: BoardScene = {
      ...scene(),
      layout: { ...layout, geometryVersion: 2 },
    };
    // The pointer is above the bench, out of its reach; the card it holds
    // by its top hangs over the bench.
    expect(zoneDropTargetAt(table, 400, 60)).not.toBe('target-zone');
    expect(zoneDropTargetAt(table, 400, 60, { x: 435, y: 111 })).toBe(
      'target-zone'
    );
    // Over a Pokémon, it joins it.
    expect(
      resolveBoardDropTarget(table, sourceId, 400, 60, false, {
        x: 540,
        y: 190,
      })
    ).toBe('target-stack');
    // A pointer over a zone still means that zone.
    expect(
      resolveBoardDropTarget(table, sourceId, 100, 500, false, {
        x: 540,
        y: 190,
      })
    ).toBe('source-zone');
    // v1's own board aims with the pointer alone.
    expect(zoneDropTargetAt(scene(), 400, 60, { x: 435, y: 111 })).toBeNull();

    // Held by its top-left corner, dropped with the pointer just above the
    // bench: the card lands on the bench it hangs over.
    const intents: BoardIntent[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: () => undefined,
    });
    controller.pointerDown(table, sourceId, input(25, 435));
    controller.pointerMove(table, input(400, 60));
    controller.pointerUp(table, input(400, 60));
    expect(intents).toMatchObject([
      { kind: 'CardDropRequested', cardId: sourceId, targetId: 'target-zone' },
    ]);
  });

  it('cancels active presentation when the pointer or card is invalidated', () => {
    const emitPresentationUpdate = vi.fn();
    const emitIntent = vi.fn();
    const controller = new BoardDragController({
      emitIntent,
      emitPresentationUpdate,
    });
    controller.pointerDown(scene(), sourceId, input(40, 450));
    controller.pointerMove(scene(), input(450, 120));
    expect(controller.cancel(99)).toBe(false);
    expect(controller.cancel(7)).toBe(true);
    expect(emitPresentationUpdate).toHaveBeenLastCalledWith({
      kind: 'DragChanged',
      drag: null,
    });

    controller.pointerDown(scene(), sourceId, input(40, 450));
    controller.pointerMove(scene(), input(450, 120));
    const withoutCards = { ...scene(), cards: [] };
    expect(controller.pointerUp(withoutCards, input(450, 120))).toBe(false);
    expect(emitPresentationUpdate).toHaveBeenLastCalledWith({
      kind: 'DragChanged',
      drag: null,
    });
    expect(emitIntent).not.toHaveBeenCalled();
  });

  it('targets the topmost card before its containing zone', () => {
    expect(resolveBoardDropTarget(scene(), sourceId, 520, 160)).toBe(
      'target-stack'
    );
    expect(resolveBoardDropTarget(scene(), sourceId, 450, 120)).toBe(
      'target-zone'
    );
    expect(resolveBoardDropTarget(scene(), sourceId, 799, 599)).toBeNull();
  });

  it('targets the later-painted card when overlapping cards share a z-index', () => {
    const base = scene();
    const target = base.cards.find((card) => card.id === targetCardId)!;
    const laterTargetId = asViewCardId('later-target-card');
    const equalLayerScene: BoardScene = {
      ...base,
      cards: [
        ...base.cards,
        {
          ...target,
          id: laterTargetId,
          parentId: 'later-target-stack',
        },
      ],
    };

    expect(resolveBoardDropTarget(equalLayerScene, sourceId, 520, 160)).toBe(
      'later-target-stack'
    );
  });

  it('targets the painted footprint of a quarter-turned card', () => {
    const base = scene();
    const rotated: BoardScene = {
      ...base,
      cards: base.cards.map((card) =>
        card.id === targetCardId
          ? { ...card, rotationQuarterTurns: 1 as const }
          : card
      ),
    };

    expect(resolveBoardDropTarget(rotated, sourceId, 490, 196)).toBe(
      'target-stack'
    );
    expect(resolveBoardDropTarget(rotated, sourceId, 540, 145)).toBe(
      'target-zone'
    );
  });

  it('cancels active and suppressed-click state without emitting updates', () => {
    const emitPresentationUpdate = vi.fn();
    const controller = new BoardDragController({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
    });
    controller.pointerDown(scene(), sourceId, input(40, 450));
    controller.pointerMove(scene(), input(450, 120));
    emitPresentationUpdate.mockClear();
    expect(controller.cancelInteraction()).toBe(7);
    expect(emitPresentationUpdate).not.toHaveBeenCalled();
    expect(controller.pointerUp(scene(), input(450, 120))).toBe(false);

    controller.pointerDown(scene(), sourceId, input(40, 450));
    controller.pointerMove(scene(), input(450, 120));
    controller.pointerUp(scene(), input(450, 120));
    expect(controller.cancelInteraction()).toBeNull();
    expect(controller.consumeSuppressedClick(sourceId)).toBe(false);
  });

  it('reports a renderer-owned active-drag failure exactly once', () => {
    const emitPresentationUpdate = vi.fn();
    const controller = new BoardDragController({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
    });
    controller.pointerDown(scene(), sourceId, input(40, 450));
    controller.pointerMove(scene(), input(450, 120));
    emitPresentationUpdate.mockClear();

    expect(controller.cancelForRendererFailure()).toEqual({
      pointerId: 7,
      wasDragging: true,
    });
    expect(emitPresentationUpdate).toHaveBeenCalledOnce();
    expect(emitPresentationUpdate).toHaveBeenCalledWith({
      kind: 'DragChanged',
      drag: null,
    });
    expect(controller.cancelForRendererFailure()).toEqual({
      pointerId: null,
      wasDragging: false,
    });
    expect(emitPresentationUpdate).toHaveBeenCalledOnce();
  });
});
