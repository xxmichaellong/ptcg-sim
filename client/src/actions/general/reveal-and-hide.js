import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { showPopup } from '../../setup/general/pop-up-message.js';
import { processAction } from '../../setup/general/process-action.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { convertZoneName } from '../move-card-bundle/move-card-message.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { sort } from '../zones/general.js';
import { deselectCard } from './close-popups.js';

const toggleCard = (card, targetCardBackSrc) => {
  if (card.image.src !== targetCardBackSrc) {
    card.image.src2 = card.image.src;
    card.image.src = targetCardBackSrc;
    card.image.alt2 = card.image.alt;
    card.image.alt = 'Card back';
  } else {
    card.image.src = card.image.src2;
    card.image.alt = card.image.alt2;
  }
};

export const hideCard = (user, card) => {
  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;

  if (card.image.src !== targetCardBackSrc) {
    toggleCard(card, targetCardBackSrc);
  }
};

export const revealCard = (user, card) => {
  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;

  if (card.image.src === targetCardBackSrc) {
    toggleCard(card, targetCardBackSrc);
  }
};

export const lookAtCards = (
  user,
  initiator,
  zoneId,
  message = true,
  emit = true
) => {
  if (emit) {
    const zone = getZone(user, zoneId);
    removeImages(zone.element);
    zone.array.forEach((card) => {
      revealCard(user, card);
      zone.element.appendChild(card.image);
    });
    if (zoneId === 'hand') {
      sort(user, zoneId);
    }
  }
  if (message) {
    appendMessage(
      initiator,
      determineUsername(initiator) +
        ' looked at ' +
        determineUsername(user) +
        "'s " +
        zoneId,
      'player',
      false
    );
  }

  if (systemState.isTwoPlayer && emit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      message: message,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('lookAtCards', data);
  }
};

export const stopLookingAtCards = (
  user,
  initiator,
  zoneId,
  message = true,
  emit = true
) => {
  if (emit) {
    const zone = getZone(user, zoneId);
    removeImages(zone.element);
    zone.array.forEach((card) => {
      hideCard(user, card);
      zone.element.appendChild(card.image);
    });
    if (zoneId === 'hand') {
      sort(user, zoneId);
    }
  }
  if (message) {
    appendMessage(
      initiator,
      determineUsername(initiator) +
        ' stopped looking at ' +
        determineUsername(user) +
        "'s " +
        zoneId,
      'player',
      false
    );
  }

  if (systemState.isTwoPlayer && emit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      message: message,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('stopLookingAtCards', data);
  }
};

export const revealCards = (user, initiator, zoneId, emit = true) => {
  const prizesCount = getZone(user, 'prizes').getCount();
  for (let i = 0; i < prizesCount; i++) {
    revealShortcut(user, initiator, zoneId, i, false, false);
  }
  appendMessage(
    initiator,
    determineUsername(initiator) +
      ' revealed ' +
      determineUsername(user) +
      "'s " +
      zoneId,
    'player',
    false
  );

  if (systemState.isTwoPlayer && emit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('revealCards', data);
  }
};

export const hideCards = (user, initiator, zoneId, emit = true) => {
  const prizesCount = getZone(user, 'prizes').getCount();
  for (let i = 0; i < prizesCount; i++) {
    hideShortcut(user, initiator, zoneId, i, false, false);
  }
  appendMessage(
    initiator,
    determineUsername(initiator) +
      ' hid ' +
      determineUsername(user) +
      "'s " +
      zoneId,
    'player',
    false
  );

  if (systemState.isTwoPlayer && emit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('hideCards', data);
  }
};

