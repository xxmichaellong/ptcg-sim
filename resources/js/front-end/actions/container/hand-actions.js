import { deck, socket } from '../../front-end.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { moveCard } from '../general/move-card.js';
import { shuffleContainer } from './shuffle-container.js';

// Draw starting hand of 7
export const drawHand = (user) => {
    for (let i = 0; i < 7; i++){
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
    };
    for (let i = 0; i < 6; i++){
        moveCard(user, 'deck', 'deck_html', 'prizes', 'prizes_html', 0);
    };
}

export const discardAndDraw = (user, discardAmount, drawAmount) => {
    for (let i = 0; i < discardAmount; i++){
        moveCard(user, 'hand', 'hand_html', 'discard', 'discard_html', 0, false, true);
    };

    for (let i = 0; i < drawAmount; i++){
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0, false, true);
    };
}

export const shuffleAndDraw = (user, shuffleAmount, drawAmount, indices) => {
    for (let i = 0; i < shuffleAmount; i++){
        moveCard(user, 'hand', 'hand_html', 'deck', 'deck_html', 0, false, true);
    };
    if (user === 'self'){
        indices = shuffleIndices(deck.cards.length);
    };
    shuffleContainer(user, 'deck', 'deck_html', indices);

    for (let i = 0; i < drawAmount; i++){
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0, false, true);
    };

    if (user === 'self'){
        socket.emit('shuffleAndDraw', roomId, shuffleAmount, drawAmount, indices);
    };
}

export const shuffleBottomAndDraw = (user, shuffleAmount, drawAmount, indices) => {
    if (user === 'self'){
        indices = shuffleIndices(hand.cards.length);
    };
    shuffleContainer(user, 'hand', 'hand_html', indices);

    for (let i = 0; i < shuffleAmount; i++){
        moveCard(user, 'hand', 'hand_html', 'deck', 'deck_html', 0, false, true);
    };

    for (let i = 0; i < drawAmount; i++){
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0, false, true);
    };

    if (user === 'self'){
        socket.emit('shuffleBottomAndDraw', roomId, shuffleAmount, drawAmount, indices);
    };
}