import { deck, hand, oppDeck, oppHand, socket } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
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

export const discardAndDraw = (user) => {
    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const deckCount = user === 'self' ? deck.count : oppDeck.count;
    const discardAmount = user === 'self' ? hand.count : oppHand.count;

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, deckCount);

        for (let i = 0; i < discardAmount; i++){
            moveCard(user, 'hand', 'hand_html', 'discard', 'discard_html', 0);
        };
        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
        };

        let message;
        if (drawAmount > 0){
            message = determineUsername(user) + ' discarded hand and drew ' + drawAmount + ' card(s)';
        } else {
            message = determineUsername(user) + ' discarded hand';
        };
        appendMessage(user, message, 'player');
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
}

export const shuffleAndDraw = (user) => {

    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const deckCount = user === 'self' ? deck.count : oppDeck.count;
    const shuffleAmount = user === 'self' ? hand.count : oppHand.count;

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (deckCount + shuffleAmount));

        for (let i = 0; i < shuffleAmount; i++){
            moveCard(user, 'hand', 'hand_html', 'deck', 'deck_html', 0);
        };

        shuffleContainer(user, 'deck', 'deck_html');

        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
        };
        
        let message;
        if (drawAmount > 0){
            message = determineUsername(user) + ' shuffled hand into deck and drew ' + drawAmount + ' card(s)';
        } else {
            message = determineUsername(user) + ' shuffled hand into deck';
        };
        appendMessage(user, message, 'player');
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
}

export const shuffleBottomAndDraw = (user) => {
    
    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const deckCount = user === 'self' ? deck.count : oppDeck.count;
    const shuffleAmount = user === 'self' ? hand.count : oppHand.count;
    
    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (deckCount + shuffleAmount));

        shuffleContainer(user, 'hand', 'hand_html');

        for (let i = 0; i < shuffleAmount; i++){
            moveCard(user, 'hand', 'hand_html', 'deck', 'deck_html', 0);
        };

        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
        };
        let message;
        if (drawAmount > 0){
            message = determineUsername(user) + ' shuffled hand to bottom of deck and drew ' + drawAmount + ' card(s)';
        } else {
            message = determineUsername(user) + ' shuffled hand to bottom of deck';
        };
        appendMessage(user, message, 'player');
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
}