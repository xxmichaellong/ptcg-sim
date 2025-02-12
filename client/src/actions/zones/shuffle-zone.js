import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { rearrangeArray, shuffleIndices } from '../../setup/general/shuffle.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { sort } from './general.js';

export const shuffleZone = (
  user,
  initiator,
  zoneId,
  indices,
  message = true,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'shuffleZone', [
      oInitiator,
      zoneId,
      indices,
      message,
    ]);
    return;
  }

  const zone = getZone(user, zoneId);
  removeImages(zone.element);
  indices = indices ? indices : shuffleIndices(zone.getCount());

  rearrangeArray(zone.array, indices);
  for (let i = 0; i < zone.getCount(); i++) {
    zone.element.appendChild(zone.array[i].image);
  }
  if (zoneId === 'deck') {
    sort(user, zoneId);
  }
  if (message) {
    appendMessage(
      initiator,
      determineUsername(user) + ' shuffled ' + zoneId,
      'player',
      false
    );
  }

  processAction(user, emit, 'shuffleZone', [
    oInitiator,
    zoneId,
    indices,
    message,
  ]);
};
