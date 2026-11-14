import { describe, expect, it } from 'vitest';

import type { CommandContext } from './commands.js';
import { createEmptyMatch } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';

const p1 = asPlayerId('once-player-one');
const p2 = asPlayerId('once-player-two');

const context: CommandContext = {
  nextCardId: () => asCardInstanceId('unused-card'),
  nextStackId: () => asStackId('unused-stack'),
  nextInspectionId: () => asInspectionId('unused-inspection'),
  nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

describe('canonical once-per-game marker commands', () => {
  it('updates GX and VSTAR independently and rejects duplicate targets', () => {
    const initial = createEmptyMatch(asMatchId('once-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const gx = executeCommand(
      initial,
      { type: 'SetOncePerGameMarker', playerId: p1, marker: 'gx', used: true },
      context
    );
    if (!gx.accepted) throw new Error(gx.message);
    expect(gx.state.players[p1]?.oncePerGame).toEqual({
      gxUsed: true,
      vstarUsed: false,
    });
    expect(gx.batch.events).toEqual([
      {
        type: 'OncePerGameMarkerSet',
        playerId: p1,
        marker: 'gx',
        used: true,
      },
    ]);
    expect(
      executeCommand(
        gx.state,
        {
          type: 'SetOncePerGameMarker',
          playerId: p1,
          marker: 'gx',
          used: true,
        },
        context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });

    const vstar = executeCommand(
      gx.state,
      {
        type: 'SetOncePerGameMarker',
        playerId: p1,
        marker: 'vstar',
        used: true,
      },
      context
    );
    if (!vstar.accepted) throw new Error(vstar.message);
    expect(vstar.state.players[p1]?.oncePerGame).toEqual({
      gxUsed: true,
      vstarUsed: true,
    });
    assertMatchInvariants(vstar.state);
  });

  it('clears both markers when that player is reset', () => {
    let state = createEmptyMatch(asMatchId('once-reset-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    for (const marker of ['gx', 'vstar'] as const) {
      const result = executeCommand(
        state,
        { type: 'SetOncePerGameMarker', playerId: p1, marker, used: true },
        context
      );
      if (!result.accepted) throw new Error(result.message);
      state = result.state;
    }
    const reset = executeCommand(
      state,
      { type: 'ResetPlayer', playerId: p1 },
      context
    );
    if (!reset.accepted) throw new Error(reset.message);
    expect(reset.state.players[p1]?.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: false,
    });
    expect(reset.state.players[p2]?.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: false,
    });
    assertMatchInvariants(reset.state);
  });
});
