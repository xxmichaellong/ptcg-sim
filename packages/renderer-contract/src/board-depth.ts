import type { ViewCardId } from '@ptcgsim/game-core';
import { containsPoint } from './geometry.js';
import { compositionHold } from './card-composition.js';
import { looseBoardTargetAt } from './drag.js';
import type {
  BoardPreferences,
  BoardDepthPreferences,
  BoardPresentation,
  BoardScene,
  CardSceneNode,
  MarkerSceneNode,
  Rect,
} from './model.js';
import {
  createTableCamera,
  TABLE_TILT_MAXIMUM,
  projectTablePoint,
  tableCardMatrix,
  unprojectTablePoint,
  tablePileHeight,
  type TableCamera,
  type TablePoint,
} from './table-camera.js';

export type { BoardDepthPreferences } from './model.js';
export const DEFAULT_BOARD_DEPTH: BoardDepthPreferences = Object.freeze({
  mode: 'flat',
  tilt: 22,
  strength: 1,
  lift: true,
  animate: true,
  parallax: false,
  scatter: true,
});
export const parseBoardDepth = (value: unknown): BoardDepthPreferences => {
  if (!value || typeof value !== 'object') return DEFAULT_BOARD_DEPTH;
  const number = (key: string, fallback: number, max: number) => {
    const candidate = Reflect.get(value, key);
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.max(0, Math.min(max, candidate))
      : fallback;
  };
  const mode = Reflect.get(value, 'mode');
  return {
    mode: mode === 'depth' || mode === 'table' ? mode : 'flat',
    tilt: number('tilt', DEFAULT_BOARD_DEPTH.tilt, TABLE_TILT_MAXIMUM),
    strength: number('strength', 1, 2),
    lift: Reflect.get(value, 'lift') !== false,
    animate: Reflect.get(value, 'animate') !== false,
    parallax: Reflect.get(value, 'parallax') === true,
    scatter: Reflect.get(value, 'scatter') !== false,
  };
};

/** A number in [0, 1) that a key always gives, for a card's resting lie. */
const keyedUnit = (key: string, salt: number): number => {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return ((hash >>> 0) % 10007) / 10007;
};

/** A physical face. Plane blends from the flat hand (0) to the table (1). */
export interface TableCardPose {
  readonly bounds: Rect;
  readonly turns: number;
  readonly elevation: number;
  readonly thickness: number;
  readonly plane: number;
  /** Turned about its long axis while being turned over (radians). */
  readonly flip?: number;
}
export const tablePoseMatrix = (
  camera: TableCamera,
  pose: TableCardPose
): readonly number[] => {
  const projected = tableCardMatrix(
    camera,
    pose.bounds,
    pose.elevation,
    pose.turns,
    pose.flip ?? 0
  );
  if (pose.plane === 1) return projected;
  const flat = tableCardMatrix(
    {
      ...camera,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      sine: 0,
      cosine: 1,
      inverseDistance: 0,
      skewX: 0,
      skewY: 0,
    },
    pose.bounds,
    0,
    pose.turns
  );
  return pose.plane === 0
    ? flat
    : projected.map(
        (n, index) => flat[index]! + (n - flat[index]!) * pose.plane
      );
};
export const tablePoseQuad = (
  camera: TableCamera,
  pose: TableCardPose
): readonly TablePoint[] => {
  const m = tablePoseMatrix(camera, pose);
  return [
    [0, 0],
    [pose.bounds.width, 0],
    [pose.bounds.width, pose.bounds.height],
    [0, pose.bounds.height],
  ].map(([x, y]) => {
    const w = m[3]! * x! + m[7]! * y! + m[15]!;
    return {
      x: (m[0]! * x! + m[4]! * y! + m[12]!) / w,
      y: (m[1]! * x! + m[5]! * y! + m[13]!) / w,
    };
  });
};
export const quadBounds = (quad: readonly TablePoint[]): Rect => {
  const x = Math.min(...quad.map((p) => p.x));
  const y = Math.min(...quad.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...quad.map((p) => p.x)) - x,
    height: Math.max(...quad.map((p) => p.y)) - y,
  };
};

/** Invert the painted face itself, including a hand/table transition. */
export const tablePoseLocalPoint = (
  camera: TableCamera,
  pose: TableCardPose,
  point: TablePoint
): TablePoint | null => {
  const m = tablePoseMatrix(camera, pose);
  const [a, b, c, d, e, f, g, h, i] = [
    m[0]!,
    m[4]!,
    m[12]!,
    m[1]!,
    m[5]!,
    m[13]!,
    m[3]!,
    m[7]!,
    m[15]!,
  ];
  const w =
    (d * h - e * g) * point.x + (b * g - a * h) * point.y + a * e - b * d;
  if (!Number.isFinite(w) || Math.abs(w) < 1e-10) return null;
  return {
    x:
      ((e * i - f * h) * point.x + (c * h - b * i) * point.y + b * f - c * e) /
      w,
    y:
      ((f * g - d * i) * point.x + (a * i - c * g) * point.y + c * d - a * f) /
      w,
  };
};

