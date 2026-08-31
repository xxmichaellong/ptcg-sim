import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  createEmptyMatch,
  type CommandContext,
} from '@ptcgsim/game-core';
import { PROTOCOL_VERSION, type ClientMessage } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { RoomAuthorityCoordinator } from './coordinator.js';
import { emptyProjectionIdentityState } from './identity-registry.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  type AuthoritySnapshotStore,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';

type CommandEnvelope = Extract<ClientMessage, { type: 'Command' }>;

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const snapshot = (): RoomAuthoritySnapshot => ({
  schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  authorityVersion: 0,
  state: createEmptyMatch(asMatchId('coordinator-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]),
  identities: emptyProjectionIdentityState(),
  sessions: {
    session: {
      id: 'session',
      viewer: { kind: 'player', playerId: p1 },
      active: true,
      nextClientSequence: 1,
      recentOutcomes: [],
    },
  },
});

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  return {
    nextCardId: () => asCardInstanceId(`card-${++card}`),
    nextStackId: () => asStackId(`stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`inspection-${++inspection}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const envelope = (sequence: number): CommandEnvelope => ({
  type: 'Command',
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 'session',
  clientSequence: sequence,
  commandId: `command-${sequence}`,
  lastSeenRevision: sequence - 1,
  command: { type: 'FlipCoin' },
});

const deferred = () => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const dependencies = () => {
  let opaque = 0;
  return {
    commandContext: context(),
    opaqueIds: {
      nextOpaqueId: (kind: 'card' | 'definition') =>
        `opaque-${kind}-${String(++opaque).padStart(12, '0')}`,
    },
    policy: DEFAULT_AUTHORITY_POLICY,
  };
};

describe('room command coordinator', () => {
  it('prevents command decisions from interleaving across a storage await', async () => {
    let durable = snapshot();
    let commitCount = 0;
    const firstCommitEntered = deferred();
    const releaseFirstCommit = deferred();
    const store: AuthoritySnapshotStore = {
      load: async () => durable,
      commit: async (transaction) => {
        commitCount += 1;
        if (commitCount === 1) {
          firstCommitEntered.resolve();
          await releaseFirstCommit.promise;
        }
        expect(transaction.expectedAuthorityVersion).toBe(
          durable.authorityVersion
        );
        durable = transaction.snapshot;
      },
    };
    const coordinator = new RoomAuthorityCoordinator(
      durable,
      store,
      dependencies()
    );

    const first = coordinator.submit(envelope(1));
    const second = coordinator.submit(envelope(2));
    await firstCommitEntered.promise;
    expect(commitCount).toBe(1);
    releaseFirstCommit.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.snapshot.state.revision).toBe(1);
    expect(secondResult.snapshot.state.revision).toBe(2);
    expect(coordinator.currentSnapshot().state.revision).toBe(2);
    expect(durable.state.revision).toBe(2);
  });

  it('reloads a commit that became durable before the storage call threw', async () => {
    let durable = snapshot();
    let shouldCrashAfterCommit = true;
    const transactions: PersistedAuthorityTransaction[] = [];
    const store: AuthoritySnapshotStore = {
      load: async () => durable,
      commit: async (transaction) => {
        transactions.push(transaction);
        durable = transaction.snapshot;
        if (shouldCrashAfterCommit) {
          shouldCrashAfterCommit = false;
          throw new Error('lost response after commit');
        }
      },
    };
    const coordinator = new RoomAuthorityCoordinator(
      durable,
      store,
      dependencies()
    );

    await expect(coordinator.submit(envelope(1))).rejects.toThrow(
      'lost response after commit'
    );
    expect(coordinator.currentSnapshot().state.revision).toBe(1);

    const retry = await coordinator.submit(envelope(1));
    expect(retry.committed).toBe(false);
    expect(retry.snapshot.state.revision).toBe(1);
    expect(transactions).toHaveLength(1);
    expect(retry.deliveries.map((item) => item.message.type)).toEqual([
      'StatePublication',
      'CommandResult',
    ]);
  });

  it('keeps the old snapshot when storage fails before making a commit visible', async () => {
    let durable = snapshot();
    let failBeforeCommit = true;
    const store: AuthoritySnapshotStore = {
      load: async () => durable,
      commit: async (transaction) => {
        if (failBeforeCommit) {
          failBeforeCommit = false;
          throw new Error('write rejected');
        }
        durable = transaction.snapshot;
      },
    };
    const coordinator = new RoomAuthorityCoordinator(
      durable,
      store,
      dependencies()
    );

    await expect(coordinator.submit(envelope(1))).rejects.toThrow(
      'write rejected'
    );
    expect(coordinator.currentSnapshot().state.revision).toBe(0);

    const retry = await coordinator.submit(envelope(1));
    expect(retry.committed).toBe(true);
    expect(retry.snapshot.state.revision).toBe(1);
  });
});
