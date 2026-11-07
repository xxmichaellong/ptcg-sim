import type { ViewCardId } from '@ptcgsim/game-core';
import { DEFAULT_BOARD_PRESENTATION } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { BLUE, RED, groupTable } from './group-table.test-support.js';
import { selectAllCardIds } from './select-all.js';

const energy = { category: 'Energy' as const, name: 'Fire Energy' };

describe('Ctrl/⌘+A', () => {
  const tableWithPlaces = () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    const discard = table.put(BLUE, 'discard', energy, energy, energy);
    const mew = table.pokemon(RED, 'active', [{ name: 'Mew' }]);
    const mewtwo = table.pokemon(RED, 'bench', [{ name: 'Mewtwo' }]);
    return { table, hand, discard, mew, mewtwo };
  };
  const stateOf = (
    table: ReturnType<typeof groupTable>,
    selection: readonly ViewCardId[] = [],
    openedZoneId: string | null = null
  ) => ({
    view: table.view,
    scene: table.scene(),
    presentation: { ...DEFAULT_BOARD_PRESENTATION, selection, openedZoneId },
  });

  it('takes every card where the focused one lies: its hand, its seat’s Pokémon in play', () => {
    const { table, hand, mew, mewtwo } = tableWithPlaces();
    expect(selectAllCardIds(stateOf(table), hand[1]!)).toEqual(hand);
    expect(selectAllCardIds(stateOf(table), mewtwo.top)).toEqual([
      mew.top,
      mewtwo.top,
    ]);
  });

  it('falls back to the last card selected, then the open pile, then the browser', () => {
    const { table, hand, discard, mew } = tableWithPlaces();
    expect(selectAllCardIds(stateOf(table, [hand[0]!, mew.top]), null)).toEqual(
      [mew.top, expect.anything()]
    );
    const pile = table.zoneId(BLUE, 'discard');
    expect(selectAllCardIds(stateOf(table, [], pile), null)).toEqual(discard);
    // A pile's card focused in the viewer stands for the pile.
    expect(selectAllCardIds(stateOf(table, [], pile), discard[0]!)).toEqual(
      discard
    );
    expect(selectAllCardIds(stateOf(table), null)).toBeNull();
  });
});
