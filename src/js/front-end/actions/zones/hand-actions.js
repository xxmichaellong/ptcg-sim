import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

// Draw starting hand of 7 and prize 6
export const drawHand = (initiator, user) => {
    const drawAmount = Math.min(7, getZone(user, 'deck').getCount());
    for (let i = 0; i < drawAmount; i++){
        moveCard(initiator, user, 'deck', 'hand', 0)
    };
    const prizeAmount = Math.min(6, getZone(user, 'deck').getCount());
    for (let i = 0; i < prizeAmount; i++){
        moveCard(initiator, user, 'deck', 'prizes', 0);
    };
}

export const discardAndDraw = (initiator, user, drawAmount, emit = true) => {
    drawAmount = typeof drawAmount === 'number' ? drawAmount : parseInt(window.prompt('Draw how many cards?', '0'));
    const selectedDeckCount = getZone(user, 'deck').getCount();
    const discardAmount = getZone(user, 'hand').getCount();
    drawAmount = Math.min(drawAmount, selectedDeckCount);

    if (!isNaN(drawAmount) && drawAmount >= 0){

        for (let i = 0; i < discardAmount; i++){
            moveCard(initiator, user, 'hand', 'discard', 0);
        };
        for (let i = 0; i < drawAmount; i++){
            moveCard(initiator, user, 'deck', 'hand', 0);
        };

        let message;
        if (drawAmount > 0){
            message = determineUsername(initiator) + ' discarded hand and drew ' + drawAmount + ' card(s)';
        } else {
            message = determineUsername(initiator) + ' discarded hand';
        };
        appendMessage(initiator, message, 'player', false);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
        emit = false;
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            drawAmount: drawAmount,
            emit: false
        };
        socket.emit('discardAndDraw', data);
    };
}

export const shuffleAndDraw = (initiator, user, drawAmount, indices, emit = true) => {
    drawAmount = typeof drawAmount === 'number' ? drawAmount : parseInt(window.prompt('Draw how many cards?', '0'));
    const selectedDeckCount = getZone(user, 'deck').getCount();
    const shuffleAmount = getZone(user, 'hand').getCount();
    drawAmount = Math.min(drawAmount, (selectedDeckCount + shuffleAmount));

    if (!isNaN(drawAmount) && drawAmount >= 0){
        for (let i = 0; i < shuffleAmount; i++){
            moveCard(initiator, user, 'hand', 'deck', 0);
        };
        const newDeckCount = getZone(user, 'deck').getCount();
        indices = indices ? indices : shuffleIndices(newDeckCount);
        shuffleZone(initiator, user, 'deck', indices, false, false);
        for (let i = 0; i < drawAmount; i++){
            moveCard(initiator, user, 'deck', 'hand', 0);
        };
        let message;
        if (drawAmount > 0){
            message = determineUsername(initiator) + ' shuffled hand into deck and drew ' + drawAmount + ' card(s)';
        } else {
            message = determineUsername(initiator) + ' shuffled hand into deck';
        };
        appendMessage(initiator, message, 'player', false);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
        emit = false;
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            drawAmount: drawAmount,
            indices: indices,
            emit: false
        };
        socket.emit('shuffleAndDraw', data);
    };
}

export const shuffleBottomAndDraw = (initiator, user, drawAmount, indices, emit = true) => {
    drawAmount = typeof drawAmount === 'number' ? drawAmount : parseInt(window.prompt('Draw how many cards?', '0'));
    const selectedDeckCount = getZone(user, 'deck').getCount();
    const shuffleAmount = getZone(user, 'hand').getCount();
    drawAmount = Math.min(drawAmount, (selectedDeckCount + shuffleAmount));

    if (!isNaN(drawAmount) && drawAmount >= 0){
        indices = indices ? indices : shuffleIndices(shuffleAmount);
        shuffleZone(initiator, user, 'hand', indices, false, false);
        for (let i = 0; i < shuffleAmount; i++){
            moveCard(initiator, user, 'hand', 'deck', 0);
        };
        for (let i = 0; i < drawAmount; i++){
            moveCard(initiator, user, 'deck', 'hand', 0);
        };
        let message;
        if (drawAmount > 0){
            message = determineUsername(initiator) + ' shuffled hand to bottom of deck and drew ' + drawAmount + ' card(s)';
        } else {
            message = determineUsername(initiator) + ' shuffled hand to bottom of deck';
        };
        appendMessage(initiator, message, 'player', false);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
        emit = false;
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            drawAmount: drawAmount,
            indices: indices,
            emit: false
        };
        socket.emit('shuffleBottomAndDraw', data);
    };
}