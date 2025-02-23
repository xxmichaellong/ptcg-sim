import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { moveCard } from '../move-card-bundle/move-card.js';

export const changeType = (
  user,
  initiator,
  zoneId,
  index,
  type,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'changeType', [oInitiator, zoneId, index, type]);
    return;
  }

  const zone = getZone(user, zoneId);
  const card = zone.array[index];

  if (!card.type2) {
    card.type2 = card.type;
  }
  card.type = type;

  const cardName = card.image.faceDown ? 'card' : card.name;
  let typeName;
  if (type === 'Trainer') {
    typeName = 'a tool';
  } else if (type === 'Energy') {
    typeName = 'an energy';
  } else if (type === 'Pokémon') {
    typeName = 'a Pokémon';
  }
  appendMessage(
    initiator,
    determineUsername(initiator) +
      ' changed ' +
      cardName +
      ' into ' +
      typeName,
    'player',
    false
  );
  moveCard(user, initiator, zoneId, 'board', index);

  processAction(user, emit, 'changeType', [oInitiator, zoneId, index, type]);
};
