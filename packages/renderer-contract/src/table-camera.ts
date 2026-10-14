import type { Rect } from './model.js';

export type TableViewMode = 'flat' | 'depth' | 'table';
export interface TablePoint {
  readonly x: number;
  readonly y: number;
}
export interface TablePoint3D extends TablePoint {
  readonly z: number;
}
export interface TableCamera {
  readonly width: number;
  readonly height: number;
  readonly sine: number;
  readonly cosine: number;
  readonly inverseDistance: number;
  readonly skewX: number;
  readonly skewY: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The steepest a player may tilt the table, in degrees. */
export const TABLE_TILT_MAXIMUM = 35;
/**
 * How far the eye sits from the table, as a multiple of the window's
 * diagonal: about a 37° lens, like looking down at a mat on a desk.
 */
export const TABLE_LENS = 1.5;
/**
 * A card's thickness as a share of its width: a sleeved card, so a
 * sixty-card deck stands about half a card wide.
 */
export const TABLE_CARD_THICKNESS = 0.008;

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;
const bounded = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

/** A bounded presentation camera. It never changes the logical board layout. */
export const createTableCamera = (options: {
  readonly width: number;
  readonly height: number;
  readonly mode: TableViewMode;
  readonly tiltDegrees?: number;
  readonly margin?: number;
  readonly maximumElevation?: number;
  readonly viewpoint?: TablePoint;
  /**
   * What must fit in the window once tilted: the table's zones. The hands
   * stay flat along the edges, so the mat may reach under them. The whole
   * window when absent.
   */
  readonly fitBounds?: Rect;
  /** The eye's distance as a multiple of the window's diagonal. */
  readonly lens?: number;
}): TableCamera => {
  const width = Math.max(1, finite(options.width, 1));
  const height = Math.max(1, finite(options.height, 1));
  const radians =
    options.mode === 'table'
      ? (bounded(finite(options.tiltDegrees ?? 10, 10), 0, TABLE_TILT_MAXIMUM) *
          Math.PI) /
        180
      : 0;
  const camera: TableCamera = {
    width,
    height,
    sine: Math.sin(radians),
    cosine: Math.cos(radians),
    inverseDistance:
      options.mode === 'table'
        ? 1 /
          (bounded(finite(options.lens ?? TABLE_LENS, TABLE_LENS), 0.8, 4) *
            Math.hypot(width, height))
        : 0,
    skewX:
      (options.mode === 'depth' ? -0.14 : 0) +
      (options.mode === 'flat'
        ? 0
        : bounded(finite(options.viewpoint?.x ?? 0, 0), -1, 1) * 0.12),
    skewY:
      (options.mode === 'depth' ? -0.35 : 0) +
      (options.mode === 'flat'
        ? 0
        : bounded(finite(options.viewpoint?.y ?? 0, 0), -1, 1) * 0.08),
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  if (options.mode === 'flat') return camera;
  const maximumElevation = bounded(
    finite(options.maximumElevation ?? 90, 90),
    0,
    Math.min(width, height) * 0.25
  );
  const fit =
    options.fitBounds &&
    [
      options.fitBounds.x,
      options.fitBounds.y,
      options.fitBounds.width,
      options.fitBounds.height,
    ].every(Number.isFinite) &&
    options.fitBounds.width > 0 &&
    options.fitBounds.height > 0
      ? options.fitBounds
      : { x: 0, y: 0, width, height };
  const points = [0, maximumElevation].flatMap((z) =>
    [
      { x: fit.x, y: fit.y, z },
      { x: fit.x + fit.width, y: fit.y, z },
      { x: fit.x + fit.width, y: fit.y + fit.height, z },
      { x: fit.x, y: fit.y + fit.height, z },
    ].map((point) => projectTablePoint(camera, point))
  );
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const margin = bounded(
    finite(options.margin ?? 12, 12),
    0,
    Math.min(width, height) * 0.1
  );
  const scale = Math.min(
    1,
    (width - 2 * margin) / (maxX - minX),
    (height - 2 * margin) / (maxY - minY)
  );
  return {
    ...camera,
    scale,
    offsetX: -scale * ((minX + maxX) / 2 - width / 2),
    offsetY: -scale * ((minY + maxY) / 2 - height / 2),
  };
};

const homogeneous = (
  camera: TableCamera,
  point: TablePoint3D
): readonly [number, number, number] => {
  const dx = point.x - camera.width / 2;
  const dy = point.y - camera.height / 2;
  const w =
    1 - (dy * camera.sine + point.z * camera.cosine) * camera.inverseDistance;
  return [
    (camera.width / 2 + camera.offsetX) * w +
      camera.scale * (dx + camera.skewX * point.z),
    (camera.height / 2 + camera.offsetY) * w +
      camera.scale *
        (dy * camera.cosine - point.z * camera.sine + camera.skewY * point.z),
    w,
  ];
};

export const projectTablePoint = (
  camera: TableCamera,
  point: TablePoint3D
): TablePoint => {
  const [x, y, w] = homogeneous(camera, point);
  if (![x, y, w].every(Number.isFinite) || w <= 0)
    throw new RangeError('Point is outside the table camera');
  return { x: x / w, y: y / w };
};

/** Intersect the cursor ray with a known elevation, including a lifted drag. */
export const unprojectTablePoint = (
  camera: TableCamera,
  point: TablePoint,
  elevation = 0
): TablePoint | null => {
  if (![point.x, point.y, elevation].every(Number.isFinite)) return null;
  const x = (point.x - camera.width / 2 - camera.offsetX) / camera.scale;
  const y = (point.y - camera.height / 2 - camera.offsetY) / camera.scale;
  const denominator = camera.cosine + y * camera.sine * camera.inverseDistance;
  if (Math.abs(denominator) < 1e-8) return null;
  const dy =
    (y * (1 - elevation * camera.cosine * camera.inverseDistance) +
      elevation * (camera.sine - camera.skewY)) /
    denominator;
  const w =
    1 - (dy * camera.sine + elevation * camera.cosine) * camera.inverseDistance;
  if (w <= 0) return null;
  return {
    x: camera.width / 2 + x * w - camera.skewX * elevation,
    y: camera.height / 2 + dy,
  };
};

/**
 * A point on a card's face in the table's space. `flip` turns the card
 * about its long axis (radians; 0 lies flat, ±π/2 stands on its edge), as
 * a card is turned over by hand. The face stays a plane, so its projection
 * is still one homography and picking inverts it exactly.
 */
const cardPoint = (
  bounds: Rect,
  quarterTurns: number,
  x: number,
  y: number,
  z: number,
  flip = 0
): TablePoint3D => {
  const radians = (quarterTurns * Math.PI) / 2;
  const dx = (x - bounds.width / 2) * Math.cos(flip);
  const dy = y - bounds.height / 2;
  return {
    x:
      bounds.x +
      bounds.width / 2 +
      dx * Math.cos(radians) -
      dy * Math.sin(radians),
    y:
      bounds.y +
      bounds.height / 2 +
      dx * Math.sin(radians) +
      dy * Math.cos(radians),
    z: z + (x - bounds.width / 2) * Math.sin(flip),
  };
};

export const projectTableCard = (
  camera: TableCamera,
  bounds: Rect,
  elevation: number,
  quarterTurns = 0
): readonly TablePoint[] =>
  [
    [0, 0],
    [bounds.width, 0],
    [bounds.width, bounds.height],
    [0, bounds.height],
  ].map(([x, y]) =>
    projectTablePoint(
      camera,
      cardPoint(bounds, quarterTurns, x!, y!, elevation)
    )
  );

/** The same projection as projectTableCard, expressed for a flat DOM image. */
export const tableCardMatrix = (
  camera: TableCamera,
  bounds: Rect,
  elevation: number,
  quarterTurns = 0,
  flip = 0
): readonly number[] => {
  const origin = homogeneous(
    camera,
    cardPoint(bounds, quarterTurns, 0, 0, elevation, flip)
  );
  const across = homogeneous(
    camera,
    cardPoint(bounds, quarterTurns, 1, 0, elevation, flip)
  ).map((value, index) => value - origin[index]!);
  const down = homogeneous(
    camera,
    cardPoint(bounds, quarterTurns, 0, 1, elevation, flip)
  ).map((value, index) => value - origin[index]!);
  return [
    across[0]!,
    across[1]!,
    0,
    across[2]!,
    down[0]!,
    down[1]!,
    0,
    down[2]!,
    0,
    0,
    1,
    0,
    origin[0],
    origin[1],
    0,
    origin[2],
  ];
};

/** Art-directed world height, not a millimetre claim. Counts remain exact. */
export const tablePileHeight = (
  count: number,
  cardWidth: number,
  strength = 1
): number => {
  const cards = Math.max(0, Math.floor(finite(count, 0)));
  const layers =
    Math.min(cards, 60) +
    Math.min(60, 20 * Math.log1p(Math.max(0, cards - 60) / 20));
  return (
    layers *
    Math.max(0, finite(cardWidth, 0)) *
    TABLE_CARD_THICKNESS *
    bounded(finite(strength, 1), 0, 2)
  );
};
