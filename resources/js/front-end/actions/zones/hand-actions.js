import { deckArray, handArray, oppDeckArray, oppHandArray } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { shuffleZone } from './shuffle-zone.js';
import { getZoneCount } from '../general/count.js';

// Draw starting hand of 7
export const drawHand = (user) => {

    const selectedHandCount = Math.min(7, getZoneCount(stringToVariable(user, 'deckArray')));

    for (let i = 0; i < selectedHandCount; i++){
        moveCard(user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0);
    };

    const prizeCount = Math.min(6, getZoneCount(stringToVariable(user, 'deckArray')));

    for (let i = 0; i < prizeCount; i++){
        moveCard(user, 'deckArray', 'deckElement', 'prizesArray', 'prizesElement', 0);
    };
}

export const discardAndDraw = (user) => {
    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const selectedDeckCount = user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    const discardAmount = user === 'self' ? getZoneCount(handArray) : getZoneCount(oppHandArray);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, selectedDeckCount);

        for (let i = 0; i < discardAmount; i++){
            moveCard(user, 'handArray', 'handElement', 'discardArray', 'discardElement', 0);
        };
        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0);
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
    const selectedDeckCount = user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    const shuffleAmount = user === 'self' ? getZoneCount(handArray) : getZoneCount(oppHandArray);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (selectedDeckCount + shuffleAmount));

        for (let i = 0; i < shuffleAmount; i++){
            moveCard(user, 'handArray', 'handElement', 'deckArray', 'deckElement', 0);
        };

        shuffleZone(user, 'deckArray', 'deckElement');

        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0);
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
    const selectedDeckCount = user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    const shuffleAmount = user === 'self' ? getZoneCount(handArray) : getZoneCount(oppHandArray);
    
    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (selectedDeckCount + shuffleAmount));

        shuffleZone(user, 'handArray', 'handElement');

        for (let i = 0; i < shuffleAmount; i++){
            moveCard(user, 'handArray', 'handElement', 'deckArray', 'deckElement', 0);
        };

        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0);
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