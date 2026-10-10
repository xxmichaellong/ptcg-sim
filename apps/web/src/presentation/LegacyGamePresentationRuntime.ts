import type {
  AccessibilityPresentationAnnouncement,
  PresentationStateSource,
} from './PresentationRuntime.js';
import type { PresentationConsumerFailureReporter } from './PresentationConsumerRuntime.js';
import type { ReducedMotionSource } from './PresentationAnimationExecutor.js';
import {
  CoinFlipController,
  type CoinFlipScheduler,
  type CoinFlipSnapshot,
} from './CoinFlipController.js';
import {
  GamePresentationRuntime,
  type GamePresentationRuntimeOptions,
} from './GamePresentationRuntime.js';

export interface LegacyLiveRegionAnnouncement {
  readonly id: number;
  readonly message: string;
  readonly politeness: 'polite';
}

export interface LegacyLiveRegionSnapshot {
  readonly announcement: LegacyLiveRegionAnnouncement | null;
}

export type LegacyAnnouncementScheduler = (complete: () => void) => () => void;

export interface LegacyGamePresentationRuntimeOptions extends Omit<
  GamePresentationRuntimeOptions,
  'consumers'
> {
  /** Separately labels failures from serial DOM-facing queue consumers. */
  readonly reportConsumerFailure?: PresentationConsumerFailureReporter;
  /** Test seam for the live-region dwell period. */
  readonly scheduleAnnouncementClear?: LegacyAnnouncementScheduler;
  /**
   * The player's reduce-motion choice (the motion settings' `reducedMotion`).
   * When it is on, a coin shows only its result; without it, coins toss.
   */
  readonly reducedMotion?: ReducedMotionSource;
  /** The animation-speed multiplier from the motion settings. */
  readonly animationDurationScale?: () => number;
  /** Test seam for the coin's toss and linger timers. */
  readonly scheduleCoinFlip?: CoinFlipScheduler;
}

const EMPTY_LIVE_REGION: LegacyLiveRegionSnapshot = { announcement: null };
const LIVE_REGION_DWELL_MS = 1_000;

const scheduleDefaultAnnouncementClear: LegacyAnnouncementScheduler = (
  complete
) => {
  const timeout = globalThis.setTimeout(complete, LIVE_REGION_DWELL_MS);
  return () => globalThis.clearTimeout(timeout);
};

/**
 * Holds one serial announcement in the DOM long enough for assistive
 * technology to observe it. Queue cancellation aborts the dwell immediately.
 */
class LegacyLiveRegionController implements PresentationStateSource<LegacyLiveRegionSnapshot> {
  private readonly listeners = new Set<() => void>();
  private snapshot = EMPTY_LIVE_REGION;
  private finishActive: (() => void) | undefined;
  private disposed = false;

  constructor(private readonly scheduleClear: LegacyAnnouncementScheduler) {}

  getSnapshot = (): LegacyLiveRegionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  announce = (
    entry: AccessibilityPresentationAnnouncement,
    signal: AbortSignal
  ): Promise<void> | void => {
    if (this.disposed || signal.aborted) return;
    this.finishActive?.();
    this.publish({
      announcement: {
        id: entry.id,
        message: entry.effect.message,
        politeness: entry.effect.politeness,
      },
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelScheduled: () => void = () => undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        cancelScheduled();
        signal.removeEventListener('abort', finish);
        if (this.finishActive === finish) this.finishActive = undefined;
        if (this.snapshot.announcement?.id === entry.id) {
          this.publish(EMPTY_LIVE_REGION);
        }
        resolve();
      };

      signal.addEventListener('abort', finish, { once: true });
      try {
        cancelScheduled = this.scheduleClear(finish);
        if (settled) cancelScheduled();
        else this.finishActive = finish;
      } catch (error) {
        signal.removeEventListener('abort', finish);
        if (this.snapshot.announcement?.id === entry.id) {
          this.publish(EMPTY_LIVE_REGION);
        }
        reject(error);
      }
    });
  };

  dispose(): void {
    if (this.disposed) return;
    this.finishActive?.();
    this.disposed = true;
    this.listeners.clear();
  }

  private publish(snapshot: LegacyLiveRegionSnapshot): void {
    if (this.disposed || snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Route-scoped composition for the legacy sidebar presentation surfaces.
 * A coin's result is logged and announced exactly as before; the table also
 * tosses a coin that lands on the room's already-resolved result (nothing
 * rerolls), or only shows the result when motion is reduced.
 */
export class LegacyGamePresentationRuntime {
  private readonly liveRegionController: LegacyLiveRegionController;
  private readonly coinFlipController: CoinFlipController;
  /** The coin on the table, for the board's coin overlay. */
  readonly coinFlip: PresentationStateSource<CoinFlipSnapshot>;
  readonly game: GamePresentationRuntime;
  readonly activityFeed: NonNullable<
    GamePresentationRuntime['consumers']
  >['activityFeed'];
  readonly liveRegion: PresentationStateSource<LegacyLiveRegionSnapshot>;

  constructor({
    live,
    replay,
    policy,
    reportFailure,
    announcePresence,
    reportConsumerFailure,
    scheduleAnnouncementClear = scheduleDefaultAnnouncementClear,
    reducedMotion,
    animationDurationScale,
    scheduleCoinFlip,
  }: LegacyGamePresentationRuntimeOptions) {
    this.liveRegionController = new LegacyLiveRegionController(
      scheduleAnnouncementClear
    );
    this.liveRegion = this.liveRegionController;
    this.coinFlipController = new CoinFlipController({
      ...(scheduleCoinFlip ? { schedule: scheduleCoinFlip } : {}),
      ...(animationDurationScale
        ? { durationScale: animationDurationScale }
        : {}),
    });
    this.coinFlip = this.coinFlipController;
    try {
      this.game = new GamePresentationRuntime({
        live,
        replay,
        ...(policy ? { policy } : {}),
        ...(reportFailure ? { reportFailure } : {}),
        ...(announcePresence === undefined ? {} : { announcePresence }),
        consumers: {
          announceAccessibility: this.liveRegionController.announce,
          animate: this.coinFlipController.animate,
          presentAnimationWithoutMotion:
            this.coinFlipController.presentWithoutMotion,
          ...(reducedMotion ? { reducedMotion } : {}),
          ...(reportConsumerFailure
            ? { reportFailure: reportConsumerFailure }
            : {}),
        },
      });
    } catch (error) {
      this.liveRegionController.dispose();
      this.coinFlipController.dispose();
      throw error;
    }
    this.activityFeed = this.game.consumers!.activityFeed;
  }

  clearActivity = (): boolean => this.game.clearActivity();

  dispose(): void {
    try {
      this.game.dispose();
    } finally {
      this.liveRegionController.dispose();
      this.coinFlipController.dispose();
    }
  }
}
