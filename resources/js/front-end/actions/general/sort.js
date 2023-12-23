import { oppSortCheckBox, selfSortCheckBox } from "../../front-end.js";
import { removeImages } from "../../image-logic/remove-images.js";
import { stringToVariable } from "../../setup/containers/string-to-variable.js";
import { determineDeckData } from "../../setup/general/determine-deckdata.js";

export const sort = (user) => {
    const checkbox = user === 'self' ? selfSortCheckBox : oppSortCheckBox;
    const deckData = determineDeckData(user);
    const deck = stringToVariable(user, 'deck');
    const deck_html = stringToVariable(user, 'deck_html');

    removeImages(deck_html);

    if (checkbox.checked){
        deckData.forEach(entry => {
            const cardAttributes = JSON.parse(entry[1]);
            const name = cardAttributes.name;
            deck.cards.forEach(card => {
                if (card.name === name){
                    deck_html.appendChild(card.image);
                };
            });
        });
    } else {
        deck.cards.forEach(card => deck_html.appendChild(card.image));
    };
}