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
  const runtime: BoardCommandRuntime & {
    getBoardSnapshot: () => BoardSessionControllerState | undefined;
  } = {
    getBoardSnapshot: () => state,
    emitIntent: vi.fn(),
    emitOpenedZoneCardIntent: vi.fn(),
    emitLegacyShortcutAction: vi.fn(() => true),
    emitLegacyOverlayAction: vi.fn(() => true),
    declareDeckView: vi.fn(),
  };
  return runtime as typeof runtime & {
    emitIntent: ReturnType<typeof vi.fn>;
    emitOpenedZoneCardIntent: ReturnType<typeof vi.fn>;
    emitLegacyShortcutAction: ReturnType<typeof vi.fn>;
    emitLegacyOverlayAction: ReturnType<typeof vi.fn>;
  };
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
    // Changed while the number was typed: taken off what is there now.
    runtime.getBoardSnapshot = () => ({
      ...damaged,
      view: {
        ...damaged.view!,
        stacks: { ...view.stacks, [active.id]: { ...active, damage: 150 } },
      },
    });
    remove.run!({ count: 50 });
    expect(runtime.emitLegacyOverlayAction).toHaveBeenLastCalledWith(
      { kind: 'context', action: 'setDamage', cardId, value: '100' },
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

  it('keeps two prints of one name apart, and copies of one card together', () => {
    const hand = Object.values(view.zones).find(
      (zone) => zone.kind === 'hand' && zone.ownerId === bottom
    )!;
    const known = hand.cards.filter((card) => card.kind === 'known');
    expect(known.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = known as [
      (typeof known)[number] & { kind: 'known' },
      (typeof known)[number] & { kind: 'known' },
      (typeof known)[number] & { kind: 'known' },
    ];
    const twinView = {
      ...view,
      definitions: {
        ...view.definitions,
        'def:twin-a': {
          ...view.definitions[first.definitionId]!,
          id: 'def:twin-a',
          name: 'Twin',
        },
        'def:twin-b': {
          ...view.definitions[first.definitionId]!,
          id: 'def:twin-b',
          name: 'Twin',
        },
      },
      zones: {
        ...view.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.map((card) =>
            card.id === first.id || card.id === third.id
              ? { ...card, definitionId: 'def:twin-a' }
              : card.id === second.id
                ? { ...card, definitionId: 'def:twin-b' }
                : card
          ),
        },
      },
    } as typeof view;
    const twinScene = createBoardSceneForViewport(twinView, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: bottom,
      splitRatio: 0.5,
    });
    const cards = find(
      boardCommands({
        runtime: runtimeFor(stateWith({ view: twinView, scene: twinScene })),
        hint: () => undefined,
      }),
      'cards.find'
    ).submenu!().commands.filter((card) => card.title === 'Twin');
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.detail)).toEqual([
      'Your hand (2)',
      'Your hand',
    ]);
    // Each shows its own face.
    expect(cards.every((card) => card.image?.src)).toBe(true);
  });

  it("shows a closed pile's buried card over its pile, opened for it", () => {
    const state = stateWith();
    const runtime = runtimeFor(state);
    const buried = scene.cards.find(
      (card) =>
        !card.interactive &&
        !card.concealed &&
        view.zones[card.parentId]?.kind === 'discard'
    )!;
    const cards = find(
      boardCommands({ runtime, hint: () => undefined }),
      'cards.find'
    ).submenu!().commands;
    const row = cards.find((card) => card.id === `cards.card.${buried.id}`);
    // Copies lying together are one row: act on whichever stands for them.
    const actions = (row ?? cards.find((card) => card.title === buried.label)!)
      .submenu!().commands;
    const show = actions.find((command) => command.id.endsWith('.view'))!;
    show.run!({});
    expect(runtime.emitIntent).toHaveBeenCalledWith({
      kind: 'ZoneOpened',
      zoneId: buried.parentId,
    });
    expect(runtime.emitOpenedZoneCardIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CardPreviewRequested' })
    );
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
