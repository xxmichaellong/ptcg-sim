import type { ClientSessionState } from '@ptcgsim/client-session';
import type { PresentationEvent } from '@ptcgsim/protocol';

import { ImmutableLogDispatcher } from './ImmutableLogDispatcher.js';

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
  private readonly dispatcher: ImmutableLogDispatcher<
    ClientSessionState,
    PresentationEvent
  >;

  constructor(
    source: SessionPresentationSource,
    sink: SessionPresentationSink,
    reportFailure: SessionPresentationFailureReporter = (error, event) =>
      console.error('Session presentation event failed', event, error)
  ) {
    this.dispatcher = new ImmutableLogDispatcher(
      source,
      (state) => state.presentationEvents,
      sink,
      reportFailure
    );
  }

  dispose(): void {
    this.dispatcher.dispose();
  }
}
