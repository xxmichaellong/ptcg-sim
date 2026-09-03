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
  playerZoneId,
  type CommandContext,
} from '@ptcgsim/game-core';
import { PROTOCOL_VERSION, type ClientMessage } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { createRoomAdmissionState } from './admission.js';
import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import {
  authoritySnapshotCommandValidationMatches,
  authoritySnapshotValidationMatches,
  authoritySnapshotValidationFor,
  assertAuthoritySnapshotInvariants,
  prepareValidatedReplayHistoryTransition,
  validateAuthoritySnapshot,
  validateMultiplayerAuthorityCandidate,
  type ReplayHistoryTransitionValidation,
} from './invariants.js';
import { createReplayHistory } from './replay-history.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  type AuthorityDependencies,
  type AuthorityPersistence,
  type AuthoritySnapshotValidation,
  type PersistedAuthorityTransaction,
  type PersistedCommandOutcome,
  type RoomAuthoritySnapshot,
} from './model.js';
import { processAuthorityCommand } from './process-command.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');
type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;

const createSnapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('authority-test-match'), [
    {
      playerId: p1,
      displayName: 'Blue',
      cardBackUrl: '/cardback-blue.png',
    },
    {
      playerId: p2,
      displayName: 'Red',
      cardBackUrl: '/cardback-red.png',
    },
  ]);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    admission: createRoomAdmissionState({
      playerIds: [p1, p2],
      seatCapabilityDigests: {
        [p1]: 'a'.repeat(32),
        [p2]: 'b'.repeat(32),
      },
      spectatorCapabilityDigest: 'c'.repeat(32),
    }),
    sessions: {
      'session-player-one': {
        id: 'session-player-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      'session-player-two': {
        id: 'session-player-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      'session-spectator': {
        id: 'session-spectator',
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`canonical-card-${++card}`),
    nextStackId: () => asStackId(`canonical-stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

interface RecordingPersistence extends AuthorityPersistence {
  readonly transactions: PersistedAuthorityTransaction[];
}

const createPersistence = (): RecordingPersistence => {
  const transactions: PersistedAuthorityTransaction[] = [];
  return {
    transactions,
    commit: async (transaction) => {
      transactions.push(transaction);
    },
  };
};

const createDependencies = (
  persistence: AuthorityPersistence
): AuthorityDependencies => {
  let opaqueId = 0;
  return {
    commandContext: createContext(),
    opaqueIds: {
      nextOpaqueId: (kind) =>
        `opaque-${kind}-${String(++opaqueId).padStart(12, '0')}`,
    },
    persistence,
    policy: DEFAULT_AUTHORITY_POLICY,
  };
};

const command = (
  sessionId: string,
  clientSequence: number,
  commandId: string,
  gameCommand: CommandEnvelope['command'],
  revision = 0
): CommandEnvelope => ({
  type: 'Command',
  protocolVersion: PROTOCOL_VERSION,
  sessionId,
  clientSequence,
  commandId,
  lastSeenRevision: revision,
  command: gameCommand,
});

const loadDeck = (sessionId = 'session-player-one'): CommandEnvelope =>
  command(sessionId, 1, 'load-deck-command', {
    type: 'LoadDeck',
    entries: Array.from({ length: 14 }, (_, index) => ({
      definition: {
        id: `secret-definition-${index}`,
        name: `Secret card ${index}`,
        category: index % 2 === 0 ? 'Pokémon' : 'Trainer',
        imageUrl: `https://cards.invalid/secret-${index}.png`,
      },
      count: 1,
    })),
  });

