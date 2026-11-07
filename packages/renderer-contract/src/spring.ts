/**
 * A damped spring solved in closed form, so a card's position can be read at
 * any instant -- mid-flight, when an interruption has to start the next leg
 * from where the card is and at the speed it is moving -- without integrating
 * frame by frame. Units are the caller's (px, degrees, a 0..1 progress), and
 * time is seconds; the mass is fixed at 1.
 */
export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

/**
 * The spring described the way a designer tunes it: how long one swing takes
 * (`response`, seconds) and how little it overshoots (`dampingRatio`, where 1
 * is critically damped and smaller values bounce).
 */
export interface PerceptualSpring {
  readonly response: number;
  readonly dampingRatio: number;
}

export const springFromPerceptual = ({
  response,
  dampingRatio,
}: PerceptualSpring): SpringConfig => {
  if (!(response > 0) || !(dampingRatio > 0)) {
    throw new Error('Spring response and damping ratio must be positive');
  }
  const angular = (2 * Math.PI) / response;
  return {
    stiffness: angular * angular,
    damping: 2 * dampingRatio * angular,
  };
};

/**
 * Shared presets. `snappy` answers a pointer; `gentle` carries a card across
 * the table; `bouncy` is the small overshoot of a card landing or a counter
 * popping; `settle` is the critically damped return used when overshoot
 * would read as an error (a rejected move going home).
 */
export const SPRING_PRESETS = {
  snappy: springFromPerceptual({ response: 0.28, dampingRatio: 0.82 }),
  gentle: springFromPerceptual({ response: 0.42, dampingRatio: 0.86 }),
  bouncy: springFromPerceptual({ response: 0.38, dampingRatio: 0.62 }),
  settle: springFromPerceptual({ response: 0.34, dampingRatio: 1 }),
} as const satisfies Record<string, SpringConfig>;

export type SpringPresetName = keyof typeof SPRING_PRESETS;

/** Displacement from the target and its rate of change at time `t`. */
export interface SpringState {
  readonly displacement: number;
  readonly velocity: number;
}

const assertSpring = ({ stiffness, damping }: SpringConfig): void => {
  if (
    !Number.isFinite(stiffness) ||
    !Number.isFinite(damping) ||
    stiffness <= 0 ||
    damping < 0
  ) {
    throw new Error('Spring stiffness must be positive and damping finite');
  }
};

/**
 * Where a spring released at `displacement0` with `velocity0` (both relative
 * to its target) is after `t` seconds.
 */
export const springStateAt = (
  spring: SpringConfig,
  displacement0: number,
  velocity0: number,
  t: number
): SpringState => {
  assertSpring(spring);
  if (t <= 0) return { displacement: displacement0, velocity: velocity0 };
  const omega = Math.sqrt(spring.stiffness);
  const zeta = spring.damping / (2 * omega);
  if (zeta < 1 - 1e-9) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    const a = displacement0;
    const b = (velocity0 + zeta * omega * displacement0) / omegaD;
    const cos = Math.cos(omegaD * t);
    const sin = Math.sin(omegaD * t);
    const displacement = decay * (a * cos + b * sin);
    const velocity =
      decay *
      (-zeta * omega * (a * cos + b * sin) + omegaD * (-a * sin + b * cos));
    return { displacement, velocity };
  }
  if (zeta <= 1 + 1e-9) {
    const decay = Math.exp(-omega * t);
    const b = velocity0 + omega * displacement0;
    const displacement = decay * (displacement0 + b * t);
    const velocity = decay * (b - omega * (displacement0 + b * t));
    return { displacement, velocity };
  }
  const root = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega + root;
  const r2 = -zeta * omega - root;
  const c1 = (velocity0 - r2 * displacement0) / (r1 - r2);
  const c2 = displacement0 - c1;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return {
    displacement: c1 * e1 + c2 * e2,
    velocity: c1 * r1 * e1 + c2 * r2 * e2,
  };
};

/**
 * How long until the spring is visually at rest: within `precision` of the
 * target (in the caller's units) and moving slower than `precision` per
 * 1/60 s. Capped so a mis-tuned spring cannot animate forever.
 */
export const springSettleTime = (
  spring: SpringConfig,
  displacement0: number,
  velocity0 = 0,
  precision = 0.01,
  maximumSeconds = 3
): number => {
  assertSpring(spring);
  if (Math.abs(displacement0) <= precision && Math.abs(velocity0) <= precision)
    return 0;
  const step = 1 / 240;
  let restingSince: number | null = null;
  for (let t = step; t <= maximumSeconds; t += step) {
    const state = springStateAt(spring, displacement0, velocity0, t);
    const resting =
      Math.abs(state.displacement) <= precision &&
      Math.abs(state.velocity) / 60 <= precision;
    if (resting) {
      restingSince ??= t;
      // A bouncy spring can pass through the target fast; require it to stay.
      if (t - restingSince >= 0.05) return restingSince;
    } else {
      restingSince = null;
    }
  }
  return maximumSeconds;
};

/**
 * A CSS `linear()` easing that reproduces the spring's progress from 0 to 1,
 * so the browser can run it on the compositor. `initialVelocity` is in
 * progress units per second (a drag release carrying the card onward).
 * Returns the easing and the duration it was sampled over, in seconds.
 */
export const springEasing = (
  spring: SpringConfig,
  initialVelocity = 0,
  samples = 48
): { readonly easing: string; readonly duration: number } => {
  assertSpring(spring);
  // Progress p = 1 - displacement, starting at displacement 1. Velocity in
  // progress units is the negated displacement velocity.
  const duration = Math.max(
    1 / 60,
    springSettleTime(spring, 1, -initialVelocity, 0.001)
  );
  const count = Math.max(2, Math.round(samples));
  const points: string[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = (duration * index) / count;
    const progress =
      index === count
        ? 1
        : 1 - springStateAt(spring, 1, -initialVelocity, t).displacement;
    points.push(String(Math.round(progress * 10_000) / 10_000));
  }
  return { easing: `linear(${points.join(', ')})`, duration };
};

/**
 * Pointer velocity from recent samples, in units per second. Only the last
 * `windowMs` count, so a pause before release reads as a gentle drop rather
 * than the speed of a flick made earlier in the gesture.
 */
export class VelocityTracker {
  private readonly samples: Array<{
    readonly x: number;
    readonly y: number;
    readonly time: number;
  }> = [];

  constructor(private readonly windowMs = 100) {}

  add(x: number, y: number, timeMs: number): void {
    this.samples.push({ x, y, time: timeMs });
    const cutoff = timeMs - this.windowMs * 2;
    while (this.samples.length > 2 && this.samples[0]!.time < cutoff) {
      this.samples.shift();
    }
  }

  reset(): void {
    this.samples.length = 0;
  }

  velocity(nowMs?: number): { readonly x: number; readonly y: number } {
    const last = this.samples.at(-1);
    if (!last) return { x: 0, y: 0 };
    const now = nowMs ?? last.time;
    const cutoff = now - this.windowMs;
    const recent = this.samples.filter((sample) => sample.time >= cutoff);
    const first = recent[0];
    const final = recent.at(-1);
    if (!first || !final || final.time - first.time < 4) return { x: 0, y: 0 };
    const seconds = (final.time - first.time) / 1000;
    return {
      x: (final.x - first.x) / seconds,
      y: (final.y - first.y) / seconds,
    };
  }
}
