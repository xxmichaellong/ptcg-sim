import type { ViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it, vi } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../board/BoardSessionController.js';
import { BLUE, groupTable, piece } from '../board/group-table.test-support.js';
import { boardCommands } from './board-commands.js';
import type { PaletteCommand } from './types.js';

const energy = { category: 'Energy' as const, name: 'Fire Energy' };
const MORPEKO = 'swshp:155:Morpeko V-UNION';
const union = (part: number) => ({
  name: 'Morpeko V-UNION',
  presentation: piece(MORPEKO, part),
});

const commandsFor = (
  table: ReturnType<typeof groupTable>,
  selection: readonly ViewCardId[]
) => {
  const state: BoardSessionControllerState = {
    ...createInitialBoardSessionControllerState(),
    generation: 1,
    sessionPhase: 'ready',
    source: { kind: 'live' },
    canSubmitCommands: true,
    view: table.view,
    scene: table.scene(),
  };
  const runtime = {
    getBoardSnapshot: () => ({
      ...state,
      presentation: { ...state.presentation, selection },
    }),
    emitIntent: vi.fn(),
    emitOpenedZoneCardIntent: vi.fn(),
    emitLegacyShortcutAction: vi.fn(() => true),
    emitLegacyOverlayAction: vi.fn(() => true),
    emitGroupAction: vi.fn(() => true),
    declareDeckView: vi.fn(),
  };
  const commands = boardCommands({
    runtime,
    hint: (id) => (id === 'card.toDiscard' ? 'D' : undefined),
  });
  return { commands, runtime };
};

const selected = (commands: readonly PaletteCommand[]) =>
  commands.filter((command) => command.section === 'selected');

describe("the palette's Selected cards", () => {
  it("lists the group's moves and marks, counted, each run as the group's action", () => {
    const table = groupTable();
    const hand = table.put(BLUE, 'hand', energy, energy);
    table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]);
    const { commands, runtime } = commandsFor(table, hand);
    const group = selected(commands);
    const discard = group.find(
      (command) => command.id === 'selected.group.send:discard'
    )!;
    expect(discard).toMatchObject({
      title: 'Discard 2 cards',
      detail: '2 cards',
      hint: 'D',
    });
    discard.run?.({});
    expect(runtime.emitGroupAction).toHaveBeenCalledExactlyOnceWith(
      { kind: 'send', to: 'discard' },
      'palette'
    );
    // One card's commands go quiet for a group.
    expect(group.some((command) => command.id.startsWith('selected.'))).toBe(
      true
    );
    expect(
      group.every((command) => command.id.startsWith('selected.group.'))
    ).toBe(true);
    // Attach to… names each Pokémon that takes them all.
    const attach = group.find(
      (command) => command.id === 'selected.group.attach'
    )!;
    const targets = attach.submenu!().commands;
    expect(targets.map((command) => command.title)).toEqual(['Pikachu']);
    targets[0]!.run?.({});
    expect(runtime.emitGroupAction).toHaveBeenLastCalledWith(
      {
        kind: 'drop',
        targetId: Object.values(table.view.stacks)[0]!.id,
      },
      'palette'
    );
    // Deselect puts the group down.
    group
      .find((command) => command.id === 'selected.group.deselect')!
      .run?.({});
    expect(runtime.emitIntent).toHaveBeenCalledWith({
      kind: 'CardsSelected',
      cardIds: [],
      mode: 'replace',
    });
  });

  it('adds damage to each Pokémon of a group by any amount', () => {
    const table = groupTable();
    const tops = [
      table.pokemon(BLUE, 'active', [{ name: 'Pikachu' }]).top,
      table.pokemon(BLUE, 'bench', [{ name: 'Pichu' }]).top,
    ];
    const { commands, runtime } = commandsFor(table, tops);
    const damage = commands.find(
      (command) => command.id === 'selected.group.damage'
    )!;
    expect(damage.count?.title(30)).toBe('Add 30 damage to each');
    damage.run?.({ count: 30 });
    expect(runtime.emitGroupAction).toHaveBeenCalledExactlyOnceWith(
      { kind: 'damage', delta: 30 },
      'palette'
    );
  });

  it('plays a piece as one card, one selected or among several', () => {
    const table = groupTable();
    const pieces = table.put(BLUE, 'hand', union(0), union(1), union(2));
    const single = commandsFor(table, [pieces[0]!]);
    const play = single.commands.find(
      (command) => command.id === 'selected.playAsOne'
    )!;
    expect(play.title).toBe('Play as one card');
    play.run?.({});
    expect(single.runtime.emitIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: pieces,
      mode: 'replace',
    });
    const [card] = table.put(BLUE, 'hand', energy);
    const group = commandsFor(table, [pieces[0]!, card!]);
    group.commands
      .find((command) => command.id === 'selected.group.playAsOne')!
      .run?.({});
    expect(group.runtime.emitIntent).toHaveBeenCalledExactlyOnceWith({
      kind: 'CardsSelected',
      cardIds: pieces,
      mode: 'replace',
    });
  });
});