describe('authoritative room command transaction', () => {
  it('commits the event, new state, frontier, and outcome before ordered delivery', async () => {
    const persistence = createPersistence();
    const current = createSnapshot();
    const result = await processAuthorityCommand(
      current,
      loadDeck(),
      createDependencies(persistence)
    );

    expect(result.committed).toBe(true);
    expect(current.state.revision).toBe(0);
    expect(result.snapshot.state.revision).toBe(1);
    expect(result.snapshot.replayHistory).toMatchObject({
      baseState: { revision: 0 },
      entries: [{ batch: { revision: 1 } }],
    });
    expect(result.snapshot.admission).toEqual(current.admission);
    expect(persistence.transactions).toHaveLength(1);
    expect(persistence.transactions[0]?.snapshotValidation).toBe(
      result.snapshotValidation
    );
    expect(
      authoritySnapshotValidationMatches(
        result.snapshotValidation,
        result.snapshot
      )
    ).toBe(true);
    expect(persistence.transactions[0]?.eventBatch?.revision).toBe(1);
    expect(persistence.transactions[0]?.eventBatch).toBe(
      result.snapshot.replayHistory.entries.at(-1)?.batch
    );
    expect(Object.isFrozen(persistence.transactions[0]?.eventBatch)).toBe(true);
    expect(
      authoritySnapshotCommandValidationMatches(
        result.snapshotValidation,
        result.snapshot,
        current,
        persistence.transactions[0]!.expectedAuthorityVersion,
        persistence.transactions[0]!.expectedRevision,
        'session-player-one',
        persistence.transactions[0]!.outcome,
        persistence.transactions[0]!.eventBatch
      )
    ).toBe(true);
    expect(persistence.transactions[0]?.outcome).toMatchObject({
      accepted: true,
      revision: 1,
      commandId: 'load-deck-command',
    });
    expect(
      persistence.transactions[0]?.snapshot.sessions['session-player-one']
        ?.nextClientSequence
    ).toBe(2);

    expect(result.deliveries.map((delivery) => delivery.message.type)).toEqual([
      'StatePublication',
      'StatePublication',
      'StatePublication',
      'CommandResult',
    ]);
    expect(result.deliveries.at(-1)?.sessionId).toBe('session-player-one');
  });

  it('reports isolated authority, projection, and persistence phases without affecting the transaction', async () => {
    const persistence = createPersistence();
    const marks = [0, 0, 10, 10, 30, 30, 60, 60, 80, 80, 90, 90, 120, 120];
    const result = await processAuthorityCommand(createSnapshot(), loadDeck(), {
      ...createDependencies(persistence),
      monotonicNow: () => marks.shift()!,
    });

    expect(result.committed).toBe(true);
    expect(result.timing).toEqual({
      authorityProcessingMs: 70,
      projectionMs: 20,
      persistenceMs: 30,
      breakdown: {
        inputValidationMs: 10,
        resolutionAndExecutionMs: 20,
        historyAndCandidateMs: 30,
        candidateValidationMs: 10,
        snapshotValidationMs: 0,
        predecessorValidationMs: 0,
        frontierFastPathHit: 0,
        transactionMs: 0,
      },
    });
    expect(marks).toEqual([]);

    const clockFailure = await processAuthorityCommand(
      createSnapshot(),
      loadDeck(),
      {
        ...createDependencies(createPersistence()),
        monotonicNow: () => {
          throw new Error('observation clock failed');
        },
      }
    );
    expect(clockFailure.committed).toBe(true);
    expect(clockFailure.timing).toEqual({
      authorityProcessingMs: 0,
      projectionMs: 0,
      persistenceMs: 0,
      breakdown: {
        inputValidationMs: 0,
        resolutionAndExecutionMs: 0,
        historyAndCandidateMs: 0,
        candidateValidationMs: 0,
        snapshotValidationMs: 0,
        predecessorValidationMs: 0,
        frontierFastPathHit: 0,
        transactionMs: 0,
      },
    });
  });

  it('rejects forged and stale validation proofs', async () => {
    const forgedCurrent = { ...createSnapshot(), authorityVersion: -1 };
    await expect(
      processAuthorityCommand(forgedCurrent, loadDeck(), {
        ...createDependencies(createPersistence()),
        currentSnapshotValidation: {} as AuthoritySnapshotValidation,
      })
    ).rejects.toThrow('authority version must be a non-negative safe integer');

    const original = createSnapshot();
    const staleValidation = validateAuthoritySnapshot(original);
    const differentSnapshot = { ...original, authorityVersion: -1 };
    await expect(
      processAuthorityCommand(differentSnapshot, loadDeck(), {
        ...createDependencies(createPersistence()),
        currentSnapshotValidation: staleValidation,
      })
    ).rejects.toThrow('authority version must be a non-negative safe integer');
  });

  it('does not mint a validation proof from assertion alone', () => {
    const snapshot = createSnapshot();

    assertAuthoritySnapshotInvariants(snapshot);

    expect(authoritySnapshotValidationFor(snapshot)).toBeUndefined();
    expect(Object.isFrozen(snapshot)).toBe(false);
  });

  it('recursively freezes proof-bound snapshots against top-level and deep mutation', () => {
    const snapshot = createSnapshot();
    const validation = validateAuthoritySnapshot(snapshot);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.state)).toBe(true);
    expect(Object.isFrozen(snapshot.replayHistory)).toBe(true);
    expect(() => {
      (snapshot as unknown as { schemaVersion: number }).schemaVersion = 999;
    }).toThrow(TypeError);
    expect(() => {
      (snapshot as unknown as { mode: string }).mode = 'corrupt';
    }).toThrow(TypeError);
    expect(() => {
      (
        snapshot.replayHistory as unknown as { baseStateHash: string }
      ).baseStateHash = 'corrupt';
    }).toThrow(TypeError);
    expect(authoritySnapshotValidationMatches(validation, snapshot)).toBe(true);
  });

  it('validates current alias integrity for active viewers while allowing inactive retention', () => {
    const initial = createSnapshot();
    const loaded = executeCommand(
      initial.state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('alias-integrity-definition'),
              name: 'Alias integrity',
              category: 'Trainer',
              imageUrl: '/alias-integrity.png',
            },
            count: 1,
          },
        ],
      },
      createContext()
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    const projected = projectRecipient(
      loaded.state,
      { kind: 'player', playerId: p1 },
      emptyProjectionIdentityState(),
      { nextOpaqueId: () => 'alias-integrity-opaque-id-0001' }
    );
    const snapshot: RoomAuthoritySnapshot = {
      ...initial,
      state: loaded.state,
      replayHistory: createReplayHistory(loaded.state),
      identities: projected.identities,
    };
    assertAuthoritySnapshotInvariants(snapshot);
    const alias = snapshot.identities.cardAliases[0]!;
    const forgedKnown: RoomAuthoritySnapshot = {
      ...snapshot,
      identities: {
        ...snapshot.identities,
        cardAliases: [{ ...alias, known: !alias.known }],
      },
    };
    expect(() => assertAuthoritySnapshotInvariants(forgedKnown)).toThrow(
      'active projection alias is stale or has invalid visibility'
    );
    expect(() =>
      assertAuthoritySnapshotInvariants({
        ...snapshot,
        identities: {
          ...snapshot.identities,
          cardAliases: [
            {
              ...alias,
              visibilityGeneration: alias.visibilityGeneration + 1,
            },
          ],
        },
      })
    ).toThrow('active projection alias is stale or has invalid visibility');

    expect(() =>
      assertAuthoritySnapshotInvariants({
        ...forgedKnown,
        sessions: {
          ...forgedKnown.sessions,
          'session-player-one': {
            ...forgedKnown.sessions['session-player-one']!,
            active: false,
          },
        },
      })
    ).not.toThrow();
  });

  it('purges missing-card and missing-definition aliases while retaining another viewer', () => {
    const initial = createSnapshot();
    const loaded = executeCommand(
      initial.state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('alias-old-definition'),
              name: 'Old alias card',
              category: 'Trainer',
              imageUrl: '/old-alias.png',
            },
            count: 1,
          },
        ],
      },
      createContext()
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    const oldCardId = loaded.state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
    const moved = executeCommand(
      loaded.state,
      {
        type: 'MoveCard',
        cardId: oldCardId,
        expectedSourceZoneId: playerZoneId(p1, 'deck'),
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      createContext()
    );
    if (!moved.accepted) throw new Error(moved.message);
    const oldProjection = projectRecipient(
      moved.state,
      { kind: 'player', playerId: p1 },
      emptyProjectionIdentityState(),
      {
        nextOpaqueId: (kind) => `old-${kind}-alias-opaque-000001`,
      }
    );
    expect(oldProjection.identities.cardAliases).toHaveLength(1);
    expect(oldProjection.identities.definitionAliases).toHaveLength(1);

    const replacement = executeCommand(
      moved.state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('alias-new-definition'),
              name: 'New alias card',
              category: 'Energy',
              imageUrl: '/new-alias.png',
            },
            count: 1,
          },
        ],
      },
      {
        ...createContext(),
        nextCardId: () => asCardInstanceId('replacement-canonical-card'),
      }
    );
    if (!replacement.accepted) throw new Error(replacement.message);
    const retainedOtherViewer = projectRecipient(
      replacement.state,
      { kind: 'player', playerId: p2 },
      oldProjection.identities,
      {
        nextOpaqueId: (kind) => `new-${kind}-alias-opaque-000001`,
      }
    );

    expect(
      retainedOtherViewer.identities.cardAliases.some(
        (entry) => entry.cardId === oldCardId
      )
    ).toBe(false);
    expect(
      retainedOtherViewer.identities.definitionAliases.some(
        (entry) => entry.definitionId === 'alias-old-definition'
      )
    ).toBe(false);
    expect(
      retainedOtherViewer.identities.cardAliases.every((entry) =>
        Boolean(replacement.state.cards[entry.cardId])
      )
    ).toBe(true);
    expect(
      retainedOtherViewer.identities.definitionAliases.every((entry) =>
        Boolean(replacement.state.definitions[entry.definitionId])
      )
    ).toBe(true);
  });

  it('commits an active player deck replacement while purging dangling aliases retained for an inactive viewer', async () => {
    const initial = createSnapshot();
    const context = createContext();
    const first = executeCommand(
      initial.state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('retained-owner-definition'),
              name: 'Retained owner card',
              category: 'Trainer',
              imageUrl: '/retained-owner.png',
            },
            count: 1,
          },
        ],
      },
      context
    );
    if (!first.accepted) throw new Error(first.message);
    const second = executeCommand(
      first.state,
      {
        type: 'LoadDeck',
        playerId: p2,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('replaced-opponent-definition'),
              name: 'Replaced opponent card',
              category: 'Energy',
              imageUrl: '/replaced-opponent.png',
            },
            count: 1,
          },
        ],
      },
      context
    );
    if (!second.accepted) throw new Error(second.message);
    let retainedOpaqueId = 0;
    const projected = projectRecipient(
      second.state,
      { kind: 'player', playerId: p1 },
      emptyProjectionIdentityState(),
      {
        nextOpaqueId: (kind) =>
          `retained-${kind}-opaque-id-${++retainedOpaqueId}`,
      }
    );
    const p1Card = second.state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
    const oldP2Card = second.state.zones[playerZoneId(p2, 'deck')]!.cardIds[0]!;
    const retainedAlias = projected.identities.cardAliases.find(
      (entry) => entry.cardId === p1Card
    )!;
    const danglingAlias = projected.identities.cardAliases.find(
      (entry) => entry.cardId === oldP2Card
    )!;
    const current: RoomAuthoritySnapshot = {
      ...initial,
      state: second.state,
      replayHistory: createReplayHistory(second.state),
      identities: projected.identities,
      sessions: {
        ...initial.sessions,
        'session-player-one': {
          ...initial.sessions['session-player-one']!,
          active: false,
        },
        'session-spectator': {
          ...initial.sessions['session-spectator']!,
          active: false,
        },
      },
    };
    const dependencies = createDependencies(createPersistence());
    const result = await processAuthorityCommand(
      current,
      command(
        'session-player-two',
        1,
        'replace-active-player-deck',
        {
          type: 'LoadDeck',
          entries: [
            {
              definition: {
                id: 'replacement-opponent-definition',
                name: 'Replacement opponent card',
                category: 'Pokémon',
                imageUrl: '/replacement-opponent.png',
              },
              count: 1,
            },
          ],
        },
        second.state.revision
      ),
      {
        ...dependencies,
        commandContext: {
          ...dependencies.commandContext,
          nextCardId: () => asCardInstanceId('active-player-replacement-card'),
        },
      }
    );

    expect(result.committed).toBe(true);
    expect(
      result.snapshot.sessions['session-player-two']!.recentOutcomes.at(-1)
    ).toMatchObject({ accepted: true });
    expect(
      result.snapshot.identities.cardAliases.some(
        (entry) => entry.alias === retainedAlias.alias
      )
    ).toBe(true);
    expect(
      result.snapshot.identities.cardAliases.some(
        (entry) => entry.alias === danglingAlias.alias
      )
    ).toBe(false);
    expect(
      result.snapshot.identities.cardAliases.every((entry) =>
        Boolean(result.snapshot.state.cards[entry.cardId])
      )
    ).toBe(true);
    assertAuthoritySnapshotInvariants(structuredClone(result.snapshot));
  });

  it('fails closed for forged replay evidence and consumes valid evidence once', () => {
    const current = createSnapshot();
    const currentValidation = validateAuthoritySnapshot(current);
    const execution = executeCommand(
      current.state,
      { type: 'FlipCoin', playerId: p1 },
      createContext()
    );
    if (!execution.accepted) throw new Error(execution.message);
    const transition = prepareValidatedReplayHistoryTransition(
      current,
      currentValidation,
      execution.batch,
      execution.state,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes
    );
    const outcome = {
      commandId: 'incremental-command',
      clientSequence: 1,
      accepted: true,
      revision: 1,
    } as const;
    const candidate = {
      ...current,
      authorityVersion: 1,
      state: transition.resultingState,
      replayHistory: transition.replayHistory,
      sessions: {
        ...current.sessions,
        'session-player-one': {
          ...current.sessions['session-player-one']!,
          nextClientSequence: 2,
          recentOutcomes: [outcome],
        },
      },
    };

    const wrongLimitValidation = validateMultiplayerAuthorityCandidate(
      current,
      currentValidation,
      candidate,
      'session-player-one',
      outcome,
      DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches - 1,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes,
      transition.validation
    );
    expect(
      authoritySnapshotCommandValidationMatches(
        wrongLimitValidation,
        candidate,
        current,
        current.authorityVersion,
        current.state.revision,
        'session-player-one',
        outcome,
        transition.eventBatch
      )
    ).toBe(false);

    const validation = validateMultiplayerAuthorityCandidate(
      current,
      currentValidation,
      candidate,
      'session-player-one',
      outcome,
      DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes,
      transition.validation
    );
    expect(authoritySnapshotValidationMatches(validation, candidate)).toBe(
      true
    );
    expect(
      authoritySnapshotCommandValidationMatches(
        validation,
        candidate,
        current,
        current.authorityVersion,
        current.state.revision,
        'session-player-one',
        outcome,
        transition.eventBatch
      )
    ).toBe(true);
    const structurallyEquivalentCurrent = structuredClone(current);
    validateAuthoritySnapshot(structurallyEquivalentCurrent);
    expect(
      authoritySnapshotCommandValidationMatches(
        validation,
        candidate,
        structurallyEquivalentCurrent,
        current.authorityVersion,
        current.state.revision,
        'session-player-one',
        outcome,
        transition.eventBatch
      )
    ).toBe(false);
    expect(
      authoritySnapshotCommandValidationMatches(
        validation,
        candidate,
        current,
        current.authorityVersion + 1,
        current.state.revision,
        'session-player-one',
        outcome,
        transition.eventBatch
      )
    ).toBe(false);
    expect(
      authoritySnapshotCommandValidationMatches(
        validation,
        candidate,
        current,
        current.authorityVersion,
        current.state.revision + 1,
        'session-player-one',
        outcome,
        transition.eventBatch
      )
    ).toBe(false);

    const replayedCandidate = structuredClone(candidate);
    const replayedValidation = validateMultiplayerAuthorityCandidate(
      current,
      currentValidation,
      replayedCandidate,
      'session-player-one',
      replayedCandidate.sessions['session-player-one']!.recentOutcomes[0]!,
      DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes,
      transition.validation
    );
    expect(
      authoritySnapshotCommandValidationMatches(
        replayedValidation,
        replayedCandidate,
        current,
        current.authorityVersion,
        current.state.revision,
        'session-player-one',
        replayedCandidate.sessions['session-player-one']!.recentOutcomes[0]!,
        replayedCandidate.replayHistory.entries.at(-1)?.batch
      )
    ).toBe(false);

    const corrupt = structuredClone(candidate);
    corrupt.replayHistory.entries[0]!.resultingStateHash = 'corrupt';
    expect(() =>
      validateMultiplayerAuthorityCandidate(
        current,
        currentValidation,
        corrupt,
        'session-player-one',
        corrupt.sessions['session-player-one']!.recentOutcomes[0]!,
        DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
        DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
        DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes,
        {} as ReplayHistoryTransitionValidation
      )
    ).toThrow('replay history is malformed or cannot be replayed');
  });

  it('never mints command proof for malformed command outcome metadata', () => {
    const acceptedCurrent = createSnapshot();
    const acceptedCurrentValidation =
      validateAuthoritySnapshot(acceptedCurrent);
    const execution = executeCommand(
      acceptedCurrent.state,
      { type: 'FlipCoin', playerId: p1 },
      createContext()
    );
    if (!execution.accepted) throw new Error(execution.message);
    const transition = prepareValidatedReplayHistoryTransition(
      acceptedCurrent,
      acceptedCurrentValidation,
      execution.batch,
      execution.state,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
      DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes
    );
    const acceptedWithCode = {
      commandId: 'accepted-with-code',
      clientSequence: 1,
      accepted: true,
      revision: 1,
      code: 'precondition_failed',
    } as const;
    const acceptedCandidate: RoomAuthoritySnapshot = {
      ...acceptedCurrent,
      authorityVersion: 1,
      state: transition.resultingState,
      replayHistory: transition.replayHistory,
      sessions: {
        ...acceptedCurrent.sessions,
        'session-player-one': {
          ...acceptedCurrent.sessions['session-player-one']!,
          nextClientSequence: 2,
          recentOutcomes: [acceptedWithCode],
        },
      },
    };
    expect(() =>
      validateMultiplayerAuthorityCandidate(
        acceptedCurrent,
        acceptedCurrentValidation,
        acceptedCandidate,
        'session-player-one',
        acceptedWithCode,
        DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
        DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
        DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes,
        transition.validation
      )
    ).toThrow('accepted command outcome cannot contain a rejection code');

    const invalidRejectedOutcomes = [
      {
        commandId: 'missing-code',
        clientSequence: 1,
        accepted: false,
        revision: 0,
      },
      {
        commandId: 'invalid-code',
        clientSequence: 1,
        accepted: false,
        revision: 0,
        code: 'not-a-rejection-code',
      },
      {
        commandId: '',
        clientSequence: 1,
        accepted: false,
        revision: 0,
        code: 'precondition_failed',
      },
      {
        commandId: 'x'.repeat(129),
        clientSequence: 1,
        accepted: false,
        revision: 0,
        code: 'precondition_failed',
      },
    ] as unknown as readonly PersistedCommandOutcome[];
    for (const outcome of invalidRejectedOutcomes) {
      const current = createSnapshot();
      const currentValidation = validateAuthoritySnapshot(current);
      const candidate: RoomAuthoritySnapshot = {
        ...current,
        authorityVersion: 1,
        sessions: {
          ...current.sessions,
          'session-player-one': {
            ...current.sessions['session-player-one']!,
            nextClientSequence: 2,
            recentOutcomes: [outcome],
          },
        },
      };
      expect(() =>
        validateMultiplayerAuthorityCandidate(
          current,
          currentValidation,
          candidate,
          'session-player-one',
          outcome,
          DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
          DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
          DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes
        )
      ).toThrow(
        outcome.commandId.length < 1 || outcome.commandId.length > 128
          ? 'command outcome metadata is malformed'
          : 'rejected command outcome has an invalid rejection code'
      );
    }

    const validRejection = {
      commandId: 'empty-session-id',
      clientSequence: 1,
      accepted: false,
      revision: 0,
      code: 'precondition_failed',
    } as const;
    const current = createSnapshot();
    const currentValidation = validateAuthoritySnapshot(current);
    const candidate: RoomAuthoritySnapshot = {
      ...current,
      authorityVersion: 1,
      sessions: {
        ...current.sessions,
        'session-player-one': {
          ...current.sessions['session-player-one']!,
          nextClientSequence: 2,
          recentOutcomes: [validRejection],
        },
      },
    };
    expect(() =>
      validateMultiplayerAuthorityCandidate(
        current,
        currentValidation,
        candidate,
        '',
        validRejection,
        DEFAULT_AUTHORITY_POLICY.maximumRecentOutcomesPerSession,
        DEFAULT_AUTHORITY_POLICY.maximumReplayEventBatches,
        DEFAULT_AUTHORITY_POLICY.maximumReplayEventBytes
      )
    ).toThrow('command session ID is malformed');
  });

  it('does not install or acknowledge a mutation when persistence fails before commit', async () => {
    const current = createSnapshot();
    const dependencies = createDependencies({
      commit: async () => {
        throw new Error('storage unavailable');
      },
    });

    await expect(
      processAuthorityCommand(current, loadDeck(), dependencies)
    ).rejects.toThrow('storage unavailable');
    expect(current.state.revision).toBe(0);
    expect(current.sessions['session-player-one']?.nextClientSequence).toBe(1);
  });

  it('recovers exactly once when storage committed but the reply path crashed', async () => {
    const current = createSnapshot();
    let durable = current;
    let commits = 0;
    const crashAfterCommit: AuthorityPersistence = {
      commit: async (transaction) => {
        commits += 1;
        durable = transaction.snapshot;
        throw new Error('process terminated after durable commit');
      },
    };
    const dependencies = createDependencies(crashAfterCommit);

    await expect(
      processAuthorityCommand(current, loadDeck(), dependencies)
    ).rejects.toThrow('process terminated after durable commit');
    expect(durable.state.revision).toBe(1);

    const recoveredPersistence = createPersistence();
    const retried = await processAuthorityCommand(durable, loadDeck(), {
      ...dependencies,
      persistence: recoveredPersistence,
    });
    expect(retried.snapshot.state.revision).toBe(1);
    expect(retried.committed).toBe(false);
    expect(recoveredPersistence.transactions).toHaveLength(0);
    expect(retried.deliveries).toHaveLength(2);
    expect(retried.deliveries[0]?.message).toMatchObject({
      type: 'StatePublication',
      coveringCommandId: 'load-deck-command',
      executedClientSequence: 1,
    });
    expect(retried.deliveries[1]?.message).toMatchObject({
      type: 'CommandResult',
      accepted: true,
      revision: 1,
    });
    expect(commits).toBe(1);
  });

  it('persists spectator rejection and sequence consumption without mutating state', async () => {
    const persistence = createPersistence();
    const current = createSnapshot();
    const result = await processAuthorityCommand(
      current,
      loadDeck('session-spectator'),
      createDependencies(persistence)
    );

    expect(result.committed).toBe(true);
    expect(result.snapshot.state.revision).toBe(0);
    expect(
      result.snapshot.sessions['session-spectator']?.nextClientSequence
    ).toBe(2);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.message).toMatchObject({
      type: 'CommandResult',
      accepted: false,
      code: 'unauthorized',
    });
    expect(persistence.transactions[0]?.eventBatch).toBeUndefined();
    expect(result.snapshot.state).toBe(current.state);
    expect(result.snapshot.replayHistory).toBe(current.replayHistory);
    expect(result.snapshot.soloUndoHistory).toBe(current.soloUndoHistory);
    expect(result.snapshot.identities).toBe(current.identities);
    expect(result.snapshot.admission).toBe(current.admission);
    expect(result.snapshot.sessions['session-player-one']).toBe(
      current.sessions['session-player-one']
    );
    expect(result.snapshot.sessions['session-player-two']).toBe(
      current.sessions['session-player-two']
    );
    expect(result.snapshot.sessions['session-spectator']).not.toBe(
      current.sessions['session-spectator']
    );
    expect(
      authoritySnapshotCommandValidationMatches(
        result.snapshotValidation,
        result.snapshot,
        current,
        persistence.transactions[0]!.expectedAuthorityVersion,
        persistence.transactions[0]!.expectedRevision,
        'session-spectator',
        persistence.transactions[0]!.outcome,
        undefined
      )
    ).toBe(true);
  });

  it('retains the canonical frozen batch when the new replay entry is immediately compacted', async () => {
    const persistence = createPersistence();
    const current = createSnapshot();
    const result = await processAuthorityCommand(current, loadDeck(), {
      ...createDependencies(persistence),
      policy: {
        ...DEFAULT_AUTHORITY_POLICY,
        maximumReplayEventBytes: 2,
      },
    });

    expect(result.snapshot.replayHistory.entries).toEqual([]);
    expect(result.snapshot.replayHistory.baseState).toBe(result.snapshot.state);
    expect(persistence.transactions[0]?.eventBatch).toBeDefined();
    expect(Object.isFrozen(persistence.transactions[0]?.eventBatch)).toBe(true);
    expect(
      authoritySnapshotCommandValidationMatches(
        result.snapshotValidation,
        result.snapshot,
        current,
        persistence.transactions[0]!.expectedAuthorityVersion,
        persistence.transactions[0]!.expectedRevision,
        'session-player-one',
        persistence.transactions[0]!.outcome,
        persistence.transactions[0]!.eventBatch
      )
    ).toBe(true);
    expect(() =>
      assertAuthoritySnapshotInvariants(structuredClone(result.snapshot))
    ).not.toThrow();
  });

  it('matches full replay validation across a long compacting command chain', async () => {
    const persistence = createPersistence();
    const dependencies = {
      ...createDependencies(persistence),
      policy: {
        ...DEFAULT_AUTHORITY_POLICY,
        maximumReplayEventBatches: 3,
      },
    };
    let current = createSnapshot();

    for (let sequence = 1; sequence <= 48; sequence += 1) {
      const result = await processAuthorityCommand(
        current,
        command(
          'session-player-one',
          sequence,
          `long-chain-${sequence}`,
          { type: 'FlipCoin' },
          current.state.revision
        ),
        dependencies
      );
      expect(result.committed).toBe(true);
      expect(result.snapshot.replayHistory.entries.length).toBeLessThanOrEqual(
        3
      );
      expect(() =>
        assertAuthoritySnapshotInvariants(structuredClone(result.snapshot))
      ).not.toThrow();
      current = result.snapshot;
    }

    expect(current.state.revision).toBe(48);
    expect(current.replayHistory.baseState.revision).toBe(45);
    expect(persistence.transactions).toHaveLength(48);
  });

  it('publishes typed table signals once and persists stale broad-action rejection', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const started = await processAuthorityCommand(
      createSnapshot(),
      command('session-player-one', 1, 'start-empty-turn', {
        type: 'StartTurn',
        targetPlayerId: p1,
      }),
      dependencies
    );
    expect(started.snapshot.state.revision).toBe(1);
    expect(persistence.transactions[0]?.eventBatch?.events.at(-1)).toEqual({
      type: 'TableActionDeclared',
      action: 'startTurn',
      playerId: p1,
      outcome: 'emptyDeck',
      turnNumber: 0,
    });
    const publications = started.deliveries.filter(
      (delivery) => delivery.message.type === 'StatePublication'
    );
    expect(publications).toHaveLength(3);
    for (const delivery of publications) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'TurnStartFailedNoDeck',
          revision: 1,
          playerId: p1,
          turnNumber: 0,
        },
      ]);
    }

    const duplicate = await processAuthorityCommand(
      started.snapshot,
      command('session-player-one', 1, 'start-empty-turn', {
        type: 'StartTurn',
        targetPlayerId: p1,
      }),
      dependencies
    );
    expect(duplicate.committed).toBe(false);
    expect(duplicate.deliveries[0]?.message).toMatchObject({
      type: 'StatePublication',
    });
    if (duplicate.deliveries[0]?.message.type === 'StatePublication') {
      expect(
        duplicate.deliveries[0].message.presentationEvents
      ).toBeUndefined();
    }

    const stale = await processAuthorityCommand(
      started.snapshot,
      command(
        'session-player-one',
        2,
        'stale-pass',
        { type: 'PassTurn', targetPlayerId: p1 },
        0
      ),
      dependencies
    );
    expect(stale.committed).toBe(true);
    expect(stale.snapshot.state.revision).toBe(1);
    expect(stale.deliveries[0]?.message).toMatchObject({
      type: 'CommandResult',
      accepted: false,
      code: 'stale_reference',
    });
    expect(persistence.transactions.at(-1)?.eventBatch).toBeUndefined();
  });

  it('publishes setup and reset lifecycle facts with their durable batches', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const loaded = await processAuthorityCommand(
      createSnapshot(),
      loadDeck(),
      dependencies
    );
    for (const delivery of loaded.deliveries) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'DeckLoaded',
          revision: 1,
          playerId: p1,
          cardCount: 14,
        },
      ]);
    }
    const setup = await processAuthorityCommand(
      loaded.snapshot,
      command(
        'session-player-one',
        2,
        'setup-player-command',
        { type: 'SetupPlayer', targetPlayerId: p1 },
        1
      ),
      dependencies
    );
    expect(setup.snapshot.state.revision).toBe(2);
    expect(persistence.transactions[1]?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'PlayerSetup',
        playerId: p1,
        handOrder: expect.any(Array),
        prizeOrder: expect.any(Array),
      }),
    ]);
    for (const delivery of setup.deliveries) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'PlayerSetup',
          revision: 2,
          playerId: p1,
          handCount: 7,
          prizeCount: 6,
        },
      ]);
    }

    const reset = await processAuthorityCommand(
      setup.snapshot,
      command(
        'session-player-one',
        3,
        'reset-player-command',
        { type: 'ResetPlayer', targetPlayerId: p1 },
        2
      ),
      dependencies
    );
    expect(reset.snapshot.state.revision).toBe(3);
    expect(reset.snapshot.state.turn).toEqual({
      number: 0,
      currentPlayerId: null,
    });
    expect(persistence.transactions[2]?.eventBatch?.events).toEqual([
      expect.objectContaining({ type: 'PlayerReset', playerId: p1 }),
    ]);
    for (const delivery of reset.deliveries) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        { type: 'PlayerReset', revision: 3, playerId: p1 },
      ]);
    }
  });

  it('publishes privacy-safe public visibility facts with the atomic batch', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const loaded = await processAuthorityCommand(
      createSnapshot(),
      loadDeck(),
      dependencies
    );
    const setup = await processAuthorityCommand(
      loaded.snapshot,
      command(
        'session-player-one',
        2,
        'visibility-setup',
        { type: 'SetupPlayer', targetPlayerId: p1 },
        1
      ),
      dependencies
    );
    const ownerPublication = setup.deliveries.find(
      (delivery) =>
        delivery.sessionId === 'session-player-one' &&
        delivery.message.type === 'StatePublication'
    );
    if (ownerPublication?.message.type !== 'StatePublication') {
      throw new Error('missing owner setup publication');
    }
    const prizeId = playerZoneId(p1, 'prizes');
    const aliases = ownerPublication.message.snapshot.zones[prizeId]!.cards.map(
      (card) => card.id
    );
    const revealed = await processAuthorityCommand(
      setup.snapshot,
      command(
        'session-player-one',
        3,
        'reveal-prizes',
        {
          type: 'SetZonePublicReveal',
          targetPlayerId: p1,
          zoneId: prizeId,
          expectedCardIds: aliases,
          revealed: true,
        },
        2
      ),
      dependencies
    );
    expect(persistence.transactions[2]?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'PublicRevealSet',
        playerId: p1,
        cardIds: expect.arrayContaining([
          expect.stringMatching(/^canonical-card-/),
        ]),
        revealed: true,
      }),
    ]);
    for (const delivery of revealed.deliveries) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'PublicCardsRevealed',
          revision: 3,
          actorPlayerId: p1,
          playerId: p1,
          scope: 'zone',
          source: 'prizes',
          cardCount: 6,
        },
      ]);
      expect(JSON.stringify(delivery.message.presentationEvents)).not.toContain(
        'canonical-card-'
      );
      expect(
        delivery.message.snapshot.zones[prizeId]!.cards.every(
          (card) => card.kind === 'known' && card.publiclyRevealed
        )
      ).toBe(true);
    }
  });

  it('publishes private inspections only to their viewer with privacy-safe facts', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const loaded = await processAuthorityCommand(
      createSnapshot(),
      loadDeck(),
      dependencies
    );
    const setup = await processAuthorityCommand(
      loaded.snapshot,
      command(
        'session-player-one',
        2,
        'private-inspection-setup',
        { type: 'SetupPlayer', targetPlayerId: p1 },
        1
      ),
      dependencies
    );
    const ownerSetupPublication = setup.deliveries.find(
      (delivery) =>
        delivery.sessionId === 'session-player-one' &&
        delivery.message.type === 'StatePublication'
    );
    if (ownerSetupPublication?.message.type !== 'StatePublication') {
      throw new Error('missing private-inspection owner setup publication');
    }
    const prizeId = playerZoneId(p1, 'prizes');
    const concealedAliases = ownerSetupPublication.message.snapshot.zones[
      prizeId
    ]!.cards.map((card) => card.id);
    const opened = await processAuthorityCommand(
      setup.snapshot,
      command(
        'session-player-one',
        3,
        'open-private-inspection',
        {
          type: 'BeginZoneInspection',
          targetPlayerId: p1,
          zoneId: prizeId,
          expectedCardIds: concealedAliases,
        },
        2
      ),
      dependencies
    );
    expect(persistence.transactions[2]?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'InspectionGrantOpened',
        sourcePlayerId: p1,
        sourceId: prizeId,
        cardIds: expect.arrayContaining([
          expect.stringMatching(/^canonical-card-/),
        ]),
        viewerIds: [p1],
      }),
    ]);

    const publications = opened.deliveries.filter(
      (delivery) => delivery.message.type === 'StatePublication'
    );
    expect(publications).toHaveLength(3);
    for (const delivery of publications) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'PrivateInspectionStarted',
          revision: 3,
          sourcePlayerId: p1,
          viewerPlayerId: p1,
          scope: 'zone',
          source: 'prizes',
          cardCount: 6,
        },
      ]);
      expect(JSON.stringify(delivery.message.presentationEvents)).not.toContain(
        'canonical-card-'
      );
    }

    const ownerPublication = publications.find(
      (delivery) => delivery.sessionId === 'session-player-one'
    );
    const opponentPublication = publications.find(
      (delivery) => delivery.sessionId === 'session-player-two'
    );
    const spectatorPublication = publications.find(
      (delivery) => delivery.sessionId === 'session-spectator'
    );
    if (
      ownerPublication?.message.type !== 'StatePublication' ||
      opponentPublication?.message.type !== 'StatePublication' ||
      spectatorPublication?.message.type !== 'StatePublication'
    ) {
      throw new Error('missing private-inspection publication');
    }
    const ownerPrize = ownerPublication.message.snapshot.zones[prizeId]!;
    expect(ownerPrize.cards.every((card) => card.kind === 'known')).toBe(true);
    expect(ownerPublication.message.snapshot.privateInspections).toEqual([
      {
        id: 'inspection-1',
        sourcePlayerId: p1,
        sourceId: prizeId,
        cardIds: ownerPrize.cards.map((card) => card.id),
      },
    ]);
    for (const privatePublication of [
      opponentPublication,
      spectatorPublication,
    ]) {
      expect(
        privatePublication.message.snapshot.zones[prizeId]!.cards.every(
          (card) => card.kind === 'concealed'
        )
      ).toBe(true);
      expect(privatePublication.message.snapshot.privateInspections).toEqual(
        []
      );
      expect(JSON.stringify(privatePublication.message.snapshot)).not.toContain(
        'inspection-1'
      );
      expect(JSON.stringify(privatePublication.message.snapshot)).not.toContain(
        'secret-definition-'
      );
    }

    const closed = await processAuthorityCommand(
      opened.snapshot,
      command(
        'session-player-one',
        4,
        'close-private-inspection',
        {
          type: 'EndPrivateInspection',
          inspectionId: 'inspection-1',
        },
        3
      ),
      dependencies
    );
    expect(persistence.transactions[3]?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'InspectionGrantClosed',
        sourcePlayerId: p1,
        sourceId: prizeId,
        viewerId: p1,
      }),
    ]);
    const ownerClosedPublication = closed.deliveries.find(
      (delivery) =>
        delivery.sessionId === 'session-player-one' &&
        delivery.message.type === 'StatePublication'
    );
    if (ownerClosedPublication?.message.type !== 'StatePublication') {
      throw new Error('missing closed private-inspection publication');
    }
    expect(ownerClosedPublication.message.presentationEvents).toEqual([
      {
        type: 'PrivateInspectionEnded',
        revision: 4,
        sourcePlayerId: p1,
        viewerPlayerId: p1,
        scope: 'zone',
        source: 'prizes',
        cardCount: 6,
      },
    ]);
    expect(
      ownerClosedPublication.message.snapshot.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(
      ownerClosedPublication.message.snapshot.zones[prizeId]!.cards.map(
        (card) => card.id
      )
    ).not.toEqual(concealedAliases);
    expect(ownerClosedPublication.message.snapshot.privateInspections).toEqual(
      []
    );
  });

  it('publishes an authority-random face-down play without leaking the selection', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const loaded = await processAuthorityCommand(
      createSnapshot(),
      loadDeck(),
      dependencies
    );
    const setup = await processAuthorityCommand(
      loaded.snapshot,
      command(
        'session-player-one',
        2,
        'random-face-down-setup',
        { type: 'SetupPlayer', targetPlayerId: p1 },
        1
      ),
      dependencies
    );
    const opponentSetupPublication = setup.deliveries.find(
      (delivery) =>
        delivery.sessionId === 'session-player-two' &&
        delivery.message.type === 'StatePublication'
    );
    if (opponentSetupPublication?.message.type !== 'StatePublication') {
      throw new Error('missing random-play opponent setup publication');
    }
    const handId = playerZoneId(p1, 'hand');
    const boardId = playerZoneId(p1, 'board');
    const oldOpponentAliases = opponentSetupPublication.message.snapshot.zones[
      handId
    ]!.cards.map((card) => card.id);

    const played = await processAuthorityCommand(
      setup.snapshot,
      command(
        'session-player-two',
        1,
        'play-random-face-down',
        { type: 'PlayRandomCardFaceDown', targetPlayerId: p1 },
        2
      ),
      dependencies
    );
    expect(persistence.transactions[2]?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'RandomHandCardPlayedFaceDown',
        actorPlayerId: p2,
        targetPlayerId: p1,
        cardId: expect.stringMatching(/^canonical-card-/),
      }),
    ]);
    const publications = played.deliveries.filter(
      (delivery) => delivery.message.type === 'StatePublication'
    );
    expect(publications).toHaveLength(3);
    for (const delivery of publications) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'RandomCardPlayedFaceDown',
          revision: 3,
          actorPlayerId: p2,
          targetPlayerId: p1,
        },
      ]);
      expect(JSON.stringify(delivery.message.presentationEvents)).not.toContain(
        'canonical-card-'
      );
      expect(JSON.stringify(delivery.message.presentationEvents)).not.toContain(
        'secret-definition-'
      );
    }

    const ownerPublication = publications.find(
      (delivery) => delivery.sessionId === 'session-player-one'
    );
    const opponentPublication = publications.find(
      (delivery) => delivery.sessionId === 'session-player-two'
    );
    const spectatorPublication = publications.find(
      (delivery) => delivery.sessionId === 'session-spectator'
    );
    if (
      ownerPublication?.message.type !== 'StatePublication' ||
      opponentPublication?.message.type !== 'StatePublication' ||
      spectatorPublication?.message.type !== 'StatePublication'
    ) {
      throw new Error('missing random-play recipient publication');
    }
    expect(ownerPublication.message.snapshot.zones[handId]!.cards).toHaveLength(
      6
    );
    expect(ownerPublication.message.snapshot.zones[boardId]!.cards).toEqual([
      expect.objectContaining({ kind: 'known', face: 'down' }),
    ]);
    const opponentBoardCard =
      opponentPublication.message.snapshot.zones[boardId]!.cards[0]!;
    expect(opponentBoardCard.kind).toBe('concealed');
    expect(oldOpponentAliases).not.toContain(opponentBoardCard.id);
    for (const privatePublication of [
      opponentPublication,
      spectatorPublication,
    ]) {
      expect(
        privatePublication.message.snapshot.zones[handId]!.cards
      ).toHaveLength(6);
      expect(
        privatePublication.message.snapshot.zones[boardId]!.cards[0]?.kind
      ).toBe('concealed');
      expect(JSON.stringify(privatePublication.message.snapshot)).not.toContain(
        'canonical-card-'
      );
      expect(JSON.stringify(privatePublication.message.snapshot)).not.toContain(
        'secret-definition-'
      );
      expect(JSON.stringify(privatePublication.message.snapshot)).not.toContain(
        'Secret card'
      );
    }
  });

  it('never publishes canonical hidden IDs and invalidates concealed handles on shuffle', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const loaded = await processAuthorityCommand(
      createSnapshot(),
      loadDeck(),
      dependencies
    );
    const opponentPublication = loaded.deliveries.find(
      (delivery) =>
        delivery.sessionId === 'session-player-two' &&
        delivery.message.type === 'StatePublication'
    );
    if (opponentPublication?.message.type !== 'StatePublication') {
      throw new Error('missing opponent publication');
    }
    const serialized = JSON.stringify(opponentPublication.message);
    expect(serialized).not.toContain('canonical-card-');
    expect(serialized).not.toContain('secret-definition-');
    expect(serialized).not.toContain('Secret card');
    const deckId = playerZoneId(p1, 'deck');
    const oldAlias =
      opponentPublication.message.snapshot.zones[deckId]?.cards[0]?.id;
    expect(oldAlias).toMatch(/^opaque-card-/);

    const shuffled = await processAuthorityCommand(
      loaded.snapshot,
      command(
        'session-player-one',
        2,
        'shuffle-command',
        { type: 'ShuffleZone', zoneId: deckId },
        1
      ),
      dependencies
    );
    const staleAttempt = await processAuthorityCommand(
      shuffled.snapshot,
      command(
        'session-player-two',
        1,
        'stale-reveal-command',
        {
          type: 'SetPublicReveal',
          cardId: oldAlias!,
          expectedSourceId: deckId,
          revealed: true,
        },
        2
      ),
      dependencies
    );

    expect(staleAttempt.snapshot.state.revision).toBe(2);
    expect(staleAttempt.deliveries[0]?.message).toMatchObject({
      type: 'CommandResult',
      accepted: false,
      code: 'stale_reference',
    });
  });

  it('applies bounded stackable solo checkpoints without replaying randomness', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const solo = { ...createSnapshot(), mode: 'solo' as const };
    const loaded = await processAuthorityCommand(
      solo,
      loadDeck(),
      dependencies
    );
    expect(loaded.snapshot.soloUndoHistory).toEqual({
      baseState: null,
      baseStateHash: null,
      entries: [],
    });

    const setup = await processAuthorityCommand(
      loaded.snapshot,
      command(
        'session-player-one',
        2,
        'setup-for-undo',
        { type: 'SetupPlayer' },
        1
      ),
      dependencies
    );
    expect(setup.snapshot.soloUndoHistory.entries).toHaveLength(1);
    const setupState = setup.snapshot.state;
    const handId = playerZoneId(p1, 'hand');
    const setupOpponentPublication = setup.deliveries.find(
      (delivery) =>
        delivery.sessionId === 'session-player-two' &&
        delivery.message.type === 'StatePublication'
    );
    if (setupOpponentPublication?.message.type !== 'StatePublication') {
      throw new Error('missing pre-undo opponent publication');
    }
    const setupAliases = setupOpponentPublication.message.snapshot.zones[
      handId
    ]!.cards.map((card) => card.id);

    const played = await processAuthorityCommand(
      setup.snapshot,
      command(
        'session-player-one',
        3,
        'random-command-to-undo',
        { type: 'PlayRandomCardFaceDown', targetPlayerId: p1 },
        2
      ),
      dependencies
    );
    expect(played.snapshot.soloUndoHistory.entries).toHaveLength(2);

    const undone = await processAuthorityCommand(
      played.snapshot,
      command(
        'session-player-one',
        4,
        'first-undo-command',
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        3
      ),
      dependencies
    );
    expect(undone.snapshot.state).toEqual({ ...setupState, revision: 4 });
    expect(undone.snapshot.soloUndoHistory.entries).toHaveLength(1);
    expect(persistence.transactions.at(-1)?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'UndoApplied',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'random-command-to-undo',
        revertedRevision: 3,
        fromRevision: 3,
        checkpointRevision: 2,
      }),
    ]);
    const undoPublications = undone.deliveries.filter(
      (delivery) => delivery.message.type === 'StatePublication'
    );
    expect(undoPublications).toHaveLength(3);
    for (const delivery of undoPublications) {
      if (delivery.message.type !== 'StatePublication') continue;
      expect(delivery.message.presentationEvents).toEqual([
        {
          type: 'UndoApplied',
          revision: 4,
          actorPlayerId: p1,
          targetPlayerId: p1,
          revertedRevision: 3,
        },
      ]);
      expect(JSON.stringify(delivery.message)).not.toContain('canonical-card-');
      expect(JSON.stringify(delivery.message)).not.toContain(
        'secret-definition-'
      );
    }
    const undoOpponentPublication = undoPublications.find(
      (delivery) => delivery.sessionId === 'session-player-two'
    );
    if (undoOpponentPublication?.message.type !== 'StatePublication') {
      throw new Error('missing post-undo opponent publication');
    }
    const undoAliases = undoOpponentPublication.message.snapshot.zones[
      handId
    ]!.cards.map((card) => card.id);
    expect(undoAliases).toHaveLength(7);
    expect(undoAliases.every((alias) => !setupAliases.includes(alias))).toBe(
      true
    );

    const branched = await processAuthorityCommand(
      undone.snapshot,
      command(
        'session-player-one',
        5,
        'branched-marker-command',
        {
          type: 'SetOncePerGameMarker',
          targetPlayerId: p1,
          marker: 'gx',
          used: true,
        },
        4
      ),
      dependencies
    );
    expect(branched.snapshot.state.players[p1]?.oncePerGame.gxUsed).toBe(true);
    expect(branched.snapshot.soloUndoHistory.entries).toHaveLength(2);

    const branchUndo = await processAuthorityCommand(
      branched.snapshot,
      command(
        'session-player-one',
        6,
        'branch-undo-command',
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        5
      ),
      dependencies
    );
    expect(branchUndo.snapshot.state.players[p1]?.oncePerGame.gxUsed).toBe(
      false
    );
    expect(branchUndo.snapshot.soloUndoHistory.entries).toHaveLength(1);

    const secondUndo = await processAuthorityCommand(
      branchUndo.snapshot,
      command(
        'session-player-one',
        7,
        'second-undo-command',
        { type: 'ApplySoloUndo', targetPlayerId: p2 },
        6
      ),
      dependencies
    );
    expect(secondUndo.snapshot.state.revision).toBe(7);
    expect(secondUndo.snapshot.soloUndoHistory.entries).toEqual([]);
    expect(secondUndo.snapshot.state.zones[handId]?.cardIds).toEqual([]);

    const emptyUndo = await processAuthorityCommand(
      secondUndo.snapshot,
      command(
        'session-player-one',
        8,
        'empty-undo-command',
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        7
      ),
      dependencies
    );
    expect(emptyUndo.snapshot.state.revision).toBe(7);
    expect(emptyUndo.deliveries.at(-1)?.message).toMatchObject({
      type: 'CommandResult',
      accepted: false,
      code: 'precondition_failed',
    });
  });

  it('rejects undo through the multiplayer authority transaction', async () => {
    const persistence = createPersistence();
    const result = await processAuthorityCommand(
      createSnapshot(),
      command('session-player-one', 1, 'multiplayer-undo-command', {
        type: 'ApplySoloUndo',
        targetPlayerId: p1,
      }),
      createDependencies(persistence)
    );
    expect(result.snapshot.state.revision).toBe(0);
    expect(result.deliveries.at(-1)?.message).toMatchObject({
      type: 'CommandResult',
      accepted: false,
      code: 'unauthorized',
    });
    expect(persistence.transactions[0]?.eventBatch).toBeUndefined();
  });

  it('retains only the configured suffix of solo checkpoints', async () => {
    const persistence = createPersistence();
    const base = createDependencies(persistence);
    const dependencies = {
      ...base,
      policy: { ...base.policy, maximumSoloUndoCheckpoints: 2 },
    };
    let current = { ...createSnapshot(), mode: 'solo' as const };
    const markerCommands = [
      {
        type: 'SetOncePerGameMarker' as const,
        targetPlayerId: p1,
        marker: 'gx' as const,
        used: true,
      },
      {
        type: 'SetOncePerGameMarker' as const,
        targetPlayerId: p2,
        marker: 'gx' as const,
        used: true,
      },
      {
        type: 'SetOncePerGameMarker' as const,
        targetPlayerId: p1,
        marker: 'vstar' as const,
        used: true,
      },
    ];
    for (let sequence = 1; sequence <= markerCommands.length; sequence += 1) {
      const result = await processAuthorityCommand(
        current,
        command(
          'session-player-one',
          sequence,
          `bounded-command-${sequence}`,
          markerCommands[sequence - 1]!,
          sequence - 1
        ),
        dependencies
      );
      current = result.snapshot;
    }
    expect(
      current.soloUndoHistory.entries.map(
        (checkpoint) => checkpoint.revertedCommandId
      )
    ).toEqual(['bounded-command-2', 'bounded-command-3']);
    expect(
      current.soloUndoHistory.entries.map(
        (checkpoint) => checkpoint.checkpointRevision
      )
    ).toEqual([1, 2]);

    const firstUndo = await processAuthorityCommand(
      current,
      command(
        'session-player-one',
        4,
        'bounded-undo-1',
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        3
      ),
      dependencies
    );
    expect(firstUndo.snapshot.state.players[p1]?.oncePerGame).toEqual({
      gxUsed: true,
      vstarUsed: false,
    });
    expect(firstUndo.snapshot.state.players[p2]?.oncePerGame.gxUsed).toBe(true);

    const secondUndo = await processAuthorityCommand(
      firstUndo.snapshot,
      command(
        'session-player-one',
        5,
        'bounded-undo-2',
        { type: 'ApplySoloUndo', targetPlayerId: p2 },
        4
      ),
      dependencies
    );
    expect(secondUndo.snapshot.state.players[p1]?.oncePerGame.gxUsed).toBe(
      true
    );
    expect(secondUndo.snapshot.state.players[p2]?.oncePerGame.gxUsed).toBe(
      false
    );
  });

  it('rejects gaps and command-id reuse without consuming sequence', async () => {
    const persistence = createPersistence();
    const dependencies = createDependencies(persistence);
    const current = createSnapshot();
    const gap = await processAuthorityCommand(
      current,
      command('session-player-one', 3, 'gap', { type: 'FlipCoin' }),
      dependencies
    );
    expect(gap.committed).toBe(false);
    expect(gap.deliveries[0]?.message).toMatchObject({
      accepted: false,
      code: 'invalid_sequence',
    });

    const loaded = await processAuthorityCommand(
      current,
      loadDeck(),
      dependencies
    );
    const reused = await processAuthorityCommand(
      loaded.snapshot,
      command('session-player-one', 2, 'load-deck-command', {
        type: 'FlipCoin',
      }),
      dependencies
    );
    expect(reused.committed).toBe(false);
    expect(
      reused.snapshot.sessions['session-player-one']?.nextClientSequence
    ).toBe(2);
    expect(reused.deliveries[0]?.message).toMatchObject({
      accepted: false,
      code: 'invalid_sequence',
    });
  });
});
