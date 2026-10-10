import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveOncePerGameAction,
  submitOncePerGameAction,
} from './resolveOncePerGameAction.js';

describe('once-per-game application actions', () => {
  it('toggles GX and VSTAR independently for either projected player', () => {
    const view = createRendererSpikeView();
    const [selfId, opponentId] = view.playerOrder;
    expect(
      resolveOncePerGameAction(view, selfId!, {
        type: 'toggle',
        marker: 'gx',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetOncePerGameMarker',
        targetPlayerId: selfId,
        marker: 'gx',
        used: true,
      },
    });
    expect(
      resolveOncePerGameAction(view, opponentId!, {
        type: 'toggle',
        marker: 'vstar',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetOncePerGameMarker',
        targetPlayerId: opponentId,
        marker: 'vstar',
        used: true,
      },
    });
  });

  it('derives explicit reset targets from authoritative state', () => {
    const base = createRendererSpikeView();
    const playerId = base.playerOrder[0]!;
    const view: MatchViewState = {
      ...base,
      players: {
        ...base.players,
        [playerId]: {
          ...base.players[playerId]!,
          oncePerGame: { gxUsed: true, vstarUsed: false },
        },
      },
    };
    expect(
      resolveOncePerGameAction(view, playerId, {
        type: 'toggle',
        marker: 'gx',
      })
    ).toMatchObject({
      ok: true,
      command: { marker: 'gx', used: false },
    });
    expect(
      resolveOncePerGameAction(view, playerId, {
        type: 'set',
        marker: 'vstar',
        used: false,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('fails closed for spectators and stale player targets', () => {
    const view = createRendererSpikeView();
    expect(
      resolveOncePerGameAction(
        { ...view, viewer: { kind: 'spectator' } },
        view.playerOrder[0]!,
        { type: 'toggle', marker: 'gx' }
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveOncePerGameAction(view, 'missing-player', {
        type: 'toggle',
        marker: 'gx',
      })
    ).toEqual({ ok: false, reason: 'stale_player' });
  });

  it('submits exactly one accepted target-value command', () => {
    const view = createRendererSpikeView();
    const submit = vi.fn();
    const result = submitOncePerGameAction(
      view,
      view.playerOrder[0]!,
      { type: 'set', marker: 'vstar', used: true },
      submit
    );
    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      type: 'SetOncePerGameMarker',
      targetPlayerId: view.playerOrder[0],
      marker: 'vstar',
      used: true,
    });
  });
});
