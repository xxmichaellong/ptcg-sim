import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { convertZoneName } from '../../setup/chatbox/move-card-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { showPopup } from '../../setup/general/pop-up-message.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { deselectCard } from './close-popups.js';

let rootDirectory = window.location.origin;

export const hideCard = (card) => {
    //only trigger if card isn't already hidden
    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
    };
}

export const revealCard = (card) => {
    //only trigger if card is hidden
    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
    };
}

export const hideCards = (user, zoneId) => {
    const zone = getZone(user, zoneId);
    removeImages(zone.element);
    zone.array.forEach(card => {
        hideCard(card);
        zone.element.appendChild(card.image);
    });
}
export const revealCards = (user, zoneId) => {
    const zone = getZone(user, zoneId);
    removeImages(zone.element);
    zone.array.forEach(card => {
        revealCard(card);
        zone.element.appendChild(card.image);
    });
}

export const revealShortcut = (user, zoneId, index, message = true, emit = true) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];
    card.image.faceDown = false;

    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
    };
    if (zoneId === 'prizes'){
        card.image.faceUp = true;
    };
    //if card is from prizes,  don't reveal to opponent. otherwise, reveal
    if (emit && message){
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' revealed ' + card.name + ' in ' + determineUsername(card.image.user) + "'s " + convertZoneName(zoneId), 'player');
    };
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneId: zoneId,
            index: index,
            message: message,
            emit: false
        };
        socket.emit('revealShortcut', data);
    };

    //deal with case when revealing a card in your own hand
    if (emit && systemState.isTwoPlayer && zoneId === 'hand' && systemState.pov.user === card.image.user) {
        deselectCard();
        showPopup('Press OK to stop revealing card to opponent', () => {
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: systemState.roomId,
                user: oUser,
                zoneId: zoneId,
                index: index,
            };
            socket.emit('stopLookingShortcut', data);
        });
    };
}

export const hideShortcut = (user, zoneId, index, message = true, emit = true) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];

    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
    };
    if (emit & message){
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' hid card in ' + determineUsername(card.image.user) + "'s " + convertZoneName(zoneId), 'player');
    };
    //deal with handling faceDown card locations
    if (!['prizes'].includes(zoneId) && !(zoneId === 'hand' && systemState.pov.oUser === card.image.user)){
        card.image.faceDown = true;
        if (systemState.isTwoPlayer && emit){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: systemState.roomId,
                user: oUser,
                zoneId: zoneId,
                index: index,
            };
            socket.emit('faceDown', data);
        };
    };
    if (systemState.isTwoPlayer && emit && !(zoneId === 'hand' && systemState.pov.oUser === card.image.user)){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneId: zoneId,
            index: index,
            emit: false
        };
        socket.emit('hideShortcut', data);
    };
}

export const lookShortcut = (user, zoneId, index) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];

    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' looked at card in ' + determineUsername(card.image.user) + "'s " + zoneId, 'player');
    };
}

export const stopLookingShortcut = (user, zoneId, index) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];

    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' stopped looking at card in ' + determineUsername(card.image.user) + "'s " + zoneId, 'player');
    };
}