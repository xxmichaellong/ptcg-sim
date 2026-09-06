import { asViewCardId, type MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  isLegacyBoardCountActionId,
  parseLegacyCountInput,
  resolveLegacyBoardCountAction,
  type LegacyBoardCountActionId,
} from './resolveLegacyBoardCountAction.js';

const zone = (
  view: MatchViewState,
  ownerId: string,
  kind: MatchViewState['zones'][string]['kind']
) =>
  Object.values(view.zones).find(
    (candidate) => candidate.ownerId === ownerId && candidate.kind === kind
  )!;

describe('legacy board count action resolver', () => {
  it('recognizes only the six reviewed prompt actions and parses complete integers', () => {
    for (const action of [
      'discardHand',
      'shuffleHandToDeck',
      'shuffleHandToDeckBottom',
      'drawCards',
      'viewDeckTop',
      'viewDeckBottom',
    ]) {
      expect(isLegacyBoardCountActionId(action)).toBe(true);
    }
    expect(isLegacyBoardCountActionId('setDamage')).toBe(false);
    expect(parseLegacyCountInput(' 02 ', 1)).toBe(2);
    expect(parseLegacyCountInput('0', 0)).toBe(0);
    for (const value of ['', ' ', '-1', '2.5', '2cards', '+2']) {
      expect(parseLegacyCountInput(value, 0)).toBeUndefined();
    }
    expect(parseLegacyCountInput('0', 1)).toBeUndefined();
    expect(
      parseLegacyCountInput(String(Number.MAX_SAFE_INTEGER + 1), 0)
    ).toBeUndefined();
    expect(parseLegacyCountInput(2 as unknown as string, 0)).toBeUndefined();
  });

  it('opens exact source prompts and defaults for every supported action', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const hand = zone(view, playerId, 'hand');
    const deck = zone(view, playerId, 'deck');
    const actions: readonly [
      LegacyBoardCountActionId,
      string,
      '0' | '1',
      0 | 1,
    ][] = [
      ['discardHand', 'Draw how many cards?', '0', 0],
      ['shuffleHandToDeck', 'Draw how many cards?', '0', 0],
      ['shuffleHandToDeckBottom', 'Draw how many cards?', '0', 0],
      ['drawCards', 'Draw how many cards?', '1', 1],
      ['viewDeckTop', 'How many cards do you want to look at?', '1', 1],
      ['viewDeckBottom', 'How many cards do you want to look at?', '1', 1],
    ];
    for (const [action, message, initialValue, minimum] of actions) {
      const target =
        action.includes('Hand') || action.startsWith('shuffleHand')
          ? hand
          : deck;
      const invalidMessage = action.startsWith('viewDeck')
        ? 'Please enter a valid number for the view amount.'
        : 'Please enter a valid number for the draw amount.';
      expect(
        resolveLegacyBoardCountAction(view, action, target.cards[0]!.id)
      ).toMatchObject({
        ok: true,
        input: {
          kind: 'count',
          action,
          cardId: target.cards[0]!.id,
          zoneId: target.id,
          message,
          initialValue,
          minimum,
          invalidMessage,
        },
      });
    }
  });

  it('maps and clamps all hand, draw, and private/public inspection commands', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const opponentId = view.playerOrder.find((id) => id !== playerId)!;
    const hand = zone(view, playerId, 'hand');
    const deck = zone(view, playerId, 'deck');
    const opponentDeck = zone(view, opponentId, 'deck');

    expect(
      resolveLegacyBoardCountAction(
        view,
        'discardHand',
        hand.cards[0]!.id,
        '999'
      )
    ).toEqual({
      ok: true,
      command: { type: 'DiscardHandAndDraw', count: deck.cards.length },
    });
    expect(
      resolveLegacyBoardCountAction(
        view,
        'shuffleHandToDeck',
        hand.cards[0]!.id,
        '999'
      )
    ).toEqual({
      ok: true,
      command: {
        type: 'ShuffleHandIntoDeckAndDraw',
        count: deck.cards.length + hand.cards.length,
      },
    });

    const inflatedDeck = {
      ...deck,
      cards: Array.from({ length: 150 }, (_, index) => ({
        ...deck.cards[index % deck.cards.length]!,
        id: asViewCardId(`inflated-deck-${index}`),
      })),
    };
    const inflatedHand = {
      ...hand,
      cards: Array.from({ length: 100 }, (_, index) => ({
        ...hand.cards[index % hand.cards.length]!,
        id: asViewCardId(`inflated-hand-${index}`),
      })),
    };
    const inflated: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [deck.id]: inflatedDeck,
        [hand.id]: inflatedHand,
      },
    };
    expect(
      resolveLegacyBoardCountAction(
        inflated,
        'shuffleHandToDeck',
        inflatedHand.cards[0]!.id,
        '999'
      )
    ).toEqual({
      ok: true,
      command: { type: 'ShuffleHandIntoDeckAndDraw', count: 200 },
    });
    expect(
      resolveLegacyBoardCountAction(
        view,
        'shuffleHandToDeckBottom',
        hand.cards[0]!.id,
        '0'
      )
    ).toEqual({
      ok: true,
      command: { type: 'ShuffleHandToDeckBottomAndDraw', count: 0 },
    });
    expect(
      resolveLegacyBoardCountAction(view, 'drawCards', deck.cards[0]!.id, '999')
    ).toEqual({
      ok: true,
      command: { type: 'DrawCards', count: deck.cards.length },
    });
    expect(
      resolveLegacyBoardCountAction(view, 'viewDeckTop', deck.cards[0]!.id, '2')
    ).toEqual({
      ok: true,
      command: {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: playerId,
        count: 2,
        edge: 'top',
        visibility: 'private',
      },
    });
    expect(
      resolveLegacyBoardCountAction(
        view,
        'viewDeckBottom',
        opponentDeck.cards[0]!.id,
        '999'
      )
    ).toEqual({
      ok: true,
      command: {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: opponentId,
        count: opponentDeck.cards.length,
        edge: 'bottom',
        visibility: 'public',
      },
    });
  });

  it('rejects malformed, stale, spectator, and cross-zone requests', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const opponentId = view.playerOrder.find((id) => id !== playerId)!;
    const hand = zone(view, playerId, 'hand');
    const opponentHand = zone(view, opponentId, 'hand');
    const opponentDeck = zone(view, opponentId, 'deck');

    expect(
      resolveLegacyBoardCountAction(
        view,
        'discardHand',
        hand.cards[0]!.id,
        '2.5'
      )
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardCountAction(
        view,
        'discardHand',
        opponentHand.cards[0]!.id
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveLegacyBoardCountAction(
        view,
        'drawCards',
        opponentDeck.cards[0]!.id
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveLegacyBoardCountAction(view, 'viewDeckTop', hand.cards[0]!.id)
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveLegacyBoardCountAction(
        view,
        'viewDeckTop',
        asViewCardId('missing')
      )
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(
      resolveLegacyBoardCountAction(
        { ...view, viewer: { kind: 'spectator' } },
        'viewDeckTop',
        opponentDeck.cards[0]!.id
      )
    ).toEqual({ ok: false, reason: 'not_player' });
  });
});
