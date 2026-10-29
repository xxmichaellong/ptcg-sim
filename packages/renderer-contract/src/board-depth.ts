import type { ViewCardId } from '@ptcgsim/game-core';
import { containsPoint } from './geometry.js';
import { compositionHold } from './card-composition.js';
import {
  arrangedCardIds,
  arrangementHold,
  arrangementOffsets,
  benchRearrangementTarget,
} from './arrangement.js';
import {
  heldCentreCardTarget,
  joinedCardTargetAt,
  zoneDropTargetAt,
} from './drag.js';
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

/**
 * How far off, in card widths, the eye sees a flat card (in the hand) being
 * turned over from: near enough that its edges visibly near and recede.
 */
const FLAT_TURN_DISTANCE = 3;

/** The felt left showing between a tilted mat's near edge and a hand. */
const HAND_EDGE_GAP_PX = 6;
/** The most a hand grows to meet a tilted mat. */
const HAND_GROWTH_MAXIMUM = 1.4;
/** A tilted hand keeps at least this share of its flat fan. */
const MIN_HAND_FAN = 0.5;

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
  // Flat, a card being turned over is seen in depth about its own middle,
  // as an eye a few card-widths away would see it; lying still it is flat.
  const flip = pose.flip ?? 0;
  const flat = tableCardMatrix(
    {
      ...camera,
      width: 2 * (pose.bounds.x + pose.bounds.width / 2),
      height: 2 * (pose.bounds.y + pose.bounds.height / 2),
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      sine: 0,
      cosine: 1,
      inverseDistance:
        flip === 0 ? 0 : 1 / (FLAT_TURN_DISTANCE * pose.bounds.width),
      skewX: 0,
      skewY: 0,
    },
    pose.bounds,
    0,
    pose.turns,
    flip
  );
  return pose.plane === 0
    ? flat
    : projected.map(
        (n, index) => flat[index]! + (n - flat[index]!) * pose.plane
      );
};
/** Points on a face, in its own units, where a pose's matrix paints them. */
const projectThrough = (
  m: readonly number[],
  points: readonly TablePoint[]
): readonly TablePoint[] =>
  points.map(({ x, y }) => {
    const w = m[3]! * x + m[7]! * y + m[15]!;
    return {
      x: (m[0]! * x + m[4]! * y + m[12]!) / w,
      y: (m[1]! * x + m[5]! * y + m[13]!) / w,
    };
  });
export const tablePoseQuad = (
  camera: TableCamera,
  pose: TableCardPose
): readonly TablePoint[] =>
  projectThrough(tablePoseMatrix(camera, pose), [
    { x: 0, y: 0 },
    { x: pose.bounds.width, y: 0 },
    { x: pose.bounds.width, y: pose.bounds.height },
    { x: 0, y: pose.bounds.height },
  ]);

/**
 * A card's corner radius across and down, as parts of its width and
 * height: the face's `--ptcgsim-card-radius` (4.8% / 3.4%), about 3 mm on
 * a real card.
 */
const TABLE_CARD_CORNER = Object.freeze({ x: 0.048, y: 0.034 });
/** Straight pieces each rounded corner of a card's edge is drawn with. */
const CORNER_STEPS = 6;

/**
 * The outline of a face of this size, its corners rounded as the face's
 * are, wound as the face is: along its top edge first, then down.
 */
const cardOutline = (width: number, height: number): readonly TablePoint[] => {
  const rx = width * TABLE_CARD_CORNER.x;
  const ry = height * TABLE_CARD_CORNER.y;
  return [
    { x: width - rx, y: ry },
    { x: width - rx, y: height - ry },
    { x: rx, y: height - ry },
    { x: rx, y: ry },
  ].flatMap((centre, corner) =>
    Array.from({ length: CORNER_STEPS + 1 }, (_, step) => {
      const angle = ((corner - 1 + step / CORNER_STEPS) * Math.PI) / 2;
      return {
        x: centre.x + rx * Math.cos(angle),
        y: centre.y + ry * Math.sin(angle),
      };
    })
  );
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
): TablePoint | null => localPointThrough(tablePoseMatrix(camera, pose), point);

