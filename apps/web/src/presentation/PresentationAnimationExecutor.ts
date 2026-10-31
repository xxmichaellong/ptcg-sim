import type {
  AnimationPresentationSnapshot,
  PresentationStateSource,
  QueuedPresentationAnimation,
} from './PresentationRuntime.js';
import { SerialPresentationConsumer } from './SerialPresentationConsumer.js';

export type PresentationAnimationHandler = (
  animation: QueuedPresentationAnimation,
  signal: AbortSignal
) => void | PromiseLike<void>;

export type PresentationAnimationFailureReporter = (
  error: unknown,
  animation: QueuedPresentationAnimation
) => void;

export type ReducedMotionSource = PresentationStateSource<boolean>;

export interface PresentationAnimationExecutorOptions {
  readonly source: PresentationStateSource<AnimationPresentationSnapshot>;
  readonly acknowledge: (entryId: number) => boolean;
  readonly animate: PresentationAnimationHandler;
  /** Optional instantaneous/static result treatment when motion is disabled. */
  readonly presentWithoutMotion?: PresentationAnimationHandler;
  readonly reducedMotion?: ReducedMotionSource;
  readonly reportFailure?: PresentationAnimationFailureReporter;
}

/**
 * Runs one animation at a time. Queue replacement and preference changes abort
 * in-flight work; reduced motion never invokes the animated path.
 */
export class PresentationAnimationExecutor {
  private readonly consumer: SerialPresentationConsumer<
    AnimationPresentationSnapshot,
    QueuedPresentationAnimation
  >;
  private readonly reducedMotionSource?: ReducedMotionSource;
  private unsubscribeReducedMotion: () => void = () => undefined;
  private reducedMotion: boolean;
  private disposed = false;

  constructor({
    source,
    acknowledge,
    animate,
    presentWithoutMotion = () => undefined,
    reducedMotion,
    reportFailure = (error, animation) =>
      console.error('Presentation animation failed', animation, error),
  }: PresentationAnimationExecutorOptions) {
    this.reducedMotionSource = reducedMotion;
    this.reducedMotion = reducedMotion?.getSnapshot() ?? false;
    this.consumer = new SerialPresentationConsumer({
      source,
      selectEntries: (snapshot) => snapshot.animations,
      consume: (animation, signal) =>
        this.reducedMotion
          ? presentWithoutMotion(animation, signal)
          : animate(animation, signal),
      acknowledge,
      reportFailure,
    });
    if (reducedMotion) {
      const unsubscribe = reducedMotion.subscribe(this.handleMotionChange);
      if (this.disposed) unsubscribe();
      else this.unsubscribeReducedMotion = unsubscribe;
    }
    this.consumer.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.unsubscribeReducedMotion();
    } finally {
      this.consumer.dispose();
    }
  }

  private readonly handleMotionChange = (): void => {
    if (this.disposed || !this.reducedMotionSource) return;
    const next = this.reducedMotionSource.getSnapshot();
    if (next === this.reducedMotion) return;
    this.reducedMotion = next;
    this.consumer.restartActive();
  };
}
