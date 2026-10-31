import type { ViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { BLUE, RED, groupTable, piece } from './group-table.test-support.js';
import {
  cardPieceOf,
  partitionPieceSets,
  unfinishedPokemonFor,
  visiblePieceSetOf,
} from './piece-sets.js';

const MORPEKO = 'swshp:155:Morpeko V-UNION';
const MEWTWO = 'swshp:159:Mewtwo V-UNION';
const LUGIA = 'hgss2:90:Lugia LEGEND';
const TRENCH = 'm6:71:Legendary Trench';

const union = (key: string, part: number) => ({
  name: key.split(':')[2],
  presentation: piece(key, part),
});
const legend = (part: number) => ({
  name: 'Lugia LEGEND',
  presentation: {
    ...piece(LUGIA, part, 1, 2),
    readingQuarterTurns: 1 as const,
  },
});
const stadiumHalf = (part: number) => ({
  name: 'Legendary Trench',
  category: 'Trainer' as const,
  presentation: piece(TRENCH, part, 2, 1),
});

describe("a group's pieces", () => {
  it('reads a piece only from a face-up card the viewer knows', () => {
    const table = groupTable();
    table.put(BLUE, 'hand', union(MORPEKO, 2));
    table.put(BLUE, 'prizes', { ...union(MORPEKO, 1), face: 'down' });
    table.put(BLUE, 'hand', {});
    const cards = [
      ...table.view.zones[table.zoneId(BLUE, 'hand')]!.cards,
      ...table.view.zones[table.zoneId(BLUE, 'prizes')]!.cards,
    ];
    expect(cards.map((card) => cardPieceOf(table.view, card))).toEqual([
      { key: MORPEKO, columns: 2, rows: 2, part: 2 },
      null,
      null,
    ]);
  });

  it('plays each print as one set, in part order, where its first piece was picked', () => {
    const table = groupTable();
    const [m3, x, m0, w1, m2, w0, m1] = table.put(
      BLUE,
      'discard',
      union(MORPEKO, 3),
      {},
      union(MORPEKO, 0),
      union(MEWTWO, 1),
      union(MORPEKO, 2),
      union(MEWTWO, 0),
      union(MORPEKO, 1)
    ) as ViewCardId[];
    expect(
      partitionPieceSets(table.view, [m3!, x!, m0!, w1!, m2!, w0!, m1!])
    ).toEqual([
      {
        kind: 'set',
        set: {
          key: MORPEKO,
          columns: 2,
          rows: 2,
          cardIds: [m0, m1, m2, m3],
          parts: [0, 1, 2, 3],
          complete: true,
          kind: 'pokemon',
        },
      },
      { kind: 'card', cardId: x },
      {
        kind: 'set',
        set: {
          key: MEWTWO,
          columns: 2,
          rows: 2,
          cardIds: [w0, w1],
          parts: [0, 1],
          complete: false,
          kind: 'pokemon',
        },
      },
    ]);
  });

  it("makes two Pokémon of two copies of a LEGEND's halves", () => {
    const table = groupTable();
    const [top1, top2, bottom1, bottom2] = table.put(
      BLUE,
      'hand',
      legend(0),
      legend(0),
      legend(1),
      legend(1)
    ) as ViewCardId[];
    const units = partitionPieceSets(table.view, [
      top1!,
      top2!,
      bottom1!,
      bottom2!,
    ]);
    expect(
      units.map((unit) => (unit.kind === 'set' ? unit.set.cardIds : unit))
    ).toEqual([
      [top1, bottom1],
      [top2, bottom2],
    ]);
  });

  it("never joins two players' pieces: each seat's go to its own board", () => {
    const table = groupTable();
    const [blueTop, blueBottom] = table.put(
      BLUE,
      'hand',
      legend(0),
      legend(1)
    ) as ViewCardId[];
    const [redBottom] = table.put(RED, 'hand', legend(1)) as ViewCardId[];
    expect(partitionPieceSets(table.view, [blueTop!, redBottom!])).toEqual([
      { kind: 'card', cardId: blueTop },
      { kind: 'card', cardId: redBottom },
    ]);
    const units = partitionPieceSets(table.view, [
      blueTop!,
      redBottom!,
      blueBottom!,
    ]);
    expect(
      units.map((unit) => (unit.kind === 'set' ? unit.set.cardIds : unit))
    ).toEqual([[blueTop, blueBottom], { kind: 'card', cardId: redBottom }]);
  });

  it('leaves a lone piece a card, and a Pokémon in play out of any set', () => {
    const table = groupTable();
    const [lone] = table.put(BLUE, 'hand', union(MORPEKO, 0));
    const inPlay = table.pokemon(BLUE, 'bench', [union(MORPEKO, 1)]);
    expect(partitionPieceSets(table.view, [lone!, inPlay.top])).toEqual([
      { kind: 'card', cardId: lone },
      { kind: 'card', cardId: inPlay.top },
    ]);
  });

  it("calls a split Stadium's halves a Stadium's", () => {
    const table = groupTable();
    const halves = table.put(BLUE, 'hand', stadiumHalf(1), stadiumHalf(0));
    expect(partitionPieceSets(table.view, halves)).toEqual([
      {
        kind: 'set',
        set: expect.objectContaining({
          cardIds: [halves[1], halves[0]],
          complete: true,
          kind: 'stadium',
        }) as unknown,
      },
    ]);
  });
});

describe('"Play as one card"', () => {
  it("finds a piece's siblings where the player reaches: its place, the hand, the discard, the open pile", () => {
    const table = groupTable();
    const [picked] = table.put(BLUE, 'discard', union(MORPEKO, 2));
    const [inHand] = table.put(BLUE, 'hand', union(MORPEKO, 0));
    // Not seen: a piece face down, one in a closed pile, the other player's.
    table.put(BLUE, 'hand', { ...union(MORPEKO, 1), face: 'down' });
    const [lostCopy] = table.put(BLUE, 'lostZone', union(MORPEKO, 1));
    table.put(RED, 'discard', union(MORPEKO, 3));
    expect(visiblePieceSetOf(table.view, picked!)?.cardIds).toEqual([
      inHand,
      picked,
    ]);
    expect(
      visiblePieceSetOf(table.view, picked!, table.zoneId(BLUE, 'lostZone'))
        ?.cardIds
    ).toEqual([inHand, lostCopy, picked]);
  });

  it('prefers the copy beside the piece, and offers nothing for a lone piece', () => {
    const table = groupTable();
    const [picked, beside] = table.put(
      BLUE,
      'discard',
      union(MORPEKO, 0),
      union(MORPEKO, 1)
    );
    table.put(BLUE, 'hand', union(MORPEKO, 1));
    expect(visiblePieceSetOf(table.view, picked!)?.cardIds).toEqual([
      picked,
      beside,
    ]);
    const [alone] = table.put(BLUE, 'hand', union(MEWTWO, 0));
    expect(visiblePieceSetOf(table.view, alone!)).toBeNull();
    expect(
      visiblePieceSetOf(table.view, table.put(BLUE, 'hand', {})[0]!)
    ).toBeNull();
  });
});

describe('an unfinished Pokémon a piece joins', () => {
  it('is the one of its print on that board missing its parts', () => {
    const table = groupTable();
    const half = table.pokemon(BLUE, 'bench', [
      union(MORPEKO, 0),
      union(MORPEKO, 1),
    ]);
    const other = table.pokemon(BLUE, 'bench', [union(MEWTWO, 0)]);
    table.pokemon(RED, 'bench', [union(MORPEKO, 0)]);
    const morpeko = { key: MORPEKO, columns: 2, rows: 2, part: 2 };
    expect(unfinishedPokemonFor(table.view, morpeko, [2, 3], BLUE, BLUE)).toBe(
      half.stackId
    );
    expect(
      unfinishedPokemonFor(table.view, morpeko, [1], BLUE, BLUE)
    ).toBeNull();
    expect(
      unfinishedPokemonFor(
        table.view,
        { ...morpeko, key: MEWTWO },
        [1],
        BLUE,
        BLUE
      )
    ).toBe(other.stackId);
    // Two to choose between: none.
    table.pokemon(BLUE, 'bench', [union(MORPEKO, 0)]);
    expect(
      unfinishedPokemonFor(table.view, morpeko, [3], BLUE, BLUE)
    ).toBeNull();
  });

  it("is never another player's, though it lies on that board", () => {
    const table = groupTable();
    // Red's top-left piece dragged onto Blue's Bench.
    const theirs = table.pokemon(BLUE, 'bench', [union(MORPEKO, 0)]);
    const stack = table.view.stacks[theirs.stackId]!;
    (stack.evolutionCards[0] as { ownerId: string }).ownerId = RED;
    const morpeko = { key: MORPEKO, columns: 2, rows: 2, part: 1 };
    expect(
      unfinishedPokemonFor(table.view, morpeko, [1], BLUE, BLUE)
    ).toBeNull();
    expect(unfinishedPokemonFor(table.view, morpeko, [1], BLUE, RED)).toBe(
      theirs.stackId
    );
  });
});
