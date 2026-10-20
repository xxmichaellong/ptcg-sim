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

  it('sets a pile cover off from where the card put on it was, and lands it as the pile', () => {
    const motion = new TablePoseMotion();
    // The cover lies on its pile; the card put on it was across the table.
    const pile = { ...pose(500, 20), thickness: 20 };
    motion.set('cover', pile, 0);
    const card = pose(0, 1);
    const onTop = { ...pose(500, 20.5), thickness: 0.5 };
    const grown = { ...pose(500, 20.5), thickness: 20.5 };
    motion.set('cover', onTop, 0, 400, card, 0, 0, false, {
      restart: true,
      becomes: grown,
    });
    // It sets off from the card, not from the pile it already covered.
    expect(motion.sample('cover', 0)!.bounds.x).toBe(0);
    // It travels as one card...
    const midway = motion.sample('cover', 200)!;
    expect(midway.bounds.x).toBeGreaterThan(0);
    expect(midway.bounds.x).toBeLessThan(500);
    expect(midway.thickness).toBe(0.5);
    // ...is going to be the pile, as far as a newer move can tell...
    expect(motion.target('cover')).toEqual(grown);
    // ...and is the pile once it lands.
    expect(motion.sample('cover', 400)).toEqual(grown);
    expect(motion.active).toBe(false);
    // Finished early, it is the pile too.
    motion.set('cover', onTop, 400, 400, card, 0, 0, false, {
      restart: true,
      becomes: grown,
    });
    motion.finish();
    expect(motion.poses.get('cover')).toEqual(grown);
  });
});
