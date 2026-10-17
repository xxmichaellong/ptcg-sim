import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { resolveZoneInspectionAction } from '../board/resolvePrivateInspectionAction.js';
import { applyHandSortDisplay } from './hand-sort-display.js';

describe('hand sort display', () => {
  it('orders a sorted hand by disclosed name and leaves everything else alone', () => {
    const spike = createRendererSpikeView();
    const blue = asPlayerId('spike-blue');
    const red = asPlayerId('spike-red');
    const handId = `zone:${blue}:hand`;
    // The fixture deals its hand in name order; deal it backwards so the
    // sort has something to do.
    const view = {
      ...spike,
      zones: {
        ...spike.zones,
        [handId]: {
          ...spike.zones[handId]!,
          cards: [...spike.zones[handId]!.cards].reverse(),
        },
      },
    };
    const original = view.zones[handId]!.cards;
    expect(applyHandSortDisplay(view, new Set())).toBe(view);

    const sorted = applyHandSortDisplay(view, new Set([blue]));
    expect(sorted).not.toBe(view);
    const names = sorted.zones[handId]!.cards.map((card) =>
      card.kind === 'known' ? view.definitions[card.definitionId]!.name : ''
    );
    expect(names).toEqual([...names].sort());
    // Same cards, same aliases: only the paint order moved.
    expect(
      [...sorted.zones[handId]!.cards].sort((a, b) => (a.id < b.id ? -1 : 1))
    ).toEqual([...original].sort((a, b) => (a.id < b.id ? -1 : 1)));
    // The other player's hand and every other zone are untouched.
    expect(sorted.zones[`zone:${red}:hand`]).toBe(
      view.zones[`zone:${red}:hand`]
    );
    expect(sorted.zones[`zone:${blue}:deck`]).toBe(
      view.zones[`zone:${blue}:deck`]
    );

    // A concealed hand has nothing to sort by and keeps its order.
    expect(applyHandSortDisplay(view, new Set([red]))).toBe(view);
  });

  it('paints the declared decklist order, not the alphabet', () => {
    const spike = createRendererSpikeView();
    const blue = asPlayerId('spike-blue');
    const handId = `zone:${blue}:hand`;
    const hand = spike.zones[handId]!;
    const [first, second, third] = hand.cards;
    if (
      first?.kind !== 'known' ||
      second?.kind !== 'known' ||
      third?.kind !== 'known'
    ) {
      throw new Error('known hand cards are required');
    }
    // A decklist that declares Zapdos before Abra, with two Abra.
    const definitions = {
      ...spike.definitions,
      [first.definitionId]: {
        ...spike.definitions[first.definitionId]!,
        name: 'Zapdos',
      },
      [second.definitionId]: {
        ...spike.definitions[second.definitionId]!,
        name: 'Abra',
      },
      [third.definitionId]: {
        ...spike.definitions[third.definitionId]!,
        name: 'Abra',
      },
    };
    const view = {
      ...spike,
      definitions,
      zones: {
        ...spike.zones,
        [handId]: {
          ...hand,
          cards: [
            { ...second, decklistRank: 4 },
            { ...first, decklistRank: 0 },
            { ...third, decklistRank: 4 },
          ],
        },
      },
    };
    const sorted = applyHandSortDisplay(view, new Set([blue]));
    expect(sorted.zones[handId]!.cards.map((card) => card.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    // Alphabetical order would have put both Abra first.
    expect(
      sorted.zones[handId]!.cards.map((card) =>
        card.kind === 'known' ? definitions[card.definitionId]!.name : ''
      )
    ).toEqual(['Zapdos', 'Abra', 'Abra']);
  });

  it("looks at a sorted hand in the room's order", () => {
    const spike = createRendererSpikeView();
    const blue = asPlayerId('spike-blue');
    const red = asPlayerId('spike-red');
    const handId = `zone:${red}:hand`;
    const hand = spike.zones[handId]!;
    const [first, ...rest] = hand.cards;
    const known = spike.zones[`zone:${blue}:hand`]!.cards[0]!;
    expect(rest.length).toBeGreaterThan(0);
    // Coaching: the first card looked at on its own, the rest concealed.
    const view: MatchViewState = {
      ...spike,
      zones: {
        ...spike.zones,
        [handId]: {
          ...hand,
          cards: [{ ...known, id: first!.id, decklistRank: 0 }, ...rest],
        },
      },
    };
    // Sorted, the known card goes behind the concealed ones...
    const sorted = applyHandSortDisplay(view, new Set([red]));
    expect(sorted.zones[handId]!.cards.at(-1)!.id).toBe(first!.id);
    // ...but the look names the hand as the room keeps it.
    expect(resolveZoneInspectionAction(sorted, red, 'hand', true)).toEqual({
      ok: true,
      command: {
        type: 'BeginZoneInspection',
        targetPlayerId: red,
        zoneId: handId,
        expectedCardIds: hand.cards.map((card) => card.id),
      },
    });
  });
});
