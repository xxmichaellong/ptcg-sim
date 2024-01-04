import { deckArray, deckCoverElement, deckElement, oppDeckArray, oppDeckCoverElement, oppDeckElement, systemState } from '../../front-end.js';
import { determineDeckData } from '../general/determine-deckdata.js';
import { Card } from './card.js';
import { Cover } from './cover.js';

export const buildDeck = (user) => {
    const deckData = determineDeckData(user);
    for (const [quantity, name, imageURL, type] of deckData){
        for (let i = 0; i < quantity; i++){
            const card = new Card(user, name, imageURL, type);
            const selectedDeckArray = user === 'self' ? deckArray : oppDeckArray;
            const selectedDeckElement = user === 'self' ? deckElement : oppDeckElement;
            selectedDeckArray.push(card);
            selectedDeckElement.appendChild(card.image);
        };
    };
    const selectedDisplayElement = user === 'self' ? deckCoverElement : oppDeckCoverElement;
    const cover = new Cover(user, 'deckCoverElement', systemState.cardBackSrc);
    selectedDisplayElement.appendChild(cover.image);
}