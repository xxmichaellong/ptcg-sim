import { deck, deckData, deck_html, oppDeck, oppDeck_html } from '../../front-end.js';
import { Card } from './card.js';

// Function to make card objects and add it to the deck array, specifying the quantity of each card
export const buildDeck = (user) => {
    for (const [quantity, rawCardAttributes, rawImageAttributes] of deckData){
        for (let i = 0; i < quantity; i++){
            const _card = new Card(rawCardAttributes, rawImageAttributes);
            _card.image.user = user;
            const _deck = user === 'self' ? deck : oppDeck;
            const _deck_html = user === 'self' ? deck_html : oppDeck_html;
            _deck.cards.push(_card);
            _deck_html.appendChild(_card.image);
        };
    };
}