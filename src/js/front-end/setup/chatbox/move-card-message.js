import { mouseClick } from "../../front-end.js";
import { determineUsername } from "../general/determine-username.js";
import { getZone } from "../zones/get-zone.js";
import { appendMessage } from "./messages.js";

export const convertZoneName = (zoneId) => {
    zoneId = zoneId.replace('Cover', '');
    const specialCases = {
        'viewCards': 'deck',
        'lostZone': 'lost zone',
        'attachedCards': 'attached cards',
    };
    return specialCases[zoneId] || zoneId;
};

export const moveCardMessage = (user, cardName, oZoneId, dZoneId, action, attached = false, faceDown = false, faceUp = false, targetIndex = false) => {
    let oLocationName = convertZoneName(oZoneId);
    let mLocationName = convertZoneName(dZoneId);

    let targetCard;
    if (typeof targetIndex === 'number'){
        targetCard = getZone(user, dZoneId).array[targetIndex];
    };
      
    if (targetCard && (!['active', 'bench'].includes(oLocationName) || attached)){
        mLocationName = targetCard.name;
        if (!['active', 'bench'].includes(oLocationName) && mouseClick.card.type !== 'Pokémon'){
            action = 'attach';
        } else if (!['active', 'bench'].includes(oLocationName)) {
            action = 'evolve';
        };
    };

    const hiddenCardZones = [
        ['hand', 'deck'],
        ['deck', 'hand'],
        ['prizes', 'hand'],
        ['hand', 'prizes'],
        ['deck', 'prizes'],
        ['prizes', 'deck'],
        ['prizes', 'prizes'],
        ['deck', 'deck'],
        ['hand', 'hand'],
      ];

    if (!faceUp && hiddenCardZones.some(pair => pair[0] === oLocationName && pair[1] === mLocationName) || faceDown) {
        cardName = 'card';
    };
    if (faceUp && mLocationName !== 'prizes'){
        mouseClick.card.image.faceUp = false;
    };
    if (attached){
        const relativeCard = getZone(mouseClick.user, mouseClick.zoneId).array.find(card => card.image === mouseClick.card.image.relative);
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