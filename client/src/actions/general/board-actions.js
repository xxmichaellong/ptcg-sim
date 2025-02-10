import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { shuffleZone } from '../zones/shuffle-zone.js';

export const discardBoard = (user, initiator, message = true, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'discardBoard', [oInitiator, message]);
    return;
  }

  const selectedBoardCount = getZone(user, 'board').getCount();
  if (selectedBoardCount > 0) {
    for (let i = 0; i < selectedBoardCount; i++) {
      moveCard(user, initiator, 'board', 'discard', 0);
    }
    if (message) {
      appendMessage(
        initiator,
        determineUsername(initiator) +
          ' moved ' +
          selectedBoardCount +
          ' card(s) from board to discard',
        'player',
        false
      );
    }
  }

  processAction(user, emit, 'discardBoard', [oInitiator, message]);
};

export const handBoard = (user, initiator, message = true, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'handBoard', [oInitiator, message]);
    return;
  }

  const selectedBoardCount = getZone(user, 'board').getCount();
  if (selectedBoardCount > 0) {
    for (let i = 0; i < selectedBoardCount; i++) {
      moveCard(user, initiator, 'board', 'hand', 0);
    }
    if (message) {
      appendMessage(
        initiator,
        determineUsername(initiator) +
          ' moved ' +
          selectedBoardCount +
          ' card(s) from board to hand',
        'player',
        false
      );
    }
  }

  processAction(user, emit, 'handBoard', [oInitiator, message]);
};

export const shuffleBoard = (
  user,
  initiator,
  message = true,
  indices,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'shuffleBoard', [oInitiator, message, indices]);
    return;
  }

  const selectedBoardCount = getZone(user, 'board').getCount();
  const deck = getZone(user, 'deck');

  if (selectedBoardCount > 0) {
    for (let i = 0; i < selectedBoardCount; i++) {
      moveCard(user, initiator, 'board', 'deck', 0);
    }
    indices = indices ? indices : shuffleIndices(deck.getCount());
    shuffleZone(user, initiator, 'deck', indices, false, false);
    if (message) {
      appendMessage(
        initiator,
        determineUsername(initiator) +
          ' shuffled ' +
          selectedBoardCount +
          ' card(s) from board to deck',
        'player',
        false
      );
    }
  }

  processAction(user, emit, 'shuffleBoard', [oInitiator, message, indices]);
};

export const lostZoneBoard = (user, initiator, message = true, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'lostZoneBoard', [oInitiator, message]);
    return;
  }

  const selectedBoardCount = getZone(user, 'board').getCount();
  if (selectedBoardCount > 0) {
    for (let i = 0; i < selectedBoardCount; i++) {
      moveCard(user, initiator, 'board', 'lostZone', 0);
    }
    if (message) {
      appendMessage(
        initiator,
        determineUsername(initiator) +
          ' moved ' +
          selectedBoardCount +
          ' card(s) from board to lost zone',
        'player',
        false
      );
    }
  }

  processAction(user, emit, 'lostZoneBoard', [oInitiator, message]);
};
