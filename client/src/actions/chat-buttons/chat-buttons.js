import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { resetAbilityCounters } from '../counters/reset-counters.js';
import { discardBoard } from '../general/board-actions.js';

export const attack = (user, emit = true) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'attack', []);
    return;
  }

  resetAbilityCounters();
  const message = determineUsername(user) + ' attacked';
  appendMessage(user, message, 'player', false);
  discardBoard(user, user, false, false);

  processAction(user, emit, 'attack', []);
};

export const pass = (user, emit = true) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'pass', []);
    return;
  }

  resetAbilityCounters();
  const message = determineUsername(user) + ' passed';
  appendMessage(user, message, 'player', false);
  discardBoard(user, user, false, false);

  processAction(user, emit, 'pass', []);
};
