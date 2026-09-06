import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  CARD_PLAY_MOVE_DESTINATIONS,
  isCardPlayMoveDestination,
  resolveCardPlayMoveAction,
} from './resolveCardPlayMoveAction.js';

describe('selected-card play placement', () => {
  it('maps the closed slot set to preconditioned play commands', () => {
    expect(CARD_PLAY_MOVE_DESTINATIONS).toEqual(['active', 'bench']);
    expect(CARD_PLAY_MOVE_DESTINATIONS.every(isCardPlayMoveDestination)).toBe(
      true
    );
    expect(isCardPlayMoveDestination('board')).toBe(false);
    expect(isCardPlayMoveDestination(null)).toBe(false);

    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const card = hand.cards[0]!;
    for (const slot of CARD_PLAY_MOVE_DESTINATIONS) {
      expect(resolveCardPlayMoveAction(view, card.id, slot)).toEqual({
        ok: true,
        command: {
          type: 'MoveCardToPlay',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          boardPlayerId: playerId,
          slot,
        },
      });
    }
  });

  it('moves complete stacks and restores viewer-owned staged stacks', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const active = view.stacks['stack:blue:active']!;
    const top = active.evolutionCards.at(-1)!;
    expect(resolveCardPlayMoveAction(view, top.id, 'bench')).toEqual({
      ok: true,
      command: {
        type: 'MovePlayStack',
        stackId: active.id,
        expectedSourceSlot: 'active',
        expectedActiveStackId: active.id,
        expectedBenchStackIds: [],
        destinationSlot: 'bench',
      },
    });

    const hand = view.zones[`zone:${playerId}:hand`]!;
    const stagedCard = hand.cards[0]!;
    const staged: MatchViewState = {
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
            id: 'play-move-staged',
            sourceStackId: 'removed-play-stack',
            evolutionCards: [stagedCard],
            attachmentCards: [],
            suggestedSlot: 'bench',
          },
        },
      },
    };
    expect(resolveCardPlayMoveAction(staged, stagedCard.id, 'active')).toEqual({
      ok: true,
      command: {
        type: 'RestoreStagedStack',
        expectedWorkAreaId: 'play-move-staged',
        expectedActiveStackId: active.id,
        expectedBenchStackIds: [],
        destinationSlot: 'active',
      },
    });
  });

  it('fails closed for spectators, stale/unsupported sources, missing boards, and active no-ops', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const active = view.stacks['stack:blue:active']!;
    expect(
      resolveCardPlayMoveAction(
        { ...view, viewer: { kind: 'spectator' } },
        hand.cards[0]!.id,
        'active'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(resolveCardPlayMoveAction(view, 'missing-card', 'active')).toEqual({
      ok: false,
      reason: 'stale_card',
    });
    expect(
      resolveCardPlayMoveAction(view, active.evolutionCards[0]!.id, 'bench')
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(
      resolveCardPlayMoveAction(view, active.attachmentCards[0]!.id, 'bench')
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(
      resolveCardPlayMoveAction(
        view,
        active.evolutionCards.at(-1)!.id,
        'active'
      )
    ).toEqual({ ok: false, reason: 'no_op' });

    const withoutBoard: MatchViewState = {
      ...view,
      boards: Object.fromEntries(
        Object.entries(view.boards).filter(([id]) => id !== playerId)
      ),
    };
    expect(
      resolveCardPlayMoveAction(withoutBoard, hand.cards[0]!.id, 'active')
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveCardPlayMoveAction(
        withoutBoard,
        active.evolutionCards.at(-1)!.id,
        'bench'
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });

    const first = hand.cards[0]!;
    const second = hand.cards[1]!;
    const third = hand.cards[2]!;
    const withoutFirst: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
      },
    };
    const withoutHandCards: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(3) },
      },
    };
    const inspected: MatchViewState = {
      ...withoutFirst,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          inspection: {
            id: 'play-move-inspection',
            sourceZoneId: hand.id,
            cards: [first],
          },
        },
      },
    };
    expect(resolveCardPlayMoveAction(inspected, first.id, 'active')).toEqual({
      ok: false,
      reason: 'unsupported_source',
    });

    const foreignPlayerId = view.playerOrder[1]!;
    const foreignStaged: MatchViewState = {
      ...withoutFirst,
      workAreas: {
        ...view.workAreas,
        [foreignPlayerId]: {
          ...view.workAreas[foreignPlayerId]!,
          attachmentResolution: {
            id: 'foreign-play-move-staged',
            sourceStackId: null,
            evolutionCards: [first],
            attachmentCards: [],
            suggestedSlot: 'bench',
          },
        },
      },
    };
    expect(
      resolveCardPlayMoveAction(foreignStaged, first.id, 'active')
    ).toEqual({ ok: false, reason: 'unsupported_source' });

    const partialStaged: MatchViewState = {
      ...withoutHandCards,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'partial-play-move-staged',
            sourceStackId: null,
            evolutionCards: [first, second],
            attachmentCards: [third],
            suggestedSlot: 'active',
          },
        },
      },
    };
    expect(resolveCardPlayMoveAction(partialStaged, first.id, 'bench')).toEqual(
      { ok: false, reason: 'unsupported_source' }
    );
    expect(resolveCardPlayMoveAction(partialStaged, third.id, 'bench')).toEqual(
      { ok: false, reason: 'unsupported_source' }
    );
  });
});
