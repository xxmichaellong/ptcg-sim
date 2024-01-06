import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

// Draw starting hand of 7 and prize 6
export const drawHand = (user) => {

    const drawAmount = Math.min(7, getZone(user, 'deck').getCount());

    for (let i = 0; i < drawAmount; i++){
        moveCard(user, 'deck', 'hand', 0);
    };

    const prizeAmount = Math.min(6, getZone(user, 'deck').getCount());

    for (let i = 0; i < prizeAmount; i++){
        moveCard(user, 'deck', 'prizes', 0);
    };
}

export const discardAndDraw = (user) => {
    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const selectedDeckCount = getZone(user, 'deck').getCount();
    const discardAmount = getZone(user, 'hand').getCount();

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, selectedDeckCount);

        for (let i = 0; i < discardAmount; i++){
            moveCard(user, 'hand', 'discard', 0);
        };
        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'hand', 0);
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
    const selectedDeckCount = getZone(user, 'deck').getCount();
    const shuffleAmount = getZone(user, 'hand').getCount();

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (selectedDeckCount + shuffleAmount));

        for (let i = 0; i < shuffleAmount; i++){
            moveCard(user, 'hand', 'deck', 0);
        };

        shuffleZone(user, 'deck');

        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'hand', 0);
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
    const selectedDeckCount = getZone(user, 'deck').getCount();
    const shuffleAmount = getZone(user, 'hand').getCount();
    
    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (selectedDeckCount + shuffleAmount));

        shuffleZone(user, 'hand');

        for (let i = 0; i < shuffleAmount; i++){
            moveCard(user, 'hand', 'deck', 0);
        };

        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'hand', 0);
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