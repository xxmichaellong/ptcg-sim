import { describe, expect, it } from 'vitest';

import { BLUE, RED, groupTable, piece } from './group-table.test-support.js';
import {
  groupAttachTargets,
  groupMenuOf,
  playAsOneSelection,
} from './group-menu-entries.js';

const energy = { category: 'Energy' as const, name: 'Fire Energy' };
const MORPEKO = 'swshp:155:Morpeko V-UNION';
const union = (part: number) => ({
  name: 'Morpeko V-UNION',
  presentation: piece(MORPEKO, part),
});
const hint = (id: string) => `<${id}>`;

describe('the group menu', () => {
  it('offers nothing for none or one item: one card keeps its own menu', () => {
    const table = groupTable();
    const [card] = table.put(BLUE, 'hand', energy);
    expect(groupMenuOf(table.context(), [])).toBeNull();
    expect(groupMenuOf(table.context(), [card!])).toBeNull();
  });

  it('lists what a group of hand cards can do, counted and with the order on a pile', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy, energy);
    table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const menu = groupMenuOf(table.context(), hand, { hint })!;
    expect(menu.header).toBe('3 cards');
    const byId = new Map(menu.entries.map((entry) => [entry.id, entry]));
    expect(byId.get('send:discard')).toMatchObject({
      label: 'Discard 3 cards',
      detail: '3 ends on top',
      shortcut: '<card.toDiscard>',
      run: { kind: 'action', action: { kind: 'send', to: 'discard' } },
    });
    expect(byId.get('send:deckShuffled')?.label).toBe(
      'Shuffle 3 cards into the deck'
    );
    // Already in hand: no "Move to hand".
    expect(byId.has('send:hand')).toBe(false);
    expect(byId.get('attach')).toMatchObject({
      run: { kind: 'picker', picker: 'attachTarget' },
    });
    // Damage goes only on Pokémon in play.
    expect(byId.has('damage:add')).toBe(false);
    expect(byId.get('reveal')?.label).toBe('Reveal 3 cards');
    expect(menu.entries.at(-1)).toMatchObject({
      id: 'deselect',
      run: { kind: 'deselect' },
      shortcut: '<table.closePopups>',
    });
  });

  it('counts only the cards that move, and names whole Pokémon as Pokémon', () => {
    const table = groupTable();
    const [inHand] = table.put(BLUE, 'hand', energy);
    const [discarded] = table.put(BLUE, 'discard', energy);
    const charmander = table.pokemon(
      BLUE,
      'bench',
      [{ name: 'Charmander' }],
      [energy]
    );
    const pichu = table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }]);
    const opened = table.context({
      openedZoneId: table.zoneId(BLUE, 'discard'),
    });
    const mixed = groupMenuOf(opened, [inHand!, discarded!])!;
    const discard = mixed.entries.find((entry) => entry.id === 'send:discard');
    // One already lies there: one card moves, the first.
    expect(discard?.label).toBe('Discard 1 card');
    expect(discard?.detail).toBe('1 ends on top');
    const pokemon = groupMenuOf(table.context(), [charmander.top, pichu.top])!;
    expect(
      pokemon.entries.find((entry) => entry.id === 'send:hand')
    ).toMatchObject({
      label: 'Move 2 Pokémon to hand',
      detail: 'With their attached cards',
    });
    expect(
      pokemon.entries.find((entry) => entry.id === 'damage:add')?.label
    ).toBe('Add 10 damage to each of 2');
    expect(pokemon.entries.some((entry) => entry.id === 'damage')).toBe(true);
    // Neither is Active: no Special Condition.
    expect(
      pokemon.entries.some((entry) => entry.id.startsWith('condition'))
    ).toBe(false);
  });

  it('names the other seat in the header when every card is theirs', () => {
    const table = groupTable();
    const theirs = [
      table.pokemon(RED, 'active', [{ name: 'Mew' }]).top,
      table.pokemon(RED, 'bench', [{ name: 'Mewtwo' }]).top,
    ];
    const players = table.view.players as Record<
      string,
      { displayName: string }
    >;
    players[RED]!.displayName = 'Red';
    expect(groupMenuOf(table.context(), theirs)?.header).toBe(
      "2 of Red's cards"
    );
    const [own] = table.put(BLUE, 'hand', energy);
    expect(groupMenuOf(table.context(), [own!, theirs[0]!])?.header).toBe(
      '2 cards'
    );
  });

  it('plays a V-UNION as one card: its pieces in sight, then where they go', () => {
    const table = groupTable();
    const [first, second] = table.put(BLUE, 'hand', union(0), union(1));
    const [third, fourth] = table.put(BLUE, 'discard', union(2), union(3));
    const [card] = table.put(BLUE, 'hand', energy);
    const context = table.context();
    expect(playAsOneSelection(context, [first!])).toEqual([
      first,
      second,
      third,
      fourth,
    ]);
    // All of them selected already: nothing more to bring.
    expect(
      playAsOneSelection(context, [first!, second!, third!, fourth!])
    ).toBeNull();
    const withCard = groupMenuOf(context, [first!, card!])!;
    expect(withCard.entries.some((entry) => entry.id === 'playAsOne')).toBe(
      true
    );
    const set = groupMenuOf(
      table.context({ openedZoneId: table.zoneId(BLUE, 'discard') }),
      [first!, second!, third!, fourth!]
    )!;
    expect(set.entries.find((entry) => entry.id === 'play:bench')?.label).toBe(
      'Put Morpeko V-UNION on the Bench'
    );
    expect(set.entries.find((entry) => entry.id === 'play:active')?.label).toBe(
      'Put Morpeko V-UNION in the Active Spot'
    );
  });

  it('lists the Pokémon a group of attachments can go on together', () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const active = table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const benched = table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }]);
    expect(groupAttachTargets(table.context(), hand)).toEqual([
      { stackId: active.stackId, topCardId: active.top },
      { stackId: benched.stackId, topCardId: benched.top },
    ]);
    const [basic] = table.put(BLUE, 'hand', { name: 'Eevee' });
    expect(groupAttachTargets(table.context(), [hand[0]!, basic!])).toEqual([]);
  });
});
