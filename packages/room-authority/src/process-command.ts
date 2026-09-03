import {
  cloneMatchState,
  executeCommand,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import {
  authoritySnapshotValidationMatches,
  prepareValidatedReplayHistoryTransition,
  validateAuthoritySnapshot,
  validateMultiplayerAuthorityCandidate,
  type ValidatedReplayHistoryTransition,
} from './invariants.js';
import {
  MAX_REPLAY_EVENT_BATCHES,
  MAX_REPLAY_EVENT_BYTES,
  MAX_SOLO_UNDO_CHECKPOINTS,
} from './model.js';
import type {
  AuthorityDelivery,
  AuthorityCommandTiming,
  AuthorityCommandTimingBreakdown,
  AuthorityDependencies,
  AuthorityPersistenceTiming,
  AuthorityProcessResult,
  AuthorityRejectionCode,
  AuthoritySession,
  AuthoritySnapshotValidation,
  PersistedCommandOutcome,
  RoomAuthoritySnapshot,
} from './model.js';
import { resolveWireCommand } from './resolve-command.js';
import { presentationEventsForBatch } from './presentation-events.js';
import { appendReplayHistory } from './replay-history.js';
import {
  appendSoloUndoHistory,
  cloneSoloUndoHistory,
  emptySoloUndoHistory,
  materializeSoloUndoCheckpoint,
  popSoloUndoHistory,
} from './solo-undo-history.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;

interface AuthorityCommandTimer {
  readonly measureAuthority: <Value>(
    phase: AuthorityProcessingPhase,
    operation: () => Value
  ) => Value;
  readonly measureProjection: <Value>(operation: () => Value) => Value;
  readonly measurePersistence: (
    operation: () => Promise<void | AuthorityPersistenceTiming>
  ) => Promise<void>;
  readonly finish: () => AuthorityCommandTiming;
}

type AuthorityProcessingPhase =
  | 'inputValidationMs'
  | 'resolutionAndExecutionMs'
  | 'historyAndCandidateMs'
  | 'candidateValidationMs';

const safeMonotonicMark = (monotonicNow?: () => number): number | undefined => {
  try {
    const mark = monotonicNow?.();
    return Number.isFinite(mark) && mark !== undefined ? mark : undefined;
  } catch {
    return undefined;
  }
};

const elapsed = (startedAt?: number, finishedAt?: number): number =>
  startedAt === undefined || finishedAt === undefined || finishedAt < startedAt
    ? 0
    : finishedAt - startedAt;

const boundedTiming = (value: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.min(value, 86_400_000) : 0;

const createAuthorityCommandTimer = (
  monotonicNow?: () => number
): AuthorityCommandTimer => {
  const startedAt = safeMonotonicMark(monotonicNow);
  let projectionMs = 0;
  let persistenceMs = 0;
  const breakdown: {
    -readonly [Phase in keyof AuthorityCommandTimingBreakdown]: number;
  } = {
    inputValidationMs: 0,
    resolutionAndExecutionMs: 0,
    historyAndCandidateMs: 0,
    candidateValidationMs: 0,
    snapshotValidationMs: 0,
    transactionMs: 0,
  };
  return {
    measureAuthority: (phase, operation) => {
      const phaseStartedAt = safeMonotonicMark(monotonicNow);
      const value = operation();
      breakdown[phase] += elapsed(
        phaseStartedAt,
        safeMonotonicMark(monotonicNow)
      );
      return value;
    },
    measureProjection: (operation) => {
      const phaseStartedAt = safeMonotonicMark(monotonicNow);
      const value = operation();
      projectionMs += elapsed(phaseStartedAt, safeMonotonicMark(monotonicNow));
      return value;
    },
    measurePersistence: async (operation) => {
      const phaseStartedAt = safeMonotonicMark(monotonicNow);
      const detail = await operation();
      persistenceMs += elapsed(phaseStartedAt, safeMonotonicMark(monotonicNow));
      if (detail) {
        breakdown.snapshotValidationMs += boundedTiming(
          detail.snapshotValidationMs
        );
        breakdown.transactionMs += boundedTiming(detail.transactionMs);
      }
    },
    finish: () => ({
      authorityProcessingMs: Math.max(
        0,
        elapsed(startedAt, safeMonotonicMark(monotonicNow)) -
          projectionMs -
          persistenceMs
      ),
      projectionMs,
      persistenceMs,
      breakdown: { ...breakdown },
    }),
  };
};

const cloneSession = (session: AuthoritySession): AuthoritySession => ({
  ...session,
  viewer:
    session.viewer.kind === 'player'
      ? { kind: 'player', playerId: session.viewer.playerId }
      : { kind: 'spectator' },
  recentOutcomes: session.recentOutcomes.map((outcome) => ({ ...outcome })),
});

const resultMessage = (outcome: PersistedCommandOutcome): ServerMessage => ({
  type: 'CommandResult',
  protocolVersion: PROTOCOL_VERSION,
  commandId: outcome.commandId,
  clientSequence: outcome.clientSequence,
  accepted: outcome.accepted,
  revision: outcome.revision,
  ...(outcome.code ? { code: outcome.code } : {}),
});

const immediateRejection = (
  snapshot: RoomAuthoritySnapshot,
  envelope: CommandEnvelope,
  code: AuthorityRejectionCode,
  snapshotValidation: AuthoritySnapshotValidation,
  timer: AuthorityCommandTimer
): AuthorityProcessResult => ({
  snapshot,
  committed: false,
  deliveries: [
    {
      sessionId: envelope.sessionId,
      message: resultMessage({
        commandId: envelope.commandId,
        clientSequence: envelope.clientSequence,
        accepted: false,
        revision: snapshot.state.revision,
        code,
      }),
    },
  ],
  snapshotValidation,
  timing: timer.finish(),
});

const coreRejectionCode = (
  code:
    | 'invalid_command'
    | 'not_found'
    | 'stale_reference'
    | 'precondition_failed'
    | 'conflict'
): AuthorityRejectionCode => {
  switch (code) {
    case 'not_found':
    case 'stale_reference':
      return 'stale_reference';
    case 'invalid_command':
    case 'precondition_failed':
    case 'conflict':
      return 'precondition_failed';
  }
};

const appendOutcome = (
  session: AuthoritySession,
  outcome: PersistedCommandOutcome,
  maximum: number
): AuthoritySession => ({
  ...session,
  nextClientSequence: session.nextClientSequence + 1,
  recentOutcomes: [...session.recentOutcomes, outcome].slice(-maximum),
});

const projectForSessions = (
  snapshot: RoomAuthoritySnapshot,
  dependencies: AuthorityDependencies,
  coveringCommandId: string,
  eventBatch: EventBatch
): {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly deliveries: readonly AuthorityDelivery[];
} => {
  let identities = snapshot.identities;
  const deliveries: AuthorityDelivery[] = [];
  // Details are intentionally safe for the least-privileged spectator, so one
  // immutable event list can be shared by every recipient projection.
  const presentationEvents = presentationEventsForBatch(
    eventBatch,
    snapshot.state
  );
  for (const session of Object.values(snapshot.sessions)) {
    if (!session.active) continue;
    const projected = projectRecipient(
      snapshot.state,
      session.viewer,
      identities,
      dependencies.opaqueIds
    );
    identities = projected.identities;
    deliveries.push({
      sessionId: session.id,
      message: {
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        coveringCommandId,
        executedClientSequence: session.nextClientSequence - 1,
        snapshot: serializeMatchViewState(projected.snapshot),
        ...(presentationEvents.length > 0
          ? { presentationEvents: [...presentationEvents] }
          : {}),
      },
    });
  }
  return {
    snapshot: { ...snapshot, identities },
    deliveries,
  };
};

export const processAuthorityCommand = async (
  current: RoomAuthoritySnapshot,
  envelope: CommandEnvelope,
  dependencies: AuthorityDependencies
): Promise<AuthorityProcessResult> => {
  const timer = createAuthorityCommandTimer(dependencies.monotonicNow);
  const currentSnapshotValidation = timer.measureAuthority(
    'inputValidationMs',
    () => {
      const supplied = dependencies.currentSnapshotValidation;
      const validation = authoritySnapshotValidationMatches(supplied, current)
        ? supplied!
        : validateAuthoritySnapshot(current);
      if (
        !Number.isSafeInteger(dependencies.policy.maximumSoloUndoCheckpoints) ||
        dependencies.policy.maximumSoloUndoCheckpoints < 1 ||
        dependencies.policy.maximumSoloUndoCheckpoints >
          MAX_SOLO_UNDO_CHECKPOINTS
      ) {
        throw new Error('Solo undo checkpoint policy is invalid');
      }
      if (
        !Number.isSafeInteger(dependencies.policy.maximumReplayEventBatches) ||
        dependencies.policy.maximumReplayEventBatches < 1 ||
        dependencies.policy.maximumReplayEventBatches > MAX_REPLAY_EVENT_BATCHES
      ) {
        throw new Error('Replay history policy is invalid');
      }
      if (
        !Number.isSafeInteger(dependencies.policy.maximumReplayEventBytes) ||
        dependencies.policy.maximumReplayEventBytes < 2 ||
        dependencies.policy.maximumReplayEventBytes > MAX_REPLAY_EVENT_BYTES
      ) {
        throw new Error('Replay history byte policy is invalid');
      }
      return validation;
    }
  );
  const session = current.sessions[envelope.sessionId];
  if (!session || !session.active) {
    return immediateRejection(
      current,
      envelope,
      'session_superseded',
      currentSnapshotValidation,
      timer
    );
  }

  const duplicate = session.recentOutcomes.find(
    (outcome) => outcome.commandId === envelope.commandId
  );
  if (duplicate) {
    if (duplicate.clientSequence !== envelope.clientSequence) {
      return immediateRejection(
        current,
        envelope,
        'invalid_sequence',
        currentSnapshotValidation,
        timer
      );
    }
    const replayDeliveries: AuthorityDelivery[] = [];
    if (duplicate.accepted) {
      const projected = timer.measureProjection(() =>
        projectRecipient(
          current.state,
          session.viewer,
          current.identities,
          dependencies.opaqueIds
        )
      );
      replayDeliveries.push({
        sessionId: session.id,
        message: {
          type: 'StatePublication',
          protocolVersion: PROTOCOL_VERSION,
          coveringCommandId: duplicate.commandId,
          executedClientSequence: session.nextClientSequence - 1,
          snapshot: serializeMatchViewState(projected.snapshot),
        },
      });
    }
    return {
      snapshot: current,
      committed: false,
      deliveries: [
        ...replayDeliveries,
        {
          sessionId: session.id,
          message: resultMessage(duplicate),
        },
      ],
      snapshotValidation: currentSnapshotValidation,
      timing: timer.finish(),
    };
  }

  if (envelope.clientSequence !== session.nextClientSequence) {
    return immediateRejection(
      current,
      envelope,
      'invalid_sequence',
      currentSnapshotValidation,
      timer
    );
  }
  if (envelope.lastSeenRevision > current.state.revision) {
    return immediateRejection(
      current,
      envelope,
      'invalid_sequence',
      currentSnapshotValidation,
      timer
    );
  }

  const resolved = timer.measureAuthority('resolutionAndExecutionMs', () => {
    const undoCheckpoint =
      current.mode === 'solo' && envelope.command.type === 'ApplySoloUndo'
        ? materializeSoloUndoCheckpoint(current.soloUndoHistory)
        : undefined;
    const resolution = resolveWireCommand(
      current.state,
      current.identities,
      session,
      envelope.command,
      dependencies.policy,
      envelope.lastSeenRevision,
      {
        mode: current.mode,
        ...(undoCheckpoint ? { checkpoint: undoCheckpoint } : {}),
      }
    );
    let nextState: MatchState = current.state;
    let eventBatch: EventBatch | undefined;
    let outcome: PersistedCommandOutcome;
    if (!resolution.accepted) {
      outcome = {
        commandId: envelope.commandId,
        clientSequence: envelope.clientSequence,
        accepted: false,
        revision: current.state.revision,
        code: resolution.code,
      };
    } else {
      const execution = executeCommand(
        current.state,
        resolution.command,
        dependencies.commandContext
      );
      if (execution.accepted) {
        nextState = execution.state;
        eventBatch = execution.batch;
        outcome = {
          commandId: envelope.commandId,
          clientSequence: envelope.clientSequence,
          accepted: true,
          revision: execution.state.revision,
        };
      } else {
        outcome = {
          commandId: envelope.commandId,
          clientSequence: envelope.clientSequence,
          accepted: false,
          revision: current.state.revision,
          code: coreRejectionCode(execution.code),
        };
      }
    }
    return { nextState, eventBatch, outcome };
  });
  const { nextState, eventBatch, outcome } = resolved;
  const accepted = outcome.accepted;
  let replayTransition: ValidatedReplayHistoryTransition | undefined;
  let canonicalEventBatch = eventBatch;

  let candidate = timer.measureAuthority('historyAndCandidateMs', () => {
    let soloUndoHistory =
      current.mode === 'multiplayer'
        ? current.soloUndoHistory
        : cloneSoloUndoHistory(current.soloUndoHistory);
    if (accepted && current.mode === 'solo') {
      if (envelope.command.type === 'ApplySoloUndo') {
        soloUndoHistory = popSoloUndoHistory(soloUndoHistory);
      } else if (envelope.command.type === 'LoadDeck') {
        // Loading a new deck replaces canonical card identities and is the same
        // non-undoable history boundary as the legacy deck exchange.
        soloUndoHistory = emptySoloUndoHistory();
      } else {
        if (!eventBatch) {
          throw new Error(
            'Accepted solo command did not produce an event batch'
          );
        }
        soloUndoHistory = appendSoloUndoHistory(
          soloUndoHistory,
          current.state,
          envelope.commandId,
          eventBatch,
          dependencies.policy.maximumSoloUndoCheckpoints
        );
      }
    }
    let replayHistory = current.replayHistory;
    let candidateState: MatchState =
      current.mode === 'multiplayer'
        ? current.state
        : cloneMatchState(current.state);
    if (accepted) {
      if (!eventBatch) {
        throw new Error('Accepted command did not produce an event batch');
      }
      if (current.mode === 'multiplayer') {
        replayTransition = prepareValidatedReplayHistoryTransition(
          current,
          currentSnapshotValidation,
          eventBatch,
          nextState,
          dependencies.policy.maximumReplayEventBatches,
          dependencies.policy.maximumReplayEventBytes
        );
        canonicalEventBatch = replayTransition.eventBatch;
        candidateState = replayTransition.resultingState;
        replayHistory = replayTransition.replayHistory;
      } else {
        candidateState = cloneMatchState(nextState);
        replayHistory = appendReplayHistory(
          replayHistory,
          eventBatch,
          candidateState,
          dependencies.policy.maximumReplayEventBatches,
          dependencies.policy.maximumReplayEventBytes
        );
      }
    }

    const sessions =
      current.mode === 'multiplayer'
        ? { ...current.sessions }
        : Object.fromEntries(
            Object.entries(current.sessions).map(([id, value]) => [
              id,
              cloneSession(value),
            ])
          );
    sessions[session.id] = appendOutcome(
      sessions[session.id]!,
      outcome,
      dependencies.policy.maximumRecentOutcomesPerSession
    );
    return {
      schemaVersion: current.schemaVersion,
      authorityVersion: current.authorityVersion + 1,
      mode: current.mode,
      state: candidateState,
      soloUndoHistory,
      replayHistory,
      identities:
        accepted && envelope.command.type === 'ApplySoloUndo'
          ? emptyProjectionIdentityState()
          : current.mode === 'multiplayer'
            ? current.identities
            : {
                cardAliases: current.identities.cardAliases.map((entry) => ({
                  ...entry,
                })),
                definitionAliases: current.identities.definitionAliases.map(
                  (entry) => ({ ...entry })
                ),
              },
      sessions,
      ...(current.admission ? { admission: current.admission } : {}),
    } satisfies RoomAuthoritySnapshot;
  });
  let publications: readonly AuthorityDelivery[] = [];
  if (accepted) {
    const publicationEventBatch = canonicalEventBatch;
    if (!publicationEventBatch) {
      throw new Error('Accepted command did not produce an event batch');
    }
    const projected = timer.measureProjection(() =>
      projectForSessions(
        candidate,
        dependencies,
        envelope.commandId,
        publicationEventBatch
      )
    );
    candidate = projected.snapshot;
    publications = projected.deliveries;
  }

  const candidateSnapshotValidation = timer.measureAuthority(
    'candidateValidationMs',
    () =>
      current.mode === 'multiplayer'
        ? validateMultiplayerAuthorityCandidate(
            current,
            currentSnapshotValidation,
            candidate,
            session.id,
            outcome,
            dependencies.policy.maximumRecentOutcomesPerSession,
            dependencies.policy.maximumReplayEventBatches,
            dependencies.policy.maximumReplayEventBytes,
            replayTransition?.validation
          )
        : validateAuthoritySnapshot(candidate)
  );

  await timer.measurePersistence(() =>
    dependencies.persistence.commit({
      expectedAuthorityVersion: current.authorityVersion,
      expectedRevision: current.state.revision,
      snapshot: candidate,
      sessionId: session.id,
      outcome,
      ...(canonicalEventBatch ? { eventBatch: canonicalEventBatch } : {}),
      snapshotValidation: candidateSnapshotValidation,
    })
  );

  return {
    snapshot: candidate,
    committed: true,
    deliveries: [
      ...publications,
      { sessionId: session.id, message: resultMessage(outcome) },
    ],
    snapshotValidation: candidateSnapshotValidation,
    timing: timer.finish(),
  };
};
