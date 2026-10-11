import { describe, expect, it } from 'vitest';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_DEPTH,
  parseBoardDepth,
  tablePoseLocalPoint,
  tablePoseQuad,
} from './board-depth.js';
import { TablePoseMotion } from './table-pose-motion.js';
import { createBoardScene } from './scene.js';
import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
} from './layout-table.js';
import { createRendererSpikeView } from './spike-fixture.js';
import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
} from './defaults.js';
import { BoardDragController } from './drag.js';
import type { BoardIntent, BoardScene, CardSceneNode } from './model.js';

const fixture = () => {
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
const preferences = {
  ...DEFAULT_BOARD_PREFERENCES,
  depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const },
};

describe('live board depth', () => {
  it('validates saved preferences and keeps malformed values bounded', () => {
    expect(parseBoardDepth(null)).toEqual(DEFAULT_BOARD_DEPTH);
    expect(
      parseBoardDepth({ mode: 'bogus', tilt: 99, strength: -2, lift: false })
    ).toEqual({
      mode: 'flat',
      tilt: 18,
      strength: 0,
      lift: false,
      animate: true,
    });
    expect(parseBoardDepth({ tilt: NaN, strength: Infinity }).strength).toBe(1);
  });
  it('keeps hand images flat and picks the same projected card at every quarter turn', () => {
    const scene = fixture();
    const original = scene.cards.find(
      (card) => card.renderKey && card.role === 'stackEvolution'
    )!;
    expect(original).toBeDefined();
    for (const turns of [0, 1, 2, 3] as const) {
      const card = { ...original, rotationQuarterTurns: turns };
      const projection = new BoardDepthProjection(
        { ...scene, cards: [card] },
        preferences
      );
      const pose = projection.pose(card);
      const quad = tablePoseQuad(projection.camera, pose);
      for (const [index, point] of quad.entries()) {
        const local = tablePoseLocalPoint(projection.camera, pose, point)!;
        expect(local.x).toBeCloseTo(
          index === 1 || index === 2 ? card.bounds.width : 0,
          6
        );
        expect(local.y).toBeCloseTo(index >= 2 ? card.bounds.height : 0, 6);
      }
      const center = projection.point(
        {
          x: card.bounds.x + card.bounds.width / 2,
          y: card.bounds.y + card.bounds.height / 2,
        },
        pose.elevation
      );
      expect(
        projection.drop(center, 'unrelated' as CardSceneNode['id']).targetId
      ).toBe(card.parentId);
    }
    const projection = new BoardDepthProjection(scene, preferences);
    for (const card of scene.cards.filter(
      (card) => card.renderKey && card.parentId.endsWith(':hand')
    ))
      expect(projection.pose(card).plane).toBe(0);
  });
  it('treats four joined panels as one layer, overlays as separate layers, and lifts the assembly together', () => {
    const scene = fixture();
    const original = scene.cards.find(
      (card) => card.renderKey && card.role === 'stackEvolution'
    )!;
    const cards = [0, 1, 2, 3].map((part) => ({
      ...original,
      id: `piece-${part}` as CardSceneNode['id'],
      renderKey: `piece-${part}`,
      zIndex: part,
      composition: { kind: 'joined' as const, bounds: original.bounds },
    }));
    const joined = new BoardDepthProjection({ ...scene, cards }, preferences);
    expect(new Set(cards.map((card) => joined.pose(card).elevation)).size).toBe(
      1
    );
    const presentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: cards[0]!.id, x: 700, y: 700, targetId: null },
    };
    expect(
      new Set(cards.map((card) => joined.pose(card, presentation).elevation))
        .size
    ).toBe(1);
    expect(joined.pose(cards[0]!, presentation).elevation).toBeGreaterThan(
      joined.pose(cards[0]!).elevation
    );
    const overlays = cards.slice(0, 2).map((card) => ({
      ...card,
      composition: { ...card.composition, kind: 'overlay' as const },
    }));
    const overlay = new BoardDepthProjection(
      { ...scene, cards: overlays },
      preferences
    );
    expect(overlay.pose(overlays[1]!).elevation).toBeGreaterThan(
      overlay.pose(overlays[0]!).elevation
    );
  });
  it('picks a moving face where it is painted and reports its logical target coordinates', () => {
    const scene = fixture();
    const card = scene.cards.find(
      (card) => card.renderKey && card.role === 'stackEvolution'
    )!;
    const projection = new BoardDepthProjection(
      { ...scene, cards: [card] },
      preferences
    );
    const base = projection.pose(card);
    const moving = {
      ...base,
      bounds: { ...base.bounds, x: 200, y: 200 },
      elevation: 40,
    };
    const point = projection.point(
      {
        x: moving.bounds.x + moving.bounds.width / 2,
        y: moving.bounds.y + moving.bounds.height / 2,
      },
      moving.elevation
    );
    const hit = projection.drop(
      point,
      'unrelated' as CardSceneNode['id'],
      () => moving
    );
    expect(hit.targetId).toBe(card.parentId);
    expect(hit.point.x).toBeCloseTo(card.bounds.x + card.bounds.width / 2, 6);
    expect(hit.point.y).toBeCloseTo(card.bounds.y + card.bounds.height / 2, 6);
  });
  it('derives pile height solely from the public count, with no geometry per hidden card', () => {
    const scene = fixture();
    const zone = scene.zones.find((zone) => zone.kind === 'deck')!;
    const template = scene.cards.find((card) => card.parentId === zone.id)!;
    const cover = {
      ...template,
      renderKey: `cover:${zone.id}`,
      primaryAction: { kind: 'openZone' as const, zoneId: zone.id },
    };
    const make = (count: number): BoardScene => ({
      ...scene,
      zones: [{ ...zone, count }],
      cards: [
        cover,
        ...Array.from({ length: 100 }, (_, index) => ({
          ...template,
          id: `hidden-${index}` as CardSceneNode['id'],
          renderKey: null,
        })),
      ],
    });
    const full = new BoardDepthProjection(make(60), preferences);
    const small = new BoardDepthProjection(make(12), preferences);
    expect(full.poses.size).toBe(1);
    expect(full.pose(cover).elevation).toBeCloseTo(
      small.pose(cover).elevation * 5,
      7
    );
    expect(
      new BoardDepthProjection(make(12), {
        ...preferences,
        reducedMotion: true,
      }).lift
    ).toBe(0);
  });
  it('uses screen distance for the drag threshold and the projected target for the logical drop', () => {
    const scene = fixture();
    const source = scene.cards.find(
      (card) => card.interactive && card.renderKey
    )!;
    const intents: BoardIntent[] = [];
    const drag = new BoardDragController({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: () => {},
    });
    const input = {
      pointerId: 1,
      button: 0,
      x: source.bounds.x,
      y: source.bounds.y,
      screenPoint: { x: 20, y: 20 },
    };
    expect(drag.pointerDown(scene, source.id, input)).toBe(true);
    expect(
      drag.pointerMove(scene, {
        ...input,
        x: input.x + 200,
        screenPoint: { x: 21, y: 21 },
      })
    ).toBe(false);
    const target = scene.zones.find((zone) => zone.kind === 'bench')!;
    drag.pointerUp(scene, {
      ...input,
      x: 900,
      screenPoint: { x: 60, y: 60 },
      dropPoint: { x: 300, y: 400 },
      targetId: target.id,
    });
    expect(intents).toEqual([
      {
        kind: 'CardDropRequested',
        cardId: source.id,
        targetId: target.id,
        x: 300,
        y: 400,
      },
    ]);
  });
});

