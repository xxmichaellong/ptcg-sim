import { asViewCardId, type ViewCardId } from '@ptcgsim/game-core';
import { NO_SELECTION } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { BLUE, RED, groupTable, piece } from './group-table.test-support.js';
import { visiblePieceSetOf } from './piece-sets.js';
import {
  MAX_SELECTION_ITEMS,
  normalizeSelection,
  reduceSelection,
} from './selection.js';

describe('the items a selection holds', () => {
  it('takes any card of a Pokémon as the whole Pokémon, by its top card', () => {
    const table = groupTable();
    const charizard = table.pokemon(BLUE, 'active', [{}, {}, {}], [{}]);
    const [basic, stage1] = charizard.line;
    expect(
      normalizeSelection(table.context(), [basic!, stage1!, charizard.top])
    ).toEqual({ items: [charizard.top], refused: [] });
  });

  it('takes an attached card alone, unless its Pokémon is selected', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}], [{}, {}]);
    const [energy] = active.attached;
    expect(normalizeSelection(table.context(), [energy!]).items).toEqual([
      energy,
    ]);
    // Selected after its Pokémon: it is part of it.
    expect(normalizeSelection(table.context(), [active.top, energy!])).toEqual({
      items: [active.top],
      refused: [{ cardId: energy, reason: 'in_selected_pokemon' }],
    });
    // Selected before: its Pokémon takes it in.
    expect(
      normalizeSelection(table.context(), [energy!, active.top]).items
    ).toEqual([active.top]);
  });

  it("leaves out a pile's top, but takes the cards of the pile open in the viewer", () => {
    const table = groupTable();
    const [, top] = table.put(BLUE, 'discard', {}, {});
    const [lost] = table.put(BLUE, 'lostZone', {});
    expect(normalizeSelection(table.context(), [top!, lost!])).toEqual({
      items: [],
      refused: [
        { cardId: top, reason: 'not_an_item' },
        { cardId: lost, reason: 'not_an_item' },
      ],
    });
    const discard = table.zoneId(BLUE, 'discard');
    const [bottom] = table.view.zones[discard]!.cards;
    expect(
      normalizeSelection(table.context({ openedZoneId: discard }), [
        top!,
        bottom!.id,
      ]).items
    ).toEqual([top, bottom!.id]);
  });

  it("leaves out the other player's face-down cards, except to Solo's one player", () => {
    const table = groupTable();
    const [hidden] = table.put(RED, 'hand', { concealed: true });
    const [ownPrize] = table.put(BLUE, 'prizes', { concealed: true });
    const [theirs] = table.put(RED, 'board', {});
    expect(
      normalizeSelection(table.context(), [hidden!, ownPrize!, theirs!])
    ).toEqual({
      items: [ownPrize, theirs],
      refused: [{ cardId: hidden, reason: 'uncontrolled' }],
    });
    expect(
      normalizeSelection(table.context({ controlsEverySeat: true }), [hidden!])
        .items
    ).toEqual([hidden]);
  });

  it('keeps the order the cards came in, each item once, up to sixty', () => {
    const table = groupTable();
    const hand = table.put(
      BLUE,
      'hand',
      ...Array.from({ length: MAX_SELECTION_ITEMS + 1 }, () => ({}))
    );
    const reversed = [...hand].reverse();
    const { items, refused } = normalizeSelection(table.context(), [
      reversed[0]!,
      reversed[0]!,
      ...reversed.slice(1),
    ]);
    expect(items).toEqual(reversed.slice(0, MAX_SELECTION_ITEMS));
    expect(refused).toEqual([{ cardId: hand[0], reason: 'full' }]);
  });

  it('refuses a card no longer on the table', () => {
    const table = groupTable();
    expect(
      normalizeSelection(table.context(), [asViewCardId('gone')]).refused
    ).toEqual([{ cardId: 'gone', reason: 'stale_card' }]);
  });
});

