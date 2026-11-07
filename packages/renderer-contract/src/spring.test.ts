import { describe, expect, it } from 'vitest';

import {
  SPRING_PRESETS,
  VelocityTracker,
  springEasing,
  springFromPerceptual,
  springSettleTime,
  springStateAt,
  type SpringConfig,
} from './spring.js';

/** Fourth-order Runge-Kutta reference for x'' = -k x - c x'. */
const integrate = (
  spring: SpringConfig,
  displacement: number,
  velocity: number,
  seconds: number
) => {
  const step = 1 / 4000;
  let x = displacement;
  let v = velocity;
  const acceleration = (position: number, speed: number) =>
    -spring.stiffness * position - spring.damping * speed;
  for (let t = 0; t < seconds - step / 2; t += step) {
    const k1x = v;
    const k1v = acceleration(x, v);
    const k2x = v + (step / 2) * k1v;
    const k2v = acceleration(x + (step / 2) * k1x, v + (step / 2) * k1v);
    const k3x = v + (step / 2) * k2v;
    const k3v = acceleration(x + (step / 2) * k2x, v + (step / 2) * k2v);
    const k4x = v + step * k3v;
    const k4v = acceleration(x + step * k3x, v + step * k3v);
    x += (step / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (step / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return { displacement: x, velocity: v };
};

describe('closed-form spring', () => {
  it('matches numerical integration when under, critically and over damped', () => {
    for (const dampingRatio of [0.3, 0.62, 1, 1.6]) {
      const spring = springFromPerceptual({ response: 0.4, dampingRatio });
      for (const [x0, v0] of [
        [100, 0],
        [-40, 900],
        [0, -600],
      ] as const) {
        for (const t of [0.01, 0.08, 0.25, 0.6]) {
          const exact = springStateAt(spring, x0, v0, t);
          const reference = integrate(spring, x0, v0, t);
          expect(exact.displacement).toBeCloseTo(reference.displacement, 4);
          expect(exact.velocity).toBeCloseTo(reference.velocity, 3);
        }
      }
    }
  });

  it('starts where it was released and comes to rest at the target', () => {
    const spring = SPRING_PRESETS.gentle;
    expect(springStateAt(spring, 120, -30, 0)).toEqual({
      displacement: 120,
      velocity: -30,
    });
    const settle = springSettleTime(spring, 120, 0, 0.5);
    expect(settle).toBeGreaterThan(0.1);
    expect(settle).toBeLessThan(1.5);
    const rest = springStateAt(spring, 120, 0, settle);
    expect(Math.abs(rest.displacement)).toBeLessThanOrEqual(0.5);
    expect(springSettleTime(spring, 0, 0)).toBe(0);
  });

  it('can be tuned perceptually: a lower damping ratio overshoots more', () => {
    const overshoot = (dampingRatio: number) => {
      const spring = springFromPerceptual({ response: 0.4, dampingRatio });
      let lowest = 0;
      for (let t = 0; t < 1.5; t += 1 / 240) {
        lowest = Math.min(lowest, springStateAt(spring, 1, 0, t).displacement);
      }
      return -lowest;
    };
    expect(overshoot(1)).toBeLessThan(1e-6);
    expect(overshoot(0.62)).toBeGreaterThan(0.005);
    expect(overshoot(0.4)).toBeGreaterThan(overshoot(0.62));
    expect(() =>
      springFromPerceptual({ response: 0, dampingRatio: 1 })
    ).toThrow();
  });

  it('turns a spring into a compositor easing that ends exactly on the target', () => {
    const { easing, duration } = springEasing(SPRING_PRESETS.bouncy);
    const points = easing.slice('linear('.length, -1).split(', ').map(Number);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(Math.max(...points)).toBeGreaterThan(1);
    expect(duration).toBeGreaterThan(0.2);
    expect(duration).toBeLessThan(2);

    // A release that is already moving toward the target starts steeper.
    const thrown = springEasing(SPRING_PRESETS.settle, 6);
    const still = springEasing(SPRING_PRESETS.settle, 0);
    const firstStep = (value: string) =>
      Number(value.slice('linear('.length, -1).split(', ')[1]);
    expect(firstStep(thrown.easing)).toBeGreaterThan(firstStep(still.easing));
  });
});

describe('velocity tracker', () => {
  it('measures only the recent part of a gesture', () => {
    const tracker = new VelocityTracker(100);
    tracker.add(0, 0, 0);
    tracker.add(50, 0, 50);
    tracker.add(100, 0, 100);
    expect(tracker.velocity().x).toBeCloseTo(1000, 5);
    // The pointer then rests: a release now is a gentle drop.
    tracker.add(100, 0, 260);
    expect(tracker.velocity(260).x).toBe(0);
    tracker.reset();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });
});
