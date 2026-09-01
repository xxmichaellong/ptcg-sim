import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveDeckRelativeCardAction,
  resolvePrizeDeckBottomAction,
  submitDeckRelativeCardAction,
  submitPrizeDeckBottomAction,
} from './resolveDeckRelativeAction.js';

describe('deck-relative application actions', () => {
  it('maps all four per-card deck actions to semantic stale-safe commands', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const card = hand.cards[0]!;
    for (const [action, type] of [
      ['moveToTop', 'MoveCardToDeckTop'],
      ['moveToBottom', 'MoveCardToDeckBottom'],
      ['shuffleIntoDeck', 'ShuffleCardIntoDeck'],
      ['swapWithTop', 'SwapCardWithDeckTop'],
    ] as const) {
      expect(resolveDeckRelativeCardAction(view, card.id, action)).toEqual({
        ok: true,
        command: {
          type,
          cardId: card.id,
          expectedSourceId: hand.id,
        },
      });
    }
  });

  it('fails closed for spectators, stale cards, deck no-ops, and empty decks', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const deck = view.zones[`zone:${playerId}:deck`]!;
    expect(
      resolveDeckRelativeCardAction(
        { ...view, viewer: { kind: 'spectator' } },
        hand.cards[0]!.id,
        'moveToTop'
      )
    ).toEqual({ ok: false, reason: 'not_player' });
    expect(
      resolveDeckRelativeCardAction(view, 'missing-view-card', 'moveToTop')
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(
      resolveDeckRelativeCardAction(view, deck.cards[0]!.id, 'moveToTop')
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveDeckRelativeCardAction(view, deck.cards[1]!.id, 'swapWithTop')
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveDeckRelativeCardAction(view, deck.cards.at(-1)!.id, 'moveToBottom')
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveDeckRelativeCardAction(view, deck.cards[0]!.id, 'shuffleIntoDeck')
        .ok
    ).toBe(true);
    const emptyDeckView: MatchViewState = {
      ...view,
      zones: { ...view.zones, [deck.id]: { ...deck, cards: [] } },
    };
    expect(
      resolveDeckRelativeCardAction(
        emptyDeckView,
        hand.cards[0]!.id,
        'swapWithTop'
      )
    ).toEqual({ ok: false, reason: 'empty_deck' });
  });

  it('submits each valid action exactly once, including prize-bottom', () => {
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const prizes = view.zones[`zone:${playerId}:prizes`]!;
    const withPrize: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
        [prizes.id]: { ...prizes, cards: [hand.cards[0]!] },
      },
    };
    const submit = vi.fn();
    expect(
      submitDeckRelativeCardAction(view, hand.cards[0]!.id, 'moveToTop', submit)
        .ok
    ).toBe(true);
    expect(submitPrizeDeckBottomAction(withPrize, submit).ok).toBe(true);
    expect(submit).toHaveBeenNthCalledWith(2, {
      type: 'MovePrizesToDeckBottom',
    });
    expect(
      resolvePrizeDeckBottomAction({
        ...view,
        zones: {
          ...view.zones,
          [prizes.id]: { ...prizes, cards: [] },
        },
      })
    ).toEqual({
      ok: false,
      reason: 'empty_prizes',
    });
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
