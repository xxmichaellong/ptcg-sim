import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { addAbilityCounter } from './ability-counter.js';

export const useAbility = (user, initiator, zoneId, index, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'useAbility', [oInitiator, zoneId, index]);
    return;
  }

  const cardName = getZone(user, zoneId).array[index].name;
  addAbilityCounter(user, zoneId, index);
  if (zoneId !== 'stadium') {
    appendMessage(
      initiator,
      determineUsername(initiator) + ' used ' + cardName + "'s ability",
      'player',
      false
    );
  } else {
    appendMessage(
      initiator,
      determineUsername(initiator) + ' used ' + cardName,
      'player',
      false
    );
  }

  processAction(user, emit, 'useAbility', [oInitiator, zoneId, index]);
};
