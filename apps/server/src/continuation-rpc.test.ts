import { asMatchId, asPlayerId, createEmptyMatch } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTINUATION_TTL_MS,
  createContinuationCapability,
  parseContinuationCapability,
} from './continuation-custody.js';
import {
  readContinuationRestoreRpcInput,
  readContinuationSaveCreationRpcInput,
  readContinuationSaveRecoveryRpcInput,
  readContinuationSourceCreationRpcInput,
} from './continuation-rpc.js';

const p1 = asPlayerId('continuation-rpc-player-one');
const p2 = asPlayerId('continuation-rpc-player-two');
const createdAt = 2_000_000_000_000;

const snapshotFixture = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId('continuation-rpc-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: 'a'.repeat(43),
      [p2]: 'b'.repeat(43),
    },
  });
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 3,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    admission: {
      ...admission,
      seats: {
        ...admission.seats,
        [p1]: {
          ...admission.seats[p1]!,
          claimedSessionId: 'continuation-rpc-session-one',
        },
      },
    },
    sessions: {
      'continuation-rpc-session-one': {
        id: 'continuation-rpc-session-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 2,
        recentOutcomes: [],
      },
    },
  };
};

describe('continuation internal RPC codec', () => {
  it('accepts only an exact source-room creation request', () => {
    const input = {
      requesterSessionId: 'continuation-rpc-session-one',
      operationId: 'C'.repeat(43),
    };
    expect(readContinuationSourceCreationRpcInput(input)).toEqual(input);
    for (const value of [
      {},
      { ...input, operationId: 'short' },
      { ...input, requesterSessionId: '' },
      { ...input, extra: true },
    ]) {
      expect(readContinuationSourceCreationRpcInput(value)).toBeUndefined();
    }
  });

  it('accepts only an exact active-player save creation bound to its object name', () => {
    const input = {
      saveId: 'L'.repeat(22),
      operationId: 'C'.repeat(43),
      snapshot: snapshotFixture(),
      requesterSessionId: 'continuation-rpc-session-one',
      sourceBuild: 'continuation-rpc-test',
      createdAt,
      expiresAt: createdAt + DEFAULT_CONTINUATION_TTL_MS,
      requestedAt: createdAt + 1,
    };
    expect(readContinuationSaveCreationRpcInput(input, input.saveId)).toEqual(
      input
    );
    expect(
      readContinuationSaveCreationRpcInput(input, 'M'.repeat(22))
    ).toBeUndefined();
    expect(
      readContinuationSaveCreationRpcInput(
        { ...input, requesterSessionId: 'missing-session' },
        input.saveId
      )
    ).toBeUndefined();
    expect(
      readContinuationSaveCreationRpcInput(
        { ...input, requestedAt: input.expiresAt },
        input.saveId
      )
    ).toBeUndefined();
    expect(
      readContinuationSaveCreationRpcInput(
        { ...input, extra: true },
        input.saveId
      )
    ).toBeUndefined();
  });

  it('accepts only an exact save creation recovery bound to its object name', () => {
    const input = {
      saveId: 'L'.repeat(22),
      operationId: 'C'.repeat(43),
      requestedAt: createdAt + 2,
    };
    expect(readContinuationSaveRecoveryRpcInput(input, input.saveId)).toEqual(
      input
    );
    expect(
      readContinuationSaveRecoveryRpcInput(input, 'M'.repeat(22))
    ).toBeUndefined();
    expect(
      readContinuationSaveRecoveryRpcInput(
        { ...input, extra: true },
        input.saveId
      )
    ).toBeUndefined();
  });

  it('accepts only an exact capability-bound restore request', () => {
    const capability = createContinuationCapability().capability;
    const saveId = parseContinuationCapability(capability)!.saveId;
    const operationId = 'R'.repeat(43);

    expect(
      readContinuationRestoreRpcInput({ capability, operationId }, saveId)
    ).toEqual({ capability, operationId });
    expect(
      readContinuationRestoreRpcInput(
        { capability, operationId },
        'A'.repeat(22)
      )
    ).toBeUndefined();
    expect(
      readContinuationRestoreRpcInput({ capability, operationId }, undefined)
    ).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { capability: 'bad', operationId: 'R'.repeat(43) },
    { capability: createContinuationCapability().capability, operationId: 'x' },
    {
      capability: createContinuationCapability().capability,
      operationId: 'R'.repeat(43),
      extra: true,
    },
  ])('rejects malformed or extended request %#', (value) => {
    expect(
      readContinuationRestoreRpcInput(value, 'A'.repeat(22))
    ).toBeUndefined();
  });
});
