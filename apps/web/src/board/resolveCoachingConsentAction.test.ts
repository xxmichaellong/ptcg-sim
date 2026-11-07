import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveCoachingConsentAction,
  submitCoachingConsentAction,
} from './resolveCoachingConsentAction.js';

describe('coaching-consent application action', () => {
  it('emits a target-free seat-scoped command for either consent value', () => {
    const base = createRendererSpikeView();
    const playerId = base.playerOrder[0]!;
    expect(resolveCoachingConsentAction(base, true)).toEqual({
      ok: true,
      command: { type: 'SetCoachingConsent', consent: true },
    });
    const consented: MatchViewState = {
      ...base,
      players: {
        ...base.players,
        [playerId]: { ...base.players[playerId]!, coachingConsent: true },
      },
    };
    expect(resolveCoachingConsentAction(consented, false)).toEqual({
      ok: true,
      command: { type: 'SetCoachingConsent', consent: false },
    });
  });

  it('fails closed for spectators, stale self state, and no-op choices', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    expect(
      resolveCoachingConsentAction(
        { ...view, viewer: { kind: 'spectator' } },
        true
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveCoachingConsentAction(
        {
          ...view,
          players: Object.fromEntries(
            Object.entries(view.players).filter(([id]) => id !== playerId)
          ),
        },
        true
      )
    ).toEqual({ ok: false, reason: 'stale_player' });
    expect(resolveCoachingConsentAction(view, false)).toEqual({
      ok: false,
      reason: 'no_op',
    });
  });

  it('submits exactly once only for a changed player choice', () => {
    const view = createRendererSpikeView();
    const submit = vi.fn();
    expect(submitCoachingConsentAction(view, true, submit).ok).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith({
      type: 'SetCoachingConsent',
      consent: true,
    });
    expect(submitCoachingConsentAction(view, false, submit)).toEqual({
      ok: false,
      reason: 'no_op',
    });
    expect(submit).toHaveBeenCalledOnce();
  });
});
