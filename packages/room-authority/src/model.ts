import type {
  CommandContext,
  EventBatch,
  MatchState,
  PlayerId,
  ViewerRole,
} from '@ptcgsim/game-core';
import type { ServerMessage } from '@ptcgsim/protocol';

import type {
  OpaqueIdSource,
  ProjectionIdentityState,
} from './identity-registry.js';

export type AuthorityRejectionCode =
  | 'invalid_message'
  | 'invalid_sequence'
  | 'unauthorized'
  | 'stale_reference'
  | 'precondition_failed'
  | 'rate_limited'
  | 'room_not_ready'
  | 'room_full'
  | 'session_superseded'
  | 'internal_retryable';

export interface PersistedCommandOutcome {
  readonly commandId: string;
  readonly clientSequence: number;
  readonly accepted: boolean;
  readonly revision: number;
  readonly code?: AuthorityRejectionCode;
}

export interface AuthoritySession {
  readonly id: string;
  readonly viewer: ViewerRole;
  readonly active: boolean;
  readonly nextClientSequence: number;
  readonly recentOutcomes: readonly PersistedCommandOutcome[];
}

export interface RoomAuthoritySnapshot {
  readonly state: MatchState;
  readonly identities: ProjectionIdentityState;
  readonly sessions: Readonly<Record<string, AuthoritySession>>;
}

export interface PersistedAuthorityTransaction {
  readonly expectedRevision: number;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly sessionId: string;
  readonly outcome: PersistedCommandOutcome;
  readonly eventBatch?: EventBatch;
}

export interface AuthorityPersistence {
  readonly commit: (
    transaction: PersistedAuthorityTransaction
  ) => Promise<void>;
}

export interface AuthorityPolicy {
  readonly allowOpponentPublicInteraction: boolean;
  readonly maximumRecentOutcomesPerSession: number;
}

export interface AuthorityDependencies {
  readonly commandContext: CommandContext;
  readonly opaqueIds: OpaqueIdSource;
  readonly persistence: AuthorityPersistence;
  readonly policy: AuthorityPolicy;
}

export interface AuthorityDelivery {
  readonly sessionId: string;
  readonly message: ServerMessage;
}

export interface AuthorityProcessResult {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly committed: boolean;
  readonly deliveries: readonly AuthorityDelivery[];
}

export const DEFAULT_AUTHORITY_POLICY: AuthorityPolicy = {
  allowOpponentPublicInteraction: true,
  maximumRecentOutcomesPerSession: 128,
};

export const sessionPlayerId = (
  session: AuthoritySession
): PlayerId | undefined =>
  session.viewer.kind === 'player' ? session.viewer.playerId : undefined;
