import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import { BoardDragController, resolveBoardDropTarget } from './drag.js';
import type {
  BoardIntent,
  BoardPresentationUpdate,
  BoardScene,
} from './model.js';

const playerId = asPlayerId('player');
const sourceId = asViewCardId('source');
const targetCardId = asViewCardId('target-card');

const scene = (): BoardScene => ({
  matchId: 'drag-test',
  revision: 1,
  viewport: { width: 800, height: 600, devicePixelRatio: 1 },
  bottomPlayerId: playerId,
  splitRatio: 0.5,
  zones: [
    {
      id: 'source-zone',
      playerId,
      side: 'local',
      kind: 'hand',
      bounds: { x: 0, y: 400, width: 300, height: 200 },
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
});
