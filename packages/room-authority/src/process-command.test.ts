import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  playerZoneId,
  type CommandContext,
} from '@ptcgsim/game-core';
import { PROTOCOL_VERSION, type ClientMessage } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { createRoomAdmissionState } from './admission.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  type AuthorityDependencies,
  type AuthorityPersistence,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';
import { processAuthorityCommand } from './process-command.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');
type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;

const createSnapshot = (): RoomAuthoritySnapshot => ({
  schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  authorityVersion: 0,
  state: createEmptyMatch(asMatchId('authority-test-match'), [
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
  ]),
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
});

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
    expect(result.snapshot.admission).toEqual(current.admission);
    expect(persistence.transactions).toHaveLength(1);
    expect(persistence.transactions[0]?.eventBatch?.revision).toBe(1);
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
    const result = await processAuthorityCommand(
      createSnapshot(),
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
        { type: 'SetPublicReveal', cardId: oldAlias!, revealed: true },
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
