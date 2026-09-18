import type { PresentationEvent } from '@ptcgsim/protocol';

import type { ReplaySessionCoordinatorState } from './ReplaySessionCoordinator.js';

export interface ReplayPresentationSource {
  readonly getSnapshot: () => ReplaySessionCoordinatorState;
  readonly subscribe: (listener: () => void) => () => void;
}

export type ReplayPresentationSink = (event: PresentationEvent) => void;

export type ReplayPresentationFailureReporter = (
  error: unknown,
  event: PresentationEvent
) => void;

interface PresentationBatch {
  readonly replayId: string;
  readonly generation: number;
  readonly events: readonly PresentationEvent[];
}

/**
 * Delivers the presentation facts crossed by replay playback without coupling
 * multi-revision fast-forward batches to one renderer scene revision.
 */
export class ReplayPresentationDispatcher {
  private readonly queue: PresentationBatch[] = [];
  private unsubscribe: () => void = () => undefined;
  private consumedReplayId?: string;
  private consumedGeneration?: number;
  private delivering = false;
  private disposed = false;

  constructor(
    private readonly source: ReplayPresentationSource,
    private readonly sink: ReplayPresentationSink,
    private readonly reportFailure: ReplayPresentationFailureReporter = (
      error,
      event
    ) => console.error('Replay presentation event failed', event, error)
  ) {
    // Mounting a presentation surface must not replay effects that have already
    // been crossed. Only later coordinator publications are delivered.
    this.seedConsumedGeneration(source.getSnapshot());
    const unsubscribe = source.subscribe(this.handleSourceChange);
    if (this.disposed) unsubscribe();
    else this.unsubscribe = unsubscribe;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.queue.length = 0;
  }

  private readonly handleSourceChange = (): void => {
    if (this.disposed) return;
    const state = this.source.getSnapshot();
    if (state.mode !== 'replay' || state.playback.phase !== 'ready') return;

    const { replayId, generation, enteredPresentationEvents } = state.playback;
    if (
      replayId === this.consumedReplayId &&
      this.consumedGeneration !== undefined &&
      generation <= this.consumedGeneration
    ) {
      return;
    }

    // Mark the entire playback generation before invoking application code so
    // reentrant coordinator publications cannot duplicate its effects.
    this.consumedReplayId = replayId;
    this.consumedGeneration = generation;
    if (enteredPresentationEvents.length === 0) return;
    this.queue.push({
      replayId,
      generation,
      events: enteredPresentationEvents,
    });
    this.deliverQueuedBatches();
  };

  private seedConsumedGeneration(state: ReplaySessionCoordinatorState): void {
    if (state.mode !== 'replay' || state.playback.phase !== 'ready') return;
    this.consumedReplayId = state.playback.replayId;
    this.consumedGeneration = state.playback.generation;
  }

  private deliverQueuedBatches(): void {
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (!this.disposed) {
        const batch = this.queue.shift();
        if (!batch) return;
        for (const event of batch.events) {
          if (this.disposed) return;
          try {
            this.sink(event);
          } catch (error) {
            try {
              this.reportFailure(error, event);
            } catch {
              // Diagnostics must not prevent later deterministic effects.
            }
          }
        }
      }
    } finally {
      this.delivering = false;
    }
  }
}
