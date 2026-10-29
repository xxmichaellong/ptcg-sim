import type { ViewCardId } from '@ptcgsim/game-core';

import type { GroupAction } from './compile-group.js';
import type { SelectionContext } from './selection.js';

/**
 * The group menu as data (ADR-042 §3, "The group menu"): what a selection
 * of several items can do, worded as it would be done. The table's menu
 * (right-click or a long press on a selected item, the group bar's Move…)
 * and the palette's "Selected cards" section show the same list.
 */
export type GroupMenuSection = 'move' | 'annotate' | 'play' | 'selection';

export interface GroupMenuEntry {
  /**
   * Stable, for tests and React keys: `send:discard`, `play:bench`,
   * `damage:add`, `playAsOne`, `deselect`…
   */
  readonly id: string;
  readonly section: GroupMenuSection;
  /** State-true and counted: "Discard 3 cards", "Hide 2 cards". */
  readonly label: string;
  /** A second line where the order matters: "3 ends on top". */
  readonly detail?: string;
  /** The key that does the same, as the shortcuts dialog writes it. */
  readonly shortcut?: string;
  /**
   * What choosing it does: an action for the whole selection
   * (`emitGroupAction`); a picker first (Damage… opens the stepper,
   * Attach to… asks for the Pokémon); the pieces played as one card; or
   * the selection put down.
   */
  readonly run:
    | { readonly kind: 'action'; readonly action: GroupAction }
    | { readonly kind: 'picker'; readonly picker: 'damage' | 'attachTarget' }
    | { readonly kind: 'playAsOne' }
    | { readonly kind: 'deselect' };
}

export interface GroupMenu {
  /** "3 cards", or "3 of Red's cards" when it holds the other seat's. */
  readonly header: string;
  readonly entries: readonly GroupMenuEntry[];
}

/**
 * The menu for this selection, built from `compileGroup` so it offers only
 * what the group can do; null for none or one item (one card keeps its own
 * menu). Nothing until the controller's work package fills it in.
 */
export const groupMenuOf = (
  _context: SelectionContext,
  _selection: readonly ViewCardId[]
): GroupMenu | null => null;
