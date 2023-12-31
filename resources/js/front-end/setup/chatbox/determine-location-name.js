import { sCard, target } from "../../front-end.js"
import { stringToVariable } from "../containers/string-to-variable.js";
import { determineUsername } from "../general/determine-username.js";
import { appendMessage } from "./messages.js";

export const findLocation = (locationAsString) => {
    if (locationAsString === 'lostzone'){
        return 'lost zone';
    } else if (locationAsString === 'attachedCardPopup'){
        return 'attached cards';
    } else if (locationAsString === 'viewCards'){
        return 'deck';
    } else {
        return locationAsString;
    };
}

export const moveCardMessage = (user, cardName, oLocation, mLocation, action, attached = false, faceDown = false, faceUp = false) => {
    oLocation = findLocation(oLocation);
    mLocation = findLocation(mLocation);

    const hiddenName = [
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
      
    if (target.card && (!['active', 'bench'].includes(oLocation) || attached)){
        mLocation = target.card.name;
        if (!['bench', 'active'].includes(oLocation) && sCard.card.type !== 'Pokémon'){
            action = 'attach';
        } else if (!['bench', 'active'].includes(oLocation)) {
            action = 'evolve';
        };
    };
    if (!faceUp && hiddenName.some(pair => pair[0] === oLocation && pair[1] === mLocation) || faceDown) {
        cardName = 'card';
    };
    if (faceUp && mLocation !== 'prizes'){
        sCard.card.image.faceUp = false;
    };
    if (attached){
        const relativeCard = stringToVariable(sCard.user, sCard.locationAsString).cards.find(card => card.image === sCard.card.image.relative);
        oLocation = relativeCard.name;
    };
    let message;
    if (action === 'move'){
        message = determineUsername(user) + ' moved ' + cardName + ' from ' + oLocation + ' to ' + mLocation;
    } else if (action === 'shuffle'){
        message = determineUsername(user) + ' shuffled ' + cardName + ' from ' + oLocation + ' into deck';
    } else if (action === 'top'){
        message = determineUsername(user) + ' moved ' + cardName + ' from ' + oLocation + ' to top of deck';
    } else if (action === 'bottom'){
        message = determineUsername(user) + ' moved ' + cardName + ' from ' + oLocation + ' to bottom of deck';
    } else if (action === 'switch'){
        message = determineUsername(user) + ' switched ' + cardName + ' from ' + oLocation + ' with top of deck';
    } else if (action === 'attach'){
        message = determineUsername(user) + ' attached ' + cardName + ' from ' + oLocation + ' to ' + mLocation;
    } else if (action === 'evolve'){
        message = determineUsername(user) + ' evolved ' + mLocation + ' into ' + cardName;
    };
    appendMessage(user, message, 'player');
};