import type { MatchViewState } from '@ptcgsim/game-core';
import type { ServerMessage } from '@ptcgsim/protocol';

export type ClientSessionPhase =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'ready'
  | 'reconnecting'
  | 'superseded'
  | 'closed'
  | 'failed';

export type CommandFailureCode = NonNullable<
  Extract<ServerMessage, { type: 'CommandResult' }>['code']
>;

export interface PendingCommandSummary {
  readonly commandId: string;
  readonly clientSequence: number;
  readonly commandType: string;
  readonly state: 'queued' | 'in_flight' | 'awaiting_publication';
}

export interface CompletedCommandSummary {
  readonly commandId: string;
  readonly clientSequence: number;
  readonly accepted: boolean;
  readonly revision: number;
  readonly code?: CommandFailureCode;
}

export interface ClientSessionFailure {
  readonly code:
    | 'invalid_server_frame'
    | 'admission_rejected'
    | 'inconsistent_publication'
    | 'sequence_divergence'
    | 'command_retry_exhausted'
    | 'reconnect_exhausted';
  readonly message: string;
}

export interface ClientSessionState {
  readonly phase: ClientSessionPhase;
  readonly role?: 'player' | 'spectator';
  readonly playerId?: string;
  readonly view?: MatchViewState;
  readonly nextClientSequence: number;
  readonly pendingCommands: readonly PendingCommandSummary[];
  readonly completedCommands: readonly CompletedCommandSummary[];
  readonly chatMessages: readonly Extract<
    ServerMessage,
    { type: 'ChatMessage' }
  >[];
  readonly presence: readonly Extract<ServerMessage, { type: 'Presence' }>[];
  readonly notices: readonly Extract<ServerMessage, { type: 'ServerNotice' }>[];
  readonly latencyMs?: number;
  readonly reconnectAttempt: number;
  readonly failure?: ClientSessionFailure;
}

export interface ConnectSessionOptions {
  readonly url: string;
  readonly buildId: string;
  readonly roomCode: string;
  readonly displayName: string;
  readonly requestedRole: 'player' | 'spectator';
  /** A bearer capability. It is retained only in private, in-memory fields. */
  readonly admissionTicket: string;
}

export interface ClientSessionPolicy {
  readonly maximumPendingCommands: number;
  readonly maximumCompletedCommands: number;
  readonly maximumChatMessages: number;
  readonly maximumPresenceEvents: number;
  readonly maximumNotices: number;
  readonly maximumReconnectAttempts: number;
  readonly maximumCommandRetries: number;
  readonly reconnectBaseDelayMs: number;
  readonly reconnectMaximumDelayMs: number;
  readonly reconnectJitterRatio: number;
}

export const DEFAULT_CLIENT_SESSION_POLICY: ClientSessionPolicy = {
  maximumPendingCommands: 32,
  maximumCompletedCommands: 128,
  maximumChatMessages: 100,
  maximumPresenceEvents: 100,
  maximumNotices: 50,
  maximumReconnectAttempts: 5,
  maximumCommandRetries: 3,
  reconnectBaseDelayMs: 250,
  reconnectMaximumDelayMs: 5_000,
  reconnectJitterRatio: 0.2,
};
