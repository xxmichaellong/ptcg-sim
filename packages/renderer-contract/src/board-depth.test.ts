import { describe, expect, it } from 'vitest';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_DEPTH,
  parseBoardDepth,
  tablePoseEdges,
  tablePoseLocalPoint,
  tablePoseMatrix,
  tablePoseQuad,
} from './board-depth.js';
import { TablePoseMotion } from './table-pose-motion.js';
import { projectTablePoint } from './table-camera.js';
import { createBoardScene } from './scene.js';
import {
  APP_BAR_INSET_PX,
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  tableVerticalLayout,
} from './layout-table.js';
import { createRendererSpikeView } from './spike-fixture.js';
import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
} from './defaults.js';
import { BoardDragController, zoneDropTargetAt } from './drag.js';
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
      tilt: 35,
      strength: 0,
      lift: false,
      animate: true,
      parallax: false,
      scatter: true,
    });
    expect(parseBoardDepth({ tilt: NaN, strength: Infinity }).strength).toBe(1);
    expect(parseBoardDepth({ scatter: false }).scatter).toBe(false);
  });
  it('lays resting table cards a touch askew, the same every time, and keeps piles, hands and the tidy table square', () => {
    const scene = fixture();
    const askew = new BoardDepthProjection(scene, preferences);
    const again = new BoardDepthProjection(scene, preferences);
    const tidy = new BoardDepthProjection(scene, {
      ...preferences,
      depth: { ...preferences.depth, scatter: false },
    });
    const zones = new Map(scene.zones.map((zone) => [zone.id, zone]));
    let moved = 0;
    for (const card of scene.cards) {
      if (card.renderKey === null) continue;
      const pose = askew.pose(card);
      expect(again.pose(card)).toEqual(pose);
      expect(tidy.pose(card).turns).toBe(card.rotationQuarterTurns);
      const kind = zones.get(card.parentId)?.kind;
      // A hand comes in to meet the tilted mat (below); the rest lie true.
      if (kind !== 'hand') expect(tidy.pose(card).bounds).toEqual(card.bounds);
      const yaw = Math.abs(pose.turns - card.rotationQuarterTurns) * 90;
      if (
        pose.plane === 0 ||
        ['deck', 'discard', 'lostZone'].includes(kind ?? '')
      ) {
        expect(yaw).toBe(0);
        continue;
      }
      // Never more than a degree or so, and never more than a hair off.
      expect(yaw).toBeLessThanOrEqual(kind === 'prizes' ? 1.2 : 0.6);
      expect(Math.abs(pose.bounds.x - card.bounds.x)).toBeLessThanOrEqual(
        card.bounds.width * 0.005
      );
      if (yaw > 0) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("grows the player's own hand toward the tilted mat from the window's edge, keeps the far hand's peek, and leaves a flat table alone", () => {
    const scene = fixture();
    const table = new BoardDepthProjection(scene, preferences);
    const flat = new BoardDepthProjection(scene, {
      ...preferences,
      depth: { ...preferences.depth!, mode: 'flat' },
    });
    const centre = scene.viewport.height / 2;
    const bottom = scene.viewport.height;
    let checked = 0;
    for (const zone of scene.zones.filter((zone) => zone.kind === 'hand')) {
      const cards = scene.cards.filter(
        (card) => card.parentId === zone.id && card.renderKey !== null
      );
      if (cards.length === 0) continue;
      checked += 1;
      const strip = zone.bounds;
      const near = strip.y + strip.height / 2 >= centre;
      for (const card of cards) {
        expect(flat.pose(card).bounds).toEqual(card.bounds);
      }
      if (!near) {
        // Across the table the hand peeks in from the top edge as laid
        // out, and does not grow.
        for (const card of cards) {
          expect(table.pose(card).bounds).toEqual(card.bounds);
        }
        continue;
      }
      const inner = strip.y;
      const edge = projectTablePoint(table.camera, {
        x: strip.x + strip.width / 2,
        y: inner,
        z: 0,
      }).y;
      const reach = inner - edge - 6;
      expect(reach).toBeGreaterThan(10);
      const grow = Math.min(1.3, (strip.height + reach) / strip.height);
      cards.forEach((card) => {
        const pose = table.pose(card).bounds;
        // Grown by the strip's share, no further than the mat's edge...
        expect(pose.height / card.bounds.height).toBeCloseTo(grow, 6);
        expect(pose.y).toBeGreaterThanOrEqual(edge + 5.5);
        // ...from the window's edge: as much of it runs off as before.
        expect((pose.y + pose.height - bottom) / pose.height).toBeCloseTo(
          (card.bounds.y + card.bounds.height - bottom) / card.bounds.height,
          6
        );
        expect(pose.x).toBeGreaterThanOrEqual(strip.x - 0.5);
        expect(pose.x + pose.width).toBeLessThanOrEqual(
          strip.x + strip.width + 0.5
        );
      });
    }
    expect(checked).toBe(2);
  });

  it('lays the tilted mat just under the far hand, the height to spare going to the near side', () => {
    const scene = fixture();
    const table = new BoardDepthProjection(scene, preferences);
    const centre = scene.viewport.height / 2;
    const hands = scene.zones.filter((zone) => zone.kind === 'hand');
    const far = hands.find(
      (zone) => zone.bounds.y + zone.bounds.height / 2 < centre
    )!.bounds;
    const near = hands.find(
      (zone) => zone.bounds.y + zone.bounds.height / 2 >= centre
    )!.bounds;
    const spots = scene.zones.filter((zone) => zone.kind !== 'hand');
    const project = (y: number) =>
      projectTablePoint(table.camera, {
        x: scene.viewport.width / 2,
        y,
        z: 0,
      }).y;
    const top = project(Math.min(...spots.map((zone) => zone.bounds.y)));
    const end = project(
      Math.max(...spots.map((zone) => zone.bounds.y + zone.bounds.height))
    );
    // The mat's own margin and a strip of desk under the far hand...
    expect(top - (far.y + far.height)).toBeCloseTo(26, 0);
    // ...and the rest of the room between the mat and the near hand.
    expect(near.y - end).toBeGreaterThan(top - (far.y + far.height));
  });

  it("grows a tilted hand about its own middle, the table's centre, though its strip runs from the mat's edge to its pill", () => {
    const scene = fixture();
    const table = new BoardDepthProjection(scene, preferences);
    const middle =
      scene.layout.playAreaBounds.x + scene.layout.playAreaBounds.width / 2;
    const hand = scene.zones.find(
      (zone) => zone.kind === 'hand' && zone.side === 'local'
    )!;
    // The strip isn't centred on the table; the cards that fit are.
    expect(
      Math.abs(hand.bounds.x + hand.bounds.width / 2 - middle)
    ).toBeGreaterThan(10);
    const cards = scene.cards.filter(
      (card) => card.parentId === hand.id && card.renderKey !== null
    );
    expect(cards.length).toBeGreaterThan(1);
    const centreOf = (rects: readonly { x: number; width: number }[]) =>
      (Math.min(...rects.map((rect) => rect.x)) +
        Math.max(...rects.map((rect) => rect.x + rect.width))) /
      2;
    expect(centreOf(cards.map((card) => card.bounds))).toBeCloseTo(middle, 6);
    expect(centreOf(cards.map((card) => table.pose(card).bounds))).toBeCloseTo(
      middle,
      6
    );
  });

  it('keeps a full hand, grown to meet the tilted mat, inside its strip and clear of the app bar', () => {
    const base = createRendererSpikeView();
    const bar = { width: 202, height: 42 };
    let checked = 0;
    for (const handSize of [7, 12, 20]) {
      // Every hand holds `handSize` cards.
      const zones = Object.fromEntries(
        Object.entries(base.zones).map(([id, zone]) => {
          if (!id.endsWith(':hand') || zone.cards.length === 0) {
            return [id, zone];
          }
          const cards = Array.from({ length: handSize }, (_, index) => ({
            ...zone.cards[index % zone.cards.length]!,
            id: `${String(zone.cards[index % zone.cards.length]!.id)}-${String(index)}`,
          }));
          return [id, { ...zone, cards }];
        })
      ) as typeof base.zones;
      const view = { ...base, zones } as typeof base;
      for (const [width, height] of [
        [1440, 900],
        [1280, 720],
        [1366, 768],
        [1920, 1080],
        [1024, 768],
      ] as const) {
        const layout = createTableLayoutSnapshot({
          viewport: { width, height, devicePixelRatio: 1 },
          playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
          bottomPlayerId: view.playerOrder[0]!,
          shellMode: 'fullscreen',
          geometryVersion: 2,
          vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
          appBarPx: bar,
        });
        const scene = createBoardScene(view, layout);
        const barBox = {
          x: layout.playAreaBounds.width - APP_BAR_INSET_PX - bar.width,
          y: APP_BAR_INSET_PX,
          ...bar,
        };
        for (const tilt of [10, 22, 35]) {
          const table = new BoardDepthProjection(scene, {
            ...preferences,
            depth: { ...preferences.depth!, tilt },
          });
          for (const zone of scene.zones.filter(
            (candidate) => candidate.kind === 'hand'
          )) {
            for (const card of scene.cards.filter(
              (candidate) =>
                candidate.parentId === zone.id && candidate.renderKey !== null
            )) {
              const at = `${String(handSize)} ${String(width)}x${String(height)} tilt ${String(tilt)}`;
              const bounds = table.bounds(card);
              expect(bounds.x, at).toBeGreaterThanOrEqual(zone.bounds.x - 0.5);
              expect(bounds.x + bounds.width, at).toBeLessThanOrEqual(
                zone.bounds.x + zone.bounds.width + 0.5
              );
              expect(
                bounds.x < barBox.x + barBox.width &&
                  barBox.x < bounds.x + bounds.width &&
                  bounds.y < barBox.y + barBox.height &&
                  barBox.y < bounds.y + bounds.height,
                at
              ).toBe(false);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps a tilted hand fanned on a narrow strip, never closed up into one card', () => {
    const view = createRendererSpikeView();
    let checked = 0;
    for (const width of [496, 560, 608, 640]) {
      for (const lowerShare of [0.4, 0.54]) {
        for (const markers of [0, 1, 2]) {
          const layout = createTableLayoutSnapshot({
            viewport: { width, height: 1024, devicePixelRatio: 1 },
            playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
            bottomPlayerId: view.playerOrder[0]!,
            shellMode: 'fullscreen',
            geometryVersion: 2,
            vertical: tableVerticalLayout(lowerShare),
            appBarPx: { width: width < 600 ? 146 : 242, height: 50 },
            seamBandPx: 46,
            ...(markers ? { oncePerGameMarkers: markers } : {}),
          });
          const scene = createBoardScene(view, layout);
          for (const hand of scene.zones.filter(
            (zone) => zone.kind === 'hand'
          )) {
            const cards = scene.cards.filter(
              (card) => card.parentId === hand.id && card.renderKey !== null
            );
            if (cards.length < 2) continue;
            const span = (xs: readonly number[]) =>
              Math.max(...xs) - Math.min(...xs);
            const flat = span(cards.map((card) => card.bounds.x));
            for (const tilt of [22, 35]) {
              const table = new BoardDepthProjection(scene, {
                ...preferences,
                depth: { ...preferences.depth!, tilt },
              });
              expect(
                span(cards.map((card) => table.bounds(card).x)),
                `${String(width)} split ${String(lowerShare)} markers ${String(markers)} tilt ${String(tilt)}`
              ).toBeGreaterThanOrEqual(flat * 0.5 - 0.5);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('lays a marker on its card, a hair above it, and carries it with the card', () => {
    const scene = fixture();
    const marker = scene.markers[0];
    if (!marker) return;
    const parent = scene.cards.find((card) => card.id === marker.parentCardId)!;
    const table = new BoardDepthProjection(scene, preferences);
    const flat = new BoardDepthProjection(scene, DEFAULT_BOARD_PREFERENCES);
    expect(flat.markerMatrix(marker)).toBeNull();
    const resting = table.markerMatrix(marker);
    if (table.pose(parent).plane !== 1) {
      expect(resting).toBeNull();
      return;
    }
    expect(resting).not.toBeNull();
    // Moved 40px with its card, the marker moves with it.
    const pose = table.pose(parent);
    const moved = table.markerMatrix(marker, {
      ...pose,
      bounds: { ...pose.bounds, x: pose.bounds.x + 40 },
    })!;
    const origin = (matrix: readonly number[]) => matrix[12]! / matrix[15]!;
    expect(origin(moved)).toBeGreaterThan(origin(resting!) + 30);
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
  it('takes a benched Pokémon moved aside for a gap where it lies, so aiming at it closes the gap under the pointer', () => {
    const table = fixture();
    const bench = table.zones.find(
      (zone) => zone.kind === 'bench' && zone.side === 'local'
    )!;
    // Three Pokémon on the bench, centred and spaced as the table lays
    // them out.
    const template = table.cards.find(
      (card) => card.renderKey !== null && card.role === 'stackEvolution'
    )!;
    const middle = bench.contentBounds.x + bench.contentBounds.width / 2;
    const width = bench.contentBounds.height * 0.716;
    const benched = [0, 1, 2].map((index) => ({
      ...template,
      id: `benched-${String(index)}` as CardSceneNode['id'],
      renderKey: `card:benched-${String(index)}`,
      parentId: `stack:benched-${String(index)}`,
      // Each one along drawn over the one before, as the bench draws them.
      zIndex: template.zIndex + index,
      bounds: {
        x: middle + (index - 1) * width * 1.17 - width / 2,
        y: bench.contentBounds.y,
        width,
        height: bench.contentBounds.height,
      },
    }));
    const scene = { ...table, cards: [...table.cards, ...benched] };
    const projection = new BoardDepthProjection(scene, preferences);
    // A card held over the bare mat at the bench's left end: the bench
    // opens a gap there, its Pokémon moved along to the right.
    const holding = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: {
        cardId: 'held' as CardSceneNode['id'],
        x: bench.bounds.x + 4,
        y: bench.bounds.y + bench.bounds.height / 2,
        targetId: bench.id,
        index: 0,
      },
    };
    const first = benched[0]!;
    const resting = projection.pose(first);
    const aside = projection.pose(first, holding);
    expect(aside.bounds.x).toBeGreaterThan(
      resting.bounds.x + resting.bounds.width / 2
    );
    // Aimed at the middle of where it lies, no longer painted there.
    const painted = (card: CardSceneNode) => projection.pose(card, holding);
    const aimAt = (x: number, y: number, elevation: number) =>
      projection.drop(
        projection.point({ x, y }, elevation),
        'held' as CardSceneNode['id'],
        painted
      ).targetId;
    expect(
      aimAt(
        resting.bounds.x + resting.bounds.width / 2,
        resting.bounds.y + resting.bounds.height / 2,
        resting.elevation
      )
    ).toBe(first.parentId);
    // Where it is painted, aside, it is what the player sees: still it.
    expect(
      aimAt(
        aside.bounds.x + aside.bounds.width / 2,
        aside.bounds.y + aside.bounds.height / 2,
        aside.elevation
      )
    ).toBe(first.parentId);
    // Its right edge, painted over where the next Pokémon lies: the one the
    // player sees, not the one that lies there unseen.
    const second = projection.pose(benched[1]!);
    const edge = aside.bounds.x + aside.bounds.width * 0.92;
    expect(edge).toBeGreaterThan(second.bounds.x);
    expect(
      aimAt(edge, aside.bounds.y + aside.bounds.height / 2, aside.elevation)
    ).toBe(first.parentId);
    // The gap itself, left of where it lies, is the bench's.
    expect(
      aimAt(
        resting.bounds.x - 8,
        resting.bounds.y + resting.bounds.height / 2,
        0
      )
    ).toBe(bench.id);
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
    // Only the sides turned toward the viewer are drawn, all wound one
    // way: a far side in the same filled path would cancel a near one where
    // they overlap and let the mat show through the pile.
    const edges = tablePoseEdges(full.camera, full.pose(cover), 60);
    const faces = edges.sides
      .split('Z')
      .filter(Boolean)
      .map((face) =>
        face
          .replace('M', '')
          .split('L')
          .map((pair) => pair.split(',').map(Number) as [number, number])
      );
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThanOrEqual(2);
    for (const face of faces) {
      const area = face.reduce((sum, [x, y], index) => {
        const [nextX, nextY] = face[(index + 1) % face.length]!;
        return sum + x * nextY - nextX * y;
      }, 0);
      expect(area).toBeGreaterThan(0);
    }
    // The pages show as lines along those sides only: one per side per band.
    expect(edges.lines.match(/M/g)).toHaveLength(8 * faces.length);
    // A held card rises about half its width; with reduced motion it is
    // still raised (an instant change is not motion), and off is off.
    expect(small.liftFor(100)).toBeCloseTo(45, 7);
    expect(
      new BoardDepthProjection(make(12), {
        ...preferences,
        reducedMotion: true,
      }).liftFor(100)
    ).toBeCloseTo(45, 7);
    expect(
      new BoardDepthProjection(make(12), {
        ...preferences,
        depth: { ...preferences.depth!, lift: false },
      }).liftFor(100)
    ).toBe(0);
  });
  it('rounds a pile’s edge at the corners as its face is rounded, with no seam where two sides meet', () => {
    const scene = fixture();
    const zone = scene.zones.find((zone) => zone.kind === 'deck')!;
    const template = scene.cards.find((card) => card.parentId === zone.id)!;
    const cover = {
      ...template,
      renderKey: `cover:${zone.id}`,
      primaryAction: { kind: 'openZone' as const, zoneId: zone.id },
    };
    const projection = new BoardDepthProjection(
      { ...scene, zones: [{ ...zone, count: 60 }], cards: [cover] },
      preferences
    );
    const pose = projection.pose(cover);
    const { width, height } = pose.bounds;
    const [rx, ry] = [width * 0.048, height * 0.034];
    // Where a point of the face's outline is, against its rounded corners:
    // 1 on the curve, more outside it (a square corner is 2).
    const corner = ({ x, y }: { x: number; y: number }) => {
      const dx = Math.max(0, rx - x, x - (width - rx)) / rx;
      const dy = Math.max(0, ry - y, y - (height - ry)) / ry;
      return dx > 0 && dy > 0 ? dx * dx + dy * dy : undefined;
    };
    // At the table's near corners two sides of the pile show.
    const turned = [0, projection.camera.width - width].map((x) => {
      const edges = tablePoseEdges(
        projection.camera,
        { ...pose, bounds: { ...pose.bounds, x } },
        60
      );
      const bands = edges.sides
        .split('Z')
        .filter(Boolean)
        .map((band) =>
          band
            .replace('M', '')
            .split('L')
            .map((pair) => {
              const [px, py] = pair.split(',').map(Number);
              return { x: px!, y: py! };
            })
        );
      return { bands, lines: edges.lines };
    });
    for (const { bands, lines } of turned) {
      // One band round the corner, and one line along it per page.
      expect(bands).toHaveLength(1);
      expect(lines.match(/M/g)).toHaveLength(8);
      // Its top half is the face's own outline, taken round the curve.
      const band = bands[0]!;
      const along = band.slice(band.length / 2).map(corner);
      const round = along.filter((value) => value !== undefined);
      expect(round.length).toBeGreaterThan(2);
      for (const value of round) expect(value).toBeCloseTo(1, 3);
    }
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
        // The bench keeps an order the player sets: its place there.
        index: 0,
      },
    ]);
  });
});

describe('a flat card turned over', () => {
  it('is seen in depth about its own middle, and lies flat again at rest', () => {
    const scene = fixture();
    const card = scene.cards.find(
      (candidate) => candidate.renderKey && candidate.parentId.endsWith(':hand')
    )!;
    const projection = new BoardDepthProjection(scene, preferences);
    const flat = { ...projection.pose(card), plane: 0 };
    const { bounds } = flat;
    // At rest: exactly its rectangle, wherever it is on the screen.
    const rectangle = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ];
    tablePoseQuad(projection.camera, flat).forEach((point, index) => {
      expect(point.x).toBeCloseTo(rectangle[index]!.x, 9);
      expect(point.y).toBeCloseTo(rectangle[index]!.y, 9);
    });
    const [a, b, c, d] = tablePoseQuad(projection.camera, {
      ...flat,
      flip: Math.PI / 3,
    });
    // Narrower, still centred on its middle, one edge nearer (taller) than
    // the other.
    const middle = bounds.x + bounds.width / 2;
    expect(b!.x - a!.x).toBeLessThan(bounds.width * 0.75);
    expect(Math.abs((a!.x + b!.x) / 2 - middle)).toBeLessThan(
      bounds.width * 0.05
    );
    expect(Math.abs(c!.y - b!.y - (d!.y - a!.y))).toBeGreaterThan(
      bounds.height * 0.05
    );
  });
});

describe('a card turning over on the tilted table', () => {
  it('paints its edges and shadows in front of the eye, about its own size, and keeps its shadow nearly all the way', () => {
    const scene = fixture();
    const projection = new BoardDepthProjection(scene, preferences);
    const { camera } = projection;
    let frames = 0;
    let shadowed = 0;
    // The nearest any painted point comes to the eye's plane, and the
    // farthest it lies from its card, in card sizes.
    let nearest = Infinity;
    let farthest = 0;
    for (const card of scene.cards) {
      if (!card.renderKey) continue;
      const base = projection.pose(card);
      // Turned over as the depth director turns it, frame by frame: eased
      // in and out, about its middle, risen by half its width on its edge
      // so it stays above the cloth, and a little more, as if tossed.
      for (let frame = 0; frame <= 120; frame += 1) {
        const progress = frame / 120;
        const turn =
          progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        const flip =
          progress >= 1
            ? 0
            : turn < 0.5
              ? turn * Math.PI
              : (turn - 1) * Math.PI;
        const pose = {
          ...base,
          flip,
          elevation:
            base.elevation +
            base.plane *
              base.bounds.width *
              (0.5 * Math.abs(Math.sin(flip)) +
                0.06 * Math.sin(Math.PI * progress)),
        };
        const face = tablePoseMatrix(camera, pose);
        const edges = tablePoseEdges(camera, pose, 3);
        frames += 1;
        if (edges.shadow !== '') shadowed += 1;
        const painted = [
          edges.sides,
          edges.lines,
          edges.shadow,
          edges.contact,
        ].join('');
        for (const [, x, y] of painted.matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)) {
          const [px, py] = [Number(x), Number(y)];
          nearest = Math.min(
            nearest,
            face[3]! * px + face[7]! * py + face[15]!
          );
          farthest = Math.max(
            farthest,
            Math.abs(px) / base.bounds.width,
            Math.abs(py) / base.bounds.height
          );
        }
      }
    }
    // Behind the eye, or a layer of millions of pixels, a path runs off
    // toward infinity and the browser's memory with it.
    expect(nearest).toBeGreaterThan(0);
    expect(farthest).toBeLessThan(5);
    expect(shadowed / frames).toBeGreaterThan(0.9);
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

describe('a board laid out tilted (tiltedTable)', () => {
  const sceneAt = (width: number, height: number, tiltedTable: boolean) => {
    const view = createRendererSpikeView();
    return createBoardScene(
      view,
      createTableLayoutSnapshot({
        viewport: { width, height, devicePixelRatio: 1 },
        playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
        bottomPlayerId: view.playerOrder[0]!,
        shellMode: 'fullscreen',
        geometryVersion: 2,
        vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
        seamBandPx: 46,
        appBarPx: { width: 334, height: 42 },
        ...(tiltedTable ? { tiltedTable: true } : {}),
      })
    );
  };
  const hands = (scene: BoardScene, height: number) => {
    const all = scene.zones.filter((zone) => zone.kind === 'hand');
    return {
      near: all.find((zone) => zone.bounds.y > height / 2)!,
      far: all.find((zone) => zone.bounds.y < height / 2)!,
    };
  };

  it('draws each hand back at its edge, as large as laid out, and the board in the band between them, larger', () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1920, 1080],
      [1024, 768],
    ] as const) {
      const scene = sceneAt(width, height, true);
      const depth = new BoardDepthProjection(scene, preferences);
      const { near, far } = hands(scene, height);
      const nearDrawn = depth.handBounds(near);
      const farDrawn = depth.handBounds(far);
      expect(nearDrawn.y + nearDrawn.height).toBeCloseTo(height, 6);
      expect(farDrawn.y).toBeCloseTo(0, 6);
      // Its cards keep their size and run off the window's edge as before.
      for (const card of scene.cards.filter((c) => c.parentId === near.id)) {
        const pose = depth.pose(card);
        expect(pose.bounds.height).toBeCloseTo(card.bounds.height, 6);
        expect(pose.bounds.y).toBeCloseTo(nearDrawn.y, 0);
        expect(pose.bounds.y + pose.bounds.height).toBeGreaterThan(height);
      }
      // The board fills the band: its spots end the mat's margin and a
      // strip of desk short of either hand, at most.
      const spots = scene.zones.filter(
        (zone) =>
          zone.kind !== 'hand' &&
          zone.bounds.width > 0 &&
          zone.bounds.height > 0
      );
      const projected = spots.flatMap((zone) =>
        tablePoseQuad(depth.camera, {
          bounds: zone.bounds,
          turns: 0,
          elevation: 0,
          thickness: 0,
          plane: 1,
        })
      );
      const top = Math.min(...projected.map((point) => point.y));
      const bottom = Math.max(...projected.map((point) => point.y));
      const left = Math.min(...projected.map((point) => point.x));
      const right = Math.max(...projected.map((point) => point.x));
      expect(top).toBeGreaterThanOrEqual(farDrawn.y + farDrawn.height + 25.5);
      expect(bottom).toBeLessThanOrEqual(nearDrawn.y - 23.5);
      expect(left).toBeGreaterThan(8);
      expect(right).toBeLessThan(width - 8);
      // As tall as the band, or as wide as the window, whichever is less.
      const band = nearDrawn.y - 24 - (farDrawn.y + farDrawn.height + 26);
      expect(Math.abs(bottom - top - band) < 2 || left < 8 + 16 + 2).toBe(true);
      // Its Active larger than the board laid out with the hands inside.
      const before = sceneAt(width, height, false);
      const beforeDepth = new BoardDepthProjection(before, preferences);
      const activeHeight = (s: BoardScene, d: BoardDepthProjection) => {
        const active = s.zones
          .filter((zone) => zone.kind === 'active')
          .sort((a, b) => b.bounds.y - a.bounds.y)[0]!;
        const quad = tablePoseQuad(d.camera, {
          bounds: active.bounds,
          turns: 0,
          elevation: 0,
          thickness: 0,
          plane: 1,
        });
        return (
          Math.max(...quad.map((point) => point.y)) -
          Math.min(...quad.map((point) => point.y))
        );
      };
      expect(activeHeight(scene, depth)).toBeGreaterThan(
        activeHeight(before, beforeDepth) * 1.1
      );
    }
  });

  it('takes a point on a drawn hand to that hand, and one on the board to the board', () => {
    const [width, height] = [1440, 900];
    const scene = sceneAt(width, height, true);
    const depth = new BoardDepthProjection(scene, preferences);
    const { near, far } = hands(scene, height);
    for (const hand of [near, far]) {
      const drawn = depth.handBounds(hand);
      const on = depth.boardPoint({
        x: drawn.x + drawn.width / 2,
        y: drawn.y + drawn.height / 2,
      });
      expect(zoneDropTargetAt(scene, on.x, on.y)).toBe(hand.id);
      // Its count is drawn where the hand is.
      const count = scene.counts.find((node) => node.zoneId === hand.id);
      if (count) {
        const at = depth.point(count.anchor, 0, true);
        expect(at.y).toBeGreaterThanOrEqual(-1);
        expect(at.y).toBeLessThanOrEqual(height + 1);
      }
    }
    // The near bench's foot, where the board was laid out under the hand's
    // strip before, is the bench.
    const bench = scene.zones
      .filter((zone) => zone.kind === 'bench')
      .sort((a, b) => b.bounds.y - a.bounds.y)[0]!;
    const foot = projectTablePoint(depth.camera, {
      x: bench.bounds.x + bench.bounds.width / 2,
      y: bench.bounds.y + bench.bounds.height - 4,
      z: 0,
    });
    const back = depth.boardPoint(foot);
    expect(zoneDropTargetAt(scene, back.x, back.y)).toBe(bench.id);
  });

  it('leaves a board laid out with the hands inside as it was', () => {
    const scene = sceneAt(1440, 900, false);
    const depth = new BoardDepthProjection(scene, preferences);
    const { near } = hands(scene, 900);
    expect(depth.handBounds(near)).toEqual(near.bounds);
    expect(depth.point({ x: 10, y: 850 }, 0, true)).toEqual({ x: 10, y: 850 });
  });
});