/** Neutral paper/sleeve edges. Geometry is bounded independently of pile size. */
export const tablePoseEdges = (
  camera: TableCamera,
  pose: TableCardPose,
  bands: number
) => {
  const top = [
    { x: 0, y: 0 },
    { x: pose.bounds.width, y: 0 },
    { x: pose.bounds.width, y: pose.bounds.height },
    { x: 0, y: pose.bounds.height },
  ];
  const localQuad = (value: TableCardPose) =>
    tablePoseQuad(camera, value).map(
      (point) => tablePoseLocalPoint(camera, pose, point) ?? point
    );
  const bottom = localQuad({
    ...pose,
    elevation: pose.elevation - pose.thickness,
  });
  const path = (points: readonly TablePoint[]) =>
    `M${points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join('L')}Z`;
  const sides = top
    .map((_, index) =>
      path([
        top[index]!,
        bottom[index]!,
        bottom[(index + 1) % 4]!,
        top[(index + 1) % 4]!,
      ])
    )
    .join('');
  const lines = Array.from(
    { length: Math.min(8, Math.max(0, bands - 1)) },
    (_, index) => {
      const ratio = (index + 1) / (Math.min(8, bands - 1) + 1);
      return path(
        top.map((point, i) => ({
          x: point.x + (bottom[i]!.x - point.x) * ratio,
          y: point.y + (bottom[i]!.y - point.y) * ratio,
        }))
      );
    }
  ).join('');
  // Two shadows, as a card under a lamp has: a dark contact shadow right
  // beneath it that is gone once it lifts, and a soft cast shadow that
  // slides away, spreads and fades as it rises. The light is to the upper
  // left, as the markers and the card glare assume.
  const above = Math.max(0, pose.elevation - pose.thickness);
  const shadow = path(
    localQuad({
      ...pose,
      elevation: 0,
      flip: 0,
      bounds: {
        ...pose.bounds,
        x: pose.bounds.x + 0.1 * above,
        y: pose.bounds.y + 1.2 + 0.22 * above,
      },
    })
  );
  const contact = path(
    localQuad({
      ...pose,
      elevation: 0,
      flip: 0,
      bounds: { ...pose.bounds, y: pose.bounds.y + 0.6 },
    })
  );
  return { sides, lines, shadow, contact, above };
};

/**
 * How a card's two shadows look at a height above the table: the cast
 * shadow's blur and strength, and the contact shadow's strength.
 */
export const tableShadowStyle = (
  above: number,
  cardWidth: number
): {
  readonly castBlur: number;
  readonly castOpacity: number;
  readonly contactOpacity: number;
} => {
  const width = Math.max(1, cardWidth);
  const rise = Math.max(0, above);
  return {
    // Resting cards keep a crisp shadow: a blur on every card on the table
    // would cost more than it shows.
    castBlur: rise < 1 ? 0 : Math.min(18, 0.02 * width + 0.25 * rise),
    castOpacity: 0.32 - 0.18 * Math.min(1, rise / width),
    contactOpacity: 0.45 * Math.max(0, 1 - rise / (0.15 * width)),
  };
};

/** Shared between renderers and overlays; it only reads recipient-safe scenes. */
export class BoardDepthProjection {
  readonly settings: BoardDepthPreferences;
  readonly camera: TableCamera;
  readonly enabled: boolean;
  readonly poses = new Map<ViewCardId, TableCardPose>();
  readonly pileCounts = new Map<ViewCardId, number>();
  /** How high a held card rises, as a share of its width (0 when off). */
  readonly liftRatio: number;
  private readonly hands: readonly Rect[];
  private readonly painted: readonly CardSceneNode[];

