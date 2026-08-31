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

import { projectRecipient } from './identity-registry.js';
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

const projectForSessions = (
  snapshot: RoomAuthoritySnapshot,
  dependencies: AuthorityDependencies,
  coveringCommandId: string
): {
  readonly snapshot: RoomAuthoritySnapshot;
  readonly deliveries: readonly AuthorityDelivery[];
} => {
  let identities = snapshot.identities;
  const deliveries: AuthorityDelivery[] = [];
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

  const resolution = resolveWireCommand(
    current.state,
    current.identities,
    session,
    envelope.command,
    dependencies.policy
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
    state: accepted
      ? cloneMatchState(nextState)
      : cloneMatchState(current.state),
    identities: {
      cardAliases: current.identities.cardAliases.map((entry) => ({
        ...entry,
      })),
      definitionAliases: current.identities.definitionAliases.map((entry) => ({
        ...entry,
      })),
    },
    sessions,
  };
  let publications: readonly AuthorityDelivery[] = [];
  if (accepted) {
    const projected = projectForSessions(
      candidate,
      dependencies,
      envelope.commandId
    );
    candidate = projected.snapshot;
    publications = projected.deliveries;
  }

  await dependencies.persistence.commit({
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
