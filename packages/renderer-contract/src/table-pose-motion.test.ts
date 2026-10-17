import { describe, expect, it } from 'vitest';

import type { TableCardPose } from './board-depth.js';
import { TablePoseMotion } from './table-pose-motion.js';

const pose = (x: number, elevation: number): TableCardPose => ({
  bounds: { x, y: 100, width: 80, height: 112 },
  turns: 0,
  elevation,
  thickness: 0.5,
  plane: 1,
});

const sampled = (motion: TablePoseMotion, duration: number) =>
  Array.from({ length: 41 }, (_, index) =>
    motion.sample('card', (duration * index) / 40)!
  );

describe('TablePoseMotion', () => {
  it('brings a card down to the table without dipping below its mark', () => {
    for (const landing of [false, true]) {
      const motion = new TablePoseMotion();
      motion.set('card', pose(0, 40), 0);
      motion.set('card', pose(0, 1), 0, 200, undefined, 0, 0, landing);
      const heights = sampled(motion, 200).map((frame) => frame.elevation);
      for (const [index, height] of heights.entries()) {
        expect(height).toBeGreaterThanOrEqual(1);
        if (index > 0) expect(height).toBeLessThanOrEqual(heights[index - 1]!);
      }
      expect(heights.at(-1)).toBe(1);
    }
  });

  it('slides a card put down into its place, decelerating and never past it', () => {
    const motion = new TablePoseMotion();
    motion.set('card', pose(0, 10), 0);
    motion.set('card', pose(300, 1), 0, 240, undefined, 0, 0, true);
    const frames = sampled(motion, 240);
    const xs = frames.map((frame) => frame.bounds.x);
    const steps = xs.slice(1).map((x, index) => x - xs[index]!);
    for (const x of xs) expect(x).toBeLessThanOrEqual(300);
    for (const step of steps) expect(step).toBeGreaterThanOrEqual(0);
    // It slows as it arrives.
    expect(steps.at(-1)!).toBeLessThan(steps[0]!);
    // No arc: it never rises on the way.
    for (const [index, frame] of frames.entries())
      if (index > 0)
        expect(frame.elevation).toBeLessThanOrEqual(
          frames[index - 1]!.elevation
        );
  });

  it('arcs a card carried across the table highest halfway, landing on its mark', () => {
    const motion = new TablePoseMotion();
    motion.set('card', pose(0, 1), 0);
    motion.set('card', pose(300, 1), 0, 400, undefined, 0, 30);
    const frames = sampled(motion, 400);
    const heights = frames.map((frame) => frame.elevation);
    const peak = heights.indexOf(Math.max(...heights));
    expect(heights[peak]).toBeGreaterThan(25);
    // Highest about halfway along its path, not over its place.
    const along = frames[peak]!.bounds.x / 300;
    expect(along).toBeGreaterThan(0.35);
    expect(along).toBeLessThan(0.65);
    // Never past its place, and down on its mark at the end.
    for (const frame of frames) expect(frame.bounds.x).toBeLessThanOrEqual(300);
    expect(frames.at(-1)!.bounds.x).toBe(300);
    expect(frames.at(-1)!.elevation).toBe(1);
  });
});
