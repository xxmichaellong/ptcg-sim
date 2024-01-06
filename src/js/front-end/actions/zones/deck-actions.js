import { mouseClick, socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { moveCardMessage } from '../../setup/chatbox/move-card-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { hideCards } from '../general/reveal-and-hide.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { shuffleZone } from './shuffle-zone.js';

export const shuffleIntoDeck = () => {
    moveCardMessage(systemState.pov.user, mouseClick.card.name, mouseClick.zoneId, 'deck', 'shuffle', mouseClick.card.image.attached, mouseClick.card.image.faceDown, mouseClick.card.image.faceUp);
    moveCard(mouseClick.user, mouseClick.zoneId, 'deck', mouseClick.cardIndex);    
    shuffleZone(mouseClick.user, 'deck');
}

export const moveToDeckTop = () => {
    moveCardMessage(systemState.pov.user, mouseClick.card.name, mouseClick.zoneId, 'deck', 'top', mouseClick.card.image.attached, mouseClick.card.image.faceDown, mouseClick.card.image.faceUp);
    moveCard(mouseClick.user, mouseClick.zoneId, 'deck', mouseClick.cardIndex);
    //since card is appended to bottom, move all existing cards in deck to the bottom afterwards
    const selectedDeckCount = getZone(mouseClick.user, 'deck').getCount();
    for (let i = 0; i < selectedDeckCount - 1; i++){
        moveCard(mouseClick.user, 'deck', 'deck', 0);
    };
}

export const moveToDeckBottom = () => {
    moveCardMessage(systemState.pov.user, mouseClick.card.name, mouseClick.zoneId, 'deck', 'bottom', mouseClick.card.image.attached, mouseClick.card.image.faceDown, mouseClick.card.image.faceUp);
    moveCard(mouseClick.user, mouseClick.zoneId, 'deck', mouseClick.cardIndex);
}

export const moveToBoard = () => {
    moveCardMessage(systemState.pov.user, mouseClick.card.name, mouseClick.zoneId, 'board', 'move', mouseClick.card.image.attached, mouseClick.card.image.faceDown, mouseClick.card.image.faceUp);
    moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);
}

export const shuffleDeck = (user) => {
    shuffleZone(user, 'deck');
}

export const draw = (user) => {
    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const selectedDeckCount = getZone(user, 'deck').getCount();

    if (!isNaN(drawAmount) && drawAmount > 0){
        drawAmount = Math.min(drawAmount, selectedDeckCount);
        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deck', 'hand', 0);
        };
        let message;
        if (drawAmount > 1){
            message = determineUsername(user) + ' drew ' + drawAmount + ' cards';
        } else {
            message = determineUsername(user) + ' drew a card';
        };
        appendMessage(user, message, 'player');
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
}

export const handleViewButtonClick = (user, top) => {
    let viewAmount;
    const userInput = window.prompt('How many cards do you want to look at?', '1');
    viewAmount = parseInt(userInput);

    const selectedDeckCount = getZone(user, 'deck').getCount();
    const targetOpp = user === systemState.pov.oUser;

    if (!isNaN(viewAmount) && viewAmount >= 1){
        viewAmount = Math.min(viewAmount, selectedDeckCount);
        viewDeck(user, viewAmount, top, selectedDeckCount, targetOpp);
    } else {
        window.alert('Please enter a valid number for the view amount.');
    };
}

export const viewDeck = (user, viewAmount, top, selectedDeckCount, targetOpp, emit = true) => {
    const selectedViewCards = getZone(user, 'viewCards');
    selectedViewCards.element.style.display = 'block';

    if (top){
        for (let i = 0; i < viewAmount; i++){
            moveCard(user, 'deck', 'viewCards', 0, false, false);
        };
    } else {
        for (let i = selectedDeckCount - 1; i > selectedDeckCount - 1 - viewAmount; i--){
            moveCard(user, 'deck', 'viewCards', i, false, false);
        };
    };
    if (!emit && ((systemState.pov.user !== user && !targetOpp) || (systemState.pov.user === user && targetOpp))){
        hideCards(user, 'viewCards');
    };
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            user: oUser,
            viewAmount: viewAmount,
            top: top,
            selectedDeckCount: selectedDeckCount,
            targetOpp: targetOpp,
            emit : false
        };
        socket.emit('viewDeck', data);
    };
    const location = top ? 'top ' : 'bottom ';
    const owner = user === systemState.pov.user ? '' : "opponent's"
    const message = determineUsername(systemState.pov.user) + ' looked at ' + location + viewAmount + ' card(s) of ' + owner + ' deck';
    appendMessage(systemState.pov.user, message, 'player'); 
}

export const switchWithDeckTop = () => {
    moveCardMessage(systemState.pov.user, mouseClick.card.name, mouseClick.zoneId, 'deck', 'switch', mouseClick.card.image.attached, mouseClick.card.image.faceDown, mouseClick.card.image.faceUp);
    //first part is moving a card to the top of the deck
    moveCard(mouseClick.user, mouseClick.zoneId, 'deck', mouseClick.cardIndex);
    const initialDeckCount = getZone(mouseClick.user, 'deck').getCount();
    for (let i = 0; i < initialDeckCount - 1; i++){
        moveCard(mouseClick.user, 'deck', 'deck', 0);
    };

    const selectedDeckCount = getZone(mouseClick.user, 'deck').getCount();
    if (selectedDeckCount > 1){
        moveCard(mouseClick.user, 'deck', mouseClick.zoneId, 1);
    };
}