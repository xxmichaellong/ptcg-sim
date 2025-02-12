import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { drawHand } from '../zones/hand-actions.js';
import { shuffleZone } from '../zones/shuffle-zone.js';
import { reset } from './reset.js';

export const setup = (user, indices, emit = true) => {
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'setup', [indices]);
    return;
  }
  reset(user, true, true, true, false);
  const deck = getZone(user, 'deck');
  indices = indices ? indices : shuffleIndices(deck.getCount());
  if (determineDeckData(user)) {
    shuffleZone(user, user, 'deck', indices, false, false);
    drawHand(user, user);
    appendMessage(
      user,
      determineUsername(user) + ' drew starting hand and set prizes',
      'player',
      false
    );
  }
  processAction(user, emit, 'setup', [indices]);
};
