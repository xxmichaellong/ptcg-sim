import { describe, expect, it } from 'vitest';

import { BoardDepthProjection, DEFAULT_BOARD_DEPTH } from './board-depth.js';
import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
} from './defaults.js';
import { BoardDragController } from './drag.js';
import { boardDragInput, withHeldCards } from './held-cards.js';
import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
} from './layout-table.js';
import type { BoardPresentation, BoardScene } from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const fixture = (): BoardScene => {
  const view = createRendererSpikeView();
  return createBoardScene(
    view,
    createTableLayoutSnapshot({
      viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
      playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
      bottomPlayerId: view.playerOrder[0]!,
      shellMode: 'fullscreen',
      geometryVersion: 2,
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
    })
  );
};

const holding = (
  cardId: BoardScene['cards'][number]['id'],
  extra: Partial<BoardPresentation> = {}
): BoardPresentation => ({
  ...DEFAULT_BOARD_PRESENTATION,
  drag: { cardId, x: 400, y: 300, targetId: null },
  ...extra,
});

describe('held cards', () => {
  it('paints a card held out of a pile as itself, and leaves the scene alone otherwise', () => {
    const scene = fixture();
    expect(withHeldCards(scene, DEFAULT_BOARD_PRESENTATION)).toBe(scene);
    const painted = scene.cards.find((card) =>
      card.renderKey?.startsWith('card:')
    )!;
    expect(withHeldCards(scene, holding(painted.id))).toBe(scene);

    const buried = scene.cards.find((card) => card.renderKey === null)!;
    const held = withHeldCards(scene, holding(buried.id));
    const node = held.cards.find((card) => card.id === buried.id)!;
    expect(node.renderKey).toBe(`card:${String(buried.id)}`);
    expect(node.interactive).toBe(true);
    // Not a pile: it opens nothing and lies at one card's height.
    expect(node.primaryAction).toBeUndefined();
    expect(node.tableImageUrl).toBeUndefined();
    expect(held.cards).toHaveLength(scene.cards.length);

    // Still painted while it settles where it was dropped.
    const settling = withHeldCards(scene, {
      ...DEFAULT_BOARD_PRESENTATION,
      settling: [{ cardId: buried.id, x: 10, y: 20 }],
    });
    const settled = settling.cards.find((card) => card.id === buried.id)!;
    expect(settled.renderKey).toBe(`card:${String(buried.id)}`);
    // Where it was dropped, so the next scene flies it on from there.
    expect(settled.bounds.x + settled.bounds.width / 2).toBeCloseTo(10, 6);
    expect(settled.bounds.y + settled.bounds.height / 2).toBeCloseTo(20, 6);
  });

  it('lifts the top card out of an open pile off its cover, which stays on the pile', () => {
    const scene = fixture();
    const cover = scene.cards.find((card) =>
      card.renderKey?.startsWith('cover:')
    )!;
    // Dragged on the table, the cover itself is lifted, as it always was.
    expect(withHeldCards(scene, holding(cover.id))).toBe(scene);
    const held = withHeldCards(
      scene,
      holding(cover.id, { openedZoneId: cover.parentId })
    );
    const byId = held.cards.filter((card) => card.id === cover.id);
    expect(byId).toHaveLength(1);
    expect(byId[0]!.renderKey).toBe(`card:${String(cover.id)}`);
    expect(byId[0]!.primaryAction).toBeUndefined();
    const pile = held.cards.find((card) => card.renderKey === cover.renderKey)!;
    expect(pile.id).not.toBe(cover.id);
    expect(pile.primaryAction).toEqual(cover.primaryAction);
    expect(pile.interactive).toBe(false);
    // The 3D table keeps the pile's height on the cover, not on the card.
    const projection = new BoardDepthProjection(held, {
      ...DEFAULT_BOARD_PREFERENCES,
      depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' },
    });
    const zone = scene.zones.find((entry) => entry.id === cover.parentId)!;
    expect(projection.pileCounts.get(pile.id)).toBe(zone.count);
    expect(projection.pileCounts.has(cover.id)).toBe(false);
  });

  it('drags a card picked up anywhere as the table drags it, keeping the grip', () => {
    const scene = fixture();
    const card = scene.cards.find((entry) => entry.renderKey === null)!;
    const updates: unknown[] = [];
    const drops: unknown[] = [];
    const controller = new BoardDragController({
      emitIntent: (intent) => drops.push(intent),
      emitPresentationUpdate: (update) => updates.push(update),
    });
    const gestureScene = {
      ...scene,
      cards: scene.cards.map((entry) =>
        entry.id === card.id ? { ...entry, interactive: true } : entry
      ),
    };
    // Gripped a quarter in and a fifth down.
    const grip = { x: 0.25, y: 0.2 };
    const start = boardDragInput(
      scene,
      undefined,
      card,
      3,
      { x: 0, y: 0 },
      grip,
      true
    );
    expect(start.x).toBeCloseTo(card.bounds.x + 0.25 * card.bounds.width, 6);
    expect(start.y).toBeCloseTo(card.bounds.y + 0.2 * card.bounds.height, 6);
    expect(controller.pointerDown(gestureScene, card.id, start)).toBe(true);
    // A jitter where it was pressed is still a click, however far the card
    // itself lies from the press (a viewer shows it away from its pile).
    expect(
      controller.pointerMove(
        gestureScene,
        boardDragInput(scene, undefined, card, 3, { x: 2, y: 1 }, grip)
      )
    ).toBe(false);
    const hand = scene.zones.find(
      (zone) => zone.kind === 'hand' && zone.side === 'local'
    )!;
    const point = {
      x: hand.bounds.x + hand.bounds.width / 2,
      y: hand.bounds.y + hand.bounds.height / 2,
    };
    controller.pointerMove(
      gestureScene,
      boardDragInput(scene, undefined, card, 3, point, grip)
    );
    // Held with the grip under the pointer, over a target it would take.
    expect(updates.at(-1)).toMatchObject({
      kind: 'DragChanged',
      drag: {
        cardId: card.id,
        x: expect.closeTo(point.x + 0.25 * card.bounds.width, 6),
        y: expect.closeTo(point.y + 0.3 * card.bounds.height, 6),
        targetId: hand.id,
      },
    });
    controller.pointerUp(
      gestureScene,
      boardDragInput(scene, undefined, card, 3, point, grip)
    );
    expect(drops).toEqual([
      expect.objectContaining({
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: hand.id,
      }),
    ]);
  });

  it('aims by projected picking on the tilted table and drops below the held card', () => {
    const scene = fixture();
    const depth = new BoardDepthProjection(scene, {
      ...DEFAULT_BOARD_PREFERENCES,
      depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' },
    });
    const card = scene.cards.find((entry) => entry.renderKey === null)!;
    const bench = scene.zones.find(
      (zone) => zone.kind === 'bench' && zone.side === 'local'
    )!;
    const screen = depth.point({
      x: bench.bounds.x + bench.bounds.width / 2,
      y: bench.bounds.y + bench.bounds.height / 2,
    });
    const input = boardDragInput(scene, depth, card, 1, screen, {
      x: 0.5,
      y: 0.5,
    });
    expect(input.targetId).toBe(bench.id);
    expect(input.screenPoint).toEqual(screen);
    // Gripped at its centre, it comes down right under the grab point.
    expect(input.dropPoint!.x).toBeCloseTo(input.x, 6);
    expect(input.dropPoint!.y).toBeCloseTo(input.y, 6);
    expect(input.arrangementIndex).not.toBeUndefined();
  });
});
