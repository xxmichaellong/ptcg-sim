import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { getZone } from '../../setup/zones/get-zone.js';

export const convertZoneName = (zoneId) => {
  zoneId = zoneId.replace('Cover', '');
  const specialCases = {
    viewCards: 'deck',
    lostZone: 'lost zone',
    attachedCards: 'attached cards',
  };
  return specialCases[zoneId] || zoneId;
};

export const moveCardMessage = (
  user,
  initiator,
  oZoneId,
  dZoneId,
  index,
  targetIndex,
  action
) => {
  let targetCard;
  if (typeof targetIndex === 'number') {
    targetCard = getZone(user, dZoneId).array[targetIndex];
  }
  const movingCard = getZone(user, oZoneId).array[index];

  let oLocationName = convertZoneName(oZoneId);
  let mLocationName = convertZoneName(dZoneId);

  if (
    targetCard &&
    (!['active', 'bench'].includes(oLocationName) || movingCard.image.attached)
  ) {
    mLocationName = targetCard.name;
    if (
      !['active', 'bench'].includes(oLocationName) &&
      movingCard.type !== 'Pokémon'
    ) {
      action = 'attach';
    } else if (!['active', 'bench'].includes(oLocationName)) {
      action = 'evolve';
    }
  }

  const hiddenCardZones = [
    ['hand', 'deck'],
    ['deck', 'hand'],
    ['prizes', 'hand'],
    ['hand', 'prizes'],
    ['deck', 'prizes'],
    ['prizes', 'deck'],
    ['prizes', 'prizes'],
    ['deck', 'deck'],
    ['hand', 'hand'],
  ];

  let cardName;
  if (
    (!movingCard.image.public &&
      hiddenCardZones.some(
        (pair) => pair[0] === oLocationName && pair[1] === mLocationName
      )) ||
    movingCard.image.faceDown
  ) {
    cardName = 'card';
  } else {
    cardName = movingCard.name;
  }
  if (movingCard.image.attached) {
    const relativeCard = getZone(user, oZoneId).array.find(
      (card) => card.image === movingCard.image.relative
    );
    oLocationName = relativeCard.name;
  }
  let message;
  if (action === 'move') {
    message =
      determineUsername(initiator) +
      ' moved ' +
      cardName +
      ' from ' +
      oLocationName +
      ' to ' +
      mLocationName;
  } else if (action === 'shuffle') {
    message =
      determineUsername(initiator) +
      ' shuffled ' +
      cardName +
      ' from ' +
      oLocationName +
      ' into deck';
  } else if (action === 'top') {
    message =
      determineUsername(initiator) +
      ' moved ' +
      cardName +
      ' from ' +
      oLocationName +
      ' to top of deck';
  } else if (action === 'bottom') {
    message =
      determineUsername(initiator) +
      ' moved ' +
      cardName +
      ' from ' +
      oLocationName +
      ' to bottom of deck';
  } else if (action === 'switch') {
    message =
      determineUsername(initiator) +
      ' switched ' +
      cardName +
      ' from ' +
      oLocationName +
      ' with top of deck';
  } else if (action === 'attach') {
    message =
      determineUsername(initiator) +
      ' attached ' +
      cardName +
      ' from ' +
      oLocationName +
      ' to ' +
      mLocationName;
  } else if (action === 'evolve') {
    message =
      determineUsername(initiator) +
      ' evolved ' +
      mLocationName +
      ' into ' +
      cardName;
  }
  appendMessage(initiator, message, 'player', false);
};
