import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { showPopup } from '../../setup/general/pop-up-message.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { convertZoneName } from '../move-card-bundle/move-card-message.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { deselectCard } from './close-popups.js';

let rootDirectory = window.location.origin;

export const hideCard = (card) => {
    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
    };
}

export const revealCard = (card) => {
    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
    };
}

export const lookAtCards = (initiator, user, zoneId, emit = true) => {
    if (emit){
        const zone = getZone(user, zoneId);
        removeImages(zone.element);
        zone.array.forEach(card => {
            revealCard(card);
            zone.element.appendChild(card.image);
        });
    };
    appendMessage(initiator, determineUsername(initiator) + ' looked at ' + determineUsername(user) + "'s " + zoneId, 'player', false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            emit: false,
        };
        socket.emit('lookAtCards', data);
    };
}

export const stopLookingAtCards = (initiator, user, zoneId, message = true, emit = true) => {
    if (emit){
        const zone = getZone(user, zoneId);
        removeImages(zone.element);
        zone.array.forEach(card => {
            hideCard(card);
            zone.element.appendChild(card.image);
        });
    };
    if(message){
        appendMessage(initiator, determineUsername(initiator) + ' stopped looking at ' + determineUsername(user) + "'s " + zoneId, 'player', false);
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            message: message,
            emit: false,
        };
        socket.emit('stopLookingAtCards', data);
    };
}

export const revealCards = (initiator, user, zoneId, emit = true) => {
    const prizesCount = getZone(user, 'prizes').getCount();
    for (let i = 0; i < prizesCount; i++) {
        revealShortcut(initiator, user, zoneId, i, false, false);
    };
    appendMessage(initiator, determineUsername(initiator) + ' revealed ' + determineUsername(user) + "'s " + zoneId, 'player', false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            emit: false
        };
        socket.emit('revealCards', data);
    };
}

export const hideCards = (initiator, user, zoneId, emit = true) => {
    const prizesCount = getZone(user, 'prizes').getCount();
    for (let i = 0; i < prizesCount; i++) {
        hideShortcut(initiator, user, zoneId, i, false, false);
    };
    appendMessage(initiator, determineUsername(initiator) + ' hid ' + determineUsername(user) + "'s " + zoneId, 'player', false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            emit: false
        };
        socket.emit('hideCards', data);
    };
}

export const revealShortcut = (initiator, user, zoneId, index, message = true, emit = true) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];
    card.image.faceDown = false;
    card.image.public = true;

    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
    };
    if (message){
        appendMessage(initiator, determineUsername(initiator) + ' revealed ' + card.name + ' in ' + determineUsername(card.image.user) + "'s " + convertZoneName(zoneId), 'player', false);
    };
    const oUser = user === 'self' ? 'opp' : 'self';
    if (systemState.isTwoPlayer && emit){
        const oInitiator = initiator === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: oInitiator,
            user: oUser,
            zoneId: zoneId,
            index: index,
            message: message,
            emit: false
        };
        socket.emit('revealShortcut', data);
    };

    //deal with case when revealing a card in your own hand
    if (systemState.isTwoPlayer && emit && zoneId === 'hand' && initiator === card.image.user) {
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
    };
}

export const hideShortcut = (initiator, user, zoneId, index, message = true, emit = true) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];

    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
    };
    const appendMessageEmit = zoneId === 'hand' && initiator !== user;
    if (message){
        appendMessage(initiator, determineUsername(initiator) + ' hid card in ' + determineUsername(user) + "'s " + convertZoneName(zoneId), 'player', appendMessageEmit);
    };
    //deal with handling faceDown card locations
    if (zoneId !== 'prizes' && !(zoneId === 'hand' && initiator !== user)){
        card.image.faceDown = true;
    };
    if (systemState.isTwoPlayer && emit && !appendMessageEmit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            index: index,
            emit: false
        };
        socket.emit('hideShortcut', data);
    };
}

export const lookShortcut = (initiator, user, zoneId, index, emit = true) => {
    if (emit){ //only apply for initiator
        const zone = getZone(user, zoneId);
        const card = zone.array[index];    
        card.image.src = card.image.src2;
    };
    appendMessage(initiator, determineUsername(initiator) + ' looked at card in ' + determineUsername(user) + "'s " + zoneId, 'player', false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            index: index,
            emit: false
        };
        socket.emit('lookShortcut', data);
    };
}

export const stopLookingShortcut = (initiator, user, zoneId, index, emit = true) => {
    if (emit){ //only apply for initiator
        const zone = getZone(user, zoneId);
        const card = zone.array[index];
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
    };
    appendMessage(initiator, determineUsername(initiator) + ' stopped looking at card in ' + determineUsername(user) + "'s " + zoneId, 'player', false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            index: index,
            emit: false
        };
        socket.emit('stopLookingShortcut', data);
    };
}

export const playRandomCardFaceDown = (initiator, user, randomIndex, emit = true) => {
    const hand = getZone(user, 'hand')
    randomIndex = typeof randomIndex === 'number' ? randomIndex : Math.floor(Math.random() * hand.getCount());
    hand.array[randomIndex].image.faceDown = true;
    hideShortcut(initiator, user, 'hand', randomIndex, false, false);
    moveCard(initiator, user, 'hand', 'board', randomIndex);
    appendMessage(initiator, determineUsername(initiator) + ' moved a random card from ' + determineUsername(user) + "'s hand to board", 'player', false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            randomIndex: randomIndex,
            emit: false
        };
        socket.emit('playRandomCardFaceDown', data);
    };
}