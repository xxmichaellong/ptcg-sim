import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * The controls a lesson names, as the controls themselves are labelled:
 * the same messages (and contexts), so a lesson says the word the player
 * sees on the button, in every language.
 */
export const CONTROL_LABELS = {
  actions: msg({ message: 'Actions', context: "a card's actions" }),
  attack: msg({ message: 'Attack', context: 'declare an attack' }),
  commands: msg({ message: 'Commands', context: 'the command palette' }),
  flip: msg({ message: 'Flip', context: 'turn the table around' }),
  keyboardShortcuts: msg`Keyboard shortcuts`,
  log: msg`Log`,
  more: msg({ message: 'More', context: 'more actions' }),
  pass: msg({ message: 'Pass', context: 'end the turn' }),
  playOnline: msg`Play online`,
  read: msg({ message: 'Read', context: 'read a card up close' }),
  setUp: msg({ message: 'Set up', context: 'set up the game' }),
  setUpAgain: msg`Set up again`,
  settings: msg`Settings`,
  shuffle: msg({ message: 'Shuffle', context: 'shuffle the deck' }),
  specialCondition: msg`Special condition`,
  turn: msg({ message: 'Turn', context: 'start the turn' }),
  undo: msg`Undo`,
} as const;

export type ControlLabel = keyof typeof CONTROL_LABELS;

/** A control's own label, in the player's language. */
export const controlLabel = (control: ControlLabel): string =>
  i18n._(CONTROL_LABELS[control]);
