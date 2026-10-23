/**
 * Every keyboard shortcut on the table, in one place. The shortcuts dialog
 * lists these, the card menus read their key hints from them, and the
 * board's key handling resolves a player's own keys through them, so the
 * three cannot drift apart.
 *
 * The defaults are v1's keybinds. A shortcut works in one of three places:
 * while a card is selected (`card`), while none is (`table`), or either way
 * (`any`). Two shortcuts may share a key only if they never work at the
 * same time -- R rotates a selected card and otherwise refreshes images.
 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export type HotkeyScope = 'card' | 'table' | 'any';

export type HotkeyGroupId =
  'move' | 'card' | 'deck' | 'hand' | 'board' | 'table';

export interface HotkeyGroup {
  readonly id: HotkeyGroupId;
  /** Shown where the list is drawn, in the player's language. */
  readonly title: MessageDescriptor;
  /**
   * The table's own name for what its keys act on, which a search finds
   * them by where the title doesn't start with it ("自分の盤面").
   */
  readonly place?: MessageDescriptor;
}

/** Reading order, as v1's reference grouped them. */
export const HOTKEY_GROUPS: readonly HotkeyGroup[] = [
  {
    id: 'move',
    title: msg({
      message: 'Move the selected card',
      context: 'shortcut group',
    }),
  },
  {
    id: 'card',
    title: msg({ message: 'Selected card', context: 'shortcut group' }),
  },
  { id: 'deck', title: msg({ message: 'Deck', context: 'shortcut group' }) },
  { id: 'hand', title: msg({ message: 'Hand', context: 'shortcut group' }) },
  {
    id: 'board',
    title: msg({ message: 'Your board', context: 'shortcut group' }),
    place: msg({ message: 'Board', context: 'zone on the table' }),
  },
  { id: 'table', title: msg({ message: 'Table', context: 'shortcut group' }) },
];

export interface HotkeyAction {
  readonly id: string;
  readonly group: HotkeyGroupId;
  /** The shortcut's name, translated where it is shown. */
  readonly label: MessageDescriptor;
  /** A word or two for the key itself on the keyboard map. */
  readonly short: MessageDescriptor;
  readonly detail?: MessageDescriptor;
  readonly scope: HotkeyScope;
  /** v1's key, as canonical chord text. */
  readonly defaultChord: string;
  /**
   * Number keys that carry a count (1–9 draws that many). These, and Esc,
   * stay where v1 put them: they cannot be moved, and no other shortcut may
   * take them.
   */
  readonly digits?: true;
  readonly fixed?: true;
}

const action = <Id extends string>(
  id: Id,
  definition: Omit<HotkeyAction, 'id'>
): HotkeyAction & { readonly id: Id } => ({ id, ...definition });