export const revealShortcut = (
  user,
  initiator,
  zoneId,
  index,
  message = true,
  emit = true
) => {
  const zone = getZone(user, zoneId);
  const card = zone.array[index];
  card.image.faceDown = false;
  card.image.public = true;

  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;
  if (card.image.src === targetCardBackSrc) {
    toggleCard(card, targetCardBackSrc);
  }
  if (message) {
    appendMessage(
      initiator,
      determineUsername(initiator) +
        ' revealed ' +
        card.name +
        ' in ' +
        determineUsername(card.image.user) +
        "'s " +
        convertZoneName(zoneId),
      'player',
      false
    );
  }
  const oUser = user === 'self' ? 'opp' : 'self';
  if (systemState.isTwoPlayer && emit) {
    const oInitiator = initiator === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: oInitiator,
      user: oUser,
      zoneId: zoneId,
      index: index,
      message: message,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('revealShortcut', data);
  }

  //deal with case when revealing a card in your own hand
  if (
    systemState.isTwoPlayer &&
    emit &&
    zoneId === 'hand' &&
    initiator === card.image.user
  ) {
    deselectCard();
    showPopup('Press OK to stop revealing card to opponent', () => {
      const data = {
        roomId: systemState.roomId,
        initiator: user, //initiator is going to be the opposite of the person who revealed the cards, so if user === 'self', then the initiator from opponent's pov will be themselves, so 'self'
        user: oUser,
        zoneId: zoneId,
        index: index,
        emit: true,
      };
      socket.emit('stopLookingShortcut', data);
    });
  }
};

export const hideShortcut = (
  user,
  initiator,
  zoneId,
  index,
  message = true,
  emit = true
) => {
  const zone = getZone(user, zoneId);
  const card = zone.array[index];

  card.image.public = false;

  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;
  if (card.image.src !== targetCardBackSrc) {
    toggleCard(card, targetCardBackSrc);
  }
  const appendMessageEmit = zoneId === 'hand' && initiator !== user;
  if (message) {
    appendMessage(
      initiator,
      determineUsername(initiator) +
        ' hid card in ' +
        determineUsername(user) +
        "'s " +
        convertZoneName(zoneId),
      'player',
      appendMessageEmit
    );
  }
  //deal with handling faceDown card locations
  if (
    zoneId !== 'prizes' &&
    !(zoneId === 'hand' && initiator !== user && systemState.isTwoPlayer)
  ) {
    card.image.faceDown = true;
  }
  if (systemState.isTwoPlayer && emit && !appendMessageEmit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      index: index,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('hideShortcut', data);
  }
};

export const lookShortcut = (user, initiator, zoneId, index, emit = true) => {
  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;

  if (emit) {
    //only apply for initiator
    const zone = getZone(user, zoneId);
    const card = zone.array[index];
    toggleCard(card, targetCardBackSrc);
  }
  appendMessage(
    initiator,
    determineUsername(initiator) +
      ' looked at card in ' +
      determineUsername(user) +
      "'s " +
      zoneId,
    'player',
    false
  );

  if (systemState.isTwoPlayer && emit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      index: index,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('lookShortcut', data);
  }
};

export const stopLookingShortcut = (
  user,
  initiator,
  zoneId,
  index,
  emit = true
) => {
  const targetCardBackSrc =
    user === 'self'
      ? systemState.cardBackSrc
      : systemState.isTwoPlayer
        ? systemState.p2OppCardBackSrc
        : systemState.p1OppCardBackSrc;

  if (emit) {
    //only apply for initiator
    const zone = getZone(user, zoneId);
    const card = zone.array[index];
    toggleCard(card, targetCardBackSrc);
  }
  appendMessage(
    initiator,
    determineUsername(initiator) +
      ' stopped looking at card in ' +
      determineUsername(user) +
      "'s " +
      zoneId,
    'player',
    false
  );

  if (systemState.isTwoPlayer && emit) {
    initiator = initiator === 'self' ? 'opp' : 'self';
    user = user === 'self' ? 'opp' : 'self';
    const data = {
      roomId: systemState.roomId,
      initiator: initiator,
      user: user,
      zoneId: zoneId,
      index: index,
      emit: false,
      socketId: socket.id,
    };
    socket.emit('stopLookingShortcut', data);
  }
};

export const playRandomCardFaceDown = (
  user,
  initiator,
  randomIndex,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'playRandomCardFaceDown', [
      oInitiator,
      randomIndex,
    ]);
    return;
  }

  const hand = getZone(user, 'hand');
  randomIndex =
    typeof randomIndex === 'number'
      ? randomIndex
      : Math.floor(Math.random() * hand.getCount());
  hand.array[randomIndex].image.faceDown = true;
  hideShortcut(user, initiator, 'hand', randomIndex, false, false);
  moveCard(user, initiator, 'hand', 'board', randomIndex);
  appendMessage(
    initiator,
    determineUsername(initiator) +
      ' moved a random card from ' +
      determineUsername(user) +
      "'s hand to board",
    'player',
    false
  );

  processAction(user, emit, 'playRandomCardFaceDown', [
    oInitiator,
    randomIndex,
  ]);
};
