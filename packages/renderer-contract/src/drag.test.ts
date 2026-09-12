import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import { BoardDragController, resolveBoardDropTarget } from './drag.js';
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
    },
  ],
  markers: [],
});

const input = (x: number, y: number, pointerId = 7) => ({
  pointerId,
  x,
  y,
  button: 0,
});

describe('renderer-neutral drag controller', () => {
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
      },
    ]);
    expect(controller.consumeSuppressedClick(sourceId)).toBe(true);
    expect(controller.consumeSuppressedClick(sourceId)).toBe(false);
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
