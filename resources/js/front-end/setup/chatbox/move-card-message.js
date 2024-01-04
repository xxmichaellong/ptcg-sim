import { sCard, target } from "../../front-end.js"
import { stringToVariable } from "../zones/zone-string-to-variable.js";
import { determineUsername } from "../general/determine-username.js";
import { appendMessage } from "./messages.js";

export const convertZoneName = (zoneArrayString) => {
    const specialCases = {
        'viewCardsArray': 'deck',
        'lostZoneArray': 'lost zone',
        'attachedCardsArray': 'attached cards',
    };

    const withoutArray = zoneArrayString.replace('Array', '');

    return specialCases[zoneArrayString] || withoutArray;
};


export const moveCardMessage = (user, cardName, oZoneArrayString, dZoneArrayString, action, attached = false, faceDown = false, faceUp = false) => {
    let oLocationName = convertZoneName(oZoneArrayString);
    let mLocationName = convertZoneName(dZoneArrayString);

    const hiddenName = [
        ['handArray', 'deckArray'],
        ['deckArray', 'handArray'],
        ['prizesArray', 'handArray'],
        ['handArray', 'prizesArray'],
        ['deckArray', 'prizesArray'],
        ['prizesArray', 'deckArray'],
        ['prizesArray', 'prizesArray'],
        ['deckArray', 'deckArray'],
        ['handArray', 'handArray'],
      ];
      
    if (target.card && (!['active', 'bench'].includes(oLocationName) || attached)){
        mLocationName = target.card.name;
        if (!['bench', 'active'].includes(oLocationName) && sCard.card.type !== 'Pokémon'){
            action = 'attach';
        } else if (!['bench', 'active'].includes(oLocationName)) {
            action = 'evolve';
        };
    };
    if (!faceUp && hiddenName.some(pair => pair[0] === oLocationName && pair[1] === mLocationName) || faceDown) {
        cardName = 'card';
    };
    if (faceUp && mLocationName !== 'prizes'){
        sCard.card.image.faceUp = false;
    };
    if (attached){
        const relativeCard = stringToVariable(sCard.user, sCard.zoneArrayString).find(card => card.image === sCard.card.image.relative);
        oLocationName = relativeCard.name;
    };
    let message;
    if (action === 'move'){
        message = determineUsername(user) + ' moved ' + cardName + ' from ' + oLocationName + ' to ' + mLocationName;
    } else if (action === 'shuffle'){
        message = determineUsername(user) + ' shuffled ' + cardName + ' from ' + oLocationName + ' into deck';
    } else if (action === 'top'){
        message = determineUsername(user) + ' moved ' + cardName + ' from ' + oLocationName + ' to top of deck';
    } else if (action === 'bottom'){
        message = determineUsername(user) + ' moved ' + cardName + ' from ' + oLocationName + ' to bottom of deck';
    } else if (action === 'switch'){
        message = determineUsername(user) + ' switched ' + cardName + ' from ' + oLocationName + ' with top of deck';
    } else if (action === 'attach'){
        message = determineUsername(user) + ' attached ' + cardName + ' from ' + oLocationName + ' to ' + mLocationName;
    } else if (action === 'evolve'){
        message = determineUsername(user) + ' evolved ' + mLocationName + ' into ' + cardName;
    };
    appendMessage(user, message, 'player');
};