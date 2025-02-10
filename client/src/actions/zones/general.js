import {
  mouseClick,
  oppContainerDocument,
  selfContainerDocument,
  systemState,
} from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { addAbilityCounter } from '../counters/ability-counter.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

export const shuffleAll = (user, initiator, zoneId, indices, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'shuffleAll', [oInitiator, zoneId, indices]);
    return;
  }

  const zone = getZone(user, zoneId);
  const count = zone.getCount();

  for (let i = 0; i < count; i++) {
    moveCard(user, initiator, zoneId, 'deck', 0);
  }

  const deck = getZone(user, 'deck');
  indices = indices ? indices : shuffleIndices(deck.getCount());
  shuffleZone(user, initiator, 'deck', indices, false, false);

  zone.element.style.display = 'none';

  if (count > 0) {
    let message;
    if (zoneId === 'deck') {
      message = determineUsername(initiator) + ' shuffled deck';
    } else if (zoneId === 'attachedCards') {
      message =
        determineUsername(initiator) +
        ' shuffled ' +
        count +
        ' attached card(s) into deck';
    } else if (zoneId === 'viewCards') {
      message =
        determineUsername(initiator) +
        ' shuffled ' +
        count +
        ' card(s) into deck';
    } else if (zoneId === 'discard') {
      message = determineUsername(initiator) + ' shuffled discard into deck';
    }
    appendMessage(initiator, message, 'player', false);
  }

  processAction(user, emit, 'shuffleAll', [oInitiator, zoneId, indices]);
};

export const shuffleBottom = (
  user,
  initiator,
  zoneId,
  indices,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'shuffleBottom', [oInitiator, zoneId, indices]);
    return;
  }

  const zone = getZone(user, zoneId);
  const count = zone.getCount();
  indices = indices ? indices : shuffleIndices(count);
  shuffleZone(user, initiator, zoneId, indices, false, false);

  for (let i = 0; i < count; i++) {
    moveCard(user, initiator, zoneId, 'deck', 0);
  }

  zone.element.style.display = 'none';

  if (count > 0) {
    const message =
      determineUsername(initiator) +
      ' shuffled ' +
      count +
      ' card(s) to bottom of deck';
    appendMessage(initiator, message, 'player', false);
  }

  processAction(user, emit, 'shuffleBottom', [oInitiator, zoneId, indices]);
};

export const discardAll = (user, initiator, zoneId, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'discardAll', [oInitiator, zoneId]);
    return;
  }

  const zone = getZone(user, zoneId);
  const count = zone.getCount();

  for (let i = 0; i < count; i++) {
    moveCard(user, initiator, zoneId, 'discard', 0);
  }

  zone.element.style.display = 'none';

  if (count > 0) {
    let message;
    if (zoneId === 'attachedCards') {
      message =
        determineUsername(initiator) +
        ' discarded ' +
        count +
        ' attached card(s)';
    } else {
      message =
        determineUsername(initiator) + ' discarded ' + count + ' card(s)';
    }
    appendMessage(initiator, message, 'player', false);
  }

  processAction(user, emit, 'discardAll', [oInitiator, zoneId]);
};

export const lostZoneAll = (user, initiator, zoneId, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'lostZoneAll', [oInitiator, zoneId]);
    return;
  }

  const zone = getZone(user, zoneId);
  const count = zone.getCount();

  for (let i = 0; i < count; i++) {
    moveCard(user, initiator, zoneId, 'lostZone', 0);
  }

  zone.element.style.display = 'none';

  if (count > 0) {
    let message;
    if (zoneId === 'attachedCards') {
      message =
        determineUsername(initiator) +
        ' lost-zoned ' +
        count +
        ' attached card(s)';
    } else {
      message =
        determineUsername(initiator) + ' lost-zoned ' + count + ' card(s)';
    }
    appendMessage(initiator, message, 'player', false);
  }

  processAction(user, emit, 'lostZoneAll', [oInitiator, zoneId]);
};

