/** Largest lean of a hovered card toward the pointer, in degrees. */
const MAXIMUM_TILT_DEGREES = 8;
/** How long the lean takes to relax once the pointer leaves, in ms. */
const RELAX_MS = 260;

export type QuarterTurn = 0 | 1 | 2 | 3;

/**
 * Where the pointer is over a card in the card's own frame, as offsets from
 * its centre in -0.5..0.5. A card turned a quarter (an opponent's card is
 * turned two) is measured in its own frame so it leans the right way.
 */
export const localPointer = (
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  rotationQuarterTurns: QuarterTurn
): { readonly x: number; readonly y: number } => {
  const u = Math.max(
    -0.5,
    Math.min(0.5, (clientX - rect.left) / rect.width - 0.5)
  );
  const v = Math.max(
    -0.5,
    Math.min(0.5, (clientY - rect.top) / rect.height - 0.5)
  );
  switch (rotationQuarterTurns) {
    case 1:
      return { x: v, y: -u };
    case 2:
      return { x: -u, y: -v };
    case 3:
      return { x: -v, y: u };
    default:
      return { x: u, y: v };
  }
};

/**
 * The hovered card leans toward the pointer and catches the light: a tilt on
 * its body and a glare on its face, written as CSS custom properties once per
 * frame. Only one card at a time, and nothing while dragging or when motion
 * is reduced.
 */
export class HoverTilt {
  private body: HTMLElement | null = null;
  private frame: number | null = null;
  private pending: { readonly x: number; readonly y: number } | null = null;
  private relaxTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.leave(true);
  }

  /** The pointer is over `card` (its button) at this client position. */
  track(
    card: HTMLElement,
    clientX: number,
    clientY: number,
    rotationQuarterTurns: QuarterTurn
  ): void {
    if (!this.enabled) return;
    const body = card.querySelector<HTMLElement>(
      ':scope > .ptcgsim-card__body'
    );
    if (!body) return;
    if (body !== this.body) {
      this.leave();
      this.body = body;
    }
    if (this.relaxTimer !== null) {
      clearTimeout(this.relaxTimer);
      this.relaxTimer = null;
    }
    body.dataset.tilt = '';
    this.pending = localPointer(
      card.getBoundingClientRect(),
      clientX,
      clientY,
      rotationQuarterTurns
    );
    this.schedule();
  }

  /** The pointer left the card (or a drag began): relax back to flat. */
  leave(immediately = false): void {
    const body = this.body;
    this.body = null;
    this.pending = null;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (!body) return;
    body.style.setProperty('--ptcgsim-tilt-x', '0deg');
    body.style.setProperty('--ptcgsim-tilt-y', '0deg');
    body.style.setProperty('--ptcgsim-glare', '0');
    const finish = () => {
      if (this.body === body) return;
      delete body.dataset.tilt;
      for (const name of [
        '--ptcgsim-tilt-x',
        '--ptcgsim-tilt-y',
        '--ptcgsim-glare',
        '--ptcgsim-glare-x',
        '--ptcgsim-glare-y',
      ]) {
        body.style.removeProperty(name);
      }
    };
    if (immediately) {
      finish();
      return;
    }
    this.relaxTimer = setTimeout(() => {
      this.relaxTimer = null;
      finish();
    }, RELAX_MS);
  }

  private schedule(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const body = this.body;
      const point = this.pending;
      if (!body || !point) return;
      body.style.setProperty(
        '--ptcgsim-tilt-x',
        `${(-point.y * 2 * MAXIMUM_TILT_DEGREES).toFixed(2)}deg`
      );
      body.style.setProperty(
        '--ptcgsim-tilt-y',
        `${(point.x * 2 * MAXIMUM_TILT_DEGREES).toFixed(2)}deg`
      );
      body.style.setProperty(
        '--ptcgsim-glare-x',
        `${((point.x + 0.5) * 100).toFixed(1)}%`
      );
      body.style.setProperty(
        '--ptcgsim-glare-y',
        `${((point.y + 0.5) * 100).toFixed(1)}%`
      );
      body.style.setProperty('--ptcgsim-glare', '1');
    });
  }
}
