import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import { resolveTableAction, submitTableAction } from './resolveTableAction.js';

describe('table-action resolver', () => {
  it.each([
    ['startTurn', 'StartTurn'],
    ['attack', 'DeclareAttack'],
    ['pass', 'PassTurn'],
  ] as const)('maps %s to one target-aware command', (action, type) => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    expect(resolveTableAction(view, targetPlayerId, action)).toEqual({
      ok: true,
      command: { type, targetPlayerId },
    });
  });

  it('rejects spectator and stale-player actions without submitting', () => {
    const view = createRendererSpikeView();
    expect(
      resolveTableAction(
        { ...view, viewer: { kind: 'spectator' } },
        view.playerOrder[0]!,
        'pass'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    const submit = vi.fn();
    expect(submitTableAction(view, 'missing-player', 'attack', submit)).toEqual(
      { ok: false, reason: 'stale_player' }
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
