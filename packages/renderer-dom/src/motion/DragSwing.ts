import { SPRING_PRESETS, springStateAt } from '@ptcgsim/renderer-contract';

/** Degrees of swing per card width per second of sideways speed. */
const SWING_PER_WIDTH_PER_SECOND = 2.2;
const MAXIMUM_SWING_DEGREES = 14;

/**
 * The sway of a card in the hand while it is dragged: it leans into its
 * sideways speed and springs upright when the hand stops, like a card held
 * by its top edge. It writes one inline `rotate` on the dragged card's body
 * and runs only while there is something to animate.
 */
export class DragSwing {
  private body: HTMLElement | null = null;
  private angle = 0;
  private velocity = 0;
  private target = 0;
  private frame: number | null = null;
  private lastTime: number | null = null;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  /** Follow this body (the dragged card's) from now on. */
  attach(body: HTMLElement | null): void {
    if (body === this.body) return;
    if (this.body) this.body.style.rotate = '';
    this.body = body;
    this.angle = 0;
    this.velocity = 0;
    this.target = 0;
  }

  /** The pointer's sideways speed, in board px per second. */
  lean(horizontalVelocity: number, cardWidth: number): void {
    if (!this.enabled || !this.body || cardWidth <= 0) return;
    const lean = (horizontalVelocity / cardWidth) * SWING_PER_WIDTH_PER_SECOND;
    this.target = Math.max(
      -MAXIMUM_SWING_DEGREES,
      Math.min(MAXIMUM_SWING_DEGREES, lean)
    );
    this.schedule();
  }

  /** The card was let go: spring upright and stop. */
  release(): void {
    this.target = 0;
    this.schedule();
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastTime = null;
    if (this.body) this.body.style.rotate = '';
    this.angle = 0;
    this.velocity = 0;
    this.target = 0;
  }

  private schedule(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }
    this.frame = requestAnimationFrame(this.step);
  }

  private readonly step = (time: number): void => {
    this.frame = null;
    const body = this.body;
    if (!body) return;
    const dt =
      this.lastTime === null
        ? 1 / 60
        : Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    const state = springStateAt(
      SPRING_PRESETS.snappy,
      this.angle - this.target,
      this.velocity,
      dt
    );
    this.angle = this.target + state.displacement;
    this.velocity = state.velocity;
    const resting =
      Math.abs(this.angle - this.target) < 0.05 &&
      Math.abs(this.velocity) < 0.5;
    if (resting && this.target === 0) {
      body.style.rotate = '';
      this.angle = 0;
      this.velocity = 0;
      this.lastTime = null;
      return;
    }
    body.style.rotate = `${this.angle.toFixed(2)}deg`;
    // The pointer stops sending moves when the hand stops; the lean decays.
    this.target *= 0.86;
    if (Math.abs(this.target) < 0.05) this.target = 0;
    this.frame = requestAnimationFrame(this.step);
  };
}