/** Where on a face, in its own units, a pose's matrix paints a point. */
const localPointThrough = (
  m: readonly number[],
  point: TablePoint
): TablePoint | null => {
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

/** Twice a polygon's area, positive when it winds as the card's own face does. */
const signedArea = (points: readonly TablePoint[]): number =>
  points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);

/** Neutral paper/sleeve edges. Geometry is bounded independently of pile size. */
export const tablePoseEdges = (
  camera: TableCamera,
  pose: TableCardPose,
  bands: number
) => {
  // The edge follows the face's rounded corners; square ones would stand
  // out past the face at every corner of a pile.
  const top = cardOutline(pose.bounds.width, pose.bounds.height);
  const count = top.length;
  const face = tablePoseMatrix(camera, pose);
  const localOutline = (value: TableCardPose) =>
    projectThrough(tablePoseMatrix(camera, value), top).map(
      (point) => localPointThrough(face, point) ?? point
    );
  const bottom = localOutline({
    ...pose,
    elevation: pose.elevation - pose.thickness,
  });
  const coordinates = (points: readonly TablePoint[]) =>
    points
      .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
      .join('L');
  // Painted through the face's matrix, an outline seen from a card nearly
  // on its edge (mid-turn) maps to points behind the eye or far off the
  // card, whose paths run off toward infinity: the browser then paints,
  // and blurs, a layer of millions of pixels (gigabytes, ~1 GB a second in
  // Firefox). Such a path is left out for the frame.
  const sane = (points: readonly TablePoint[]): boolean =>
    points.every((point) => {
      const w = face[3]! * point.x + face[7]! * point.y + face[15]!;
      return (
        w > 1e-3 &&
        Math.abs(point.x) <= 4 * pose.bounds.width + 1 &&
        Math.abs(point.y) <= 4 * pose.bounds.height + 1
      );
    });
  const path = (points: readonly TablePoint[]) =>
    sane(points) ? `M${coordinates(points)}Z` : '';
  const side = (index: number): readonly TablePoint[] => [
    top[index]!,
    bottom[index]!,
    bottom[(index + 1) % count]!,
    top[(index + 1) % count]!,
  ];
  // Only the pieces of edge turned toward the viewer are drawn. Those wind
  // the same way as the top face (positive area here); the far ones wind
  // the other way, and in one filled path they would cancel the near ones
  // where they overlap, leaving holes the mat shows through.
  const facing = top.map((_, index) => signedArea(side(index)) > 1e-6);
  // Pieces that show next to each other are drawn as one band, round the
  // corner between them, so no seam is outlined where two sides meet. Each
  // run lists the outline's points along it.
  const runs: number[][] = [];
  const start = facing.indexOf(false);
  if (start === -1) runs.push(...top.map((_, index) => [index, index + 1]));
  else
    for (let step = 1; step <= count; step += 1) {
      const index = (start + step) % count;
      if (!facing[index]) continue;
      const after = (index + 1) % count;
      if (facing[(index + count - 1) % count]) runs.at(-1)!.push(after);
      else runs.push([index, after]);
    }
  const sides = runs
    .map((run) =>
      path([
        ...run.map((index) => bottom[index % count]!),
        ...run.map((index) => top[index % count]!).reverse(),
      ])
    )
    .join('');
  const bandCount = Math.min(8, Math.max(0, bands - 1));
  // Where the cards of a pile meet, along the edge that shows.
  const lines = Array.from({ length: bandCount }, (_, band) => {
    const ratio = (band + 1) / (bandCount + 1);
    const at = (index: number): TablePoint => ({
      x: top[index]!.x + (bottom[index]!.x - top[index]!.x) * ratio,
      y: top[index]!.y + (bottom[index]!.y - top[index]!.y) * ratio,
    });
    return runs
      .map((run) => run.map((index) => at(index % count)))
      .filter(sane)
      .map((points) => `M${coordinates(points)}`)
      .join('');
  }).join('');
  // Two shadows, as a card under a lamp has: a dark contact shadow right
  // beneath it that is gone once it lifts, and a soft cast shadow that
  // slides away, spreads and fades as it rises. The light is to the upper
  // left, as the markers and the card glare assume.
  const above = Math.max(0, pose.elevation - pose.thickness);
  const shadow = path(
    localOutline({
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
    localOutline({
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
    // flat along its edges, with a full deck standing on it, and sit centred
    // between them, so the room above it matches the room below. All come from
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
      ...(fitBounds
        ? { fitBounds, centreBand: { top: fitTop, bottom: fitBottom } }
        : {}),
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
    // Tilted, the mat is foreshortened: between a flat hand and the mat's
    // near edge lies a band of bare felt. Each hand comes in to meet the
    // mat's edge, growing by the same share so it still runs off the
    // screen's edge as before; its cards spread no wider than their strip.
    const handFits = new Map<string, (rect: Rect) => Rect>();
    const handReach = new Map<string, Rect>();
    if (this.enabled && this.settings.mode === 'table') {
      for (const zone of handStrips) {
        const strip = zone.bounds;
        if (strip.height <= 0) continue;
        const near = strip.y + strip.height / 2 >= centre;
        const inner = near ? strip.y : strip.y + strip.height;
        const middle = strip.x + strip.width / 2;
        const edge = projectTablePoint(this.camera, {
          x: middle,
          y: inner,
          z: 0,
        }).y;
        const reach = (near ? inner - edge : edge - inner) - HAND_EDGE_GAP_PX;
        if (!(reach > 1)) continue;
        const cards = scene.cards.filter((card) => card.parentId === zone.id);
        const spread = Math.max(
          1,
          ...cards.map((card) =>
            Math.abs(card.bounds.x + card.bounds.width / 2 - middle)
          )
        );
        const widest = Math.max(0, ...cards.map((card) => card.bounds.width));
        // Its inner edge meets the mat's; it grows as far as running off
        // the screen's edge as before asks, within reason (a tilted phone),
        // and never so wide that a narrow strip leaves it less than half its
        // fan (grown wider than the strip, it closed up into one card).
        const grow = Math.min(
          HAND_GROWTH_MAXIMUM,
          (strip.height + reach) / strip.height,
          widest > 0
            ? Math.max(1, (strip.width - 2 * spread * MIN_HAND_FAN) / widest)
            : Infinity
        );
        const reached = near ? inner - reach : inner + reach;
        // A hand that already fills its strip draws in a little, so its
        // outer cards, grown, still end where the strip does (across the
        // table, short of the app bar).
        const across = Math.max(
          0,
          Math.min(grow, (strip.width / 2 - (widest * grow) / 2) / spread)
        );
        handFits.set(zone.id, (rect) => {
          const centreX = middle + (rect.x + rect.width / 2 - middle) * across;
          // Measured from the strip's inner edge, which lands on the mat's.
          const fromInner = near
            ? rect.y - inner
            : rect.y + rect.height - inner;
          const y = reached + fromInner * grow;
          return {
            x: centreX - (rect.width * grow) / 2,
            y: near ? y : y - rect.height * grow,
            width: rect.width * grow,
            height: rect.height * grow,
          };
        });
        handReach.set(zone.id, {
          ...strip,
          y: Math.min(strip.y, reached),
          height:
            Math.max(strip.y + strip.height, reached) -
            Math.min(strip.y, reached),
        });
      }
    }
    this.hands = handStrips.map(
      (zone) => handReach.get(zone.id) ?? zone.bounds
    );
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
          : (handFits.get(card.parentId)?.(card.bounds) ?? card.bounds),
        turns:
          card.rotationQuarterTurns +
          (scattered ? ((keyedUnit(key, 3) - 0.5) * 2 * degrees) / 90 : 0),
        elevation,
        thickness,
        plane: flat ? 0 : 1,
      });
    }
  }

  /** The cards of rows that open a gap for a held card (`drop`). */
  private arrangedCards: ReadonlySet<ViewCardId> | undefined;

  /** The open gap of the zone a card is held over, kept per presentation. */
  private arranged: {
    readonly presentation: BoardPresentation;
    readonly offsets: ReturnType<typeof arrangementOffsets>;
  } | null = null;

  private arrangementOffset(
    card: CardSceneNode,
    presentation?: BoardPresentation
  ): { readonly x: number; readonly y: number } | undefined {
    if (!presentation) return undefined;
    if (this.arranged?.presentation !== presentation)
      this.arranged = {
        presentation,
        offsets: arrangementOffsets(
          this.scene,
          arrangementHold(this.scene, presentation)
        ),
      };
    return this.arranged.offsets.get(card.id);
  }

  pose(card: CardSceneNode, presentation?: BoardPresentation): TableCardPose {
    const resting = this.poses.get(card.id) ?? {
      bounds: card.bounds,
      turns: card.rotationQuarterTurns,
      elevation: 0,
      thickness: 0,
      plane: 0,
    };
    // A zone a card is held over makes room for it.
    const aside = this.arrangementOffset(card, presentation);
    const base = aside
      ? {
          ...resting,
          bounds: {
            ...resting.bounds,
            x: resting.bounds.x + aside.x,
            y: resting.bounds.y + aside.y,
          },
        }
      : resting;
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
    paintedPose?: (card: CardSceneNode) => TableCardPose | undefined,
    /** Only the card, lifted off its Pokémon by a long press. */
    detached = false,
    /** The held card's centre on the table, which aims too over bare felt. */
    centre?: TablePoint
  ): { point: TablePoint; targetId: string | null } {
    const source = this.scene.cards.find((card) => card.id === sourceId);
    this.arrangedCards ??= arrangedCardIds(this.scene);
    // A Pokémon's own cards travel with it under the pointer: they are
    // never where it is dropped.
    const candidates = this.painted.filter(
      (card) =>
        card.interactive &&
        card.id !== sourceId &&
        !(
          source?.role === 'stackEvolution' && source.parentId === card.parentId
        )
    );
    const aim = (
      card: CardSceneNode,
      pose: TableCardPose
    ): { point: TablePoint; targetId: string | null } | undefined => {
      const face = tablePoseLocalPoint(this.camera, pose, point);
      if (
        !face ||
        !containsPoint(
          { x: 0, y: 0, width: pose.bounds.width, height: pose.bounds.height },
          face.x,
          face.y
        )
      )
        return undefined;
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
        return undefined;
      const bench = benchRearrangementTarget(
        this.scene,
        sourceId,
        card,
        detached
      );
      if (bench) return { point: this.boardPoint(point), targetId: bench };
      return { point: local, targetId: card.parentId };
    };
    // What the player sees first: each card where it is painted.
    for (const card of candidates) {
      const hit = aim(card, paintedPose?.(card) ?? this.pose(card));
      if (hit) return hit;
    }
    // Then a card of a row that opens a gap for a held card (a bench, a
    // hand) where it lies, as the flat table aims: aiming there closes the
    // gap and brings it back under the pointer. Its painted place alone,
    // moved aside, kept it from the pointer as the row made room, and the
    // card went in the gap. Never before a card painted there: one moved
    // aside over a neighbour's place is the one the player aims at.
    for (const card of candidates) {
      if (!this.arrangedCards.has(card.id)) continue;
      const hit = aim(card, this.pose(card));
      if (hit) return hit;
    }
    const local = this.boardPoint(point);
    // Between the pieces of a card printed in pieces: the whole card.
    const joined = joinedCardTargetAt(
      this.scene,
      sourceId,
      local.x,
      local.y,
      detached,
      true
    );
    if (joined) return { point: local, targetId: joined };
    const held =
      centre &&
      heldCentreCardTarget(this.scene, sourceId, local, centre, detached);
    if (held) return { point: centre, targetId: held };
    return {
      point: local,
      targetId: zoneDropTargetAt(this.scene, local.x, local.y, centre),
    };
  }

  /**
   * A marker lying on its card: the projection of its own box a hair above
   * the card, wherever the card is painted (held, in flight). Null where
   * the card is flat (the hand), whose markers stay upright on screen.
   */
  markerMatrix(
    marker: MarkerSceneNode,
    pose?: TableCardPose
  ): readonly number[] | null {
    if (!this.enabled) return null;
    const parent = this.scene.cards.find(
      (card) => card.id === marker.parentCardId
    );
    const base = parent ? this.pose(parent) : undefined;
    const current = pose ?? base;
    if (!current || current.plane !== 1) return null;
    return tableCardMatrix(
      this.camera,
      {
        ...marker.bounds,
        x: marker.bounds.x + (pose && base ? pose.bounds.x - base.bounds.x : 0),
        y: marker.bounds.y + (pose && base ? pose.bounds.y - base.bounds.y : 0),
      },
      current.elevation + 1
    );
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
