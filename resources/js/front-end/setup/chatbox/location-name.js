import { POV, sCard, target } from "../../front-end.js"
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
    if (attached){
        card = 'attached card';
    } else if (['active', 'bench'].includes(oLocation)){
        card = 'Pokémon';
    } else {
        card = 'card';
    };
    if (typeof target.index === 'number' && (oLocation !== 'bench' || attached)){
        action = 'attach';
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
        message = determineUsername(POV.user) + ' moved ' + card + ' from ' + oLocation + ' to Pokémon on ' + mLocation;
    };
    appendMessage(POV.user, message, 'player');
};