import { ImmutableLogDispatcher } from './ImmutableLogDispatcher.js';
import type { ChatMessage } from './PresentationEffects.js';
import type { SessionPresentationSource } from './SessionPresentationDispatcher.js';

export type SessionChatSink = (message: ChatMessage) => void;

export type SessionChatFailureReporter = (
  error: unknown,
  message: ChatMessage
) => void;

/**
 * Delivers newly retained chat objects once. Chat is consumed without delivery
 * when the coordinator is created so remounting cannot replay bounded history.
 */
export class SessionChatDispatcher {
  private readonly dispatcher: ImmutableLogDispatcher<
    ReturnType<SessionPresentationSource['getSnapshot']>,
    ChatMessage
  >;

  constructor(
    source: SessionPresentationSource,
    sink: SessionChatSink,
    reportFailure: SessionChatFailureReporter = (error, message) =>
      console.error('Session chat delivery failed', message, error)
  ) {
    this.dispatcher = new ImmutableLogDispatcher(
      source,
      (state) => state.chatMessages,
      sink,
      reportFailure
    );
  }

  dispose(): void {
    this.dispatcher.dispose();
  }
}
