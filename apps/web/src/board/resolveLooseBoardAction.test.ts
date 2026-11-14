import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveLooseBoardAction,
  submitLooseBoardAction,
} from './resolveLooseBoardAction.js';

describe('loose-board application actions', () => {
  it('maps all four legacy destinations with exact projected card order', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[0]!;
    const board = Object.values(view.zones).find(
      (zone) => zone.ownerId === targetPlayerId && zone.kind === 'board'
    )!;
    for (const destination of [
      'discard',
      'hand',
      'lostZone',
      'shuffleIntoDeck',
    ] as const) {
      expect(
        resolveLooseBoardAction(view, targetPlayerId, destination)
      ).toEqual({
        ok: true,
        command: {
          type: 'ResolveLooseBoardCards',
          targetPlayerId,
          expectedBoardCardIds: board.cards.map((card) => card.id),
          destination,
        },
      });
    }
  });

  it('can target the opponent public board without deciding server policy', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[1]!;
    expect(
      resolveLooseBoardAction(view, targetPlayerId, 'discard')
    ).toMatchObject({
      ok: true,
      command: { targetPlayerId, destination: 'discard' },
    });
  });

  it('fails closed for spectators, stale players, and empty boards', () => {
    const view = createRendererSpikeView();
    const targetPlayerId = view.playerOrder[0]!;
    expect(
      resolveLooseBoardAction(
        { ...view, viewer: { kind: 'spectator' } },
        targetPlayerId,
        'discard'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(resolveLooseBoardAction(view, 'missing-player', 'discard')).toEqual({
      ok: false,
      reason: 'stale_player',
    });
    const boardEntry = Object.entries(view.zones).find(
      ([, zone]) => zone.ownerId === targetPlayerId && zone.kind === 'board'
    )!;
    const empty: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [boardEntry[0]]: { ...boardEntry[1], cards: [] },
      },
    };
    expect(resolveLooseBoardAction(empty, targetPlayerId, 'discard')).toEqual({
      ok: false,
      reason: 'empty_board',
    });
  });

  it('submits exactly one accepted semantic command', () => {
    const view = createRendererSpikeView();
    const submit = vi.fn();
    const result = submitLooseBoardAction(
      view,
      view.playerOrder[0]!,
      'shuffleIntoDeck',
      submit
    );
    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ResolveLooseBoardCards',
        destination: 'shuffleIntoDeck',
      })
    );
  });
});
