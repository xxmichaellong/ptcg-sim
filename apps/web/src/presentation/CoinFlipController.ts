import type {
  PresentationStateSource,
  QueuedPresentationAnimation,
} from './PresentationRuntime.js';

/** One coin on the table: the flip the room rolled, and where it is in its life. */
export interface CoinFlipShowing {
  /** The presentation entry it came from; a new id is a new toss. */
  readonly id: number;
  readonly playerId: string;
  readonly result: 'heads' | 'tails';
  /** `spin` tosses the coin; `static` only shows the result (reduced motion). */
  readonly motion: 'spin' | 'static';
  /**
   * `spinning` until it lands, then `landed` while the result lingers, then
   * `fading` on its way out.
   */
  readonly phase: 'spinning' | 'landed' | 'fading';
  /** How long the toss takes, already scaled by the animation speed. */
  readonly spinMs: number;
}

export interface CoinFlipSnapshot {
  readonly flip: CoinFlipShowing | null;
}

/** Runs `complete` after `ms`; returns a cancel. A test seam for timers. */
export type CoinFlipScheduler = (
  complete: () => void,
  ms: number
) => () => void;

export interface CoinFlipControllerOptions {
  readonly schedule?: CoinFlipScheduler;
  /** The animation-speed multiplier (motion settings); 0 means no toss. */
  readonly durationScale?: () => number;
}

/** The toss: several turns, decelerating onto the face (renderer keyframes). */
export const COIN_SPIN_MS = 1_050;
/** How long the result stays readable after the coin lands. */
export const COIN_RESULT_LINGER_MS = 1_500;
/** The coin and its result fading away. */
export const COIN_FADE_MS = 220;

const EMPTY: CoinFlipSnapshot = { flip: null };

const scheduleWithTimeout: CoinFlipScheduler = (complete, ms) => {
  const timeout = globalThis.setTimeout(complete, ms);
  return () => globalThis.clearTimeout(timeout);
};

/**
 * Turns resolved `coinFlip` animations into the coin the table shows. The
 * result is already decided by the room, so nothing here rolls anything: it
 * only paces the toss. A flip occupies the serial animation queue only while
 * it is in the air, so a second flip never waits for the first one's result
 * to fade -- it replaces it. Input is never blocked.
 */
export class CoinFlipController implements PresentationStateSource<CoinFlipSnapshot> {
  private readonly listeners = new Set<() => void>();
  private readonly schedule: CoinFlipScheduler;
  private readonly durationScale: () => number;
  private snapshot = EMPTY;
  private cancelTimers: (() => void)[] = [];
  private disposed = false;

  constructor({
    schedule = scheduleWithTimeout,
    durationScale = () => 1,
  }: CoinFlipControllerOptions = {}) {
    this.schedule = schedule;
    this.durationScale = durationScale;
  }

  getSnapshot = (): CoinFlipSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The animated path: toss, land, linger, fade. */
  animate = (
    entry: QueuedPresentationAnimation,
    signal: AbortSignal
  ): Promise<void> | void => {
    if (this.disposed || signal.aborted) return;
    const scale = this.durationScale();
    if (!(scale > 0)) return this.presentWithoutMotion(entry, signal);
    const spinMs = COIN_SPIN_MS * scale;
    this.show(entry, 'spin', spinMs);
    return new Promise<void>((resolve) => {
      const abort = (): void => {
        this.clear();
        resolve();
      };
      signal.addEventListener('abort', abort, { once: true });
      this.after(spinMs, () => {
        signal.removeEventListener('abort', abort);
        this.setPhase(entry.id, 'landed');
        this.after(COIN_RESULT_LINGER_MS, () => {
          this.setPhase(entry.id, 'fading');
          this.after(COIN_FADE_MS, () => this.clear());
        });
        // The queue moves on once the coin is down; the result lingers.
        resolve();
      });
    });
  };

  /** Reduced motion: the result alone, then gone. */
  presentWithoutMotion = (
    entry: QueuedPresentationAnimation,
    signal: AbortSignal
  ): void => {
    if (this.disposed || signal.aborted) return;
    this.show(entry, 'static', 0);
    this.after(COIN_RESULT_LINGER_MS, () => this.clear());
  };

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.listeners.clear();
  }

  private show(
    entry: QueuedPresentationAnimation,
    motion: CoinFlipShowing['motion'],
    spinMs: number
  ): void {
    this.cancelAll();
    const { playerId, result } = entry.effect.animation;
    this.publish({
      flip: {
        id: entry.id,
        playerId,
        result,
        motion,
        phase: motion === 'spin' ? 'spinning' : 'landed',
        spinMs,
      },
    });
  }

  private setPhase(id: number, phase: CoinFlipShowing['phase']): void {
    const flip = this.snapshot.flip;
    if (!flip || flip.id !== id || flip.phase === phase) return;
    this.publish({ flip: { ...flip, phase } });
  }

  private after(ms: number, run: () => void): void {
    let cancel: () => void = () => undefined;
    const done = (): void => {
      this.cancelTimers = this.cancelTimers.filter((entry) => entry !== cancel);
      run();
    };
    cancel = this.schedule(done, ms);
    this.cancelTimers.push(cancel);
  }

  private cancelAll(): void {
    const timers = this.cancelTimers;
    this.cancelTimers = [];
    for (const cancel of timers) cancel();
  }

  private clear(): void {
    this.cancelAll();
    this.publish(EMPTY);
  }

  private publish(snapshot: CoinFlipSnapshot): void {
    if (this.disposed || snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}
