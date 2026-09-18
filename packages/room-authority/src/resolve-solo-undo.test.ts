import {
  asMatchId,
  asPlayerId,
  cloneMatchState,
  createEmptyMatch,
  stableHash,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { emptyProjectionIdentityState } from './identity-registry.js';
import {
  DEFAULT_AUTHORITY_POLICY,
  type AuthoritySession,
  type SoloUndoCheckpoint,
} from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');
const state = {
  ...createEmptyMatch(asMatchId('solo-undo-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]),
  revision: 3,
};
const checkpointState = { ...cloneMatchState(state), revision: 2 };
const checkpoint: SoloUndoCheckpoint = {
  state: checkpointState,
  stateHash: stableHash(checkpointState),
  revertedCommandId: 'move-command',
  revertedRevision: 3,
};
const player: AuthoritySession = {
  id: 'solo-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

describe('solo undo authority resolution', () => {
  it('derives the actor and installs only the authority checkpoint', () => {
    expect(
      resolveWireCommand(
        state,
        emptyProjectionIdentityState(),
        player,
        { type: 'ApplySoloUndo', targetPlayerId: p2 },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'solo', checkpoint }
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'ApplySoloUndo',
        actorPlayerId: p1,
        targetPlayerId: p2,
        revertedCommandId: checkpoint.revertedCommandId,
        revertedRevision: checkpoint.revertedRevision,
        checkpoint: checkpoint.state,
      },
    });
  });

  it('rejects multiplayer mode and missing solo history', () => {
    expect(
      resolveWireCommand(
        state,
        emptyProjectionIdentityState(),
        player,
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'multiplayer', checkpoint }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        state,
        emptyProjectionIdentityState(),
        player,
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'solo' }
      )
    ).toEqual({ accepted: false, code: 'precondition_failed' });
  });

  it('rejects stale revisions, missing targets, and spectators', () => {
    expect(
      resolveWireCommand(
        state,
        emptyProjectionIdentityState(),
        player,
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        DEFAULT_AUTHORITY_POLICY,
        state.revision - 1,
        { mode: 'solo', checkpoint }
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        emptyProjectionIdentityState(),
        player,
        { type: 'ApplySoloUndo', targetPlayerId: 'missing-player' },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'solo', checkpoint }
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        emptyProjectionIdentityState(),
        { ...player, viewer: { kind: 'spectator' } },
        { type: 'ApplySoloUndo', targetPlayerId: p1 },
        DEFAULT_AUTHORITY_POLICY,
        state.revision,
        { mode: 'solo', checkpoint }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