  constructor(
    readonly scene: BoardScene,
    preferences: BoardPreferences
  ) {
    this.settings = parseBoardDepth(preferences.depth);
    this.enabled = this.settings.mode !== 'flat';
    // The tilted table must fit the window between the hands, which stay
    // flat along its edges, with a full deck standing on it. Both come from
    // the layout alone: a camera that moved with every draw would shift the
    // whole table and stop every card in flight.
    const centre = scene.viewport.height / 2;
    const handStrips = scene.zones.filter((zone) => zone.kind === 'hand');
    const fitTop = Math.max(
      0,
      ...handStrips
        .filter((zone) => zone.bounds.y + zone.bounds.height / 2 < centre)
        .map((zone) => zone.bounds.y + zone.bounds.height)
    );
    const fitBottom = Math.min(
      scene.viewport.height,
      ...handStrips
        .filter((zone) => zone.bounds.y + zone.bounds.height / 2 >= centre)
        .map((zone) => zone.bounds.y)
    );
    const fitBounds =
      fitBottom > fitTop
        ? {
            x: 0,
            y: fitTop,
            width: scene.viewport.width,
            height: fitBottom - fitTop,
          }
        : undefined;
    const deckWidth = Math.max(
      0,
      ...scene.zones
        .filter((zone) => zone.kind === 'deck')
        .map((zone) => zone.bounds.width)
    );
    const fullDeck = tablePileHeight(60, deckWidth, this.settings.strength);
    this.camera = createTableCamera({
      ...scene.viewport,
      mode: this.settings.mode,
      tiltDegrees: this.settings.tilt,
      maximumElevation: fullDeck,
      ...(fitBounds ? { fitBounds } : {}),
      margin: this.enabled ? 8 : 0,
      ...(this.settings.parallax &&
      !preferences.reducedMotion &&
      preferences.animationSpeed !== 0 &&
      preferences.viewpoint
        ? { viewpoint: preferences.viewpoint }
        : {}),
    });
    // A held card rises about half its width, enough to read as picked up.
    // With reduced motion it is still raised, only without moving there.
    this.liftRatio =
      this.enabled && this.settings.lift ? 0.45 * this.settings.strength : 0;
    this.hands = scene.zones
      .filter((zone) => zone.kind === 'hand')
      .map((zone) => zone.bounds);
    this.painted = scene.cards
      .filter((card) => card.renderKey !== null)
      .sort((a, b) => b.zIndex - a.zIndex);
    const zones = new Map(scene.zones.map((zone) => [zone.id, zone]));
    const layers = new Map<string, number>();
    for (const card of [...this.painted].reverse()) {
      const zone = zones.get(card.parentId);
      const flat =
        zone?.kind === 'hand' ||
        card.role === 'inspection' ||
        card.role === 'attachmentResolution';
      const unit =
        flat || !this.enabled
          ? 0
          : tablePileHeight(1, card.bounds.width, this.settings.strength);
      const pile =
        card.primaryAction &&
        zone &&
        ['deck', 'discard', 'lostZone'].includes(zone.kind);
      const previous = layers.get(card.parentId) ?? 0;
      // Joined panels share a physical layer. BREAK is an overlapping layer.
      const level =
        card.composition?.kind === 'joined'
          ? Math.max(1, previous)
          : previous + 1;
      layers.set(card.parentId, level);
      const thickness =
        pile && this.enabled
          ? tablePileHeight(
              zone.count,
              card.bounds.width,
              this.settings.strength
            )
          : unit;
      const elevation = pile
        ? thickness
        : card.role === 'stackEvolution' ||
            card.role === 'stackAttachment' ||
            card.composition?.kind === 'overlay'
          ? level * unit
          : unit;
      if (pile) this.pileCounts.set(card.id, zone.count);
      // A card put down by hand lies a touch askew: a fraction of a degree
      // (more for Prizes, dealt face down in a hurry) and a hair off true.
      // The same card always lies the same way; piles, the hand and joined
      // panels stay square.
      const scattered =
        this.enabled &&
        this.settings.scatter !== false &&
        !flat &&
        !pile &&
        card.renderKey !== null &&
        card.composition?.kind !== 'joined';
      const key = card.renderKey ?? '';
      const degrees = zone?.kind === 'prizes' ? 1.2 : 0.6;
      const spread = card.bounds.width * 0.005;
      this.poses.set(card.id, {
        bounds: scattered
          ? {
              ...card.bounds,
              x: card.bounds.x + (keyedUnit(key, 1) - 0.5) * 2 * spread,
              y: card.bounds.y + (keyedUnit(key, 2) - 0.5) * 2 * spread,
            }
          : card.bounds,
        turns:
          card.rotationQuarterTurns +
          (scattered ? ((keyedUnit(key, 3) - 0.5) * 2 * degrees) / 90 : 0),
        elevation,
        thickness,
        plane: flat ? 0 : 1,
      });
    }
  }

