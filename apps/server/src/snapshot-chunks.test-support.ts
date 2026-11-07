import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  type CommandContext,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  emptyProjectionIdentityState,
  projectRecipient,
  validateAuthoritySnapshot,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
export const largeSnapshot = (): RoomAuthoritySnapshot => {
  const players = [asPlayerId('player-one'), asPlayerId('player-two')];
  let state = createEmptyMatch(
    asMatchId('chunked-authority'),
    players.map((playerId, index) => ({
      playerId,
      displayName: index === 0 ? 'Blue' : 'Red',
      cardBackUrl: '/back.png',
    }))
  );
  let nextId = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`card-${nextId++}`),
    nextStackId: () => asStackId(`stack-${nextId++}`),
    nextInspectionId: () => asInspectionId(`inspection-${nextId++}`),
    nextWorkAreaId: () => asWorkAreaId(`work-${nextId++}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
  for (const playerId of players) {
    const loaded = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId,
        entries: Array.from({ length: 7 }, (_, index) => ({
          definition: {
            id: asCardDefinitionId(`${playerId}-${index}`),
            name: `Card ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `https://example.com/${'漢'.repeat(4000)}`,
            imageUrlSmall: `https://example.org/${'漢'.repeat(4000)}`,
          },
          count: index === 6 ? 26 : 29,
        })),
      },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
  }
  const sessions: Record<string, RoomAuthoritySnapshot['sessions'][string]> =
    {};
  for (let index = 0; index < 34; index++) {
    const id = `session-${index}`;
    sessions[id] = {
      id,
      viewer:
        index < 2
          ? { kind: 'player', playerId: players[index]! }
          : { kind: 'spectator' },
      displayName: index === 0 ? 'Blue' : index === 1 ? 'Red' : 'Watcher',
      active: true,
      nextClientSequence: 129,
      recentOutcomes: Array.from({ length: 128 }, (_, sequence) => ({
        commandId: `${'漢'.repeat(125)}${String(sequence).padStart(3, '0')}`,
        clientSequence: sequence + 1,
        accepted: false,
        revision: state.revision,
        code: 'unauthorized',
      })),
      resumeCapabilityDigest: 'A'.repeat(43),
    };
  }
  let identities = emptyProjectionIdentityState();
  for (const session of Object.values(sessions)) {
    identities = projectRecipient(state, session.viewer, identities, {
      nextOpaqueId: (kind) =>
        `opaque-${kind}-${String(nextId++).padStart(16, '0')}`,
    }).identities;
  }
  const snapshot: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 5000,
    mode: 'multiplayer',
    state,
    replayHistory: createReplayHistory(state),
    identities,
    sessions,
  };
  validateAuthoritySnapshot(snapshot);
  return snapshot;
};

export const nextRejected = (
  snapshot: RoomAuthoritySnapshot
): PersistedAuthorityTransaction => {
  const session = snapshot.sessions['session-0']!;
  const outcome = {
    commandId: `next-${session.nextClientSequence}`,
    clientSequence: session.nextClientSequence,
    accepted: false,
    revision: snapshot.state.revision,
    code: 'precondition_failed' as const,
  };
  return {
    expectedAuthorityVersion: snapshot.authorityVersion,
    expectedRevision: snapshot.state.revision,
    sessionId: session.id,
    outcome,
    snapshot: {
      ...snapshot,
      authorityVersion: snapshot.authorityVersion + 1,
      sessions: {
        ...snapshot.sessions,
        [session.id]: {
          ...session,
          nextClientSequence: session.nextClientSequence + 1,
          recentOutcomes: [...session.recentOutcomes, outcome].slice(-128),
        },
      },
    },
  };
};