export const HOTKEY_ACTIONS = [
  action('card.toHand', {
    group: 'move',
    label: msg`To hand`,
    short: msg({ message: 'Hand', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'h',
  }),
  action('card.toDiscard', {
    group: 'move',
    label: msg`To discard`,
    short: msg({ message: 'Discard', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'd',
  }),
  action('card.toBench', {
    group: 'move',
    label: msg`To bench`,
    short: msg({ message: 'Bench', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'b',
  }),
  action('card.toActive', {
    group: 'move',
    label: msg`To active`,
    short: msg({ message: 'Active', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'a',
  }),
  action('card.toStadium', {
    group: 'move',
    label: msg`To stadium`,
    short: msg({ message: 'Stadium', context: 'shortcut key caption' }),
    detail: msg`Joins matching pieces`,
    scope: 'card',
    defaultChord: 'g',
  }),
  action('card.addStadiumPiece', {
    group: 'move',
    label: msg`Add another stadium piece`,
    short: msg({ message: '+ Stadium', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'shift+g',
  }),
  action('card.toLostZone', {
    group: 'move',
    label: msg`To Lost Zone`,
    short: msg({ message: 'Lost Zone', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'l',
  }),
  action('card.toPrizes', {
    group: 'move',
    label: msg`To prizes`,
    short: msg({ message: 'Prize', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'p',
  }),
  action('card.toBoard', {
    group: 'move',
    label: msg`To board`,
    short: msg({ message: 'Board', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'space',
  }),
  action('card.toDeckTop', {
    group: 'move',
    label: msg`To top of deck`,
    short: msg({ message: 'Deck top', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'arrowup',
  }),
  action('card.toDeckBottom', {
    group: 'move',
    label: msg`To bottom of deck`,
    short: msg({ message: 'Deck bottom', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'arrowdown',
  }),
  action('card.swapWithDeckTop', {
    group: 'move',
    label: msg`Switch with top of deck`,
    short: msg({ message: 'Switch', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'arrowright',
  }),
  action('card.shuffleIntoDeck', {
    group: 'move',
    label: msg`Shuffle into deck`,
    short: msg({ message: 'Shuffle in', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 's',
  }),
  action('card.attach', {
    group: 'card',
    label: msg`Attach`,
    short: msg({ message: 'Attach', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'q',
  }),
  action('card.evolve', {
    group: 'card',
    label: msg`Evolve`,
    short: msg({ message: 'Evolve', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'e',
  }),
  action('card.view', {
    group: 'card',
    label: msg`View card`,
    short: msg({ message: 'View', context: 'shortcut key caption' }),
    detail: msg`Press twice for a card in play`,
    scope: 'card',
    defaultChord: 'v',
  }),
  action('card.toggleAbility', {
    group: 'card',
    label: msg`Toggle ability used`,
    short: msg({ message: 'Ability', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'w',
  }),
  action('card.addDamage', {
    group: 'card',
    label: msg`Add damage`,
    short: msg({ message: '+ Damage', context: 'shortcut key caption' }),
    detail: msg({
      message: '1 adds 10, 9 adds 90',
      comment: 'Number keys add that many tens of damage.',
    }),
    scope: 'card',
    defaultChord: '1',
    digits: true,
    fixed: true,
  }),
  action('card.removeDamage', {
    group: 'card',
    label: msg`Take off damage`,
    short: msg({ message: '− Damage', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'alt+1',
    digits: true,
    fixed: true,
  }),
  action('card.clearDamage', {
    group: 'card',
    label: msg`Clear damage`,
    short: msg({ message: 'Clear', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: '0',
    fixed: true,
  }),
  action('card.addCondition', {
    group: 'card',
    label: msg`Add or switch special condition`,
    short: msg({ message: 'Status', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'y',
  }),
  action('card.removeCondition', {
    group: 'card',
    label: msg`Remove special condition`,
    short: msg({ message: '− Status', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'alt+y',
  }),
  action('card.rotate', {
    group: 'card',
    label: msg`Rotate card(s)`,
    short: msg({ message: 'Rotate', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'r',
  }),
  action('card.rotateSingle', {
    group: 'card',
    label: msg`Rotate BREAK`,
    short: msg({ message: 'BREAK', context: 'shortcut key caption' }),
    detail: msg`Turns only the selected card`,
    scope: 'card',
    defaultChord: 'alt+r',
  }),
  action('card.lookCover', {
    group: 'card',
    label: msg`Look at or cover (only you)`,
    short: msg({ message: 'Look', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'c',
  }),
  action('card.hide', {
    group: 'card',
    label: msg`Turn face down (both players)`,
    short: msg({ message: 'Hide', context: 'shortcut key caption' }),
    detail: msg({
      message: 'Then press To active to play it face down',
      comment: '"To active" is the name of another shortcut in this list.',
    }),
    scope: 'card',
    defaultChord: 'z',
  }),
  action('card.reveal', {
    group: 'card',
    label: msg`Reveal (both players)`,
    short: msg({ message: 'Reveal', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'alt+z',
  }),
  action('card.toTool', {
    group: 'card',
    label: msg`Change type to Tool`,
    short: msg({ message: 'Tool', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'alt+t',
  }),
  action('card.toEnergy', {
    group: 'card',
    label: msg`Change type to Energy`,
    short: msg({ message: 'Energy', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'alt+e',
  }),
  action('card.toPokemon', {
    group: 'card',
    label: msg`Change type to Pokémon`,
    short: msg({ message: 'Pokémon', context: 'shortcut key caption' }),
    scope: 'card',
    defaultChord: 'alt+p',
  }),
  action('deck.shuffle', {
    group: 'deck',
    label: msg`Shuffle deck`,
    short: msg({ message: 'Shuffle', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 's',
  }),
  action('deck.draw', {
    group: 'deck',
    label: msg`Draw cards`,
    short: msg({ message: 'Draw', context: 'shortcut key caption' }),
    detail: msg({
      message: '3 draws three',
      comment: 'Pressing the number key 3 draws three cards.',
    }),
    scope: 'table',
    defaultChord: '1',
    digits: true,
    fixed: true,
  }),
  action('deck.viewTop', {
    group: 'deck',
    label: msg`Look at the top cards`,
    short: msg({ message: 'Top', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'alt+1',
    digits: true,
    fixed: true,
  }),
  action('deck.viewBottom', {
    group: 'deck',
    label: msg`Look at the bottom cards`,
    short: msg({ message: 'Bottom', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'ctrl+1',
    digits: true,
    fixed: true,
  }),
  action('deck.view', {
    group: 'deck',
    label: msg`Open your deck`,
    short: msg({ message: 'Deck', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'v',
  }),
  action('hand.discardAndDraw', {
    group: 'hand',
    label: msg`Discard hand`,
    short: msg({ message: 'Discard hand', context: 'shortcut key caption' }),
    detail: msg`Then draw`,
    scope: 'table',
    defaultChord: 'alt+d',
  }),
  action('hand.shuffleAndDraw', {
    group: 'hand',
    label: msg`Shuffle hand into deck`,
    short: msg({ message: 'Hand to deck', context: 'shortcut key caption' }),
    detail: msg`Then draw`,
    scope: 'table',
    defaultChord: 'alt+s',
  }),
  action('hand.shuffleToBottomAndDraw', {
    group: 'hand',
    label: msg`Shuffle hand to bottom of deck`,
    short: msg({ message: 'Hand to bottom', context: 'shortcut key caption' }),
    detail: msg`Then draw`,
    scope: 'table',
    defaultChord: 'alt+arrowdown',
  }),
  action('board.discardAll', {
    group: 'board',
    label: msg`Discard all`,
    short: msg({ message: 'Discard all', context: 'shortcut key caption' }),
    scope: 'any',
    defaultChord: 'enter',
  }),
  action('board.moveAllToHand', {
    group: 'board',
    label: msg`Move all to hand`,
    short: msg({ message: 'All to hand', context: 'shortcut key caption' }),
    scope: 'any',
    defaultChord: 'alt+enter',
  }),
  action('board.shuffleAllIntoDeck', {
    group: 'board',
    label: msg`Shuffle all into deck`,
    short: msg({ message: 'All to deck', context: 'shortcut key caption' }),
    scope: 'any',
    defaultChord: '/',
  }),
  action('table.setup', {
    group: 'table',
    label: msg`Set up`,
    short: msg({ message: 'Set up', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'alt+n',
  }),
  action('table.reset', {
    group: 'table',
    label: msg`Reset`,
    short: msg({ message: 'Reset', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'alt+r',
  }),
  action('table.startTurn', {
    group: 'table',
    label: msg`Start turn`,
    short: msg({ message: 'Turn', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'alt+t',
  }),
  action('table.flipCoin', {
    group: 'table',
    label: msg`Flip coin`,
    short: msg({ message: 'Coin', context: 'shortcut key caption' }),
    scope: 'any',
    defaultChord: 'f',
  }),
  action('table.flipBoard', {
    group: 'table',
    label: msg`Flip the table`,
    short: msg({ message: 'Flip', context: 'shortcut key caption' }),
    scope: 'any',
    defaultChord: 'alt+f',
  }),
  action('table.mulligan', {
    group: 'table',
    label: msg`Announce mulligan`,
    short: msg({ message: 'Mulligan', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'm',
  }),
  action('table.undo', {
    group: 'table',
    label: msg`Undo`,
    short: msg({ message: 'Undo', context: 'shortcut key caption' }),
    scope: 'table',
    defaultChord: 'u',
  }),
  action('table.closePopups', {
    group: 'table',
    label: msg`Close popups`,
    short: msg({ message: 'Close', context: 'shortcut key caption' }),
    scope: 'any',
    defaultChord: 'escape',
    fixed: true,
  }),
  action('table.shortcuts', {
    group: 'table',
    label: msg`Keyboard shortcuts`,
    short: msg({ message: 'Shortcuts', context: 'shortcut key caption' }),
    detail: msg`Opens this list`,
    scope: 'any',
    defaultChord: '?',
  }),
  action('table.commands', {
    group: 'table',
    label: msg`Commands`,
    short: msg({ message: 'Commands', context: 'shortcut key caption' }),
    detail: msg`Search for any action and run it (also Ctrl+K)`,
    scope: 'any',
    defaultChord: '`',
  }),
] as const;

export type HotkeyActionEntry = (typeof HOTKEY_ACTIONS)[number];
export type HotkeyActionId = HotkeyActionEntry['id'];

const ACTIONS_BY_ID: ReadonlyMap<string, HotkeyActionEntry> = new Map(
  HOTKEY_ACTIONS.map((entry) => [entry.id, entry])
);

export const hotkeyAction = (id: HotkeyActionId): HotkeyActionEntry =>
  ACTIONS_BY_ID.get(id)!;

export const isHotkeyActionId = (value: unknown): value is HotkeyActionId =>
  typeof value === 'string' && ACTIONS_BY_ID.has(value);

/** Whether the two can be pressed at the same moment. */
export const scopesOverlap = (left: HotkeyScope, right: HotkeyScope) =>
  left === 'any' || right === 'any' || left === right;

/** Whether a shortcut works while a card is (or is not) selected. */
export const scopeIncludes = (
  scope: HotkeyScope,
  mode: Exclude<HotkeyScope, 'any'>
): boolean => scope === 'any' || scope === mode;
