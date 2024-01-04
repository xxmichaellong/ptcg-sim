import { systemState, socket } from '../../front-end.js';
import { removeImages } from '../../image-logic/remove-images.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { showPopup } from '../../setup/general/pop-up-message.js';
import { deselectCard } from './close-popups.js';
import { convertZoneName } from '../../setup/chatbox/move-card-message.js';

let rootDirectory = window.location.origin;

export const hideCard = (card) => {
    //only trigger if card isn't already hidden
    if (card.image.src !== rootDirectory + '/src/cardback.png'){
    //store actual source in src2
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

export const hideCards = (user, zoneArrayString, zoneElementString) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);
    removeImages(zoneElement);
    zoneArray.forEach(card => {
        hideCard(card);
        zoneElement.appendChild(card.image);
    });
}
export const revealCards = (user, zoneArrayString, zoneElementString) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);
    removeImages(zoneElement);
    zoneArray.forEach(card => {
        revealCard(card);
        zoneElement.appendChild(card.image);
    });
}

export const revealShortcut = (user, zoneArrayString, index, message = true, emit = true) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const card = zoneArray[index];
    card.image.faceDown = false;

    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
    };
    if (zoneArrayString === 'prizesArray'){
        card.image.faceUp = true;
    };
    //if card is from prizes,  don't reveal to opponent. otherwise, reveal
    if (emit && message){
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' revealed ' + card.name + ' in ' + determineUsername(card.image.user) + "'s " + convertZoneName(zoneArrayString), 'player');
    };
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneArrayString: zoneArrayString,
            index: index,
            message: message,
            emit: false
        };
        socket.emit('revealShortcut', data);
    };

    //deal with case when revealing a card in your own hand
    if (emit && systemState.isTwoPlayer && zoneArrayString === 'handArray' && systemState.pov.user === card.image.user) {
        deselectCard();
        showPopup('Press OK to stop revealing card to opponent', () => {
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: systemState.roomId,
                user: oUser,
                zoneArrayString: zoneArrayString,
                index: index,
            };
            socket.emit('stopLookingShortcut', data);
        });
    };
}

export const hideShortcut = (user, zoneArrayString, index, message = true, emit = true) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const card = zoneArray[index];

    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
    };
    if (emit & message){
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' hid card in ' + determineUsername(card.image.user) + "'s " + convertZoneName(zoneArrayString), 'player');
    };
    //deal with handling faceDown card locations
    if (!['prizesArray'].includes(zoneArrayString) && !(zoneArrayString === 'handArray' && systemState.pov.oUser === card.image.user)){
        card.image.faceDown = true;
        if (systemState.isTwoPlayer && emit){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: systemState.roomId,
                user: oUser,
                zoneArrayString: zoneArrayString,
                index: index,
            };
            socket.emit('faceDown', data);
        };
    };
    if (systemState.isTwoPlayer && emit && !(zoneArrayString === 'handArray' && systemState.pov.oUser === card.image.user)){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneArrayString: zoneArrayString,
            index: index,
            emit: false
        };
        socket.emit('hideShortcut', data);
    };
}

export const lookShortcut = (user, zoneArrayString, index) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const card = zoneArray[index];

    if (card.image.src === rootDirectory + '/src/cardback.png'){
        card.image.src = card.image.src2;
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' looked at card in ' + determineUsername(card.image.user) + "'s " + zoneArrayString, 'player');
    };
}

export const stopLookingShortcut = (user, zoneArrayString, index) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const card = zoneArray[index];

    if (card.image.src !== rootDirectory + '/src/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/src/cardback.png';
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' stopped looking at card in ' + determineUsername(card.image.user) + "'s " + zoneArrayString, 'player');
    };
}