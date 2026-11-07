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
  a.plane === b.plane &&
  (a.flip ?? 0) === (b.flip ?? 0);

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
    ...(a.flip || b.flip ? { flip: mix(a.flip ?? 0, b.flip ?? 0) } : {}),
  };
};

interface Travel {
  from: TableCardPose;
  to: TableCardPose;
  start: number;
  duration: number;
  delay: number;
  /** How high above its path a card arcs at the middle of the move. */
  arc: number;
  /**
   * A card the player has just put down: it comes to rest in one smooth,
   * decelerating motion, with no spring past its place.
   */
  landing: boolean;
  /** What it is once it arrives, when that is not what travelled: see set. */
  becomes?: TableCardPose;
}

/** Decelerating to rest, never past it. */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * A card carried across the table follows a critically damped spring: quick
 * away, slowing into its place, and never past it. Sampled over this much
 * spring time and scaled to arrive exactly at the end of the move.
 */
const TRAVEL_SPRING_SECONDS = 0.45;
const TRAVEL_SPRING_END =
  1 -
  springStateAt(SPRING_PRESETS.settle, 1, 0, TRAVEL_SPRING_SECONDS)
    .displacement;
const travelEase = (progress: number): number =>
  Math.min(
    1,
    (1 -
      springStateAt(
        SPRING_PRESETS.settle,
        1,
        0,
        progress * TRAVEL_SPRING_SECONDS
      ).displacement) /
      TRAVEL_SPRING_END
  );
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
    const travel = this.travel.get(key);
    return travel ? (travel.becomes ?? travel.to) : this.poses.get(key);
  }
  /** When the card's current move ends, on the clock it was set with. */
  endsAt(key: string): number | null {
    const travel = this.travel.get(key);
    return travel ? travel.start + travel.delay + travel.duration : null;
  }
  /**
   * Moves a card to `target` over `duration`, from wherever it is now (or
   * from `from`, if it is nowhere yet). `restart` sets it off from `from`
   * even so: the painted node now shows a card that was somewhere else (a
   * pile's cover taking the card put on it). `becomes` is the pose it takes
   * on arrival, when that is not the one it travels to: a card flown onto a
   * pile travels as one card and, landed, is the pile's cover again, as
   * thick as the pile.
   */
  set(
    key: string,
    target: TableCardPose,
    now: number,
    duration = 0,
    from?: TableCardPose,
    delay = 0,
    arc = 0,
    landing = false,
    {
      restart = false,
      becomes,
    }: { readonly restart?: boolean; readonly becomes?: TableCardPose } = {}
  ) {
    const arrival = becomes ?? target;
    const oldTarget = this.target(key);
    if (
      duration > 0 &&
      !restart &&
      oldTarget &&
      sameTablePose(oldTarget, arrival)
    )
      return;
    const current =
      (restart && from ? from : this.sample(key, now)) ?? from ?? target;
    this.travel.delete(key);
    if (duration <= 0 || sameTablePose(current, target)) {
      this.poses.set(key, arrival);
      return;
    }
    this.poses.set(key, current);
    this.travel.set(key, {
      from: current,
      to: target,
      start: now,
      duration,
      delay,
      arc: Math.max(0, arc),
      landing,
      ...(becomes ? { becomes } : {}),
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
      const arrived = travel.becomes ?? travel.to;
      this.travel.delete(key);
      this.poses.set(key, arrived);
      return arrived;
    }
    // Neither easing passes its mark: a card overshooting would come down
    // past its place, or sink into the table, and bob back.
    const eased = travel.landing
      ? easeOutCubic(progress)
      : travelEase(progress);
    const between = interpolateTablePose(travel.from, travel.to, eased);
    // Carried across the table, a card rises and falls as a hand moves it,
    // highest halfway along its path: up quickly, then lowered gently onto
    // its place rather than arriving high and dropping.
    const current =
      travel.arc > 0
        ? {
            ...between,
            elevation:
              between.elevation + travel.arc * Math.sin(Math.PI * eased),
          }
        : between;
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
  /**
   * Holds back by `by` every move set off at or after `since` (a commit's
   * moves, whose first frame came late): each begins where it is seen to,
   * rather than most of the way along already.
   */
  postpone(since: number, by: number) {
    if (by <= 0) return;
    for (const [key, travel] of this.travel)
      if (travel.start >= since)
        this.travel.set(key, { ...travel, start: travel.start + by });
  }
  /**
   * Hands a card's move on to the key it is painted under now (the room
   * answering a predicted move under a new alias): the move goes on as it
   * was, on its own clock, rather than setting off again from where the
   * card is. A key that already has a card keeps its own.
   */
  carry(from: string, to: string) {
    if (from === to || this.poses.has(to)) return;
    const travel = this.travel.get(from);
    const pose = this.poses.get(from);
    if (travel) this.travel.set(to, travel);
    if (pose) this.poses.set(to, pose);
    this.travel.delete(from);
    this.poses.delete(from);
  }
  finish() {
    for (const [key, travel] of this.travel)
      this.poses.set(key, travel.becomes ?? travel.to);
    this.travel.clear();
  }
  clear() {
    this.travel.clear();
    this.poses.clear();
  }
}
