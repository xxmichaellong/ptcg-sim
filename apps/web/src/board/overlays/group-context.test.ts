// @vitest-environment happy-dom

import {
  createBoardSceneForViewport,
  createRendererSpikeView,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import { createInitialBoardSessionControllerState } from '../BoardSessionController.js';
import { groupMenuBox } from './GroupMenu.js';
import {
  boardRectOf,
  groupAttachTargets,
  isGroupSelection,
  isSelectionModifier,
  pokemonInPlayOf,
  selectedItemOf,
  selectionContextOf,
} from './group-context.js';

const view = createRendererSpikeView();
const firstPlayer = view.playerOrder[0]!;
const scene = createBoardSceneForViewport(view, {
  geometryVersion: 1,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  bottomPlayerId: firstPlayer,
  splitRatio: 0.5,
});
const board = {
  ...createInitialBoardSessionControllerState(),
  view,
  scene,
};

describe('a selection read by the overlays', () => {
  it('adds with Shift, and with ⌘ on a Mac or Ctrl elsewhere', () => {
    const press = (
      keys: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey', boolean>>
    ) => ({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      ...keys,
    });
    expect(isSelectionModifier(press({ shiftKey: true }), 'mac')).toBe(true);
    expect(isSelectionModifier(press({ shiftKey: true }), 'other')).toBe(true);
    expect(isSelectionModifier(press({ metaKey: true }), 'mac')).toBe(true);
    // A Mac's Ctrl+click is a right-click, not an add.
    expect(isSelectionModifier(press({ ctrlKey: true }), 'mac')).toBe(false);
    expect(isSelectionModifier(press({ ctrlKey: true }), 'other')).toBe(true);
    expect(isSelectionModifier(press({ metaKey: true }), 'other')).toBe(false);
    expect(isSelectionModifier(press({}), 'other')).toBe(false);
  });

  it("reads a Pokémon's lower stage as the Pokémon it is, by its top card", () => {
    const context = selectionContextOf(board, true)!;
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const stack = view.stacks[stackId]!;
    const topCard = stack.evolutionCards.at(-1)!.id;
    const hand = view.zones[`zone:${firstPlayer}:hand`]!.cards[0]!.id;
    expect(isGroupSelection([topCard])).toBe(false);
    expect(isGroupSelection([topCard, hand])).toBe(true);
    expect(selectedItemOf(context, [topCard, hand], topCard)).toBe(topCard);
    expect(selectedItemOf(context, [topCard, hand], hand)).toBe(hand);
    expect(pokemonInPlayOf(context, [topCard, hand])).toEqual([stackId]);
    if (stack.evolutionCards.length > 1)
      expect(
        selectedItemOf(context, [topCard], stack.evolutionCards[0]!.id)
      ).toBe(topCard);
    const other = view.zones[`zone:${firstPlayer}:hand`]!.cards[1]!.id;
    expect(selectedItemOf(context, [topCard, hand], other)).toBeNull();
  });

  it('attaches a group holding a Pokémon in play to nothing: only attachments go on a Pokémon together', () => {
    const context = selectionContextOf(board, true)!;
    const stackId = view.boards[firstPlayer]!.activeStackId!;
    const topCard = view.stacks[stackId]!.evolutionCards.at(-1)!.id;
    const hand = view.zones[`zone:${firstPlayer}:hand`]!.cards[0]!.id;
    expect(groupAttachTargets(context, [topCard, hand])).toEqual([]);
    // Each one offered takes every card of the group, one at a time.
    for (const target of groupAttachTargets(context, [hand])) {
      expect(view.stacks[target.id]).toBeDefined();
      expect(target.label).toMatch(/, (Active|Bench)$/u);
    }
  });

  it('has no selection for a spectator', () => {
    expect(
      selectionContextOf(
        { ...board, view: { ...view, viewer: { kind: 'spectator' } } },
        false
      )
    ).toBeNull();
  });

  it('places a button in the table, drawn at half size', () => {
    const root = document.createElement('div');
    root.setAttribute('data-legacy-board-overlays', 'true');
    const button = document.createElement('button');
    root.append(button);
    document.body.append(root);
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 10, width: 640, height: 360 })
    );
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 120, y: 60, width: 50, height: 22 })
    );
    expect(boardRectOf(button, scene)).toEqual({
      x: 200,
      y: 100,
      width: 100,
      height: 44,
    });
    root.remove();
  });
});

describe('where the group menu opens', () => {
  const table = { width: 844, height: 390 };
  it('under what opened it, centred on it, where there is room', () => {
    const box = groupMenuBox(
      { x: 300, y: 40, width: 100, height: 40 },
      { width: 240, height: 200 },
      table
    );
    expect(box).toMatchObject({ left: 230, top: 86, below: true });
  });

  it('over it near the bottom, and inside the table at its sides', () => {
    const box = groupMenuBox(
      { x: 800, y: 330, width: 40, height: 44 },
      { width: 240, height: 200 },
      table
    );
    expect(box.below).toBe(false);
    expect(box.top).toBe(330 - 6 - 200);
    expect(box.left).toBe(844 - 8 - 240);
  });

  it('never taller than the table: it scrolls', () => {
    const box = groupMenuBox(
      { x: 300, y: 180, width: 40, height: 40 },
      { width: 240, height: 900 },
      table
    );
    expect(box.maxHeight).toBe(390 - 16);
    expect(box.top).toBeGreaterThanOrEqual(8);
  });
});
