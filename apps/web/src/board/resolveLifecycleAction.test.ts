import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveLoadDeckAction,
  resolveLifecycleAction,
  submitLifecycleAction,
} from './resolveLifecycleAction.js';

describe('lifecycle action resolver', () => {
  it.each([
    ['setup', 'SetupPlayer'],
    ['reset', 'ResetPlayer'],
  ] as const)('maps %s to one explicit target command', (action, type) => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    expect(resolveLifecycleAction(view, targetPlayerId, action)).toEqual({
      ok: true,
      command: { type, targetPlayerId },
    });
  });

  it('fails closed for spectators and stale players', () => {
    const view = createRendererSpikeView();
    expect(
      resolveLifecycleAction(
        { ...view, viewer: { kind: 'spectator' } },
        view.playerOrder[0]!,
        'setup'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    const submit = vi.fn();
    expect(
      submitLifecycleAction(view, 'missing-player', 'reset', submit)
    ).toEqual({ ok: false, reason: 'stale_player' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('maps a validated deck payload to an explicit seat target', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    const entries = [
      {
        definition: {
          id: 'lifecycle-definition',
          name: 'Lifecycle card',
          category: 'Pokémon' as const,
          imageUrl: '/lifecycle.png',
        },
        count: 4,
      },
    ];
    expect(resolveLoadDeckAction(view, targetPlayerId, entries)).toEqual({
      ok: true,
      command: { type: 'LoadDeck', targetPlayerId, entries },
    });
  });
});
