import type {
  AccessibilityPresentationAnnouncement,
  PresentationStateSource,
} from './PresentationRuntime.js';
import type { PresentationConsumerFailureReporter } from './PresentationConsumerRuntime.js';
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
 * Coin results intentionally remain log-only, matching the current UI: the
 * already-resolved animation request is consumed without rerolling or motion.
 */
export class LegacyGamePresentationRuntime {
  private readonly liveRegionController: LegacyLiveRegionController;
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
    reportConsumerFailure,
    scheduleAnnouncementClear = scheduleDefaultAnnouncementClear,
  }: LegacyGamePresentationRuntimeOptions) {
    this.liveRegionController = new LegacyLiveRegionController(
      scheduleAnnouncementClear
    );
    this.liveRegion = this.liveRegionController;
    try {
      this.game = new GamePresentationRuntime({
        live,
        replay,
        ...(policy ? { policy } : {}),
        ...(reportFailure ? { reportFailure } : {}),
        consumers: {
          announceAccessibility: this.liveRegionController.announce,
          // Legacy flip-coin.js only appended the resolved result to chat.
          animate: () => undefined,
          presentAnimationWithoutMotion: () => undefined,
          ...(reportConsumerFailure
            ? { reportFailure: reportConsumerFailure }
            : {}),
        },
      });
    } catch (error) {
      this.liveRegionController.dispose();
      throw error;
    }
    this.activityFeed = this.game.consumers!.activityFeed;
  }

  dispose(): void {
    try {
      this.game.dispose();
    } finally {
      this.liveRegionController.dispose();
    }
  }
}
