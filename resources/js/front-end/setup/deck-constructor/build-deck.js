import { makeDeckCover } from '../../actions/make-cover/deck-cover.js';
import { deck, deckDisplay_html, deck_html, oppDeck, oppDeckDisplay_html, oppDeck_html } from '../../front-end.js';
import { determineDeckData } from '../general/determine-deckdata.js';
import { Card } from './card.js';

export const buildDeck = (user) => {
    const deckData = determineDeckData(user);
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
    const display_html = user === 'self' ? deckDisplay_html : oppDeckDisplay_html;
    display_html.appendChild(makeDeckCover(user).image);
}