describe('physical pose timing', () => {
  it('retargets from the current visible height and stops completely at rest', () => {
    const motion = new TablePoseMotion();
    const scene = fixture();
    const projection = new BoardDepthProjection(scene, preferences);
    const card = scene.cards.find((card) => card.renderKey)!;
    const base = projection.pose(card);
    motion.set('card', base, 0);
    motion.set('card', { ...base, elevation: 40 }, 10, 180);
    const moving = motion.sample('card', 65)!;
    motion.set('card', { ...base, elevation: 5 }, 65, 180);
    expect(motion.poses.get('card')).toEqual(moving);
    motion.sampleAll(300);
    expect(motion.poses.get('card')?.elevation).toBe(5);
    expect(motion.active).toBe(false);
    expect(motion.sampleAll(500).size).toBe(0);
  });
  it('does not replay an acknowledged optimistic pose', () => {
    const motion = new TablePoseMotion();
    const scene = fixture();
    const projection = new BoardDepthProjection(scene, preferences);
    const base = projection.pose(scene.cards.find((card) => card.renderKey)!);
    motion.set('card', base, 0);
    const target = { ...base, elevation: 20 };
    motion.set('card', target, 0, 180);
    motion.set('card', target, 100, 180);
    motion.sampleAll(181);
    expect(motion.active).toBe(false);
  });
});
