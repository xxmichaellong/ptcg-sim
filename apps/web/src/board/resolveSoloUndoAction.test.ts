import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveSoloUndoAction,
  submitSoloUndoAction,
} from './resolveSoloUndoAction.js';

describe('solo undo action resolver', () => {
  it('maps a player target without exposing checkpoint selectors', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    const result = resolveSoloUndoAction(view, targetPlayerId);
    expect(result).toEqual({
      ok: true,
      command: { type: 'ApplySoloUndo', targetPlayerId },
    });
    expect(JSON.stringify(result)).not.toContain('checkpoint');
    expect(JSON.stringify(result)).not.toContain('revision');
  });

  it('rejects spectators and stale target seats', () => {
    const view = createRendererSpikeView();
    expect(
      resolveSoloUndoAction(
        { ...view, viewer: { kind: 'spectator' } },
        view.playerOrder[0]!
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(resolveSoloUndoAction(view, 'missing-player')).toEqual({
      ok: false,
      reason: 'stale_player',
    });
  });

  it('submits only a resolved undo intent', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[0]!;
    const submit = vi.fn();
    expect(submitSoloUndoAction(view, targetPlayerId, submit).ok).toBe(true);
    expect(submit).toHaveBeenCalledWith({
      type: 'ApplySoloUndo',
      targetPlayerId,
    });
    submitSoloUndoAction(
      { ...view, viewer: { kind: 'spectator' } },
      targetPlayerId,
      submit
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
