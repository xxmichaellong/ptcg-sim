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

export type HotkeyScope = 'card' | 'table' | 'any';

export type HotkeyGroupId =
  'move' | 'card' | 'deck' | 'hand' | 'board' | 'table';

export interface HotkeyGroup {
  readonly id: HotkeyGroupId;
  readonly title: string;
}

/** Reading order, as v1's reference grouped them. */
export const HOTKEY_GROUPS: readonly HotkeyGroup[] = [
  { id: 'move', title: 'Move the selected card' },
  { id: 'card', title: 'Selected card' },
  { id: 'deck', title: 'Deck' },
  { id: 'hand', title: 'Hand' },
  { id: 'board', title: 'Your board' },
  { id: 'table', title: 'Table' },
];

export interface HotkeyAction {
  readonly id: string;
  readonly group: HotkeyGroupId;
  readonly label: string;
  /** A word or two for the key itself on the keyboard map. */
  readonly short: string;
  readonly detail?: string;
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
    label: 'To hand',
    short: 'Hand',
    scope: 'card',
    defaultChord: 'h',
  }),
  action('card.toDiscard', {
    group: 'move',
    label: 'To discard',
    short: 'Discard',
    scope: 'card',
    defaultChord: 'd',
  }),
  action('card.toBench', {
    group: 'move',
    label: 'To bench',
    short: 'Bench',
    scope: 'card',
    defaultChord: 'b',
  }),
  action('card.toActive', {
    group: 'move',
    label: 'To active',
    short: 'Active',
    scope: 'card',
    defaultChord: 'a',
  }),
  action('card.toStadium', {
    group: 'move',
    label: 'To stadium',
    short: 'Stadium',
    detail: 'Joins matching pieces',
    scope: 'card',
    defaultChord: 'g',
  }),
  action('card.addStadiumPiece', {
    group: 'move',
    label: 'Add another stadium piece',
    short: '+ Stadium',
    scope: 'card',
    defaultChord: 'shift+g',
  }),
  action('card.toLostZone', {
    group: 'move',
    label: 'To Lost Zone',
    short: 'Lost Zone',
    scope: 'card',
    defaultChord: 'l',
  }),
  action('card.toPrizes', {
    group: 'move',
    label: 'To prizes',
    short: 'Prize',
    scope: 'card',
    defaultChord: 'p',
  }),
  action('card.toBoard', {
    group: 'move',
    label: 'To board',
    short: 'Board',
    scope: 'card',
    defaultChord: 'space',
  }),
  action('card.toDeckTop', {
    group: 'move',
    label: 'To top of deck',
    short: 'Deck top',
    scope: 'card',
    defaultChord: 'arrowup',
  }),
  action('card.toDeckBottom', {
    group: 'move',
    label: 'To bottom of deck',
    short: 'Deck bottom',
    scope: 'card',
    defaultChord: 'arrowdown',
  }),
  action('card.swapWithDeckTop', {
    group: 'move',
    label: 'Switch with top of deck',
    short: 'Switch',
    scope: 'card',
    defaultChord: 'arrowright',
  }),
  action('card.shuffleIntoDeck', {
    group: 'move',
    label: 'Shuffle into deck',
    short: 'Shuffle in',
    scope: 'card',
    defaultChord: 's',
  }),
  action('card.attach', {
    group: 'card',
    label: 'Attach',
    short: 'Attach',
    scope: 'card',
    defaultChord: 'q',
  }),
  action('card.evolve', {
    group: 'card',
    label: 'Evolve',
    short: 'Evolve',
    scope: 'card',
    defaultChord: 'e',
  }),
  action('card.view', {
    group: 'card',
    label: 'View card',
    short: 'View',
    detail: 'Press twice for a card in play',
    scope: 'card',
    defaultChord: 'v',
  }),
  action('card.toggleAbility', {
    group: 'card',
    label: 'Toggle ability used',
    short: 'Ability',
    scope: 'card',
    defaultChord: 'w',
  }),
  action('card.addDamage', {
    group: 'card',
    label: 'Add damage',
    short: '+ Damage',
    detail: '1 adds 10, 9 adds 90',
    scope: 'card',
    defaultChord: '1',
    digits: true,
    fixed: true,
  }),
  action('card.removeDamage', {
    group: 'card',
    label: 'Take off damage',
    short: '− Damage',
    scope: 'card',
    defaultChord: 'alt+1',
    digits: true,
    fixed: true,
  }),
  action('card.clearDamage', {
    group: 'card',
    label: 'Clear damage',
    short: 'Clear',
    scope: 'card',
    defaultChord: '0',
    fixed: true,
  }),
  action('card.addCondition', {
    group: 'card',
    label: 'Add or switch special condition',
    short: 'Status',
    scope: 'card',
    defaultChord: 'y',
  }),
  action('card.removeCondition', {
    group: 'card',
    label: 'Remove special condition',
    short: '− Status',
    scope: 'card',
    defaultChord: 'alt+y',
  }),
  action('card.rotate', {
    group: 'card',
    label: 'Rotate card(s)',
    short: 'Rotate',
    scope: 'card',
    defaultChord: 'r',
  }),
  action('card.rotateSingle', {
    group: 'card',
    label: 'Rotate BREAK',
    short: 'BREAK',
    detail: 'Turns only the selected card',
    scope: 'card',
    defaultChord: 'alt+r',
  }),
  action('card.lookCover', {
    group: 'card',
    label: 'Look at or cover (only you)',
    short: 'Look',
    scope: 'card',
    defaultChord: 'c',
  }),
  action('card.hide', {
    group: 'card',
    label: 'Turn face down (both players)',
    short: 'Hide',
    detail: 'Then press To active to play it face down',
    scope: 'card',
    defaultChord: 'z',
  }),
  action('card.reveal', {
    group: 'card',
    label: 'Reveal (both players)',
    short: 'Reveal',
    scope: 'card',
    defaultChord: 'alt+z',
  }),
  action('card.toTool', {
    group: 'card',
    label: 'Change type to Tool',
    short: 'Tool',
    scope: 'card',
    defaultChord: 'alt+t',
  }),
  action('card.toEnergy', {
    group: 'card',
    label: 'Change type to Energy',
    short: 'Energy',
    scope: 'card',
    defaultChord: 'alt+e',
  }),
  action('card.toPokemon', {
    group: 'card',
    label: 'Change type to Pokémon',
    short: 'Pokémon',
    scope: 'card',
    defaultChord: 'alt+p',
  }),
  action('deck.shuffle', {
    group: 'deck',
    label: 'Shuffle deck',
    short: 'Shuffle',
    scope: 'table',
    defaultChord: 's',
  }),
  action('deck.draw', {
    group: 'deck',
    label: 'Draw cards',
    short: 'Draw',
    detail: '3 draws three',
    scope: 'table',
    defaultChord: '1',
    digits: true,
    fixed: true,
  }),
  action('deck.viewTop', {
    group: 'deck',
    label: 'Look at the top cards',
    short: 'Top',
    scope: 'table',
    defaultChord: 'alt+1',
    digits: true,
    fixed: true,
  }),
  action('deck.viewBottom', {
    group: 'deck',
    label: 'Look at the bottom cards',
    short: 'Bottom',
    scope: 'table',
    defaultChord: 'ctrl+1',
    digits: true,
    fixed: true,
  }),
  action('deck.view', {
    group: 'deck',
    label: 'Open your deck',
    short: 'Deck',
    scope: 'table',
    defaultChord: 'v',
  }),
  action('hand.discardAndDraw', {
    group: 'hand',
    label: 'Discard hand',
    short: 'Discard hand',
    detail: 'Then draw',
    scope: 'table',
    defaultChord: 'alt+d',
  }),
  action('hand.shuffleAndDraw', {
    group: 'hand',
    label: 'Shuffle hand into deck',
    short: 'Hand to deck',
    detail: 'Then draw',
    scope: 'table',
    defaultChord: 'alt+s',
  }),
  action('hand.shuffleToBottomAndDraw', {
    group: 'hand',
    label: 'Shuffle hand to bottom of deck',
    short: 'Hand to bottom',
    detail: 'Then draw',
    scope: 'table',
    defaultChord: 'alt+arrowdown',
  }),
  action('board.discardAll', {
    group: 'board',
    label: 'Discard all',
    short: 'Discard all',
    scope: 'any',
    defaultChord: 'enter',
  }),
  action('board.moveAllToHand', {
    group: 'board',
    label: 'Move all to hand',
    short: 'All to hand',
    scope: 'any',
    defaultChord: 'alt+enter',
  }),
  action('board.shuffleAllIntoDeck', {
    group: 'board',
    label: 'Shuffle all into deck',
    short: 'All to deck',
    scope: 'any',
    defaultChord: '/',
  }),
  action('table.setup', {
    group: 'table',
    label: 'Set up',
    short: 'Set up',
    scope: 'table',
    defaultChord: 'alt+n',
  }),
  action('table.reset', {
    group: 'table',
    label: 'Reset',
    short: 'Reset',
    scope: 'table',
    defaultChord: 'alt+r',
  }),
  action('table.startTurn', {
    group: 'table',
    label: 'Start turn',
    short: 'Turn',
    scope: 'table',
    defaultChord: 'alt+t',
  }),
  action('table.flipCoin', {
    group: 'table',
    label: 'Flip coin',
    short: 'Coin',
    scope: 'any',
    defaultChord: 'f',
  }),
  action('table.flipBoard', {
    group: 'table',
    label: 'Flip the table',
    short: 'Flip',
    scope: 'any',
    defaultChord: 'alt+f',
  }),
  action('table.mulligan', {
    group: 'table',
    label: 'Announce mulligan',
    short: 'Mulligan',
    scope: 'table',
    defaultChord: 'm',
  }),
  action('table.undo', {
    group: 'table',
    label: 'Undo',
    short: 'Undo',
    scope: 'table',
    defaultChord: 'u',
  }),
  action('table.refreshImages', {
    group: 'table',
    label: 'Reload card images',
    short: 'Reload images',
    scope: 'table',
    defaultChord: 'r',
  }),
  action('table.closePopups', {
    group: 'table',
    label: 'Close popups',
    short: 'Close',
    scope: 'any',
    defaultChord: 'escape',
    fixed: true,
  }),
  action('table.shortcuts', {
    group: 'table',
    label: 'Keyboard shortcuts',
    short: 'Shortcuts',
    detail: 'Opens this list',
    scope: 'any',
    defaultChord: '?',
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
