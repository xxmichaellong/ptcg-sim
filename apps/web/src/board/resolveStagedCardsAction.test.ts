import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveStagedCardsAction,
  submitStagedCardsAction,
} from './resolveStagedCardsAction.js';

const stagedView = (): MatchViewState => {
  const view = createRendererSpikeView();
  const playerId = view.playerOrder[0]!;
  const hand = view.zones[`zone:${playerId}:hand`]!;
  const stagedCard = hand.cards[0]!;
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
        attachmentResolution: {
          id: 'staged-bulk-work-area',
          sourceStackId: 'removed-stack',
          evolutionCards: [],
          attachmentCards: [stagedCard],
          suggestedSlot: 'bench',
        },
      },
    },
  };
};

describe('staged-card bulk action resolution', () => {
  it('maps every legacy bulk destination to one preconditioned command', () => {
    const view = stagedView();
    for (const destination of [
      'discard',
      'lostZone',
      'hand',
      'shuffleIntoDeck',
      'shuffleToDeckBottom',
    ] as const) {
      expect(resolveStagedCardsAction(view, destination)).toEqual({
        ok: true,
        command: {
          type: 'ResolveStagedCards',
          expectedWorkAreaId: 'staged-bulk-work-area',
          destination,
        },
      });
    }
  });

  it('fails closed and submits only a currently available player work area', () => {
    const view = stagedView();
    const submit = vi.fn();
    expect(submitStagedCardsAction(view, 'discard', submit).ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      resolveStagedCardsAction(
        { ...view, viewer: { kind: 'spectator' } },
        'discard'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    const playerId = view.playerOrder[0]!;
    expect(
      resolveStagedCardsAction(
        {
          ...view,
          workAreas: {
            ...view.workAreas,
            [playerId]: {
              ...view.workAreas[playerId]!,
              attachmentResolution: null,
            },
          },
        },
        'discard'
      )
    ).toEqual({ ok: false, reason: 'no_work_area' });
  });
});
