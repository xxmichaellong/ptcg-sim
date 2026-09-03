import {
  applyEventBatch,
  assertMatchInvariants,
  soloUndoCheckpointProblem,
  stableHash,
  stableSerialize,
  type EventBatch,
} from '@ptcgsim/game-core';

import { viewerIdentityKey } from './identity-registry.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  MAX_OUTSTANDING_ADMISSION_TICKETS,
  MAX_OUTSTANDING_ROOM_INVITATIONS,
  MAX_REPLAY_EVENT_BATCHES,
  MAX_REPLAY_EVENT_BYTES,
  MAX_SOLO_UNDO_CHECKPOINTS,
  type AuthoritySnapshotValidation,
  type PersistedAuthorityTransaction,
  type PersistedCommandOutcome,
  type ReplayHistory,
  type ReplayHistoryEntry,
  type RoomAuthoritySnapshot,
} from './model.js';
import { replaySoloUndoHistory } from './solo-undo-history.js';
import {
  replayHistoryByteFacts,
  replayHistoryEntryBytes,
  replayHistoryEventBytes,
  replayHistoryStates,
  type ReplayHistoryByteFacts,
} from './replay-history.js';

export class AuthoritySnapshotInvariantError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Authority snapshot invariant violation:\n${problems.join('\n')}`);
    this.name = 'AuthoritySnapshotInvariantError';
    this.problems = problems;
  }
}

interface AuthoritySnapshotValidationRecord {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly schemaVersion: RoomAuthoritySnapshot['schemaVersion'];
  readonly authorityVersion: number;
  readonly mode: RoomAuthoritySnapshot['mode'];
  readonly state: RoomAuthoritySnapshot['state'];
  readonly stateRevision: number;
  readonly soloUndoHistory: RoomAuthoritySnapshot['soloUndoHistory'];
  readonly replayHistory: RoomAuthoritySnapshot['replayHistory'];
  readonly identities: RoomAuthoritySnapshot['identities'];
  readonly sessions: RoomAuthoritySnapshot['sessions'];
  readonly admission: RoomAuthoritySnapshot['admission'];
  readonly replayByteFacts: ReplayHistoryByteFacts;
  readonly command?: {
    readonly sourceSnapshotSerialization: string;
    readonly expectedAuthorityVersion: number;
    readonly expectedRevision: number;
    readonly sessionId: string;
    readonly outcome: PersistedCommandOutcome;
    readonly eventBatch: EventBatch | undefined;
  };
}

const validationsBySnapshot = new WeakMap<
  RoomAuthoritySnapshot,
  AuthoritySnapshotValidation
>();
const validationRecords = new WeakMap<
  AuthoritySnapshotValidation,
  AuthoritySnapshotValidationRecord
>();

const validationRecordMatches = (
  record: AuthoritySnapshotValidationRecord,
  snapshot: RoomAuthoritySnapshot
): boolean =>
  record.snapshot === snapshot &&
  Object.isFrozen(snapshot) &&
  record.schemaVersion === snapshot.schemaVersion &&
  record.authorityVersion === snapshot.authorityVersion &&
  record.mode === snapshot.mode &&
  record.state === snapshot.state &&
  record.stateRevision === snapshot.state.revision &&
  record.soloUndoHistory === snapshot.soloUndoHistory &&
  record.replayHistory === snapshot.replayHistory &&
  record.identities === snapshot.identities &&
  record.sessions === snapshot.sessions &&
  record.admission === snapshot.admission;

const registerAuthoritySnapshotValidation = (
  snapshot: RoomAuthoritySnapshot,
  replayByteFacts: ReplayHistoryByteFacts = replayHistoryByteFacts(
    snapshot.replayHistory
  ),
  command?: AuthoritySnapshotValidationRecord['command']
): AuthoritySnapshotValidation => {
  freezeRecursively(replayByteFacts);
  const validation = Object.freeze({}) as AuthoritySnapshotValidation;
  validationsBySnapshot.set(snapshot, validation);
  validationRecords.set(validation, {
    snapshot,
    schemaVersion: snapshot.schemaVersion,
    authorityVersion: snapshot.authorityVersion,
    mode: snapshot.mode,
    state: snapshot.state,
    stateRevision: snapshot.state.revision,
    soloUndoHistory: snapshot.soloUndoHistory,
    replayHistory: snapshot.replayHistory,
    identities: snapshot.identities,
    sessions: snapshot.sessions,
    admission: snapshot.admission,
    replayByteFacts,
    ...(command ? { command } : {}),
  });
  return validation;
};

const freezeRecursively = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeRecursively(Reflect.get(value, key), seen);
  }
  Object.freeze(value);
};

export const authoritySnapshotValidationMatches = (
  validation: AuthoritySnapshotValidation | undefined,
  snapshot: RoomAuthoritySnapshot
): boolean => {
  if (!validation) return false;
  const record = validationRecords.get(validation);
  return Boolean(record && validationRecordMatches(record, snapshot));
};

export const authoritySnapshotValidationFor = (
  snapshot: RoomAuthoritySnapshot
): AuthoritySnapshotValidation | undefined => {
  const validation = validationsBySnapshot.get(snapshot);
  return authoritySnapshotValidationMatches(validation, snapshot)
    ? validation
    : undefined;
};

export const authoritySnapshotCommandValidationMatches = (
  validation: AuthoritySnapshotValidation | undefined,
  snapshot: RoomAuthoritySnapshot,
  current: RoomAuthoritySnapshot,
  expectedAuthorityVersion: number,
  expectedRevision: number,
  sessionId: string,
  outcome: PersistedCommandOutcome,
  eventBatch: EventBatch | undefined
): boolean => {
  if (!authoritySnapshotValidationMatches(validation, snapshot)) return false;
  const command = validationRecords.get(validation!)?.command;
  return Boolean(
    command &&
    command.sourceSnapshotSerialization === stableSerialize(current) &&
    command.expectedAuthorityVersion === expectedAuthorityVersion &&
    command.expectedRevision === expectedRevision &&
    command.sessionId === sessionId &&
    command.outcome === outcome &&
    command.eventBatch === eventBatch
  );
};

declare const replayHistoryTransitionValidationBrand: unique symbol;

export interface ReplayHistoryTransitionValidation {
  readonly [replayHistoryTransitionValidationBrand]: true;
}

interface ReplayHistoryTransitionValidationRecord {
  readonly current: RoomAuthoritySnapshot;
  readonly currentValidation: AuthoritySnapshotValidation;
  readonly eventBatch: EventBatch;
  readonly resultingState: RoomAuthoritySnapshot['state'];
  readonly replayHistory: ReplayHistory;
  readonly replayByteFacts: ReplayHistoryByteFacts;
  readonly maximumEntries: number;
  readonly maximumEventBytes: number;
  readonly removedEntries: number;
}

const replayHistoryTransitionRecords = new WeakMap<
  ReplayHistoryTransitionValidation,
  ReplayHistoryTransitionValidationRecord
>();

export interface ValidatedReplayHistoryTransition {
  readonly eventBatch: EventBatch;
  readonly resultingState: RoomAuthoritySnapshot['state'];
  readonly replayHistory: ReplayHistory;
  readonly validation: ReplayHistoryTransitionValidation;
}

export const prepareValidatedReplayHistoryTransition = (
  current: RoomAuthoritySnapshot,
  currentValidation: AuthoritySnapshotValidation,
  batch: EventBatch,
  expectedResultingState: RoomAuthoritySnapshot['state'],
  maximumEntries: number,
  maximumEventBytes: number
): ValidatedReplayHistoryTransition => {
  const currentRecord = validationRecords.get(currentValidation);
  if (
    current.mode !== 'multiplayer' ||
    !currentRecord ||
    !validationRecordMatches(currentRecord, current)
  ) {
    throw new Error(
      'Incremental replay transition requires a validated multiplayer snapshot'
    );
  }
  if (
    !Number.isSafeInteger(maximumEntries) ||
    maximumEntries < 1 ||
    maximumEntries > MAX_REPLAY_EVENT_BATCHES ||
    !Number.isSafeInteger(maximumEventBytes) ||
    maximumEventBytes < 2 ||
    maximumEventBytes > MAX_REPLAY_EVENT_BYTES
  ) {
    throw new Error('Incremental replay transition bounds are invalid');
  }

  const eventBatch = structuredClone(batch);
  if (eventBatch.events.length === 0) {
    throw new Error('Accepted command produced an empty event batch');
  }
  const resultingState = applyEventBatch(current.state, eventBatch);
  assertMatchInvariants(resultingState);
  if (
    stableSerialize(resultingState) !== stableSerialize(expectedResultingState)
  ) {
    throw new Error('Command result does not match its replay event batch');
  }

  const newEntry: ReplayHistoryEntry = {
    batch: eventBatch,
    resultingStateHash: stableHash(resultingState),
  };
  const newEntryBytes = replayHistoryEntryBytes(newEntry);
  const entries = [...current.replayHistory.entries, newEntry];
  const entryBytes = [
    ...currentRecord.replayByteFacts.entryBytes,
    newEntryBytes,
  ];
  let eventBytes =
    currentRecord.replayByteFacts.eventBytes +
    (current.replayHistory.entries.length > 0 ? 1 : 0) +
    newEntryBytes;
  let baseState = current.replayHistory.baseState;
  let baseStateHash = current.replayHistory.baseStateHash;
  let removedEntries = 0;
  while (entries.length > maximumEntries || eventBytes > maximumEventBytes) {
    const removed = entries.shift();
    const removedBytes = entryBytes.shift();
    if (!removed || removedBytes === undefined) break;
    eventBytes -= removedBytes + (entries.length > 0 ? 1 : 0);
    removedEntries += 1;
    if (removed === newEntry) {
      baseState = resultingState;
    } else {
      baseState = applyEventBatch(baseState, removed.batch);
      if (stableHash(baseState) !== removed.resultingStateHash) {
        throw new Error('Validated replay prefix produced an invalid state');
      }
    }
    baseStateHash = removed.resultingStateHash;
  }
  const replayHistory: ReplayHistory = {
    baseState,
    baseStateHash,
    entries,
  };
  const replayByteFacts = { entryBytes, eventBytes };
  freezeRecursively(eventBatch);
  freezeRecursively(resultingState);
  freezeRecursively(replayHistory);
  const validation = Object.freeze({}) as ReplayHistoryTransitionValidation;
  replayHistoryTransitionRecords.set(validation, {
    current,
    currentValidation,
    eventBatch,
    resultingState,
    replayHistory,
    replayByteFacts,
    maximumEntries,
    maximumEventBytes,
    removedEntries,
  });
  return Object.freeze({
    eventBatch,
    resultingState,
    replayHistory,
    validation,
  });
};

const collectAuthoritySnapshotProblemsInternal = (
  snapshot: RoomAuthoritySnapshot,
  validateReplayHistory: boolean
): readonly string[] => {
  const problems: string[] = [];
  if (snapshot.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
    problems.push(`unsupported authority schema ${snapshot.schemaVersion}`);
  }
  if (
    !Number.isSafeInteger(snapshot.authorityVersion) ||
    snapshot.authorityVersion < 0
  ) {
    problems.push('authority version must be a non-negative safe integer');
  }
  if (snapshot.mode !== 'solo' && snapshot.mode !== 'multiplayer') {
    problems.push('authority mode must be solo or multiplayer');
  }
  if (
    typeof snapshot.soloUndoHistory !== 'object' ||
    snapshot.soloUndoHistory === null ||
    !Array.isArray(snapshot.soloUndoHistory.entries)
  ) {
    problems.push('authority solo undo history is malformed');
  } else {
    const history = snapshot.soloUndoHistory;
    if (history.entries.length > MAX_SOLO_UNDO_CHECKPOINTS) {
      problems.push('authority has too many solo undo history entries');
    }
    if (
      snapshot.mode === 'multiplayer' &&
      (history.baseState !== null || history.entries.length > 0)
    ) {
      problems.push('multiplayer authority cannot retain solo undo history');
    }
    if ((history.baseState === null) !== (history.baseStateHash === null)) {
      problems.push('solo undo base state and hash must both be present');
    }
    if (history.entries.length > 0 && history.baseState === null) {
      problems.push('solo undo entries require a base state');
    }
    if (history.baseState) {
      const baseProblem = soloUndoCheckpointProblem(
        snapshot.state,
        history.baseState
      );
      if (baseProblem) problems.push(baseProblem);
      if (stableHash(history.baseState) !== history.baseStateHash) {
        problems.push('solo undo base hash does not match its state');
      }
    }
    let priorRevision = -1;
    for (const entry of history.entries) {
      if (
        entry.revertedCommandId.length < 1 ||
        entry.revertedCommandId.length > 128
      ) {
        problems.push('solo undo entry has an invalid command ID');
      }
      if (
        !Number.isSafeInteger(entry.checkpointRevision) ||
        entry.checkpointRevision < 0 ||
        !Number.isSafeInteger(entry.revertedRevision) ||
        entry.revertedRevision !== entry.checkpointRevision + 1 ||
        entry.revertedRevision > snapshot.state.revision
      ) {
        problems.push('solo undo entry has invalid revision metadata');
      }
      if (entry.checkpointRevision <= priorRevision) {
        problems.push('solo undo entry revisions are not increasing');
      }
      priorRevision = entry.checkpointRevision;
      if (
        entry.events.length === 0 ||
        entry.events.some((event) => event.type === 'UndoApplied')
      ) {
        problems.push('solo undo entry has an invalid resolved event tail');
      }
    }
    if (history.baseState) {
      try {
        const replayed = replaySoloUndoHistory(
          history,
          snapshot.state.revision
        );
        if (!replayed || stableHash(replayed) !== stableHash(snapshot.state)) {
          problems.push('solo undo history does not reconstruct current state');
        }
      } catch {
        problems.push('solo undo history cannot be replayed');
      }
    }
  }

  if (validateReplayHistory) {
    if (
      typeof snapshot.replayHistory !== 'object' ||
      snapshot.replayHistory === null ||
      !Array.isArray(snapshot.replayHistory.entries)
    ) {
      problems.push('authority replay history is malformed');
    } else {
      const history = snapshot.replayHistory;
      try {
        if (history.entries.length > MAX_REPLAY_EVENT_BATCHES) {
          problems.push('authority has too many replay history entries');
        }
        if (replayHistoryEventBytes(history) > MAX_REPLAY_EVENT_BYTES) {
          problems.push('authority replay history exceeds its byte bound');
        }
        if (stableHash(history.baseState) !== history.baseStateHash) {
          problems.push('replay base hash does not match its state');
        }
        if (history.baseState.matchId !== snapshot.state.matchId) {
          problems.push('replay base belongs to another match');
        }
        let expectedRevision = history.baseState.revision + 1;
        for (const entry of history.entries) {
          if (entry.batch.revision !== expectedRevision) {
            problems.push('replay history revisions are not contiguous');
          }
          expectedRevision += 1;
          if (entry.batch.events.length === 0) {
            problems.push('replay history contains an empty event batch');
          }
          if (
            typeof entry.resultingStateHash !== 'string' ||
            entry.resultingStateHash.length < 1 ||
            entry.resultingStateHash.length > 128
          ) {
            problems.push('replay history entry has an invalid result hash');
          }
        }
        const replayed = replayHistoryStates(history).at(-1);
        if (!replayed || stableHash(replayed) !== stableHash(snapshot.state)) {
          problems.push('replay history does not reconstruct current state');
        }
      } catch {
        problems.push('replay history is malformed or cannot be replayed');
      }
    }
  }

  const activePlayerSessions = new Set<string>();
  for (const [key, session] of Object.entries(snapshot.sessions)) {
    if (key !== session.id) problems.push(`session key ${key} mismatches ID`);
    if (
      !Number.isSafeInteger(session.nextClientSequence) ||
      session.nextClientSequence < 1
    ) {
      problems.push(`session ${session.id} has invalid sequence frontier`);
    }
    if (
      session.resumeCapabilityDigest !== undefined &&
      (session.resumeCapabilityDigest.length < 32 ||
        session.resumeCapabilityDigest.length > 128)
    ) {
      problems.push(`session ${session.id} has an invalid resume digest`);
    }
    if (session.viewer.kind === 'player') {
      if (!snapshot.state.players[session.viewer.playerId]) {
        problems.push(`session ${session.id} references an unknown player`);
      }
      if (session.active) {
        if (activePlayerSessions.has(session.viewer.playerId)) {
          problems.push(
            `player ${session.viewer.playerId} has multiple active sessions`
          );
        }
        activePlayerSessions.add(session.viewer.playerId);
      }
    }
    const commandIds = new Set<string>();
    for (const outcome of session.recentOutcomes) {
      if (commandIds.has(outcome.commandId)) {
        problems.push(`session ${session.id} duplicates a command outcome`);
      }
      commandIds.add(outcome.commandId);
      if (
        !Number.isSafeInteger(outcome.clientSequence) ||
        outcome.clientSequence < 1 ||
        outcome.clientSequence >= session.nextClientSequence
      ) {
        problems.push(`session ${session.id} has an invalid cached sequence`);
      }
      if (outcome.revision > snapshot.state.revision) {
        problems.push(`session ${session.id} caches a future revision`);
      }
    }
  }

  if (snapshot.admission) {
    const seatPlayerIds = new Set<string>();
    for (const [key, seat] of Object.entries(snapshot.admission.seats)) {
      if (key !== seat.playerId) {
        problems.push(`admission seat key ${key} mismatches player ID`);
      }
      if (!snapshot.state.players[seat.playerId]) {
        problems.push(
          `admission seat references unknown player ${seat.playerId}`
        );
      }
      if (seatPlayerIds.has(seat.playerId)) {
        problems.push(`admission duplicates player ${seat.playerId}`);
      }
      seatPlayerIds.add(seat.playerId);
      if (
        seat.claimCapabilityDigest.length < 32 ||
        seat.claimCapabilityDigest.length > 128
      ) {
        problems.push(`admission seat ${seat.playerId} has invalid digest`);
      }
      const claimedSession =
        seat.claimedSessionId === null
          ? undefined
          : snapshot.sessions[seat.claimedSessionId];
      if (
        seat.claimedSessionId !== null &&
        claimedSession?.viewer.kind !== 'player'
      ) {
        problems.push(
          `admission seat ${seat.playerId} has invalid claim session`
        );
      }
      if (
        claimedSession?.viewer.kind === 'player' &&
        claimedSession.viewer.playerId !== seat.playerId
      ) {
        problems.push(
          `admission seat ${seat.playerId} claim belongs to another player`
        );
      }
    }
    if (
      snapshot.state.playerOrder.some(
        (playerId) => !seatPlayerIds.has(playerId)
      )
    ) {
      problems.push('admission does not define every player seat');
    }
    if (
      snapshot.admission.spectatorCapabilityDigest !== null &&
      (snapshot.admission.spectatorCapabilityDigest.length < 32 ||
        snapshot.admission.spectatorCapabilityDigest.length > 128)
    ) {
      problems.push('admission spectator digest is invalid');
    }
    const invitationRegistryInvalid =
      typeof snapshot.admission.invitations !== 'object' ||
      snapshot.admission.invitations === null ||
      Array.isArray(snapshot.admission.invitations);
    const invitationRegistry = invitationRegistryInvalid
      ? {}
      : snapshot.admission.invitations;
    if (invitationRegistryInvalid) {
      problems.push('room invitations are malformed');
    } else {
      const invitations = Object.entries(invitationRegistry);
      if (invitations.length > MAX_OUTSTANDING_ROOM_INVITATIONS) {
        problems.push('room has too many outstanding invitations');
      }
      for (const [digest, invitation] of invitations) {
        if (digest.length < 32 || digest.length > 128) {
          problems.push('room invitation has an invalid digest');
        }
        if (
          !Number.isSafeInteger(invitation.expiresAt) ||
          invitation.expiresAt < 0
        ) {
          problems.push('room invitation has an invalid expiry');
        }
        if (invitation.role === 'player') {
          if (!snapshot.admission.seats[invitation.playerId]) {
            problems.push('room invitation references an unknown player seat');
          }
        } else if (invitation.role !== 'spectator') {
          problems.push('room invitation has an invalid role');
        }
      }
    }
    if (
      typeof snapshot.admission.tickets !== 'object' ||
      snapshot.admission.tickets === null ||
      Array.isArray(snapshot.admission.tickets)
    ) {
      problems.push('admission tickets are malformed');
    } else {
      const tickets = Object.entries(snapshot.admission.tickets);
      const invitationTicketSources = new Set<string>();
      if (tickets.length > MAX_OUTSTANDING_ADMISSION_TICKETS) {
        problems.push('admission has too many outstanding tickets');
      }
      for (const [digest, ticket] of tickets) {
        if (digest.length < 32 || digest.length > 128) {
          problems.push('admission ticket has an invalid digest');
        }
        if (!Number.isSafeInteger(ticket.expiresAt) || ticket.expiresAt < 0) {
          problems.push('admission ticket has an invalid expiry');
        }
        if (
          ticket.displayName.trim().length < 1 ||
          ticket.displayName.length > 64
        ) {
          problems.push('admission ticket has an invalid display name');
        }
        if (ticket.role === 'player') {
          if (!snapshot.admission.seats[ticket.playerId]) {
            problems.push('admission ticket references an unknown player seat');
          }
        } else if (ticket.role !== 'spectator') {
          problems.push('admission ticket has an invalid role');
        }
        if (ticket.sourceInvitationDigest) {
          if (invitationTicketSources.has(ticket.sourceInvitationDigest)) {
            problems.push('room invitation has multiple admission tickets');
          }
          invitationTicketSources.add(ticket.sourceInvitationDigest);
          const invitation = invitationRegistry[ticket.sourceInvitationDigest];
          if (!invitation) {
            problems.push('admission ticket references a missing invitation');
          } else {
            if (
              invitation.role !== ticket.role ||
              (invitation.role === 'player' &&
                (ticket.role !== 'player' ||
                  invitation.playerId !== ticket.playerId))
            ) {
              problems.push('admission ticket invitation role does not match');
            }
            if (ticket.expiresAt > invitation.expiresAt) {
              problems.push('admission ticket outlives its invitation');
            }
          }
        }
      }
    }
  }

  const aliases = [
    ...snapshot.identities.cardAliases,
    ...snapshot.identities.definitionAliases,
  ];
  if (new Set(aliases.map((entry) => entry.alias)).size !== aliases.length) {
    problems.push('projection aliases are not globally unique');
  }
  const validViewerKeys = new Set([
    'spectator',
    ...Object.values(snapshot.state.players).map((player) =>
      viewerIdentityKey({ kind: 'player', playerId: player.id })
    ),
  ]);
  for (const entry of aliases) {
    if (entry.alias.length < 16 || entry.alias.length > 128) {
      problems.push('projection alias has invalid length');
    }
    if (!validViewerKeys.has(entry.viewerKey)) {
      problems.push('projection alias references an unknown viewer');
    }
  }
  for (const entry of snapshot.identities.cardAliases) {
    if (!snapshot.state.cards[entry.cardId]) {
      problems.push(`projection alias references missing card ${entry.cardId}`);
    }
  }
  for (const entry of snapshot.identities.definitionAliases) {
    if (!snapshot.state.definitions[entry.definitionId]) {
      problems.push(
        `projection alias references missing definition ${entry.definitionId}`
      );
    }
  }
  return problems;
};

export const collectAuthoritySnapshotProblems = (
  snapshot: RoomAuthoritySnapshot
): readonly string[] =>
  collectAuthoritySnapshotProblemsInternal(snapshot, true);

export const assertAuthoritySnapshotInvariants = (
  snapshot: RoomAuthoritySnapshot
): void => {
  assertMatchInvariants(snapshot.state);
  const problems = collectAuthoritySnapshotProblems(snapshot);
  if (problems.length > 0) throw new AuthoritySnapshotInvariantError(problems);
};

export const validateAuthoritySnapshot = (
  snapshot: RoomAuthoritySnapshot
): AuthoritySnapshotValidation => {
  assertAuthoritySnapshotInvariants(snapshot);
  freezeRecursively(snapshot);
  return registerAuthoritySnapshotValidation(snapshot);
};

const structurallyEqual = (left: unknown, right: unknown): boolean =>
  stableSerialize(left) === stableSerialize(right);

const authorityRejectionCodes = new Set([
  'invalid_message',
  'invalid_sequence',
  'unauthorized',
  'stale_reference',
  'precondition_failed',
  'rate_limited',
  'room_not_ready',
  'room_full',
  'session_superseded',
  'internal_retryable',
]);

const collectCommandOutcomeMetadataProblems = (
  current: RoomAuthoritySnapshot,
  candidate: RoomAuthoritySnapshot,
  sessionId: string,
  outcome: PersistedCommandOutcome,
  eventBatch: EventBatch | undefined
): readonly string[] => {
  const problems: string[] = [];
  if (
    typeof sessionId !== 'string' ||
    sessionId.length < 1 ||
    sessionId.length > 128
  ) {
    problems.push('command session ID is malformed');
  }
  if (
    typeof outcome.commandId !== 'string' ||
    outcome.commandId.length < 1 ||
    outcome.commandId.length > 128 ||
    !Number.isSafeInteger(outcome.clientSequence) ||
    outcome.clientSequence < 1 ||
    typeof outcome.accepted !== 'boolean' ||
    !Number.isSafeInteger(outcome.revision) ||
    outcome.revision < 0
  ) {
    problems.push('command outcome metadata is malformed');
  }
  if (
    outcome.clientSequence !== current.sessions[sessionId]?.nextClientSequence
  ) {
    problems.push('command outcome sequence does not match session frontier');
  }

  if (outcome.accepted === true) {
    if (outcome.code !== undefined) {
      problems.push('accepted command outcome cannot contain a rejection code');
    }
    if (
      outcome.revision !== current.state.revision + 1 ||
      candidate.state.revision !== outcome.revision
    ) {
      problems.push('accepted command has an invalid resulting revision');
    }
    if (
      !eventBatch ||
      !Array.isArray(eventBatch.events) ||
      eventBatch.events.length === 0 ||
      eventBatch.revision !== current.state.revision + 1
    ) {
      problems.push('accepted command has an invalid or missing event batch');
    }
  } else if (outcome.accepted === false) {
    if (
      typeof outcome.code !== 'string' ||
      !authorityRejectionCodes.has(outcome.code)
    ) {
      problems.push('rejected command outcome has an invalid rejection code');
    }
    if (eventBatch !== undefined) {
      problems.push('rejected command cannot contain an event batch');
    }
    if (
      outcome.revision !== current.state.revision ||
      candidate.state.revision !== current.state.revision
    ) {
      problems.push('rejected command has an invalid resulting revision');
    }
  }
  return problems;
};

const collectCommandSessionTransitionProblems = (
  current: RoomAuthoritySnapshot,
  candidate: RoomAuthoritySnapshot,
  sessionId: string,
  outcome: PersistedCommandOutcome,
  expectedOutcomes: readonly PersistedCommandOutcome[],
  requireExactReferences: boolean
): readonly string[] => {
  const problems: string[] = [];
  const currentSession = current.sessions[sessionId];
  const candidateSession = candidate.sessions[sessionId];
  const currentSessionIds = Object.keys(current.sessions).sort();
  const candidateSessionIds = Object.keys(candidate.sessions).sort();
  if (
    !currentSession ||
    !candidateSession ||
    !structurallyEqual(currentSessionIds, candidateSessionIds)
  ) {
    return ['command candidate changed the session registry'];
  }

  for (const id of currentSessionIds) {
    if (
      id !== sessionId &&
      (requireExactReferences
        ? candidate.sessions[id] !== current.sessions[id]
        : !structurallyEqual(candidate.sessions[id], current.sessions[id]))
    ) {
      problems.push('command candidate changed an unrelated session');
    }
  }
  const expectedSession = {
    ...currentSession,
    nextClientSequence: currentSession.nextClientSequence + 1,
    recentOutcomes: expectedOutcomes,
  };
  if (!structurallyEqual(candidateSession, expectedSession)) {
    problems.push('command candidate has an invalid session outcome delta');
  }
  if (
    requireExactReferences &&
    (candidateSession.recentOutcomes.length !== expectedOutcomes.length ||
      candidateSession.recentOutcomes.some(
        (item, index) => item !== expectedOutcomes[index]
      ))
  ) {
    problems.push('command candidate did not retain exact outcome objects');
  }
  return problems;
};

const collectReplayAppendTransitionProblems = (
  current: RoomAuthoritySnapshot,
  candidate: RoomAuthoritySnapshot,
  eventBatch: EventBatch
): readonly string[] => {
  const problems: string[] = [];
  try {
    if (
      eventBatch.events.length === 0 ||
      eventBatch.revision !== current.state.revision + 1
    ) {
      problems.push('accepted command has an invalid event batch');
      return problems;
    }
    const resultingState = applyEventBatch(current.state, eventBatch);
    assertMatchInvariants(resultingState);
    if (!structurallyEqual(resultingState, candidate.state)) {
      problems.push(
        'accepted command event batch does not produce the candidate state'
      );
      return problems;
    }

    const appendedEntries: readonly ReplayHistoryEntry[] = [
      ...current.replayHistory.entries,
      {
        batch: eventBatch,
        resultingStateHash: stableHash(resultingState),
      },
    ];
    if (candidate.replayHistory.entries.length > appendedEntries.length) {
      problems.push('accepted command replay is not an appended suffix');
      return problems;
    }
    const removedEntries =
      appendedEntries.length - candidate.replayHistory.entries.length;
    const expectedSuffix = appendedEntries.slice(removedEntries);
    if (!structurallyEqual(candidate.replayHistory.entries, expectedSuffix)) {
      problems.push('accepted command replay is not an appended suffix');
      return problems;
    }

    let expectedBaseState = current.replayHistory.baseState;
    for (const entry of appendedEntries.slice(0, removedEntries)) {
      expectedBaseState = applyEventBatch(expectedBaseState, entry.batch);
      assertMatchInvariants(expectedBaseState);
    }
    if (
      !structurallyEqual(
        candidate.replayHistory.baseState,
        expectedBaseState
      ) ||
      candidate.replayHistory.baseStateHash !== stableHash(expectedBaseState)
    ) {
      problems.push('accepted command replay has an invalid compaction base');
      return problems;
    }

    let replayedState = expectedBaseState;
    for (const entry of expectedSuffix) {
      replayedState = applyEventBatch(replayedState, entry.batch);
      assertMatchInvariants(replayedState);
    }
    if (!structurallyEqual(replayedState, candidate.state)) {
      problems.push(
        'accepted command replay does not reconstruct the candidate state'
      );
    }
  } catch {
    problems.push('accepted command replay transition is malformed');
  }
  return problems;
};

/**
 * Validates a proofless command transaction against its durable predecessor.
 * Both snapshots must already have passed their complete snapshot validators.
 */
export const assertAuthorityTransactionTransition = (
  current: RoomAuthoritySnapshot,
  transaction: PersistedAuthorityTransaction
): void => {
  const candidate = transaction.snapshot;
  const outcome = transaction.outcome;
  const problems = [
    ...collectCommandOutcomeMetadataProblems(
      current,
      candidate,
      transaction.sessionId,
      outcome,
      transaction.eventBatch
    ),
  ];
  if (transaction.expectedAuthorityVersion !== current.authorityVersion) {
    problems.push('command expected authority version does not match current');
  }
  if (transaction.expectedRevision !== current.state.revision) {
    problems.push('command expected revision does not match current');
  }
  if (candidate.schemaVersion !== current.schemaVersion) {
    problems.push('command candidate changed authority schema');
  }
  if (candidate.mode !== current.mode) {
    problems.push('command candidate changed authority mode');
  }
  if (candidate.authorityVersion !== current.authorityVersion + 1) {
    problems.push('Authority commit did not advance exactly one version');
  }
  if (!structurallyEqual(candidate.admission, current.admission)) {
    problems.push('command candidate changed admission state');
  }
  if (
    current.mode === 'multiplayer' &&
    !structurallyEqual(candidate.soloUndoHistory, current.soloUndoHistory)
  ) {
    problems.push('multiplayer command candidate changed solo undo history');
  }
  if (outcome.accepted === true) {
    if (transaction.eventBatch) {
      problems.push(
        ...collectReplayAppendTransitionProblems(
          current,
          candidate,
          transaction.eventBatch
        )
      );
    }
  } else if (outcome.accepted === false) {
    if (!structurallyEqual(candidate.state, current.state)) {
      problems.push('rejected command changed match state');
    }
    if (!structurallyEqual(candidate.replayHistory, current.replayHistory)) {
      problems.push('rejected command changed replay history');
    }
    if (!structurallyEqual(candidate.identities, current.identities)) {
      problems.push('rejected command changed projection identities');
    }
    if (
      !structurallyEqual(candidate.soloUndoHistory, current.soloUndoHistory)
    ) {
      problems.push('rejected command changed solo undo history');
    }
  }

  const currentSession = current.sessions[transaction.sessionId];
  const candidateSession = candidate.sessions[transaction.sessionId];
  let expectedOutcomes: readonly PersistedCommandOutcome[] = [];
  if (currentSession && candidateSession) {
    const appendedOutcomes = [...currentSession.recentOutcomes, outcome];
    const retained = candidateSession.recentOutcomes.length;
    const retainedWithoutCompaction = appendedOutcomes.length;
    const retainedAtAnExistingBound = currentSession.recentOutcomes.length;
    if (
      retained !== retainedWithoutCompaction &&
      (retainedAtAnExistingBound < 1 || retained !== retainedAtAnExistingBound)
    ) {
      problems.push('command candidate has an invalid outcome retention delta');
    } else {
      expectedOutcomes = appendedOutcomes.slice(-retained);
    }
  }
  problems.push(
    ...collectCommandSessionTransitionProblems(
      current,
      candidate,
      transaction.sessionId,
      outcome,
      expectedOutcomes,
      false
    )
  );

  if (problems.length > 0) throw new AuthoritySnapshotInvariantError(problems);
};

export const validateMultiplayerAuthorityCandidate = (
  current: RoomAuthoritySnapshot,
  currentValidation: AuthoritySnapshotValidation,
  candidate: RoomAuthoritySnapshot,
  sessionId: string,
  outcome: PersistedCommandOutcome,
  maximumRecentOutcomes: number,
  maximumReplayEntries: number,
  maximumReplayEventBytes: number,
  replayTransitionValidation?: ReplayHistoryTransitionValidation
): AuthoritySnapshotValidation => {
  const currentRecord = validationRecords.get(currentValidation);
  if (
    current.mode !== 'multiplayer' ||
    !currentRecord ||
    !validationRecordMatches(currentRecord, current)
  ) {
    return validateAuthoritySnapshot(candidate);
  }

  let replayByteFacts = currentRecord.replayByteFacts;
  let eventBatch: EventBatch | undefined;
  if (outcome.accepted === true) {
    const transition = replayTransitionValidation
      ? replayHistoryTransitionRecords.get(replayTransitionValidation)
      : undefined;
    if (
      !transition ||
      transition.current !== current ||
      transition.currentValidation !== currentValidation ||
      transition.maximumEntries !== maximumReplayEntries ||
      transition.maximumEventBytes !== maximumReplayEventBytes ||
      !validationRecordMatches(currentRecord, current)
    ) {
      return validateAuthoritySnapshot(candidate);
    }
    replayHistoryTransitionRecords.delete(replayTransitionValidation!);
    if (
      candidate.state !== transition.resultingState ||
      candidate.replayHistory !== transition.replayHistory ||
      !Object.isFrozen(transition.eventBatch) ||
      !Object.isFrozen(transition.resultingState) ||
      !Object.isFrozen(transition.replayHistory)
    ) {
      return validateAuthoritySnapshot(candidate);
    }
    replayByteFacts = transition.replayByteFacts;
    eventBatch = transition.eventBatch;
  } else if (outcome.accepted === false) {
    if (
      replayTransitionValidation ||
      candidate.state !== current.state ||
      candidate.replayHistory !== current.replayHistory
    ) {
      return validateAuthoritySnapshot(candidate);
    }
  } else {
    return validateAuthoritySnapshot(candidate);
  }

  const problems = [
    ...collectAuthoritySnapshotProblemsInternal(candidate, false),
    ...collectCommandOutcomeMetadataProblems(
      current,
      candidate,
      sessionId,
      outcome,
      eventBatch
    ),
  ];
  if (candidate.schemaVersion !== current.schemaVersion) {
    problems.push('command candidate changed authority schema');
  }
  if (candidate.mode !== current.mode) {
    problems.push('command candidate changed authority mode');
  }
  if (candidate.authorityVersion !== current.authorityVersion + 1) {
    problems.push('command candidate did not advance one authority version');
  }
  if (candidate.soloUndoHistory !== current.soloUndoHistory) {
    problems.push('multiplayer command candidate changed solo undo history');
  }
  if (candidate.admission !== current.admission) {
    problems.push('command candidate changed admission state');
  }
  if (!outcome.accepted && candidate.identities !== current.identities) {
    problems.push('rejected command candidate changed projection identities');
  }
  const currentSession = current.sessions[sessionId];
  const expectedOutcomes = currentSession
    ? [...currentSession.recentOutcomes, outcome].slice(-maximumRecentOutcomes)
    : [];
  problems.push(
    ...collectCommandSessionTransitionProblems(
      current,
      candidate,
      sessionId,
      outcome,
      expectedOutcomes,
      true
    )
  );

  assertMatchInvariants(candidate.state);
  if (problems.length > 0) throw new AuthoritySnapshotInvariantError(problems);
  freezeRecursively(candidate);
  return registerAuthoritySnapshotValidation(candidate, replayByteFacts, {
    sourceSnapshotSerialization: stableSerialize(current),
    expectedAuthorityVersion: current.authorityVersion,
    expectedRevision: current.state.revision,
    sessionId,
    outcome,
    eventBatch,
  });
};
