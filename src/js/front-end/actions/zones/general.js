import { oppContainerDocument, selfContainerDocument, socket, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineDeckData } from "../../setup/general/determine-deckdata.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { shuffleIndices } from "../../setup/general/shuffle.js";
import { removeImages } from "../../setup/image-logic/remove-images.js";
import { getZone } from "../../setup/zones/get-zone.js";
import { moveCard } from "../move-card-bundle/move-card.js";
import { shuffleZone } from "./shuffle-zone.js";

export const shuffleAll = (initiator, user, zoneId, indices, emit = true) => {
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(initiator, user, zoneId, 'deck', 0);
    };

    const deck = getZone(user, 'deck');
    indices = indices ? indices : shuffleIndices(deck.getCount());
    shuffleZone(initiator, user, 'deck', indices, false, false);

    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'deck'){
            message = determineUsername(initiator) + ' shuffled deck';
        } else if (zoneId === 'attachedCards'){
            message = determineUsername(initiator) + ' shuffled ' + count + ' attached card(s) into deck';
        } else if (zoneId === 'viewCards'){
            message = determineUsername(initiator) + ' shuffled ' + count + ' card(s) into deck';
        } else if (zoneId === 'discard'){
            message = determineUsername(initiator) + ' shuffled discard into deck';
        };
        appendMessage(initiator, message, 'player', false);
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            indices: indices,
            emit: false
        };
        socket.emit('shuffleAll', data);
    };
}

export const discardAll = (initiator, user, zoneId, emit = true) => {
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(initiator, user, zoneId, 'discard', 0)
    };

    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'attachedCards'){
            message = determineUsername(initiator) + ' discarded '+ count + ' attached card(s)';
        } else {
            message = determineUsername(initiator) + ' discarded ' + count + ' card(s)';
        };
        appendMessage(initiator, message, 'player', false);
    };

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
        socket.emit('discardAll', data);
    };
}

export const lostZoneAll = (initiator, user, zoneId, emit = true) => {
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(initiator, user, zoneId, 'lostZone', 0)
    };

    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'attachedCards'){
            message = determineUsername(initiator) + ' lost-zoned '+ count + ' attached card(s)';
        } else {
            message = determineUsername(initiator) + ' lost-zoned ' + count + ' card(s)';
        };
        appendMessage(initiator, message, 'player', false);
    };

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
        socket.emit('lostZoneAll', data);
    };
}

export const handAll = (initiator, user, zoneId, emit = true) => {
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(initiator, user, zoneId, 'hand', 0)
    };
    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'attachedCards'){
            message = determineUsername(initiator) + ' put '+ count + ' attached card(s) into hand';
        } else {
            message = determineUsername(initiator) + ' put ' + count + ' card(s) into hand';
        };
        appendMessage(initiator, message, 'player', false);
    };

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
        socket.emit('handAll', data);
    };
}

export const closeDisplay = (user, zoneId) => {
    const zone = getZone(user, zoneId);
    zone.element.style.display = 'none';
}

export const leaveAll = (initiator, user, oZoneId, emit = true) => {
    const oZone = getZone(user, oZoneId);
    const selectedActiveZone = getZone(user, 'active');
    const dZoneId = selectedActiveZone.getCount() === 0 ? 'active' : 'bench';
    const dZone = getZone(user, dZoneId);

    if (oZone.getCount() > 0){
        const message = determineUsername(initiator) + ' left ' + oZone.getCount() + ' attached card(s) in play';      
        appendMessage(initiator, message, 'player', false);
    };

    let targetImage;
    const oZoneCount1 = oZone.getCount() - 1;
    for (let i = oZoneCount1; i >= 0; i--){
        if (oZone.array[i].type === 'Pokémon'){
            targetImage = oZone.array[i].image;
            moveCard(initiator, user, oZoneId, dZoneId, i);
            break;
        };
    };
    const oZoneCount2 = oZone.getCount() - 1;
    for (let i = oZoneCount2; i >= 0; i--){
        if (oZone.array[i].type === 'Pokémon'){
            const targetIndex = dZone.array.findIndex(card => card.image === targetImage);
            targetImage = oZone.array[i].image;
            moveCard(initiator, user, oZoneId, dZoneId, i, targetIndex);
        };
    };
    const oZoneCount3 = oZone.getCount();
    for (let i = 0; i < oZoneCount3; i++){
        const targetIndex = dZone.array.findIndex(card => card.image === targetImage);
        moveCard(initiator, user, oZoneId, dZoneId, 0, targetIndex);
    };
    oZone.element.style.display = 'none';

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            oZoneId: oZoneId,
            emit: false
        };
        socket.emit('leaveAll', data);
    };
};

export const sort = (user, zoneId) => {
    const selfCheckboxMap = {
        'deck': selfContainerDocument.getElementById('sortDeckCheckbox'),
        'discard': selfContainerDocument.getElementById('sortDiscardCheckbox'),
        'lostZone': selfContainerDocument.getElementById('sortLostZoneCheckbox')
    };
    const oppCheckboxMap = {
        'deck': oppContainerDocument.getElementById('sortDeckCheckbox'),
        'discard': oppContainerDocument.getElementById('sortDiscardCheckbox'),
        'lostZone': oppContainerDocument.getElementById('sortLostZoneCheckbox'),
    };

    const checkbox = user === 'self' ? selfCheckboxMap[zoneId] : oppCheckboxMap[zoneId];
    const deckData = determineDeckData(user);
    const zone = getZone(user, zoneId);

    removeImages(zone.element);

    if (checkbox.checked) {
        deckData.forEach(entry => {
            const name = entry[1];
            zone.array.forEach(card => {
                if (card.name === name) {
                    zone.element.appendChild(card.image);
                };
            });
        });
    } else {
        zone.array.forEach(card => zone.element.appendChild(card.image));
    };
};
