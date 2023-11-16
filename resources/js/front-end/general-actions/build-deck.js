import { Card } from "../setup/card.js";
import { deck, deck_html } from "../setup/initialization.js";
import { oppDeck, oppDeck_html } from "../setup/opp-initialization.js";
import { deckData } from "../setup/deck-data.js"

// Function to make card objects and add it to the deck array, specifying the quantity of each card
export function buildDeck(user){
    for (const [quantity, rawCardAttributes, rawImageAttributes] of deckData){
        for (let i = 0; i < quantity; i++){
            const _card = new Card(rawCardAttributes, rawImageAttributes);
            _card.image.user = user;
            if (user === 'self'){
                deck.cards.push(_card);
                deck_html.appendChild(_card.image);
            } else {
                oppDeck.cards.push(_card);
                oppDeck_html.appendChild(_card.image);
            };
        };
    };
}