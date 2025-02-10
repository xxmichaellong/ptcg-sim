import { systemState } from '../../front-end.js';

const allowedDuringReplay = {
  action: [
    'changeCardBack',
    'viewDeck',
    'lookAtCards',
    'stopLookingAtCards',
    'revealCards',
    'hideCards',
    'revealShortcut',
    'hideShortcut',
    'lookShortcut',
    'stopLookingShortcut',
  ],
  keybind: [
    'v',
    'KeyV',
    'c',
    'KeyC',
    'z',
    'KeyZ',
    'r',
    'KeyR',
    'f',
    'KeyF',
    'esc',
    'Escape',
    'Shift',
    'ShiftLeft',
    'ShiftRight',
  ],
  contextMenu: [
    'lookPrizesButton',
    'revealHidePrizesButton',
    'lookHandButton',
    'prizesHeader',
    'handHeader',
    'deckHeader',
    'boardHeader',
  ],
};

export const isBlockedByReplay = (type, value, isFromReplay = false) => {
  return (
    systemState.isReplay &&
    !systemState.isTwoPlayer &&
    !isFromReplay &&
    !allowedDuringReplay[type].includes(value)
  );
};
