import { describe, expect, it } from 'vitest';
import {
  createTableCamera,
  projectTableCard,
  projectTablePoint,
  tableCardMatrix,
  tablePileHeight,
  unprojectTablePoint,
} from './table-camera.js';

describe('table camera', () => {
  it.each(['flat', 'depth', 'table'] as const)(
    'round trips board and elevated cursor points in %s mode',
    (mode) => {
      for (const width of [320, 724, 1109, 1920]) {
        for (const tiltDegrees of [0, 8, 18]) {
          const camera = createTableCamera({
            width,
            height: 840,
            mode,
            tiltDegrees,
          });
          for (const z of [0, 1, 36, 72]) {
            for (const x of [0, width / 2, width]) {
              for (const y of [0, 420, 840]) {
                const point = unprojectTablePoint(
                  camera,
                  projectTablePoint(camera, { x, y, z }),
                  z
                )!;
                expect(point.x).toBeCloseTo(x, 7);
                expect(point.y).toBeCloseTo(y, 7);
              }
            }
          }
        }
      }
    }
  );

  it('keeps flat mode exactly at the original board coordinates', () => {
    const camera = createTableCamera({
      width: 1100,
      height: 840,
      mode: 'flat',
    });
    expect(projectTablePoint(camera, { x: 220, y: 710, z: 80 })).toEqual({
      x: 220,
      y: 710,
    });
  });

  it('fits the raised near edge as well as the board plane inside the viewport', () => {
    const camera = createTableCamera({
      width: 724,
      height: 768,
      mode: 'table',
      tiltDegrees: 18,
      maximumElevation: 90,
      margin: 16,
    });
    for (const z of [0, 90]) {
      for (const point of projectTableCard(
        camera,
        { x: 0, y: 0, width: 724, height: 768 },
        z
      )) {
        expect(point.x).toBeGreaterThanOrEqual(16 - 1e-8);
        expect(point.x).toBeLessThanOrEqual(708 + 1e-8);
        expect(point.y).toBeGreaterThanOrEqual(16 - 1e-8);
        expect(point.y).toBeLessThanOrEqual(752 + 1e-8);
      }
    }
  });

  it('projects DOM image corners identically to the shared quad in every orientation', () => {
    const camera = createTableCamera({
      width: 1280,
      height: 900,
      mode: 'table',
      tiltDegrees: 14,
    });
    const bounds = { x: 410, y: 640, width: 100, height: 140 };
    for (const turn of [0, 1, 2, 3]) {
      const matrix = tableCardMatrix(camera, bounds, 52, turn);
      const quad = projectTableCard(camera, bounds, 52, turn);
      [
        [0, 0],
        [100, 0],
        [100, 140],
        [0, 140],
      ].forEach(([x, y], index) => {
        const w = matrix[3]! * x! + matrix[7]! * y! + matrix[15]!;
        expect(
          (matrix[0]! * x! + matrix[4]! * y! + matrix[12]!) / w
        ).toBeCloseTo(quad[index]!.x, 7);
        expect(
          (matrix[1]! * x! + matrix[5]! * y! + matrix[13]!) / w
        ).toBeCloseTo(quad[index]!.y, 7);
      });
    }
  });

  it('keeps the same grip point under the pointer when a card lifts', () => {
    const camera = createTableCamera({
      width: 1100,
      height: 840,
      mode: 'table',
    });
    const pointer = projectTablePoint(camera, { x: 735, y: 682, z: 1 });
    const lifted = unprojectTablePoint(camera, pointer, 55)!;
    const projected = projectTablePoint(camera, { ...lifted, z: 55 });
    expect(projected.x).toBeCloseTo(pointer.x, 7);
    expect(projected.y).toBeCloseTo(pointer.y, 7);
    expect(lifted.y).not.toBe(682);
  });

  it('rejects non-finite pointers and contains malformed camera preferences', () => {
    const camera = createTableCamera({
      width: NaN,
      height: 0,
      mode: 'table',
      tiltDegrees: Infinity,
      margin: -100,
    });
    expect(unprojectTablePoint(camera, { x: NaN, y: 0 })).toBeNull();
    expect(Object.values(camera).every(Number.isFinite)).toBe(true);
  });
});

describe('pile height', () => {
  it('keeps elevated picking exact throughout bounded pointer parallax', () => {
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1]) {
        const camera = createTableCamera({
          width: 1440,
          height: 900,
          mode: 'table',
          tiltDegrees: 18,
          viewpoint: { x, y },
        });
        for (const z of [0, 2, 28, 80]) {
          const original = { x: 865, y: 712, z };
          const point = projectTablePoint(camera, original);
          const restored = unprojectTablePoint(camera, point, z)!;
          expect(restored.x).toBeCloseTo(original.x, 8);
          expect(restored.y).toBeCloseTo(original.y, 8);
        }
      }
  });
  it('changes on every draw, is empty at zero, and scales with card width', () => {
    expect(tablePileHeight(0, 100)).toBe(0);
    for (let count = 1; count <= 60; count++)
      expect(tablePileHeight(count, 100)).toBeGreaterThan(
        tablePileHeight(count - 1, 100)
      );
    expect(tablePileHeight(60, 200)).toBe(tablePileHeight(60, 100) * 2);
    expect(tablePileHeight(60, 100, 0)).toBe(0);
  });

  it('compresses unusually large sandbox piles without unbounded geometry', () => {
    expect(tablePileHeight(120, 100)).toBeGreaterThan(tablePileHeight(60, 100));
    expect(tablePileHeight(1e9, 100)).toBeLessThanOrEqual(66);
    expect(tablePileHeight(-1, 100)).toBe(0);
    expect(tablePileHeight(NaN, 100)).toBe(0);
  });
});
