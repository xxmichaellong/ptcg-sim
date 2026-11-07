import { SPRING_PRESETS, springStateAt } from '@ptcgsim/renderer-contract';

interface Axis {
  angle: number;
  velocity: number;
  target: number;
}
const axis = (): Axis => ({ angle: 0, velocity: 0, target: 0 });
const bounded = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, value));

/**
 * Velocity-driven sway and perspective around the point where a card was
 * picked up. Only its visual body moves; pointer capture, hit geometry and
 * command coordinates stay authoritative. The spring stops scheduling work
 * as soon as the hand rests, and release restores the ordinary card surface.
 */
export class DragSwing {
  private body: HTMLElement | null = null;
  private readonly roll = axis();
  private readonly pitch = axis();
  private readonly yaw = axis();
  private frame: number | null = null;
  private lastTime: number | null = null;
  private enabled = true;
  private held = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  attach(body: HTMLElement | null, grip = { x: 0.5, y: 0.55 }): void {
    this.stop();
    this.body = body;
    this.held = body !== null;
    if (!body || !this.enabled) return;
    body.dataset.swing = '';
    body.style.transformOrigin = `${Math.min(1, Math.max(0, grip.x)) * 100}% ${Math.min(1, Math.max(0, grip.y)) * 100}%`;
  }

  lean(
    horizontalVelocity: number,
    cardWidth: number,
    verticalVelocity = 0,
    cardHeight = cardWidth * 1.4
  ): void {
    if (!this.enabled || !this.body || cardWidth <= 0 || cardHeight <= 0)
      return;
    this.roll.target = bounded((horizontalVelocity / cardWidth) * 2.2, 14);
    this.pitch.target = bounded((-verticalVelocity / cardHeight) * 1.2, 6);
    this.yaw.target = bounded((horizontalVelocity / cardWidth) * 0.9, 5);
    this.schedule();
  }

  release(): void {
    this.held = false;
    for (const value of [this.roll, this.pitch, this.yaw]) value.target = 0;
    if (this.enabled && this.body) this.schedule();
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastTime = null;
    this.held = false;
    this.clearSurface();
    for (const value of [this.roll, this.pitch, this.yaw])
      Object.assign(value, axis());
  }

  private clearSurface(): void {
    const body = this.body;
    if (!body) return;
    body.style.rotate = '';
    body.style.transformOrigin = '';
    delete body.dataset.swing;
    for (const name of [
      '--ptcgsim-drag-pitch',
      '--ptcgsim-drag-yaw',
      '--ptcgsim-drag-light',
    ])
      body.style.removeProperty(name);
  }

  private schedule(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== 'function')
      return;
    this.frame = requestAnimationFrame(this.step);
  }

  private readonly step = (time: number): void => {
    this.frame = null;
    const body = this.body;
    if (!body || !this.enabled) return;
    const dt =
      this.lastTime === null
        ? 1 / 60
        : Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    let resting = true;
    for (const value of [this.roll, this.pitch, this.yaw]) {
      const state = springStateAt(
        SPRING_PRESETS.snappy,
        value.angle - value.target,
        value.velocity,
        dt
      );
      value.angle = value.target + state.displacement;
      value.velocity = state.velocity;
      // Pointer events cease when the hand stops. Decay the target as well.
      value.target *= 0.86;
      if (Math.abs(value.target) < 0.05) value.target = 0;
      if (
        Math.abs(value.angle) > 0.05 ||
        Math.abs(value.velocity) > 0.5 ||
        value.target !== 0
      )
        resting = false;
    }
    body.style.rotate = `${this.roll.angle.toFixed(2)}deg`;
    body.style.setProperty(
      '--ptcgsim-drag-pitch',
      `${this.pitch.angle.toFixed(2)}deg`
    );
    body.style.setProperty(
      '--ptcgsim-drag-yaw',
      `${this.yaw.angle.toFixed(2)}deg`
    );
    body.style.setProperty(
      '--ptcgsim-drag-light',
      (
        Math.min(1, Math.hypot(this.roll.angle, this.pitch.angle) / 14) * 0.65
      ).toFixed(3)
    );
    if (resting) {
      for (const value of [this.roll, this.pitch, this.yaw])
        Object.assign(value, axis());
      body.style.rotate = '';
      body.style.setProperty('--ptcgsim-drag-pitch', '0deg');
      body.style.setProperty('--ptcgsim-drag-yaw', '0deg');
      body.style.setProperty('--ptcgsim-drag-light', '0');
      if (!this.held) this.clearSurface();
      this.lastTime = null;
      return;
    }
    this.schedule();
  };
}