  pose(card: CardSceneNode, presentation?: BoardPresentation): TableCardPose {
    const base = this.poses.get(card.id) ?? {
      bounds: card.bounds,
      turns: card.rotationQuarterTurns,
      elevation: 0,
      thickness: 0,
      plane: 0,
    };
    const drag = compositionHold(this.scene, card, presentation?.drag);
    const hold =
      drag ??
      presentation?.settling
        .map((entry) => compositionHold(this.scene, card, entry))
        .find(Boolean);
    if (!hold) return base;
    return {
      ...base,
      bounds: {
        ...base.bounds,
        x: hold.x - base.bounds.width / 2,
        y: hold.y - base.bounds.height / 2,
      },
      plane: this.enabled ? 1 : base.plane,
      elevation: base.elevation + (drag ? this.liftFor(base.bounds.width) : 0),
      thickness: Math.min(
        base.thickness,
        tablePileHeight(1, base.bounds.width, this.settings.strength)
      ),
    };
  }

  /** How high a held card of this width rises. */
  liftFor(cardWidth: number): number {
    return this.liftRatio * cardWidth;
  }

  point(point: TablePoint, elevation = 0, flat = false): TablePoint {
    return flat || !this.enabled
      ? point
      : projectTablePoint(this.camera, { ...point, z: elevation });
  }

  boardPoint(point: TablePoint): TablePoint {
    if (
      !this.enabled ||
      this.hands.some((bounds) => containsPoint(bounds, point.x, point.y))
    )
      return point;
    return unprojectTablePoint(this.camera, point, 0) ?? point;
  }

  cardPoint(
    card: CardSceneNode,
    point: TablePoint,
    pose = this.pose(card)
  ): TablePoint {
    return pose.plane === 0 || !this.enabled
      ? point
      : (unprojectTablePoint(this.camera, point, pose.elevation) ?? point);
  }

  bounds(card: CardSceneNode): Rect {
    return quadBounds(tablePoseQuad(this.camera, this.pose(card)));
  }

  drop(
    point: TablePoint,
    sourceId: ViewCardId,
    paintedPose?: (card: CardSceneNode) => TableCardPose | undefined
  ): { point: TablePoint; targetId: string | null } {
    const source = this.scene.cards.find((card) => card.id === sourceId);
    for (const card of this.painted) {
      if (
        !card.interactive ||
        card.id === sourceId ||
        (source?.composition && source.parentId === card.parentId)
      )
        continue;
      const pose = paintedPose?.(card) ?? this.pose(card);
      const face = tablePoseLocalPoint(this.camera, pose, point);
      if (
        !face ||
        !containsPoint(
          { x: 0, y: 0, width: pose.bounds.width, height: pose.bounds.height },
          face.x,
          face.y
        )
      )
        continue;
      // Return the logical target point even when its painted face is in flight.
      const x = (face.x / pose.bounds.width - 0.5) * card.bounds.width;
      const y = (face.y / pose.bounds.height - 0.5) * card.bounds.height;
      const angle = (card.rotationQuarterTurns * Math.PI) / 2;
      const local = {
        x:
          card.bounds.x +
          card.bounds.width / 2 +
          x * Math.cos(angle) -
          y * Math.sin(angle),
        y:
          card.bounds.y +
          card.bounds.height / 2 +
          x * Math.sin(angle) +
          y * Math.cos(angle),
      };
      if (card.clipBounds && !containsPoint(card.clipBounds, local.x, local.y))
        continue;
      return { point: local, targetId: card.parentId };
    }
    const local = this.boardPoint(point);
    const zone = [...this.scene.zones]
      .sort((a, b) => b.zIndex - a.zIndex)
      .find(
        (zone) =>
          zone.interactive && containsPoint(zone.bounds, local.x, local.y)
      );
    return {
      point: local,
      targetId: zone?.id ?? looseBoardTargetAt(this.scene, local.x, local.y),
    };
  }

  marker(marker: MarkerSceneNode, pose?: TableCardPose): MarkerSceneNode {
    const parent = this.scene.cards.find(
      (card) => card.id === marker.parentCardId
    );
    const base = parent ? this.pose(parent) : undefined;
    const current = pose ?? base;
    const center = this.point(
      {
        x:
          marker.bounds.x +
          marker.bounds.width / 2 +
          (pose && base ? pose.bounds.x - base.bounds.x : 0),
        y:
          marker.bounds.y +
          marker.bounds.height / 2 +
          (pose && base ? pose.bounds.y - base.bounds.y : 0),
      },
      (current?.elevation ?? 0) + 1,
      current?.plane === 0
    );
    return {
      ...marker,
      bounds: {
        ...marker.bounds,
        x: center.x - marker.bounds.width / 2,
        y: center.y - marker.bounds.height / 2,
      },
    };
  }
}
