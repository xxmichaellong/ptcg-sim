import type {
  CommandContext,
  DomainEvent,
  EventBatch,
  MatchState,
  PlayerId,
  ViewerRole,
} from '@ptcgsim/game-core';
import type { ServerMessage } from '@ptcgsim/protocol';
import { MAX_REPLAY_FRAMES } from '@ptcgsim/protocol';

import type {
  OpaqueIdSource,
  ProjectionIdentityState,
} from './identity-registry.js';

export const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 4 as const;
export const MAX_SOLO_UNDO_CHECKPOINTS = 128;
export const MAX_REPLAY_EVENT_BATCHES = MAX_REPLAY_FRAMES - 1;
export const MAX_REPLAY_EVENT_BYTES = 512 * 1024;

export type AuthorityMode = 'solo' | 'multiplayer';

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
  readonly resumeCapabilityDigest?: string;
}

export interface AdmissionSeat {
  readonly playerId: PlayerId;
  readonly claimCapabilityDigest: string;
  readonly claimedSessionId: string | null;
}

export interface RoomAdmissionState {
  readonly seats: Readonly<Record<string, AdmissionSeat>>;
  readonly spectatorCapabilityDigest: string | null;
}

export interface RoomAuthoritySnapshot {
  readonly schemaVersion: typeof AUTHORITY_SNAPSHOT_SCHEMA_VERSION;
  readonly authorityVersion: number;
  readonly mode: AuthorityMode;
  readonly state: MatchState;
  readonly soloUndoHistory: SoloUndoHistory;
  readonly replayHistory: ReplayHistory;
  readonly identities: ProjectionIdentityState;
  readonly sessions: Readonly<Record<string, AuthoritySession>>;
  readonly admission?: RoomAdmissionState;
}

export interface SoloUndoCheckpoint {
  readonly state: MatchState;
  readonly stateHash: string;
  readonly revertedCommandId: string;
  readonly revertedRevision: number;
}

export interface SoloUndoHistoryEntry {
  readonly checkpointRevision: number;
  readonly checkpointHash: string;
  readonly revertedCommandId: string;
  readonly revertedRevision: number;
  readonly events: readonly DomainEvent[];
}

export interface SoloUndoHistory {
  readonly baseState: MatchState | null;
  readonly baseStateHash: string | null;
  readonly entries: readonly SoloUndoHistoryEntry[];
}

export interface ReplayHistoryEntry {
  readonly batch: EventBatch;
  readonly resultingStateHash: string;
}

/**
 * A bounded canonical replay source. It is durable authority data and must
 * never be sent to a client; clients receive only role-projected frames.
 */
export interface ReplayHistory {
  readonly baseState: MatchState;
  readonly baseStateHash: string;
  readonly entries: readonly ReplayHistoryEntry[];
}

export interface PersistedAuthorityTransaction {
  readonly expectedAuthorityVersion: number;
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

export interface AuthoritySnapshotStore extends AuthorityPersistence {
  readonly load: () => Promise<RoomAuthoritySnapshot | undefined>;
}

export interface PersistedAdmissionTransaction {
  readonly expectedAuthorityVersion: number;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly sessionId: string;
  readonly kind: 'seat_claimed' | 'spectator_joined' | 'session_resumed';
}

export interface AdmissionPersistence {
  readonly commitAdmission: (
    transaction: PersistedAdmissionTransaction
  ) => Promise<void>;
}

export interface AuthorityPolicy {
  readonly allowOpponentPublicInteraction: boolean;
  readonly maximumRecentOutcomesPerSession: number;
  readonly maximumSoloUndoCheckpoints: number;
  readonly maximumReplayEventBatches: number;
  readonly maximumReplayEventBytes: number;
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
  maximumSoloUndoCheckpoints: MAX_SOLO_UNDO_CHECKPOINTS,
  maximumReplayEventBatches: MAX_REPLAY_EVENT_BATCHES,
  maximumReplayEventBytes: MAX_REPLAY_EVENT_BYTES,
};

export const sessionPlayerId = (
  session: AuthoritySession
): PlayerId | undefined =>
  session.viewer.kind === 'player' ? session.viewer.playerId : undefined;
