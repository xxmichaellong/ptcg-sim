import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveInspectionCardsAction,
  submitInspectionCardsAction,
} from './resolveInspectionCardsAction.js';

const inspectionView = (): MatchViewState => {
  const view = createRendererSpikeView();
  const playerId = view.playerOrder[0]!;
  const hand = view.zones[`zone:${playerId}:hand`]!;
  const inspectedCard = hand.cards[0]!;
  return {
    ...view,
    zones: {
      ...view.zones,
      [hand.id]: { ...hand, cards: hand.cards.slice(1) },
    },
    workAreas: {
      ...view.workAreas,
      [playerId]: {
        ...view.workAreas[playerId]!,
        inspection: {
          id: 'inspection-bulk-work-area',
          sourceZoneId: `zone:${playerId}:deck`,
          cards: [inspectedCard],
        },
      },
    },
  };
};

describe('inspection-card bulk action resolution', () => {
  it('maps every legacy view-card destination to one command', () => {
    const view = inspectionView();
    for (const destination of [
      'discard',
      'lostZone',
      'hand',
      'shuffleIntoDeck',
      'shuffleToDeckBottom',
    ] as const) {
      expect(resolveInspectionCardsAction(view, destination)).toEqual({
        ok: true,
        command: {
          type: 'ResolveInspectionCards',
          expectedWorkAreaId: 'inspection-bulk-work-area',
          destination,
        },
      });
    }
  });

  it('fails closed and submits exactly once for an active player inspection', () => {
    const view = inspectionView();
    const submit = vi.fn();
    expect(submitInspectionCardsAction(view, 'hand', submit).ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      resolveInspectionCardsAction(
        { ...view, viewer: { kind: 'spectator' } },
        'hand'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    const playerId = view.playerOrder[0]!;
    expect(
      resolveInspectionCardsAction(
        {
          ...view,
          workAreas: {
            ...view.workAreas,
            [playerId]: {
              ...view.workAreas[playerId]!,
              inspection: null,
            },
          },
        },
        'hand'
      )
    ).toEqual({ ok: false, reason: 'no_work_area' });
  });
});
