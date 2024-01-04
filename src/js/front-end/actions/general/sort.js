import { oppSortDeckCheckbox, oppSortDiscardCheckbox, oppSortLostZoneCheckbox, selfSortDeckCheckbox, selfSortDiscardCheckbox, selfSortLostZoneCheckbox } from "../../front-end.js";
import { removeImages } from "../../image-logic/remove-images.js";
import { stringToVariable } from "../../setup/zones/zone-string-to-variable.js";
import { determineDeckData } from "../../setup/general/determine-deckdata.js";

export const sort = (user, zoneArrayString, zoneElementString) => {
    let checkbox;
    const selfCheckboxMap = {
        'deckArray': selfSortDeckCheckbox,
        'discardArray': selfSortDiscardCheckbox,
        'lostZoneArray': selfSortLostZoneCheckbox
    };
    const oppCheckboxMap = {
        'deckArray': oppSortDeckCheckbox,
        'discardArray': oppSortDiscardCheckbox,
        'lostZoneArray': oppSortLostZoneCheckbox
    };
      
    if (user === 'self') {
        checkbox = selfCheckboxMap[zoneArrayString];
    } else {
        checkbox = oppCheckboxMap[zoneArrayString];
    };
    
    const deckData = determineDeckData(user);
    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);

    removeImages(zoneElement);

    if (checkbox.checked){
        deckData.forEach(entry => {
            const name = entry[1];
            zoneArray.forEach(card => {
                if (card.name === name){
                    zoneElement.appendChild(card.image);
                };
            });
        });
    } else {
        zoneArray.forEach(card => zoneElement.appendChild(card.image));
    };
}