export const handAll = (user, initiator, zoneId, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'handAll', [oInitiator, zoneId]);
    return;
  }

  const zone = getZone(user, zoneId);
  const count = zone.getCount();

  for (let i = 0; i < count; i++) {
    moveCard(user, initiator, zoneId, 'hand', 0);
  }
  zone.element.style.display = 'none';

  if (count > 0) {
    let message;
    if (zoneId === 'attachedCards') {
      message =
        determineUsername(initiator) +
        ' put ' +
        count +
        ' attached card(s) into hand';
    } else {
      message =
        determineUsername(initiator) + ' put ' + count + ' card(s) into hand';
    }
    appendMessage(initiator, message, 'player', false);
  }

  processAction(user, emit, 'handAll', [oInitiator, zoneId]);
};

export const closeDisplay = (user, zoneId) => {
  const zone = getZone(user, zoneId);
  zone.element.style.display = 'none';
};

export const leaveAll = (user, initiator, oZoneId, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'leaveAll', [oInitiator, oZoneId]);
    return;
  }

  const oZone = getZone(user, oZoneId);
  const dZoneId = mouseClick.isActiveZone ? 'active' : 'bench';
  const dZone = getZone(user, dZoneId);

  if (oZone.getCount() > 0) {
    const message =
      determineUsername(initiator) +
      ' left ' +
      oZone.getCount() +
      ' attached card(s) in play';
    appendMessage(initiator, message, 'player', false);
  }

  let targetImage;
  const oZoneCount1 = oZone.getCount() - 1;
  for (let i = oZoneCount1; i >= 0; i--) {
    if (oZone.array[i].type === 'Pokémon') {
      targetImage = oZone.array[i].image;
      moveCard(user, initiator, oZoneId, dZoneId, i);
      break;
    }
  }
  const oZoneCount2 = oZone.getCount() - 1;
  for (let i = oZoneCount2; i >= 0; i--) {
    if (oZone.array[i].type === 'Pokémon') {
      const targetIndex = dZone.array.findIndex(
        (card) => card.image === targetImage
      );
      targetImage = oZone.array[i].image;
      moveCard(user, initiator, oZoneId, dZoneId, i, targetIndex);
    }
  }
  const oZoneCount3 = oZone.getCount();
  for (let i = 0; i < oZoneCount3; i++) {
    const targetIndex = dZone.array.findIndex(
      (card) => card.image === targetImage
    );
    moveCard(user, initiator, oZoneId, dZoneId, 0, targetIndex);
  }
  oZone.element.style.display = 'none';

  processAction(user, emit, 'leaveAll', [oInitiator, oZoneId]);
};

export const sort = (user, zoneId) => {
  const selfCheckboxMap = {
    hand: selfContainerDocument.getElementById('sortHandCheckbox'),
    deck: selfContainerDocument.getElementById('sortDeckCheckbox'),
    discard: selfContainerDocument.getElementById('sortDiscardCheckbox'),
    lostZone: selfContainerDocument.getElementById('sortLostZoneCheckbox'),
  };
  const oppCheckboxMap = {
    hand: oppContainerDocument.getElementById('sortHandCheckbox'),
    deck: oppContainerDocument.getElementById('sortDeckCheckbox'),
    discard: oppContainerDocument.getElementById('sortDiscardCheckbox'),
    lostZone: oppContainerDocument.getElementById('sortLostZoneCheckbox'),
  };

  const checkbox =
    user === 'self' ? selfCheckboxMap[zoneId] : oppCheckboxMap[zoneId];
  const deckData = determineDeckData(user);
  const zone = getZone(user, zoneId);

  removeImages(zone.element);

  if (checkbox.checked && deckData) {
    deckData.forEach((entry) => {
      const name = entry[1];
      zone.array.forEach((card) => {
        if (card.name === name) {
          // eslint-disable-next-line no-self-assign
          card.image.src = card.image.src; // redraw trick as insurance
          zone.element.appendChild(card.image);
          if (card.image.abilityCounter) {
            const index = zone.array.findIndex(
              (selectedCard) => selectedCard === card
            );
            addAbilityCounter(user, zoneId, index);
          }
        }
      });
    });
  } else {
    zone.array.forEach((card) => {
      // eslint-disable-next-line no-self-assign
      card.image.src = card.image.src; // redraw trick as insurance
      zone.element.appendChild(card.image);
      if (card.image.abilityCounter) {
        const index = zone.array.findIndex(
          (selectedCard) => selectedCard === card
        );
        addAbilityCounter(user, zoneId, index);
      }
    });
  }
};
