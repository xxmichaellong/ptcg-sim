import { oppDeckSortCheckBox, oppDiscardSortCheckBox, oppLostzoneSortCheckBox, selfDeckSortCheckBox, selfDiscardSortCheckBox, selfLostzoneSortCheckBox } from "../../front-end.js";
import { removeImages } from "../../image-logic/remove-images.js";
import { stringToVariable } from "../../setup/containers/string-to-variable.js";
import { determineDeckData } from "../../setup/general/determine-deckdata.js";

export const sort = (user, location, location_html) => {
    let checkbox;
    const selfCheckboxMap = {
        'deck': selfDeckSortCheckBox,
        'discard': selfDiscardSortCheckBox,
        'lostzone': selfLostzoneSortCheckBox
    };
    const oppCheckboxMap = {
        'deck': oppDeckSortCheckBox,
        'discard': oppDiscardSortCheckBox,
        'lostzone': oppLostzoneSortCheckBox
    };
      
    if (user === 'self') {
        checkbox = selfCheckboxMap[location];
    } else {
        checkbox = oppCheckboxMap[location];
    };
    
    const deckData = determineDeckData(user);
    location = stringToVariable(user, location);
    location_html = stringToVariable(user, location_html);

    removeImages(location_html);

    if (checkbox.checked){
        deckData.forEach(entry => {
            const cardAttributes = JSON.parse(entry[1]);
            const name = cardAttributes.name;
            location.cards.forEach(card => {
                if (card.name === name){
                    location_html.appendChild(card.image);
                };
            });
        });
    } else {
        location.cards.forEach(card => location_html.appendChild(card.image));
    };
}