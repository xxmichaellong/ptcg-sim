import { POV, sCard, target } from "../../front-end.js"
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

export const moveCardMessage = (oLocation, mLocation, action, attached = false) => {
    oLocation = findLocation(oLocation);
    mLocation = findLocation(mLocation);

    let card;
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
      
    if (target.card && (!['bench'].includes(oLocation) || attached)){
        mLocation = target.card.name;
        if (!['bench', 'active'].includes(oLocation) && sCard.card.type !== 'pokemon'){
            action = 'attach';
        } else if (!['bench', 'active'].includes(oLocation)) {
            action = 'evolve';
        };
    };
    if (hiddenName.some(pair => pair[0] === oLocation && pair[1] === mLocation)) {
        card = 'card';
    } else {
        card = sCard.card.name;
    };
    if (attached){
        const relativeCard = stringToVariable(sCard.user, sCard.locationAsString).cards.find(card => card.image === sCard.card.image.relative);
        oLocation = relativeCard.name;
    };
    let message;
    if (action === 'move'){
        message = determineUsername(POV.user) + ' moved ' + card + ' from ' + oLocation + ' to ' + mLocation;
    } else if (action === 'shuffle'){
        message = determineUsername(POV.user) + ' shuffled ' + card + ' from ' + oLocation + ' into deck';
    } else if (action === 'top'){
        message = determineUsername(POV.user) + ' moved ' + card + ' from ' + oLocation + ' to top of deck';
    } else if (action === 'bottom'){
        message = determineUsername(POV.user) + ' moved ' + card + ' from ' + oLocation + ' to bottom of deck';
    } else if (action === 'switch'){
        message = determineUsername(POV.user) + ' switched ' + card + ' from ' + oLocation + ' with top of deck';
    } else if (action === 'attach'){
        message = determineUsername(POV.user) + ' attached ' + card + ' from ' + oLocation + ' to ' + mLocation;
    } else if (action === 'evolve'){
        message = determineUsername(POV.user) + ' evolved ' + mLocation + ' into ' + card;
    };
    appendMessage(POV.user, message, 'player');
};