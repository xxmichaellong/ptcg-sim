import { Card } from "../setup/card.js";
import { deck, deck_html } from "../setup/initialization.js";
import { oppDeck, oppDeck_html } from "../setup/opp-initialization.js";

// Function to make card objects and add it to the deck array, specifying the quantity of each card
export const addCard = (user, rawCardAttributes, rawImageAttributes) => {
    const _card = new Card(rawCardAttributes, rawImageAttributes);
    if (user === 'self'){
    deck.cards.push(_card);
    deck_html.appendChild(_card.image);
    } else {
    oppDeck.cards.push(_card);
    oppDeck_html.appendChild(_card.image);
    }
}