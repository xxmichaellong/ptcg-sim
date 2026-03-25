import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

export const shufflePrizesToDeckBottom = (
  user,
  initiator,
  indices,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'shufflePrizesToDeckBottom', [
      oInitiator,
      indices,
    ]);
    return;
  }

  const prizeCount = getZone(user, 'prizes').getCount();
  if (prizeCount === 0) return;

  indices = indices ? indices : shuffleIndices(prizeCount);
  shuffleZone(user, initiator, 'prizes', indices, false, false);

  for (let i = 0; i < prizeCount; i++) {
    moveCard(user, initiator, 'prizes', 'deck', 0);
  }

  appendMessage(
    initiator,
    determineUsername(initiator) + ' shuffled prizes to bottom of deck',
    'player',
    false
  );

  processAction(user, emit, 'shufflePrizesToDeckBottom', [oInitiator, indices]);
};
