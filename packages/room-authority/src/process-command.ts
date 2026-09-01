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
  type PresentationEvent,
  type ServerMessage,
} from '@ptcgsim/protocol';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import { assertAuthoritySnapshotInvariants } from './invariants.js';
import { MAX_SOLO_UNDO_CHECKPOINTS } from './model.js';
import type {
  AuthorityDelivery,
  AuthorityDependencies,
  AuthorityProcessResult,
  AuthorityRejectionCode,
  AuthoritySession,
  PersistedCommandOutcome,
  RoomAuthoritySnapshot,
} from './model.js';
import { resolveWireCommand } from './resolve-command.js';
import {
  appendSoloUndoHistory,
  cloneSoloUndoHistory,
  emptySoloUndoHistory,
  materializeSoloUndoCheckpoint,
  popSoloUndoHistory,
} from './solo-undo-history.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;

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
  code: AuthorityRejectionCode
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

const presentationEventsForBatch = (batch: EventBatch): PresentationEvent[] =>
  batch.events.flatMap((event): PresentationEvent[] => {
    if (event.type === 'CoinFlipped') {
      return [
        {
          type: 'CoinFlipped',
          revision: batch.revision,
          result: event.result,
        },
      ];
    }
    if (event.type === 'PlayerReset') {
      return [
        {
          type: 'PlayerReset',
          revision: batch.revision,
          playerId: event.playerId,
        },
      ];
    }
    if (event.type === 'DeckLoaded') {
      return [
        {
          type: 'DeckLoaded',
          revision: batch.revision,
          playerId: event.playerId,
          cardCount: event.deckOrder.length,
        },
      ];
    }
    if (event.type === 'PlayerSetup') {
      return [
        {
          type: 'PlayerSetup',
          revision: batch.revision,
          playerId: event.playerId,
          handCount: event.handOrder.length,
          prizeCount: event.prizeOrder.length,
        },
      ];
    }
    if (event.type === 'RandomHandCardPlayedFaceDown') {
      return [
        {
          type: 'RandomCardPlayedFaceDown',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          targetPlayerId: event.targetPlayerId,
        },
      ];
    }
    if (event.type === 'PublicRevealSet') {
      return [
        {
          type: event.revealed ? 'PublicCardsRevealed' : 'PublicCardsHidden',
          revision: batch.revision,
          playerId: event.playerId,
          cardCount: event.cardIds.length,
        },
      ];
    }
    if (event.type === 'InspectionGrantOpened') {
      return event.viewerIds.map((viewerPlayerId) => ({
        type: 'PrivateInspectionStarted',
        revision: batch.revision,
        sourcePlayerId: event.sourcePlayerId,
        viewerPlayerId,
        cardCount: event.cardIds.length,
      }));
    }
    if (event.type === 'InspectionGrantClosed') {
      return [
        {
          type: 'PrivateInspectionEnded',
          revision: batch.revision,
          sourcePlayerId: event.sourcePlayerId,
          viewerPlayerId: event.viewerId,
          cardCount: event.expectedCardIds.length,
        },
      ];
    }
    if (event.type === 'UndoApplied') {
      return [
        {
          type: 'UndoApplied',
          revision: batch.revision,
          actorPlayerId: event.actorPlayerId,
          targetPlayerId: event.targetPlayerId,
          revertedRevision: event.revertedRevision,
        },
      ];
    }
    if (event.type !== 'TableActionDeclared') return [];
    const common = {
      revision: batch.revision,
      playerId: event.playerId,
      turnNumber: event.turnNumber,
    };
    if (event.action === 'attack') {
      return [{ type: 'AttackDeclared', ...common }];
    }
    if (event.action === 'pass') {
      return [{ type: 'PassDeclared', ...common }];
    }
    return [
      {
        type:
          event.outcome === 'drawn' ? 'TurnStarted' : 'TurnStartFailedNoDeck',
        ...common,
      },
    ];
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
  const presentationEvents = presentationEventsForBatch(eventBatch);
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
        ...(presentationEvents.length > 0 ? { presentationEvents } : {}),
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
  assertAuthoritySnapshotInvariants(current);
  if (
    !Number.isSafeInteger(dependencies.policy.maximumSoloUndoCheckpoints) ||
    dependencies.policy.maximumSoloUndoCheckpoints < 1 ||
    dependencies.policy.maximumSoloUndoCheckpoints > MAX_SOLO_UNDO_CHECKPOINTS
  ) {
    throw new Error('Solo undo checkpoint policy is invalid');
  }
  const session = current.sessions[envelope.sessionId];
  if (!session || !session.active) {
    return immediateRejection(current, envelope, 'session_superseded');
  }

  const duplicate = session.recentOutcomes.find(
    (outcome) => outcome.commandId === envelope.commandId
  );
  if (duplicate) {
    if (duplicate.clientSequence !== envelope.clientSequence) {
      return immediateRejection(current, envelope, 'invalid_sequence');
    }
    const replayDeliveries: AuthorityDelivery[] = [];
    if (duplicate.accepted) {
      const projected = projectRecipient(
        current.state,
        session.viewer,
        current.identities,
        dependencies.opaqueIds
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
    };
  }

  if (envelope.clientSequence !== session.nextClientSequence) {
    return immediateRejection(current, envelope, 'invalid_sequence');
  }
  if (envelope.lastSeenRevision > current.state.revision) {
    return immediateRejection(current, envelope, 'invalid_sequence');
  }

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
  const accepted = outcome.accepted;

  let soloUndoHistory = cloneSoloUndoHistory(current.soloUndoHistory);
  if (accepted && current.mode === 'solo') {
    if (envelope.command.type === 'ApplySoloUndo') {
      soloUndoHistory = popSoloUndoHistory(soloUndoHistory);
    } else if (envelope.command.type === 'LoadDeck') {
      // Loading a new deck replaces canonical card identities and is the same
      // non-undoable history boundary as the legacy deck exchange.
      soloUndoHistory = emptySoloUndoHistory();
    } else {
      if (!eventBatch) {
        throw new Error('Accepted solo command did not produce an event batch');
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

  const sessions = Object.fromEntries(
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
  let candidate: RoomAuthoritySnapshot = {
    schemaVersion: current.schemaVersion,
    authorityVersion: current.authorityVersion + 1,
    mode: current.mode,
    state: accepted
      ? cloneMatchState(nextState)
      : cloneMatchState(current.state),
    soloUndoHistory,
    identities:
      accepted && envelope.command.type === 'ApplySoloUndo'
        ? emptyProjectionIdentityState()
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
  };
  let publications: readonly AuthorityDelivery[] = [];
  if (accepted) {
    if (!eventBatch) {
      throw new Error('Accepted command did not produce an event batch');
    }
    const projected = projectForSessions(
      candidate,
      dependencies,
      envelope.commandId,
      eventBatch
    );
    candidate = projected.snapshot;
    publications = projected.deliveries;
  }

  assertAuthoritySnapshotInvariants(candidate);

  await dependencies.persistence.commit({
    expectedAuthorityVersion: current.authorityVersion,
    expectedRevision: current.state.revision,
    snapshot: candidate,
    sessionId: session.id,
    outcome,
    ...(eventBatch ? { eventBatch } : {}),
  });

  return {
    snapshot: candidate,
    committed: true,
    deliveries: [
      ...publications,
      { sessionId: session.id, message: resultMessage(outcome) },
    ],
  };
};
