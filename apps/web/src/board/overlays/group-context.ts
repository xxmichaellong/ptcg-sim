import { t } from '@lingui/core/macro';
import type { ViewCardId } from '@ptcgsim/game-core';
import type { BoardScene, Rect } from '@ptcgsim/renderer-contract';

import {
  detectKeyboardPlatform,
  type KeyboardPlatform,
} from '../../hotkeys/chords.js';
import { actingPlayerIdOf } from '../acting-seat.js';
import type { BoardSessionControllerState } from '../BoardSessionController.js';
import { groupAttachTargets as attachTargetsOf } from '../group-menu-entries.js';
import { normalizeSelection, type SelectionContext } from '../selection.js';
import type { GroupAttachTarget } from './GroupMenu.js';

/**
 * The table a selection is read against, as the overlays see it (ADR-042
 * §11): the view and scene shown, the seat at the bottom acting, and the
 * pile open in the viewer. Solo's one player moves both seats' cards.
 * Null before there is a table, or for a spectator.
 */
export const selectionContextOf = (
  state: BoardSessionControllerState,
  controlsEverySeat: boolean
): SelectionContext | null => {
  const { view, scene } = state;
  if (!view || !scene || view.viewer.kind !== 'player') return null;
  const actingPlayerId = actingPlayerIdOf(view, scene.bottomPlayerId);
  return {
    view,
    scene,
    ...(actingPlayerId ? { actingPlayerId } : {}),
    ...(controlsEverySeat ? { controlsEverySeat: true } : {}),
    openedZoneId: state.presentation.openedZoneId,
  };
};

/**
 * Whether a press adds to the selection rather than replacing it: Shift
 * everywhere, and the platform's modifier -- ⌘ on macOS, Ctrl elsewhere
 * (a Mac's Ctrl+click is a right-click, ADR-042 §2).
 */
export const isSelectionModifier = (
  event: {
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
  },
  platform: KeyboardPlatform = detectKeyboardPlatform()
): boolean =>
  event.shiftKey || (platform === 'mac' ? event.metaKey : event.ctrlKey);

/** Whether several items are selected: a group, with its own menu and bar. */
export const isGroupSelection = (selection: readonly ViewCardId[]): boolean =>
  selection.length >= 2;

/**
 * Where an element of the overlays lies in the table's own coordinates
 * (the board may be drawn scaled), for a menu to open from it.
 */
export const boardRectOf = (
  element: Element,
  scene: Pick<BoardScene, 'viewport'>
): Rect => {
  const box = element.getBoundingClientRect();
  const root = element
    .closest('[data-legacy-board-overlays]')
    ?.getBoundingClientRect();
  if (!root?.width || !root.height)
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  const scaleX = scene.viewport.width / root.width;
  const scaleY = scene.viewport.height / root.height;
  return {
    x: (box.left - root.left) * scaleX,
    y: (box.top - root.top) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
};

/** The Pokémon in play a selection holds, each once (by its stack). */
export const pokemonInPlayOf = (
  context: SelectionContext,
  selection: readonly ViewCardId[]
): readonly string[] =>
  Object.values(context.view.stacks).flatMap((stack) => {
    const top = stack.evolutionCards.at(-1);
    return top && selection.includes(top.id) ? [stack.id] : [];
  });

/**
 * "Attach to…": the Pokémon in play the whole group can go on, as the
 * group's own rule decides (`groupAttachTargets`, from `compileGroup`),
 * named as the table names them, with where they are. The move itself is
 * the group's, compiled again when it is chosen.
 */
export const groupAttachTargets = (
  context: SelectionContext,
  selection: readonly ViewCardId[]
): readonly GroupAttachTarget[] =>
  attachTargetsOf(context, selection).flatMap(({ stackId, topCardId }) => {
    const stack = context.view.stacks[stackId];
    if (!stack) return [];
    const name =
      context.scene.cards.find((card) => card.id === topCardId)?.label ??
      t`Pokémon`;
    return [
      {
        id: stackId,
        label:
          stack.slot === 'active'
            ? t({
                message: `${name}, Active`,
                comment:
                  'A Pokémon to attach cards to, e.g. "Pikachu, Active".',
              })
            : t({
                message: `${name}, Bench`,
                comment: 'A Pokémon to attach cards to, e.g. "Pikachu, Bench".',
              }),
      },
    ];
  });

/**
 * The item a card stands for in the selection (a Pokémon's lower stage is
 * its Pokémon, by its top card), when that item is selected.
 */
export const selectedItemOf = (
  context: SelectionContext,
  selection: readonly ViewCardId[],
  cardId: ViewCardId
): ViewCardId | null => {
  if (selection.includes(cardId)) return cardId;
  const item = normalizeSelection(context, [cardId]).items[0];
  return item !== undefined && selection.includes(item) ? item : null;
};
