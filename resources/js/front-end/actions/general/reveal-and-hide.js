import { POV, p1, roomId, socket } from '../../front-end.js';
import { removeImages } from '../../image-logic/remove-images.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { stringToVariable } from '../../setup/containers/string-to-variable.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { showPopup } from '../../setup/general/pop-up-message.js';
import { deselectCard } from './close-popups.js';

let rootDirectory = window.location.origin;

export const hideCard = (card) => {
    //only trigger if card isn't already hidden
    if (card.image.src !== rootDirectory + '/resources/card-scans/cardback.png'){
    //store actual source in src2
        card.image.src2 = card.image.src;
        card.image.src = '/resources/card-scans/cardback.png';
    };
}

export const revealCard = (card) => {
    //only trigger if card is hidden
    if (card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src = card.image.src2;
    };
}

export const hideCards = (user, container, container_html) => {
    container = stringToVariable(user, container);
    container_html = stringToVariable(user, container_html);
    removeImages(container_html);
    container.cards.forEach(card => {
        hideCard(card);
        container_html.appendChild(card.image);
    });
}
export const revealCards = (user, container, container_html) => {
    container = stringToVariable(user, container);
    container_html = stringToVariable(user, container_html);
    removeImages(container_html);
    container.cards.forEach(card => {
        revealCard(card);
        container_html.appendChild(card.image);
    });
}

export const revealShortcut = (user, location, index, message = true, received = false) => {
    const _location = location;
    location = stringToVariable(user, location);
    const card = location.cards[index];
    const locationOwner = card.image.user;
    card.image.faceDown = false;

    if (card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src = card.image.src2;
    };
    if (_location === 'prizes'){
        card.image.faceUp = true;
    };
    //if card is from prizes,  don't reveal to opponent. otherwise, reveal
    if (!received && message){
        appendMessage(POV.user, determineUsername(POV.user) + ' revealed ' + card.name + ' in ' + determineUsername(locationOwner) + "'s " + _location, 'player');
    };
    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: roomId,
            user: oUser,
            location: _location,
            index: index,
            message: message,
            received: true
        };
        socket.emit('revealShortcut', data);
    };

    //deal with case when revealing a card in your own hand
    if (!received && !p1[0] && _location === 'hand' && POV.user === locationOwner) {
        deselectCard();
        showPopup('Press OK to stop revealing card to opponent', () => {
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: roomId,
                user: oUser,
                location: _location,
                index: index,
            };
            socket.emit('stopLookingShortcut', data);
        });
    };
}

export const hideShortcut = (user, location, index, message = true, received = false) => {
    const _location = location;
    location = stringToVariable(user, location);
    const card = location.cards[index];
    const locationOwner = card.image.user;

    if (card.image.src !== rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/resources/card-scans/cardback.png';
    };
    if (!received & message){
        appendMessage(POV.user, determineUsername(POV.user) + ' hid card in ' + determineUsername(locationOwner) + "'s " + _location, 'player');
    };
    //deal with handling faceDown card locations
    if (!['prizes'].includes(_location) && !(_location === 'hand' && POV.oUser === locationOwner)){
        card.image.faceDown = true;
        if (!p1[0] && !received){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: roomId,
                user: oUser,
                location: _location,
                index: index,
            };
            socket.emit('faceDown', data);
        };
    };
    if (!p1[0] && !received && !(_location === 'hand' && POV.oUser === locationOwner)){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: roomId,
            user: oUser,
            location: _location,
            index: index,
            received: true
        };
        socket.emit('hideShortcut', data);
    };
}

export const lookShortcut = (user, location, index) => {
    const _location = location;
    location = stringToVariable(user, location);
    const card = location.cards[index];
    const locationOwner = card.image.user;

    if (card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src = card.image.src2;
        appendMessage(POV.user, determineUsername(POV.user) + ' looked at card in ' + determineUsername(locationOwner) + "'s " + _location, 'player');
    };
}

export const stopLookingShortcut = (user, location, index) => {
    const _location = location;
    location = stringToVariable(user, location);
    const card = location.cards[index];
    const locationOwner = card.image.user;

    if (card.image.src !== rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src2 = card.image.src;
        card.image.src = '/resources/card-scans/cardback.png';
        appendMessage(POV.user, determineUsername(POV.user) + ' stopped looking at card in ' + determineUsername(locationOwner) + "'s " + _location, 'player');
    };
}