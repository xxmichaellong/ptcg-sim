import { oppContainerDocument, selfContainerDocument } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineDeckData } from "../../setup/general/determine-deckdata.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { removeImages } from "../../setup/image-logic/remove-images.js";
import { getZone } from "../../setup/zones/get-zone.js";
import { moveCard } from "../move-card-logic/move-card.js";
import { shuffleZone } from "./shuffle-zone.js";

export const shuffleAll = (event) => {
    const zoneId = event.target.parentElement.parentElement.id;
    const user = selfContainerDocument.contains(event.target) ? 'self' : 'opp';
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneId, 'deck', 0)
    };

    shuffleZone(user, 'deck');

    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'deck'){
            message = determineUsername(user) + ' shuffled deck';
        } else if (zoneId === 'attachedCards'){
            message = determineUsername(user) + ' shuffled ' + count + ' attached card(s) into deck';
        } else if (zoneId === 'viewCards'){
            message = determineUsername(user) + ' shuffled ' + count + ' card(s) into deck';
        } else if (zoneId === 'discard'){
            message = determineUsername(user) + ' shuffled discard into deck';
        };
        appendMessage(user, message, 'player');
    };
}

export const discardAll = (event) => {
    const zoneId = event.target.parentElement.parentElement.id;
    const user = selfContainerDocument.contains(event.target) ? 'self' : 'opp';
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneId, 'discard', 0)
    };

    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'attachedCards'){
            message = determineUsername(user) + ' discarded '+ count + ' attached card(s)';
        } else {
            message = determineUsername(user) + ' discarded ' + count + ' card(s)';
        };
        appendMessage(user, message, 'player');
    };
}

export const lostZoneAll = (event) => {
    const zoneId = event.target.parentElement.parentElement.id;
    const user = selfContainerDocument.contains(event.target) ? 'self' : 'opp';
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneId, 'lostZone', 0)
    };

    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'attachedCards'){
            message = determineUsername(user) + ' lost-zoned '+ count + ' attached card(s)';
        } else {
            message = determineUsername(user) + ' lost-zoned ' + count + ' card(s)';
        };
        appendMessage(user, message, 'player');
    };
}

export const handAll = (event) => {
    const zoneId = event.target.parentElement.parentElement.id;
    const user = selfContainerDocument.contains(event.target) ? 'self' : 'opp';
    const zone = getZone(user, zoneId);
    const count = zone.getCount();

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneId, 'hand', 0)
    };
    zone.element.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneId === 'attachedCards'){
            message = determineUsername(user) + ' put '+ count + ' attached card(s) into hand';
        } else {
            message = determineUsername(user) + ' put ' + count + ' card(s) into hand';
        };
        appendMessage(user, message, 'player');
    };
}

export const closeDisplay = (event) => {
    const zoneId = event.target.parentElement.parentElement.id;
    const user = selfContainerDocument.contains(event.target) ? 'self' : 'opp';
    const zone = getZone(user, zoneId);
    zone.element.style.display = 'none';
}

export const leaveAll = (event) => {
    const oZoneId = event.target.parentElement.parentElement.id;
    const user = selfContainerDocument.contains(event.target) ? 'self' : 'opp';
    const oZone = getZone(user, oZoneId);
    
    const selectedActiveZone = getZone(user, 'active');
    const dZoneId = selectedActiveZone.getCount() === 0 ? 'active' : 'bench';
    const dZone = getZone(user, dZoneId);

    if (oZone.getCount() > 0){
        const message = determineUsername(user) + ' left ' + oZone.getCount() + ' attached card(s) in play';      
        appendMessage(user, message, 'player');
    };

    let targetImage;
    const oZoneCount1 = oZone.getCount() - 1;
    for (let i = oZoneCount1; i >= 0; i--){
        if (oZone.array[i].type === 'Pokémon'){
            targetImage = oZone.array[i].image;
            moveCard(user, oZoneId, dZoneId, i);
            break;
        };
    };
    const oZoneCount2 = oZone.getCount() - 1;
    for (let i = oZoneCount2; i >= 0; i--){
        if (oZone.array[i].type === 'Pokémon'){
            const targetIndex = dZone.array.findIndex(card => card.image === targetImage);
            targetImage = oZone.array[i].image;
            moveCard(user, oZoneId, dZoneId, i, targetIndex);
        };
    };
    const oZoneCount3 = oZone.getCount();
    for (let i = 0; i < oZoneCount3; i++){
        const targetIndex = dZone.array.findIndex(card => card.image === targetImage);
        moveCard(user, oZoneId, dZoneId, 0, targetIndex);
    };

    oZone.element.style.display = 'none';
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
