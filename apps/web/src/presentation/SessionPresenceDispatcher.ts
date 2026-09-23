import { ImmutableLogDispatcher } from './ImmutableLogDispatcher.js';
import type { PresenceMessage } from './PresentationEffects.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

export type SessionPresenceSink = (message: PresenceMessage) => void;

export type SessionPresenceFailureReporter = (
  error: unknown,
  message: PresenceMessage
) => void;

/**
 * Delivers newly retained presence objects once. Existing bounded history is
 * consumed at construction so remounting cannot replay stale announcements.
 */
export class SessionPresenceDispatcher {
  private readonly dispatcher: ImmutableLogDispatcher<
    ReturnType<SessionPresentationSource['getSnapshot']>,
    PresenceMessage
  >;

  constructor(
    source: SessionPresentationSource,
    sink: SessionPresenceSink,
    reportFailure: SessionPresenceFailureReporter = (error, message) =>
      console.error('Session presence delivery failed', message, error)
  ) {
    this.dispatcher = new ImmutableLogDispatcher(
      source,
      (state) => state.presence,
      sink,
      reportFailure
    );
  }

  dispose(): void {
    this.dispatcher.dispose();
  }
}
