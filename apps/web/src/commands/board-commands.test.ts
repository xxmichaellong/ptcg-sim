import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  createInitialBoardSessionControllerState,
  type BoardSessionControllerState,
} from '../board/BoardSessionController.js';
import { boardCommands, type BoardCommandRuntime } from './board-commands.js';
import type { PaletteCommand } from './types.js';

const view = createRendererSpikeView();
const bottom = view.playerOrder[0]!;
const scene = createBoardSceneForViewport(view, {
  geometryVersion: 1,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  bottomPlayerId: bottom,
  splitRatio: 0.5,
});

const stateWith = (
  patch: Partial<BoardSessionControllerState> = {}
): BoardSessionControllerState => ({
  ...createInitialBoardSessionControllerState(),
  generation: 1,
  sessionPhase: 'ready',
  source: { kind: 'live' },
  canSubmitCommands: true,
  view,
  scene,
  ...patch,
});

const runtimeFor = (state: BoardSessionControllerState) => {
  const runtime = {
    getBoardSnapshot: () => state,
    emitIntent: vi.fn(),
    emitLegacyShortcutAction: vi.fn(() => true),
    emitLegacyOverlayAction: vi.fn(() => true),
    declareDeckView: vi.fn(),
  } satisfies BoardCommandRuntime;
  return runtime;
};

const ids = (commands: readonly PaletteCommand[]) =>
  commands.map((command) => command.id);
const find = (commands: readonly PaletteCommand[], id: string) => {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command)
    throw new Error(`No command ${id} in ${ids(commands).join(', ')}`);
  return command;
};

describe('boardCommands', () => {
  it("lists the acting seat's deck and hand, and runs them as the palette", () => {
    const state = stateWith();
    const runtime = runtimeFor(state);
    const commands = boardCommands({ runtime, hint: () => undefined });
    expect(ids(commands)).toEqual(
      expect.arrayContaining([
        'deck.drawOne',
        'deck.draw',
        'deck.shuffle',
        'deck.lookTop',
        'deck.lookBottom',
        'cards.find',
      ])
    );
    find(commands, 'deck.draw').run!({ count: 4 });
    expect(runtime.emitLegacyShortcutAction).toHaveBeenCalledWith(
      { action: 'drawOwnDeck', count: 4 },
      'palette'
    );
  });

  it("lists a selected card's actions as its keys and menu would take them", () => {
    const active = view.stacks[view.boards[bottom]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;
    const state = stateWith({
      presentation: {
        ...createInitialBoardSessionControllerState().presentation,
        selectedCardId: cardId,
      },
    });
    const runtime = runtimeFor(state);
    const commands = boardCommands({ runtime, hint: () => undefined }).filter(
      (command) => command.section === 'selected'
    );
    expect(ids(commands)).toEqual(
      expect.arrayContaining([
        'selected.view',
        'selected.toHand',
        'selected.toDiscard',
        'selected.addDamage',
        'selected.setDamage',
        'selected.condition',
      ])
    );
    find(commands, 'selected.toHand').run!({});
    expect(runtime.emitLegacyShortcutAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moveCardToZone',
        destination: 'hand',
        cardId,
      }),
      'palette'
    );
    find(commands, 'selected.setDamage').run!({ count: 120 });
    expect(runtime.emitLegacyOverlayAction).toHaveBeenCalledWith(
      { kind: 'context', action: 'setDamage', cardId, value: '120' },
      'palette'
    );
    const burned = find(commands, 'selected.condition')
      .submenu!().commands.find(
      (command) => command.id === 'selected.condition.burned'
    )!;
    burned.run!({});
    expect(runtime.emitLegacyOverlayAction).toHaveBeenLastCalledWith(
      { kind: 'context', action: 'setSpecialCondition', cardId, value: 'B' },
      'palette'
    );
  });

  it('takes damage off by setting what is left, and offers it only where there is some', () => {
    const active = view.stacks[view.boards[bottom]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;
    const presentation = {
      ...createInitialBoardSessionControllerState().presentation,
      selectedCardId: cardId,
    };
    const damaged = stateWith({
      view: {
        ...view,
        stacks: { ...view.stacks, [active.id]: { ...active, damage: 120 } },
      },
      presentation,
    });
    const runtime = runtimeFor(damaged);
    const commands = boardCommands({ runtime, hint: () => undefined });
    const remove = find(commands, 'selected.removeDamage');
    expect(remove.count?.max).toBe(120);
    remove.run!({ count: 50 });
    expect(runtime.emitLegacyOverlayAction).toHaveBeenCalledWith(
      { kind: 'context', action: 'setDamage', cardId, value: '70' },
      'palette'
    );
    // None to take off: v1's Alt+number would put it on instead.
    const undamaged = stateWith({
      view: {
        ...view,
        stacks: { ...view.stacks, [active.id]: { ...active, damage: null } },
      },
      presentation,
    });
    expect(
      ids(
        boardCommands({ runtime: runtimeFor(undamaged), hint: () => undefined })
      )
    ).not.toContain('selected.removeDamage');
  });

  it('finds face-up cards, yours first, never a face-down pile', () => {
    const commands = boardCommands({
      runtime: runtimeFor(stateWith()),
      hint: () => undefined,
    });
    const cards = find(commands, 'cards.find').submenu!().commands;
    const deckAndPrizes = new Set(
      Object.values(view.zones)
        .filter((zone) => zone.kind === 'deck' || zone.kind === 'prizes')
        .flatMap((zone) => zone.cards.map((card) => `cards.card.${card.id}`))
    );
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => deckAndPrizes.has(card.id))).toBe(false);
    // Each card opens its own actions, kept out of the root search.
    expect(
      cards.every((card) => card.nestedSearch === false && card.submenu)
    ).toBe(true);
    const first = cards[0]!;
    expect(first.detail).toMatch(/^Your/u);
  });

  it('offers a spectator only what changes nothing in the room', () => {
    const commands = boardCommands({
      runtime: runtimeFor(stateWith({ canSubmitCommands: false })),
      hint: () => undefined,
    });
    expect(
      commands.filter(
        (command) => command.section === 'deck' || command.section === 'turn'
      )
    ).toEqual([]);
  });
});
