import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveRandomFaceDownAction,
  submitRandomFaceDownAction,
} from './resolveRandomFaceDownAction.js';

describe('random face-down action resolver', () => {
  it('maps a nonempty target hand without carrying card identities', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    const result = resolveRandomFaceDownAction(view, targetPlayerId);
    expect(result).toEqual({
      ok: true,
      command: { type: 'PlayRandomCardFaceDown', targetPlayerId },
    });
    expect(JSON.stringify(result)).not.toContain('cardIds');
  });

  it('rejects spectators, stale players, and empty hands', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    expect(
      resolveRandomFaceDownAction(
        { ...view, viewer: { kind: 'spectator' } },
        targetPlayerId
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(resolveRandomFaceDownAction(view, 'missing-player')).toEqual({
      ok: false,
      reason: 'stale_player',
    });
    const hand = Object.values(view.zones).find(
      (zone) => zone.ownerId === targetPlayerId && zone.kind === 'hand'
    )!;
    expect(
      resolveRandomFaceDownAction(
        {
          ...view,
          zones: {
            ...view.zones,
            [hand.id]: { ...hand, cards: [] },
          },
        },
        targetPlayerId
      )
    ).toEqual({ ok: false, reason: 'empty_hand' });
  });

  it('submits only a resolved random intent', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    const submit = vi.fn();
    expect(submitRandomFaceDownAction(view, targetPlayerId, submit).ok).toBe(
      true
    );
    expect(submit).toHaveBeenCalledWith({
      type: 'PlayRandomCardFaceDown',
      targetPlayerId,
    });
    const hand = Object.values(view.zones).find(
      (zone) => zone.ownerId === targetPlayerId && zone.kind === 'hand'
    )!;
    submitRandomFaceDownAction(
      {
        ...view,
        zones: { ...view.zones, [hand.id]: { ...hand, cards: [] } },
      },
      targetPlayerId,
      submit
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
