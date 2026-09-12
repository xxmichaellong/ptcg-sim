import {
  createActivityFeedSource,
  type ActivityFeedSnapshot,
} from './ActivityFeedModel.js';
import {
  AccessibilityAnnouncementDrain,
  type AccessibilityAnnouncementHandler,
} from './AccessibilityAnnouncementDrain.js';
import {
  PresentationAnimationExecutor,
  type PresentationAnimationHandler,
  type ReducedMotionSource,
} from './PresentationAnimationExecutor.js';
import type {
  AccessibilityPresentationAnnouncement,
  PresentationRuntime,
  PresentationStateSource,
  QueuedPresentationAnimation,
} from './PresentationRuntime.js';

export type PresentationConsumerFailureContext =
  | {
      readonly channel: 'accessibility';
      readonly entry: AccessibilityPresentationAnnouncement;
    }
  | {
      readonly channel: 'animation';
      readonly entry: QueuedPresentationAnimation;
    };

export type PresentationConsumerFailureReporter = (
  error: unknown,
  context: PresentationConsumerFailureContext
) => void;

export interface PresentationConsumerRuntimeOptions {
  readonly announceAccessibility?: AccessibilityAnnouncementHandler;
  readonly animate?: PresentationAnimationHandler;
  readonly presentAnimationWithoutMotion?: PresentationAnimationHandler;
  readonly reducedMotion?: ReducedMotionSource;
  readonly reportFailure?: PresentationConsumerFailureReporter;
}

/**
 * Wires transient consumers to the matching runtime queue and acknowledgement.
 * Consumers are optional so surfaces can mount independently during migration.
 */
export class PresentationConsumerRuntime {
  readonly activityFeed: PresentationStateSource<ActivityFeedSnapshot>;
  private readonly accessibility?: AccessibilityAnnouncementDrain;
  private readonly animation?: PresentationAnimationExecutor;
  private disposed = false;

  constructor(
    runtime: PresentationRuntime,
    {
      announceAccessibility,
      animate,
      presentAnimationWithoutMotion,
      reducedMotion,
      reportFailure = (error, context) =>
        console.error('Presentation consumer failed', context, error),
    }: PresentationConsumerRuntimeOptions
  ) {
    this.activityFeed = createActivityFeedSource(runtime.activity);
    let accessibility: AccessibilityAnnouncementDrain | undefined;
    try {
      if (announceAccessibility) {
        accessibility = new AccessibilityAnnouncementDrain({
          source: runtime.accessibility,
          acknowledge: runtime.acknowledgeAccessibility,
          announce: announceAccessibility,
          reportFailure: (error, entry) => {
            try {
              reportFailure(error, { channel: 'accessibility', entry });
            } catch {
              // Diagnostics must not wedge or duplicate the queue.
            }
          },
        });
      }
      if (animate) {
        this.animation = new PresentationAnimationExecutor({
          source: runtime.animation,
          acknowledge: runtime.acknowledgeAnimation,
          animate,
          ...(presentAnimationWithoutMotion
            ? { presentWithoutMotion: presentAnimationWithoutMotion }
            : {}),
          ...(reducedMotion ? { reducedMotion } : {}),
          reportFailure: (error, entry) => {
            try {
              reportFailure(error, { channel: 'animation', entry });
            } catch {
              // Diagnostics must not wedge or duplicate the queue.
            }
          },
        });
      }
    } catch (error) {
      accessibility?.dispose();
      throw error;
    }
    this.accessibility = accessibility;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.accessibility?.dispose();
    } finally {
      this.animation?.dispose();
    }
  }
}
