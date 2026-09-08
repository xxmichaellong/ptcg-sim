import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  CARD_ZONE_MOVE_DESTINATIONS,
  isCardZoneMoveDestination,
  resolveCardZoneMoveAction,
} from './resolveCardZoneMoveAction.js';

describe('per-card zone movement', () => {
  it('maps the closed destination set to stale-safe zone commands', () => {
    expect(CARD_ZONE_MOVE_DESTINATIONS).toEqual([
      'hand',
      'discard',
      'lostZone',
      'board',
      'prizes',
    ]);
    expect(CARD_ZONE_MOVE_DESTINATIONS.every(isCardZoneMoveDestination)).toBe(
      true
    );
    expect(isCardZoneMoveDestination('deck')).toBe(false);
    expect(isCardZoneMoveDestination(null)).toBe(false);

    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const source = view.zones[`zone:${playerId}:hand`]!;
    const card = source.cards[0]!;
    for (const destination of CARD_ZONE_MOVE_DESTINATIONS.slice(1)) {
      expect(resolveCardZoneMoveAction(view, card.id, destination)).toEqual({
        ok: true,
        command: {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: source.id,
          destinationZoneId: `zone:${playerId}:${destination}`,
        },
      });
    }
  });

  it('supports stack-card and viewer-owned work-area departures', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const discard = view.zones[`zone:${playerId}:discard`]!;
    const active = view.stacks[`stack:blue:active`]!;
    const lowerEvolution = active.evolutionCards[0]!;
    const top = active.evolutionCards.at(-1)!;
    const attachment = active.attachmentCards[0]!;
    for (const card of [lowerEvolution, top, attachment]) {
      expect(resolveCardZoneMoveAction(view, card.id, 'discard')).toEqual({
        ok: true,
        command: {
          type: 'MoveCardFromStack',
          cardId: card.id,
          expectedStackId: active.id,
          destinationZoneId: discard.id,
        },
      });
    }
    expect(resolveCardZoneMoveAction(view, top.id, 'prizes')).toEqual({
      ok: true,
      command: {
        type: 'MoveCardFromStack',
        cardId: top.id,
        expectedStackId: active.id,
        destinationZoneId: `zone:${playerId}:prizes`,
      },
    });

    const movedCard = hand.cards[0]!;
    const withoutCard: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
      },
    };
    const inspected: MatchViewState = {
      ...withoutCard,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          inspection: {
            id: 'zone-move-inspection',
            sourceZoneId: hand.id,
            cards: [movedCard],
          },
        },
      },
    };
    expect(resolveCardZoneMoveAction(inspected, movedCard.id, 'board')).toEqual(
      {
        ok: true,
        command: {
          type: 'MoveInspectedCard',
          cardId: movedCard.id,
          expectedWorkAreaId: 'zone-move-inspection',
          destinationZoneId: `zone:${playerId}:board`,
        },
      }
    );

    const staged: MatchViewState = {
      ...withoutCard,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'zone-move-staged',
            sourceStackId: active.id,
            evolutionCards: [],
            attachmentCards: [movedCard],
            suggestedSlot: 'active',
          },
        },
      },
    };
    expect(resolveCardZoneMoveAction(staged, movedCard.id, 'board')).toEqual({
      ok: true,
      command: {
        type: 'MoveStagedCard',
        cardId: movedCard.id,
        expectedWorkAreaId: 'zone-move-staged',
        destinationZoneId: `zone:${playerId}:board`,
      },
    });
  });

  it('fails closed for spectators, stale/no-op cards, and missing targets', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    expect(
      resolveCardZoneMoveAction(
        { ...view, viewer: { kind: 'spectator' } },
        hand.cards[0]!.id,
        'discard'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveCardZoneMoveAction(view, 'missing-view-card', 'discard')
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(resolveCardZoneMoveAction(view, hand.cards[0]!.id, 'hand')).toEqual({
      ok: false,
      reason: 'no_op',
    });
    const prizes = view.zones[`zone:${playerId}:prizes`]!;
    expect(
      resolveCardZoneMoveAction(view, prizes.cards[0]!.id, 'prizes')
    ).toEqual({ ok: false, reason: 'no_op' });
    const discard = view.zones[`zone:${playerId}:discard`]!;
    const missingTarget: MatchViewState = {
      ...view,
      zones: Object.fromEntries(
        Object.entries(view.zones).filter(([id]) => id !== discard.id)
      ),
    };
    expect(
      resolveCardZoneMoveAction(missingTarget, hand.cards[0]!.id, 'discard')
    ).toEqual({ ok: false, reason: 'unsupported_target' });
  });
});
