import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { hideCard } from '../general/reveal-and-hide.js';
import { moveCardBundle } from '../move-card-bundle/move-card-bundle.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

export const shuffleIntoDeck = (
  user,
  initiator,
  zoneId,
  index,
  indices,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'shuffleIntoDeck', [
      oInitiator,
      zoneId,
      index,
      indices,
    ]);
    return;
  }

  moveCardBundle(
    user,
    initiator,
    zoneId,
    'deck',
    index,
    false,
    'shuffle',
    false
  );
  const deck = getZone(user, 'deck');
  indices = indices ? indices : shuffleIndices(deck.getCount());
  shuffleZone(user, initiator, 'deck', indices, false, false);

  processAction(user, emit, 'shuffleIntoDeck', [
    oInitiator,
    zoneId,
    index,
    indices,
  ]);
};

export const moveToDeckTop = (user, initiator, oZoneId, index, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'moveToDeckTop', [oInitiator, oZoneId, index]);
    return;
  }
  moveCardBundle(user, initiator, oZoneId, 'deck', index, false, 'top', false);
  //since card is appended to bottom, move all existing cards in deck to the bottom afterwards
  const selectedDeckCount = getZone(user, 'deck').getCount();
  for (let i = 0; i < selectedDeckCount - 1; i++) {
    moveCard(user, initiator, 'deck', 'deck', 0);
  }

  processAction(user, emit, 'moveToDeckTop', [oInitiator, oZoneId, index]);
};

export const moveToDeckBottom = (user, initiator, oZoneId, index) => {
  moveCardBundle(user, initiator, oZoneId, 'deck', index, false, 'bottom');
};

export const moveToBoard = (user, initiator, oZoneId, index) => {
  moveCardBundle(user, initiator, oZoneId, 'board', index, false, 'move');
};

export const draw = (user, initiator, drawAmount, emit = true) => {
  drawAmount = drawAmount
    ? drawAmount
    : parseInt(window.prompt('Draw how many cards?', '1'));
  const selectedDeckCount = getZone(user, 'deck').getCount();
  drawAmount = Math.min(drawAmount, selectedDeckCount);

  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'draw', [oInitiator, drawAmount]);
    return;
  }

  if (!isNaN(drawAmount) && drawAmount > 0) {
    for (let i = 0; i < drawAmount; i++) {
      moveCard(user, initiator, 'deck', 'hand', 0);
    }
    let message;
    if (drawAmount > 1) {
      message = determineUsername(initiator) + ' drew ' + drawAmount + ' cards';
    } else {
      message = determineUsername(initiator) + ' drew a card';
    }
    appendMessage(initiator, message, 'player', false);
  } else {
    window.alert('Please enter a valid number for the draw amount.');
    emit = false;
  }

  processAction(user, emit, 'draw', [oInitiator, drawAmount]);
};

export const handleViewButtonClick = (user, initiator, top) => {
  const targetIsOpp = user !== initiator;

  let viewAmount;
  const userInput = window.prompt(
    'How many cards do you want to look at?',
    '1'
  );
  viewAmount = parseInt(userInput);
  const selectedDeckCount = getZone(user, 'deck').getCount();

  viewAmount = Math.min(viewAmount, selectedDeckCount);
  if (!isNaN(viewAmount) && viewAmount >= 1) {
    viewDeck(user, initiator, viewAmount, top, selectedDeckCount, targetIsOpp);
  } else {
    window.alert('Please enter a valid number for the view amount.');
  }
};

export const viewDeck = (
  user,
  initiator,
  viewAmount,
  top,
  selectedDeckCount,
  targetIsOpp,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'viewDeck', [
      oInitiator,
      viewAmount,
      top,
      selectedDeckCount,
      targetIsOpp,
    ]);
    return;
  }

  const selectedViewCards = getZone(user, 'viewCards');
  selectedViewCards.element.style.display = 'block';

  if (top) {
    for (let i = 0; i < viewAmount; i++) {
      moveCard(user, initiator, 'deck', 'viewCards', 0);
    }
  } else {
    for (
      let i = selectedDeckCount - 1;
      i > selectedDeckCount - 1 - viewAmount;
      i--
    ) {
      moveCard(user, initiator, 'deck', 'viewCards', i);
    }
  }
  if (
    (systemState.initiator !== user && !targetIsOpp) ||
    (systemState.initiator === user && targetIsOpp)
  ) {
    const zone = getZone(user, 'viewCards');
    removeImages(zone.element);
    zone.array.forEach((card) => {
      hideCard(user, card);
      zone.element.appendChild(card.image);
    });
  }

  const location = top ? 'top ' : 'bottom ';
  const owner = user === initiator ? '' : "opponent's";
  const message =
    determineUsername(initiator) +
    ' looked at ' +
    location +
    viewAmount +
    ' card(s) of ' +
    owner +
    ' deck';
  appendMessage(initiator, message, 'player', false);

  processAction(user, emit, 'viewDeck', [
    oInitiator,
    viewAmount,
    top,
    selectedDeckCount,
    targetIsOpp,
  ]);
};

export const switchWithDeckTop = (
  user,
  initiator,
  oZoneId,
  index,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'switchWithDeckTop', [
      oInitiator,
      oZoneId,
      index,
    ]);
    return;
  }

  if (oZoneId !== 'deck' && oZoneId !== 'deckCover') {
    moveCardBundle(
      user,
      initiator,
      oZoneId,
      'deck',
      index,
      false,
      'switch',
      false
    ); //first part is moving a card to the top of the deck
    const initialDeckCount = getZone(user, 'deck').getCount();
    for (let i = 0; i < initialDeckCount - 1; i++) {
      moveCard(user, initiator, 'deck', 'deck', 0);
    }
    const selectedDeckCount = getZone(user, 'deck').getCount();
    if (selectedDeckCount > 1) {
      moveCard(user, initiator, 'deck', oZoneId, 1);
    }

    processAction(user, emit, 'switchWithDeckTop', [
      oInitiator,
      oZoneId,
      index,
    ]);
  }
};
