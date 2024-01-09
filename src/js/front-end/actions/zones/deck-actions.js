import { mouseClick, socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { stopLookingAtCards } from '../general/reveal-and-hide.js';
import { moveCardBundle } from '../move-card-bundle/move-card-bundle.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

export const shuffleIntoDeck = (initiator, user, zoneId, index, indices, emit = true) => {
    moveCardBundle(initiator, user, zoneId, 'deck', index, false, 'shuffle', false);
    const deck = getZone(user, 'deck');
    indices = indices ? indices : shuffleIndices(deck.getCount());
    shuffleZone(initiator, user, 'deck', indices, false, false);
    
    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            index: index,
            indices: indices,
            emit: false
        };
        socket.emit('shuffleIntoDeck', data);
    };
}

export const moveToDeckTop = (initiator, user, oZoneId, index, emit = true) => {
    moveCardBundle(initiator, user, oZoneId, 'deck', index, false, 'top', false);
    //since card is appended to bottom, move all existing cards in deck to the bottom afterwards
    const selectedDeckCount = getZone(mouseClick.cardUser, 'deck').getCount();
    for (let i = 0; i < selectedDeckCount - 1; i++){
        moveCard(initiator, user, 'deck', 'deck', 0);
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            oZoneId: oZoneId,
            index: index,
            emit: false
        };
        socket.emit('moveToDeckTop', data);
    };
}

export const moveToDeckBottom = (initiator, user, oZoneId, index) => {
    moveCardBundle(initiator, user, oZoneId, 'deck', index, false, 'bottom');
}

export const moveToBoard = (initiator, user, oZoneId, index) => {
    moveCardBundle(initiator, user, oZoneId, 'board', index, false, 'move');
}

export const draw = (initiator, user, drawAmount, emit = true) => {
    drawAmount = drawAmount? drawAmount : parseInt(window.prompt('Draw how many cards?', '1'))
    const selectedDeckCount = getZone(user, 'deck').getCount();
    drawAmount = Math.min(drawAmount, selectedDeckCount);

    if (!isNaN(drawAmount) && drawAmount > 0){
        for (let i = 0; i < drawAmount; i++){
            moveCard(initiator, user, 'deck', 'hand', 0);
        };
        let message;
        if (drawAmount > 1){
            message = determineUsername(initiator) + ' drew ' + drawAmount + ' cards';
        } else {
            message = determineUsername(initiator) + ' drew a card';
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
        socket.emit('draw', data);
    };
}

export const handleViewButtonClick = (user, top) => {
    const targetIsOpp = user !== systemState.initiator;

    let viewAmount;
    const userInput = window.prompt('How many cards do you want to look at?', '1');
    viewAmount = parseInt(userInput);
    const selectedDeckCount = getZone(user, 'deck').getCount();
    
    viewAmount = Math.min(viewAmount, selectedDeckCount);
    if (!isNaN(viewAmount) && viewAmount >= 1){
        viewDeck(systemState.initiator, user, viewAmount, top, selectedDeckCount, targetIsOpp);
    } else {
        window.alert('Please enter a valid number for the view amount.');
    };
}

export const viewDeck = (initiator, user, viewAmount, top, selectedDeckCount, targetIsOpp, emit = true) => {
    const selectedViewCards = getZone(user, 'viewCards');
    selectedViewCards.element.style.display = 'block';

    if (top){
        for (let i = 0; i < viewAmount; i++){
            moveCard(initiator, user, 'deck', 'viewCards', 0);
        };
    } else {
        for (let i = selectedDeckCount - 1; i > selectedDeckCount - 1 - viewAmount; i--){
            moveCard(initiator, user, 'deck', 'viewCards', i);
        };
    };
    if (!emit && ((initiator !== user && !targetIsOpp) || (initiator === user && targetIsOpp))){
        stopLookingAtCards(initiator, user, 'viewCards', false, false);
    };

    const location = top ? 'top ' : 'bottom ';
    const owner = user === initiator ? '' : "opponent's"
    const message = determineUsername(initiator) + ' looked at ' + location + viewAmount + ' card(s) of ' + owner + ' deck';
    appendMessage(initiator, message, 'player', false); 

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            viewAmount: viewAmount,
            top: top,
            selectedDeckCount: selectedDeckCount,
            targetIsOpp: targetIsOpp,
            emit: false
        };
        socket.emit('viewDeck', data);
    };
}

export const switchWithDeckTop = (initiator, user, oZoneId, index, emit = true) => {
    if (oZoneId !== 'deck' && oZoneId !== 'deckCover'){
        moveCardBundle(initiator, user, oZoneId, 'deck', index, false, 'switch', false);  //first part is moving a card to the top of the deck
        const initialDeckCount = getZone(user, 'deck').getCount();
        for (let i = 0; i < initialDeckCount - 1; i++){
            moveCard(initiator, user, 'deck', 'deck', 0);
        };
        const selectedDeckCount = getZone(user, 'deck').getCount();
        if (selectedDeckCount > 1){
            moveCard(initiator, user, 'deck', oZoneId, 1);
        };

        if (systemState.isTwoPlayer && emit){
            initiator = initiator === 'self' ? 'opp' : 'self';
            user = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId: systemState.roomId,
                initiator: initiator,
                user: user,
                oZoneId: oZoneId,
                index: index,
                emit: false
            };
            socket.emit('switchWithDeckTop', data);
        };
    };
}