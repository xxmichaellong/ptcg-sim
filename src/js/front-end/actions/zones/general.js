import { activeArray, oppActiveArray, selfContainersDocument } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { zoneElementToArray } from "../../setup/zones/zone-element-to-array.js";
import { stringToVariable, variableToString } from "../../setup/zones/zone-string-to-variable.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { moveCard } from "../move-card-logic/move-card.js";
import { shuffleZone } from "./shuffle-zone.js";
import { getZoneCount } from "../general/count.js";

export const shuffleAll = (event) => {
    const zoneElementString = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const zoneArray = zoneElementToArray(user, zoneElementString);
    const zoneArrayString = variableToString(user, zoneArray);
    const count = getZoneCount(zoneArray);

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneArrayString, zoneElementString, 'deckArray', 'deckElement', 0)
    };

    shuffleZone(user, 'deckArray', 'deckElement');

    const zoneElement = stringToVariable(user, zoneElementString);
    zoneElement.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneArrayString === 'deckArray'){
            message = determineUsername(user) + ' shuffled deck';
        } else if (zoneArrayString === 'attachedCardsArray'){
            message = determineUsername(user) + ' shuffled ' + count + ' attached card(s) into deckArray';
        } else if (zoneArrayString === 'viewCardsArray'){
            message = determineUsername(user) + ' shuffled ' + count + ' card(s) into deckArray';
        } else if (zoneArrayString === 'discardArray'){
            message = determineUsername(user) + ' shuffled discard into deckArray';
        };
        appendMessage(user, message, 'player');
    };
}

export const discardAll = (event) => {
    const zoneElementString = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const zoneArray = zoneElementToArray(user, zoneElementString);
    const zoneArrayString = variableToString(user, zoneArray);
    const count = getZoneCount(zoneArray);

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneArrayString, zoneElementString, 'discardArray', 'discardElement', 0)
    };

    const zoneElement = stringToVariable(user, zoneElementString);
    zoneElement.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneArrayString === 'attachedCardsArray'){
            message = determineUsername(user) + ' discarded '+ count + ' attached card(s)';
        } else {
            message = determineUsername(user) + ' discarded ' + count + ' card(s)';
        };
        appendMessage(user, message, 'player');
    };
}

export const lostZoneAll = (event) => {
    const zoneElementString = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const zoneArray = zoneElementToArray(user, zoneElementString);
    const zoneArrayString = variableToString(user, zoneArray);
    const count = getZoneCount(zoneArray);

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneArrayString, zoneElementString, 'lostZoneArray', 'lostZoneElement', 0)
    };

    const zoneElement = stringToVariable(user, zoneElementString);
    zoneElement.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneArrayString === 'attachedCardsArray'){
            message = determineUsername(user) + ' lost-zoned '+ count + ' attached card(s)';
        } else {
            message = determineUsername(user) + ' lost-zoned ' + count + ' card(s)';
        };
        appendMessage(user, message, 'player');
    };
}

export const handAll = (event) => {
    const zoneElementString = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const zoneArray = zoneElementToArray(user, zoneElementString);
    const zoneArrayString = variableToString(user, zoneArray);
    const count = getZoneCount(zoneArray);

    for (let i = 0; i < count; i++) {
        moveCard(user, zoneArrayString, zoneElementString, 'handArray', 'handElement', 0)
    };

    const zoneElement = stringToVariable(user, zoneElementString);
    zoneElement.style.display = 'none';

    if (count > 0){
        let message;
        if (zoneArrayString === 'attachedCardsArray'){
            message = determineUsername(user) + ' put '+ count + ' attached card(s) into hand';
        } else {
            message = determineUsername(user) + ' put ' + count + ' card(s) into hand';
        };
        appendMessage(user, message, 'player');
    };
}

export const closeDisplay = (event) => {
    const zoneElementString = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const zoneElement = stringToVariable(user, zoneElementString);
    zoneElement.style.display = 'none';
}

export const leaveAll = (event) => {
    const zoneElementString = event.target.parentElement.parentElement.id;
    const user = selfContainersDocument.contains(event.target) ? 'self' : 'opp';
    const zoneArray = zoneElementToArray(user, zoneElementString);
    const zoneArrayString = variableToString(user, zoneArray);
    const count = getZoneCount(zoneArray);
    
    let dZoneArray;
    let dZoneArrayString;
    let dZoneElement;

    const activeCount = user === 'self' ? getZoneCount(activeArray) : getZoneCount(oppActiveArray);
    if (activeCount === 0){
        dZoneArray = stringToVariable(user, 'activeArray');
        dZoneArrayString = 'activeArray';
        dZoneElement = 'activeElement';
    } else {
        dZoneArray = stringToVariable(user, 'benchArray');
        dZoneArrayString = 'benchArray';
        dZoneElement = 'benchElement';
    };

    let targetImage;

    for (let i = count - 1; i >= 0; i--){
        if (zoneArray[i].type === 'Pokémon'){
            targetImage = zoneArray[i].image;
            moveCard(user, zoneArrayString, zoneElementString, dZoneArrayString, dZoneElement, i);
            break;
        };
    };
    const count1 = getZoneCount(zoneArray);
    for (let i = count1 - 1; i >= 0; i--){
        if (zoneArray[i].type === 'Pokémon'){
            const targetIndex = dZoneArray.findIndex(card => card.image === targetImage);
            targetImage = zoneArray[i].image;
            moveCard(user, zoneArrayString, zoneElementString, dZoneArrayString, dZoneElement, i, targetIndex);
        };
    };
    const count2 = getZoneCount(zoneArray);
    for (let i = 0; i < count2; i++){
        const targetIndex = dZoneArray.findIndex(card => card.image === targetImage);
        moveCard(user, zoneArrayString, zoneElementString, dZoneArrayString, dZoneElement, 0, targetIndex);
    };

    const zoneElement = stringToVariable(user, zoneElementString);
    zoneElement.style.display = 'none';

    if (count > 0){
        const message = determineUsername(user) + ' left ' + count + ' attached card(s) in play';      
        appendMessage(user, message, 'player');
    };
}