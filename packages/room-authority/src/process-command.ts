import {
  executeCommand,
  type EventBatch,
  type GameCommand,
  type MatchState,
  type PlayerId,
} from '@ptcgsim/game-core';
import {
  MAX_SERVER_FRAME_CODE_UNITS,
  PROTOCOL_VERSION,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

import { projectRecipient } from './identity-registry.js';
import {
  authoritySnapshotValidationMatches,
  prepareValidatedReplayHistoryTransition,
  validateAuthoritySnapshot,
  validateAuthorityCommandCandidate,
  type ValidatedReplayHistoryTransition,
} from './invariants.js';
import { MAX_REPLAY_EVENT_BATCHES, MAX_REPLAY_EVENT_BYTES } from './model.js';
import type {
  AuthorityDelivery,
  AuthorityCommandTiming,
  AuthorityCommandTimingBreakdown,
  AuthorityDependencies,
  AuthorityMode,
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
import { undoCheckpointFor } from './undo-history.js';
import { identitiesSurvivingUndo } from './undo-identities.js';

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
    predecessorValidationMs: 0,
    frontierFastPathHit: 0,
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
        breakdown.predecessorValidationMs += boundedTiming(
          detail.predecessorValidationMs
        );
        breakdown.frontierFastPathHit =
          detail.frontierFastPathHit === 1 ? 1 : 0;
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
  eventBatch: EventBatch,
  previousState: MatchState
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
    snapshot.state,
    previousState
  );
  for (const session of Object.values(snapshot.sessions)) {
    if (!session.active) continue;
    const projected = projectRecipient(
      snapshot.state,
      session.viewer,
      identities,
      dependencies.opaqueIds,
      snapshot.mode
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

/**
 * v1 narrates its "initiator", the seat at the bottom of the board. A seat
 * acting for the other seat (a flipped Solo or coaching board) names that
 * seat on the wire, and the seat-bound commands read that way in the log:
 * "Red drew 3 cards", "Red flipped heads". Card movement keeps naming the
 * submitting seat, as v1 does when a player moves the opponent's cards.
 */
const narratedActorOf = (
  command: GameCommand,
  state: MatchState,
  mode: AuthorityMode
): PlayerId | undefined => {
  switch (command.type) {
    case 'DrawCards':
    case 'DiscardHandAndDraw':
    case 'ShuffleHandIntoDeckAndDraw':
    case 'ShuffleHandToDeckBottomAndDraw':
    case 'FlipCoin':
    case 'MovePrizesToDeckBottom':
    case 'SetupPlayer':
    case 'ResetPlayer':
    case 'StartTurn':
    case 'DeclareAttack':
    case 'PassTurn':
      return command.playerId;
    case 'ApplySoloUndo':
      return command.targetPlayerId;
    // Solo's deck shortcuts work the deck of the seat at the bottom, and
    // name it. (In a room each player shuffles only their own deck, and a
    // public look at the other's names who looked.)
    case 'ShuffleZone':
      return mode === 'solo'
        ? (state.zones[command.zoneId]?.ownerId ?? undefined)
        : undefined;
    case 'ExtractDeckCardsForInspection':
      return mode === 'solo' ? command.playerId : undefined;
    default:
      return undefined;
  }
};

/**
 * Every concealed card carries its owner's card back on the wire, so a long
 * custom back on a full deck multiplies past what one frame can carry, and
 * a session sent such a frame fails. A command that would push the total
 * past half the frame limit is refused (the rest is room enough for the
 * definitions, each deck's bounded by the one frame that loaded it).
 */
const MAX_CONCEALED_CARD_BACK_CODE_UNITS = MAX_SERVER_FRAME_CODE_UNITS / 2;

const cardBackCodeUnits = (state: MatchState): number => {
  // As written on the wire: quotes and backslashes in a URL are escaped.
  const encoded = new Map<string, number>();
  const backOf = (cardId: string): number => {
    const ownerId = state.cards[cardId]?.ownerId;
    const url = (ownerId && state.players[ownerId]?.cardBackUrl) || '';
    let length = encoded.get(url);
    if (length === undefined) {
      length = JSON.stringify(url).length;
      encoded.set(url, length);
    }
    return length;
  };
  let total = 0;
  for (const cardId of Object.keys(state.cards)) total += backOf(cardId);
  // An attached-card window lists each card twice: in its flat order and
  // again among its evolutions or its attachments.
  for (const areas of Object.values(state.workAreas)) {
    const staged = areas?.attachmentResolution;
    if (!staged) continue;
    for (const cardId of [
      ...staged.evolutionCardIds,
      ...staged.attachmentCardIds,
    ])
      total += backOf(cardId);
  }
  return total;
};

const exceedsCardBackBudget = (
  current: MatchState,
  next: MatchState
): boolean => {
  const after = cardBackCodeUnits(next);
  return (
    after > MAX_CONCEALED_CARD_BACK_CODE_UNITS &&
    after > cardBackCodeUnits(current)
  );
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
      // A commit can become durable and then fail before its publications
      // go out; the coordinator reloads it and the issuer retries. While it
      // is still the latest revision, everyone may have missed it, so it
      // goes to every session again (one that has it ignores an identical
      // revision). A later commit has already carried them past it.
      const recipients =
        duplicate.revision === current.state.revision
          ? Object.values(current.sessions).filter(
              (candidate) => candidate.active
            )
          : [session];
      for (const recipient of recipients) {
        const projected = timer.measureProjection(() =>
          projectRecipient(
            current.state,
            recipient.viewer,
            current.identities,
            dependencies.opaqueIds,
            current.mode
          )
        );
        replayDeliveries.push({
          sessionId: recipient.id,
          message: {
            type: 'StatePublication',
            protocolVersion: PROTOCOL_VERSION,
            coveringCommandId: duplicate.commandId,
            executedClientSequence: recipient.nextClientSequence - 1,
            snapshot: serializeMatchViewState(projected.snapshot),
          },
        });
      }
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
      envelope.command.type === 'ApplySoloUndo' &&
      session.viewer.kind === 'player'
        ? undoCheckpointFor(
            current.replayHistory,
            current.mode,
            session.viewer.playerId
          )
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
      if (
        execution.accepted &&
        exceedsCardBackBudget(current.state, execution.state)
      ) {
        outcome = {
          commandId: envelope.commandId,
          clientSequence: envelope.clientSequence,
          accepted: false,
          revision: current.state.revision,
          code: 'precondition_failed',
        };
      } else if (execution.accepted) {
        nextState = execution.state;
        eventBatch =
          session.viewer.kind === 'player'
            ? {
                ...execution.batch,
                actorPlayerId:
                  narratedActorOf(
                    resolution.command,
                    current.state,
                    current.mode
                  ) ?? session.viewer.playerId,
                issuer: {
                  playerId: session.viewer.playerId,
                  commandId: envelope.commandId,
                },
              }
            : execution.batch;
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
    // Validated snapshots are frozen, so a candidate shares every part of
    // the current one that the command left alone.
    let replayHistory = current.replayHistory;
    let candidateState: MatchState = current.state;
    if (accepted) {
      if (!eventBatch) {
        throw new Error('Accepted command did not produce an event batch');
      }
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
    }

    const sessions = { ...current.sessions };
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
      replayHistory,
      // An undo rotates only the aliases of cards the move taken back carried
      // across a concealment boundary (identitiesSurvivingUndo).
      identities:
        accepted && envelope.command.type === 'ApplySoloUndo'
          ? identitiesSurvivingUndo(
              current.identities,
              current.state,
              candidateState
            )
          : current.identities,
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
        publicationEventBatch,
        current.state
      )
    );
    candidate = projected.snapshot;
    publications = projected.deliveries;
  }

  const candidateSnapshotValidation = timer.measureAuthority(
    'candidateValidationMs',
    () =>
      validateAuthorityCommandCandidate(
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
