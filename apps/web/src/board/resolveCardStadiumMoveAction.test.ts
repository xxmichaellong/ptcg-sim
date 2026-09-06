import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { resolveCardStadiumMoveAction } from './resolveCardStadiumMoveAction.js';

describe('selected-card stadium placement', () => {
  it('pins the current singleton occupant while moving a zone card', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const stadium = view.zones['zone:shared:stadium']!;
    const card = hand.cards[0]!;
    expect(resolveCardStadiumMoveAction(view, card.id)).toEqual({
      ok: true,
      command: {
        type: 'MoveCardToStadium',
        cardId: card.id,
        expectedSourceId: hand.id,
        expectedStadiumCardId: stadium.cards[0]!.id,
      },
    });

    expect(
      resolveCardStadiumMoveAction(
        {
          ...view,
          zones: { ...view.zones, [stadium.id]: { ...stadium, cards: [] } },
        },
        card.id
      )
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardToStadium',
        cardId: card.id,
        expectedSourceId: hand.id,
        expectedStadiumCardId: null,
      },
    });
  });

  it('supports top, attachment, and viewer-owned work-area departures', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const stadium = view.zones['zone:shared:stadium']!;
    const incumbentId = stadium.cards[0]!.id;
    const active = view.stacks['stack:blue:active']!;
    for (const card of [
      active.evolutionCards.at(-1)!,
      active.attachmentCards[0]!,
    ]) {
      expect(resolveCardStadiumMoveAction(view, card.id)).toEqual({
        ok: true,
        command: {
          type: 'MoveCardToStadium',
          cardId: card.id,
          expectedSourceId: active.id,
          expectedStadiumCardId: incumbentId,
        },
      });
    }

    const hand = view.zones[`zone:${playerId}:hand`]!;
    const card = hand.cards[0]!;
    const withoutCard: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
      },
    };
    for (const [sourceId, workArea] of [
      [
        'stadium-move-inspection',
        {
          ...view.workAreas[playerId]!,
          inspection: {
            id: 'stadium-move-inspection',
            sourceZoneId: hand.id,
            cards: [card],
          },
        },
      ],
      [
        'stadium-move-staged',
        {
          ...view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'stadium-move-staged',
            sourceStackId: active.id,
            evolutionCards: [],
            attachmentCards: [card],
            suggestedSlot: 'active' as const,
          },
        },
      ],
    ] as const) {
      const workAreaView: MatchViewState = {
        ...withoutCard,
        workAreas: { ...view.workAreas, [playerId]: workArea },
      };
      expect(resolveCardStadiumMoveAction(workAreaView, card.id)).toEqual({
        ok: true,
        command: {
          type: 'MoveCardToStadium',
          cardId: card.id,
          expectedSourceId: sourceId,
          expectedStadiumCardId: incumbentId,
        },
      });
    }
  });

  it('fails closed for spectators, stale/unsupported sources, and invalid stadiums', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const otherPlayerId = view.playerOrder[1]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const card = hand.cards[0]!;
    const stadium = view.zones['zone:shared:stadium']!;
    const active = view.stacks['stack:blue:active']!;
    expect(
      resolveCardStadiumMoveAction(
        { ...view, viewer: { kind: 'spectator' } },
        card.id
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(resolveCardStadiumMoveAction(view, 'missing-card')).toEqual({
      ok: false,
      reason: 'stale_card',
    });
    expect(
      resolveCardStadiumMoveAction(view, active.evolutionCards[0]!.id)
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(resolveCardStadiumMoveAction(view, stadium.cards[0]!.id)).toEqual({
      ok: false,
      reason: 'no_op',
    });

    const withoutCard: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
      },
      workAreas: {
        ...view.workAreas,
        [otherPlayerId]: {
          ...view.workAreas[otherPlayerId]!,
          inspection: {
            id: 'foreign-stadium-inspection',
            sourceZoneId: hand.id,
            cards: [card],
          },
        },
      },
    };
    expect(resolveCardStadiumMoveAction(withoutCard, card.id)).toEqual({
      ok: false,
      reason: 'unsupported_source',
    });

    for (const invalidZones of [
      Object.fromEntries(
        Object.entries(view.zones).filter(([id]) => id !== stadium.id)
      ),
      {
        ...view.zones,
        [stadium.id]: {
          ...stadium,
          cards: [...stadium.cards, card],
        },
      },
    ]) {
      expect(
        resolveCardStadiumMoveAction(
          { ...view, zones: invalidZones } as MatchViewState,
          card.id
        )
      ).toEqual({ ok: false, reason: 'unsupported_target' });
    }
  });
});
