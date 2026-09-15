import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it, vi } from 'vitest';

import { RoomChatService } from './room-chat.js';
import { NOOP_SERVER_TELEMETRY } from './server-telemetry.js';

const playerId = asPlayerId('chat-player');
const opponentId = asPlayerId('chat-opponent');

const snapshot = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('chat-room'), [
    {
      playerId,
      displayName: 'Authenticated Player',
      cardBackUrl: '/card-back.png',
    },
    {
      playerId: opponentId,
      displayName: 'Opponent',
      cardBackUrl: '/opponent-card-back.png',
    },
  ]);
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 2,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    sessions: {
      player: {
        id: 'player',
        viewer: { kind: 'player', playerId },
        displayName: 'Authenticated Player',
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
      legacySpectator: {
        id: 'legacySpectator',
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const serviceFixture = (input?: {
  readonly now?: () => number;
  readonly nextMessageIdCandidate?: () => string;
}) => {
  const rateLimits = {
    attempt: vi.fn(async () => ({ allowed: true, remaining: 119 }) as const),
  };
  const telemetry = {
    ...NOOP_SERVER_TELEMETRY,
    roomRateLimit: vi.fn(),
    failure: vi.fn(),
  };
  return {
    rateLimits,
    telemetry,
    service: new RoomChatService({
      rateLimits,
      telemetry,
      now: input?.now ?? (() => 12_000),
      nextMessageIdCandidate:
        input?.nextMessageIdCandidate ?? (() => 'chat-message-id'),
    }),
  };
};

describe('ephemeral room chat service', () => {
  it('recovers from invalid and colliding opaque ID candidates', async () => {
    const candidates = [
      'shared-message-id',
      'shared-message-id',
      '',
      'next-message-id',
    ];
    const setup = serviceFixture({
      nextMessageIdCandidate: () => candidates.shift() ?? 'exhausted',
    });

    await expect(
      setup.service.prepareDelivery({
        snapshot: snapshot(),
        sessionId: 'player',
        connectionId: 'connection',
        message: ' first ',
      })
    ).resolves.toMatchObject({
      accepted: true,
      message: {
        messageId: 'shared-message-id',
        playerId,
        displayName: 'Authenticated Player',
        message: 'first',
      },
    });
    await expect(
      setup.service.prepareDelivery({
        snapshot: snapshot(),
        sessionId: 'player',
        connectionId: 'connection',
        message: 'second',
      })
    ).resolves.toMatchObject({
      accepted: true,
      message: { messageId: 'next-message-id' },
    });
  });

  it('fails closed without consuming the durable budget when time is invalid', async () => {
    const setup = serviceFixture({ now: () => Number.NaN });

    await expect(
      setup.service.prepareDelivery({
        snapshot: snapshot(),
        sessionId: 'player',
        connectionId: 'connection',
        message: 'private text',
      })
    ).resolves.toEqual({
      accepted: false,
      notice: {
        type: 'ServerNotice',
        protocolVersion: 2,
        code: 'internal_retryable',
        message: 'The chat message could not be delivered',
        retryable: false,
      },
    });
    expect(setup.rateLimits.attempt).not.toHaveBeenCalled();
    expect(setup.telemetry.failure).toHaveBeenCalledWith({
      subsystem: 'chat_processing',
      retryable: false,
    });
    expect(JSON.stringify(setup.telemetry.failure.mock.calls)).not.toContain(
      'private text'
    );
  });

  it('uses a generic identity for a spectator restored from an older snapshot', async () => {
    const setup = serviceFixture();

    await expect(
      setup.service.prepareDelivery({
        snapshot: snapshot(),
        sessionId: 'legacySpectator',
        connectionId: 'connection',
        message: 'hello',
      })
    ).resolves.toMatchObject({
      accepted: true,
      message: {
        displayName: 'Spectator',
        message: 'hello',
      },
    });
  });
});