describe('changes to the selection', () => {
  const handOf = (count: number) => {
    const table = groupTable();
    const hand = table.put(
      BLUE,
      'hand',
      ...Array.from({ length: count }, () => ({}))
    );
    return { table, hand, context: table.context() };
  };

  it('presses as v1 does: one card alone, and pressed again, none', () => {
    const { hand, context } = handOf(2);
    const [a, b] = hand as [ViewCardId, ViewCardId];
    const pressed = reduceSelection(context, NO_SELECTION, {
      kind: 'toggle',
      cardId: a,
    });
    expect(pressed.selection).toEqual([a]);
    expect(
      reduceSelection(context, [a], { kind: 'toggle', cardId: b }).selection
    ).toEqual([b]);
    expect(
      reduceSelection(context, [a], { kind: 'toggle', cardId: a }).selection
    ).toBe(NO_SELECTION);
    // One of several, pressed alone, is selected alone.
    expect(
      reduceSelection(context, [a, b], { kind: 'toggle', cardId: a }).selection
    ).toEqual([a]);
  });

  it('adds with Shift or ⌘/Ctrl, and a second press takes it out', () => {
    const { hand, context } = handOf(3);
    const [a, b, c] = hand as [ViewCardId, ViewCardId, ViewCardId];
    const added = reduceSelection(context, [a, b], { kind: 'add', cardId: c });
    expect(added.selection).toEqual([a, b, c]);
    expect(
      reduceSelection(context, added.selection, { kind: 'add', cardId: b })
        .selection
    ).toEqual([a, c]);
  });

  it('adds a Pokémon in place of its cards, and refuses its cards after it', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}], [{}]);
    const [energy] = active.attached as [ViewCardId];
    const context = table.context();
    expect(
      reduceSelection(context, [energy], { kind: 'add', cardId: active.top })
        .selection
    ).toEqual([active.top]);
    expect(
      reduceSelection(context, [active.top], { kind: 'add', cardId: energy })
    ).toEqual({
      selection: [active.top],
      refused: [{ cardId: energy, reason: 'in_selected_pokemon' }],
      dropped: [],
    });
  });

  it('takes the pieces Play as one card finds in a closed discard pile, beside one that is an item', () => {
    const table = groupTable();
    const union = (part: number) => ({
      name: 'Morpeko V-UNION',
      presentation: piece('swshp:155:Morpeko V-UNION', part),
    });
    const [inHand] = table.put(BLUE, 'hand', union(0)) as [ViewCardId];
    // Under the discard's top, and its top: no items alone.
    const [buried, , top] = table.put(
      BLUE,
      'discard',
      union(1),
      {},
      union(2)
    ) as [ViewCardId, ViewCardId, ViewCardId];
    const context = table.context();
    const pieces = visiblePieceSetOf(table.view, inHand)!.cardIds;
    expect([...pieces].sort()).toEqual([inHand, buried, top].sort());
    const taken = reduceSelection(context, NO_SELECTION, {
      kind: 'replace',
      cardIds: pieces,
    });
    expect(taken).toEqual({ selection: pieces, refused: [], dropped: [] });
    // Kept as the table changes, while the piece in hand is with them.
    expect(
      reduceSelection(context, taken.selection, { kind: 'reconcile' }).selection
    ).toBe(taken.selection);
    expect(normalizeSelection(context, [buried, top])).toEqual({
      items: [],
      refused: [
        { cardId: buried, reason: 'stale_card' },
        { cardId: top, reason: 'not_an_item' },
      ],
    });
  });

  it('refuses the sixty-first, keeping the sixty', () => {
    const { hand, context } = handOf(MAX_SELECTION_ITEMS + 1);
    const full = hand.slice(0, MAX_SELECTION_ITEMS);
    const result = reduceSelection(context, full, {
      kind: 'add',
      cardId: hand.at(-1)!,
    });
    expect(result.selection).toBe(full);
    expect(result.refused).toEqual([{ cardId: hand.at(-1), reason: 'full' }]);
  });

  it('adds many without taking any out, and names only the new ones refused', () => {
    const table = groupTable();
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as [ViewCardId, ViewCardId];
    const [pile] = table.put(BLUE, 'discard', {}) as [ViewCardId];
    const context = table.context();
    expect(
      reduceSelection(context, [a], { kind: 'addMany', cardIds: [a, b, pile] })
    ).toEqual({
      selection: [a, b],
      refused: [{ cardId: pile, reason: 'not_an_item' }],
      dropped: [],
    });
    expect(
      reduceSelection(context, [b], {
        kind: 'replace',
        cardIds: [a],
      }).selection
    ).toEqual([a]);
  });

  it('keeps the same selection when nothing changed', () => {
    const { hand, context } = handOf(2);
    const selection = [hand[0]!, hand[1]!];
    expect(
      reduceSelection(context, selection, { kind: 'reconcile' }).selection
    ).toBe(selection);
    expect(
      reduceSelection(context, selection, { kind: 'addMany', cardIds: hand })
        .selection
    ).toBe(selection);
    expect(
      reduceSelection(context, NO_SELECTION, { kind: 'clear' }).selection
    ).toBe(NO_SELECTION);
  });

  it('lets go of cards that left the table, and follows a Pokémon that evolved', () => {
    const table = groupTable();
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as [ViewCardId, ViewCardId];
    const active = table.pokemon(BLUE, 'active', [{}]);
    const before = [a, b, active.top];
    // The other player took one away; the Pokémon evolved.
    const hand = table.view.zones[table.zoneId(BLUE, 'hand')]!;
    (hand as { cards: unknown[] }).cards.splice(1, 1);
    const stage1 = table.put(BLUE, 'board', {})[0]!;
    const board = table.view.zones[table.zoneId(BLUE, 'board')]!;
    const evolved = (board as { cards: unknown[] }).cards.pop();
    (
      table.view.stacks[active.stackId] as { evolutionCards: unknown[] }
    ).evolutionCards.push(evolved);
    expect(
      reduceSelection(table.context(), before, { kind: 'reconcile' })
    ).toEqual({ selection: [a, stage1], refused: [], dropped: [b] });
  });

  it("lets go of a closed pile's cards, and brings back what a refused move took", () => {
    const table = groupTable();
    const discard = table.zoneId(BLUE, 'discard');
    const pile = table.put(BLUE, 'discard', {}, {});
    const [held] = table.put(BLUE, 'hand', {}) as [ViewCardId];
    const open = table.context({ openedZoneId: discard });
    const selection = [...pile, held];
    expect(
      reduceSelection(open, selection, { kind: 'reconcile' }).selection
    ).toBe(selection);
    const closed = table.context();
    expect(reduceSelection(closed, selection, { kind: 'reconcile' })).toEqual({
      selection: [held],
      refused: [],
      dropped: pile,
    });
    expect(
      reduceSelection(closed, NO_SELECTION, {
        kind: 'restore',
        cardIds: selection,
      })
    ).toEqual({ selection: [held], refused: [], dropped: [] });
  });

  it("works one seat's windows: the other's cards there aren't items", () => {
    const table = groupTable();
    const looked = table.put(BLUE, 'board', {}, {});
    const areas = table.view.workAreas[RED] as { inspection: unknown };
    areas.inspection = {
      id: 'inspection:red',
      sourceZoneId: table.zoneId(RED, 'deck'),
      cards: table.view.zones[table.zoneId(BLUE, 'board')]!.cards.map(
        (card) => ({ ...card, ownerId: RED })
      ),
    };
    (
      table.view.zones[table.zoneId(BLUE, 'board')] as { cards: unknown[] }
    ).cards = [];
    expect(
      normalizeSelection(table.context(), looked).refused.map(
        (entry) => entry.reason
      )
    ).toEqual(['uncontrolled', 'uncontrolled']);
    expect(
      normalizeSelection(table.context({ controlsEverySeat: true }), looked)
        .items
    ).toEqual(looked);
  });
});
