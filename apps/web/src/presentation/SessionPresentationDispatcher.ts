import type { ClientSessionState } from '@ptcgsim/client-session';
import type { PresentationEvent } from '@ptcgsim/protocol';

export interface SessionPresentationSource {
  readonly getSnapshot: () => ClientSessionState;
  readonly subscribe: (listener: () => void) => () => void;
}

export type SessionPresentationSink = (event: PresentationEvent) => void;

export type SessionPresentationFailureReporter = (
  error: unknown,
  event: PresentationEvent
) => void;

/**
 * Delivers newly appended live presentation facts once. Object identity is the
 * cursor because the session retains immutable event objects in a bounded log.
 */
export class SessionPresentationDispatcher {
  private readonly consumed = new WeakSet<PresentationEvent>();
  private readonly queue: PresentationEvent[][] = [];
  private unsubscribe: () => void = () => undefined;
  private delivering = false;
  private disposed = false;

  constructor(
    private readonly source: SessionPresentationSource,
    private readonly sink: SessionPresentationSink,
    private readonly reportFailure: SessionPresentationFailureReporter = (
      error,
      event
    ) => console.error('Session presentation event failed', event, error)
  ) {
    this.consumeWithoutDelivery(source.getSnapshot().presentationEvents);
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
    const entered = this.source
      .getSnapshot()
      .presentationEvents.filter((event) => !this.consumed.has(event));
    this.consumeWithoutDelivery(entered);
    if (entered.length === 0) return;
    this.queue.push(entered);
    this.deliverQueuedEvents();
  };

  private consumeWithoutDelivery(events: readonly PresentationEvent[]): void {
    for (const event of events) this.consumed.add(event);
  }

  private deliverQueuedEvents(): void {
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (!this.disposed) {
        const events = this.queue.shift();
        if (!events) return;
        for (const event of events) {
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
