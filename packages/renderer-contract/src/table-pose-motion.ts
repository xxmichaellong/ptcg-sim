import type { TableCardPose } from './board-depth.js';
import { springStateAt, SPRING_PRESETS } from './spring.js';

export const sameTablePose = (a: TableCardPose, b: TableCardPose): boolean =>
  a.bounds.x === b.bounds.x &&
  a.bounds.y === b.bounds.y &&
  a.bounds.width === b.bounds.width &&
  a.bounds.height === b.bounds.height &&
  a.elevation === b.elevation &&
  a.thickness === b.thickness &&
  a.turns === b.turns &&
  a.plane === b.plane;

export const interpolateTablePose = (
  a: TableCardPose,
  b: TableCardPose,
  progress: number
): TableCardPose => {
  const mix = (from: number, to: number) => from + (to - from) * progress;
  let turns = (((b.turns - a.turns) % 4) + 4) % 4;
  if (turns > 2) turns -= 4;
  return {
    bounds: {
      x: mix(a.bounds.x, b.bounds.x),
      y: mix(a.bounds.y, b.bounds.y),
      width: Math.max(1, mix(a.bounds.width, b.bounds.width)),
      height: Math.max(1, mix(a.bounds.height, b.bounds.height)),
    },
    turns: a.turns + turns * progress,
    elevation: Math.max(0, mix(a.elevation, b.elevation)),
    thickness: Math.max(0, mix(a.thickness, b.thickness)),
    plane: Math.max(0, Math.min(1, mix(a.plane, b.plane))),
  };
};

interface Travel {
  from: TableCardPose;
  to: TableCardPose;
  start: number;
  duration: number;
  delay: number;
}
/** Pure, interruptible pose timing, driven by a renderer's single on-demand clock. */
export class TablePoseMotion {
  readonly poses = new Map<string, TableCardPose>();
  private readonly travel = new Map<string, Travel>();
  get active() {
    return this.travel.size > 0;
  }
  has(key: string) {
    return this.travel.has(key);
  }
  target(key: string) {
    return this.travel.get(key)?.to ?? this.poses.get(key);
  }
  set(
    key: string,
    target: TableCardPose,
    now: number,
    duration = 0,
    from?: TableCardPose,
    delay = 0
  ) {
    const oldTarget = this.target(key);
    if (duration > 0 && oldTarget && sameTablePose(oldTarget, target)) return;
    const current = this.sample(key, now) ?? from ?? target;
    this.travel.delete(key);
    if (duration <= 0 || sameTablePose(current, target)) {
      this.poses.set(key, target);
      return;
    }
    this.poses.set(key, current);
    this.travel.set(key, {
      from: current,
      to: target,
      start: now,
      duration,
      delay,
    });
  }
  sample(key: string, now: number): TableCardPose | undefined {
    const travel = this.travel.get(key);
    if (!travel) return this.poses.get(key);
    const progress = Math.max(
      0,
      (now - travel.start - travel.delay) / travel.duration
    );
    if (progress >= 1) {
      this.travel.delete(key);
      this.poses.set(key, travel.to);
      return travel.to;
    }
    const eased =
      1 -
      springStateAt(SPRING_PRESETS.snappy, 1, 0, progress * 0.45).displacement;
    const current = interpolateTablePose(travel.from, travel.to, eased);
    this.poses.set(key, current);
    return current;
  }
  sampleAll(now: number): ReadonlyMap<string, TableCardPose> {
    const changed = new Map<string, TableCardPose>();
    for (const key of this.travel.keys()) {
      const pose = this.sample(key, now);
      if (pose) changed.set(key, pose);
    }
    return changed;
  }
  delete(key: string) {
    this.travel.delete(key);
    this.poses.delete(key);
  }
  finish() {
    for (const [key, travel] of this.travel) this.poses.set(key, travel.to);
    this.travel.clear();
  }
  clear() {
    this.travel.clear();
    this.poses.clear();
  }
}
