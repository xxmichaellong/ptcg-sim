import { deckArray, oppDeckArray, oppViewCardsElement, systemState, sCard, socket, viewCardsElement } from '../../front-end.js';
import { moveCardMessage } from '../../setup/chatbox/move-card-message.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { hideCards } from '../general/reveal-and-hide.js';
import { shuffleZone } from './shuffle-zone.js';
import { getZoneCount } from '../general/count.js';

export const shuffleIntoDeck = () => {
    moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, 'deckArray', 'shuffle', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
    moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'deckArray', 'deckElement', sCard.index);    
    shuffleZone(sCard.user, 'deckArray', 'deckElement');
}

export const moveToDeckTop = () => {
    moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, 'deckArray', 'top', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
    moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'deckArray', 'deckElement', sCard.index);
    //since card is appended to bottom, move all existing cards in deck to the bottom afterwards
    const selectedDeckCount = sCard.user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    for (let i = 0; i < selectedDeckCount - 1; i++){
        moveCard(sCard.user, 'deckArray', 'deckElement', 'deckArray', 'deckElement', 0);
    };
}

export const moveToDeckBottom = () => {
    moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, 'deckArray', 'bottom', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
    moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'deckArray', 'deckElement', sCard.index);
}

export const moveToBoard = () => {
    moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, 'boardArray', 'move', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
    moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'boardArray', 'boardElement', sCard.index);
}

export const shuffleDeck = (user) => {
    shuffleZone(user, 'deckArray', 'deckElement');
}

export const draw = (user) => {
    let drawAmount;
    const userInput = window.prompt('Draw how many cards?', '0');
    drawAmount = parseInt(userInput);
    const selectedDeckCount = user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);

    if (!isNaN(drawAmount) && drawAmount > 0){
        drawAmount = Math.min(drawAmount, selectedDeckCount);
        for (let i = 0; i < drawAmount; i++){
            moveCard(user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0);
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

    const selectedDeckCount = user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    const targetOpp = user === systemState.pov.oUser;

    if (!isNaN(viewAmount) && viewAmount >= 1){
        viewAmount = Math.min(viewAmount, selectedDeckCount);
        viewDeck(user, viewAmount, top, selectedDeckCount, targetOpp);
    } else {
        window.alert('Please enter a valid number for the view amount.');
    };
}

export const viewDeck = (user, viewAmount, top, selectedDeckCount, targetOpp, emit = true) => {
    const selectedViewCardsElement = user === 'self' ? viewCardsElement : oppViewCardsElement;
    selectedViewCardsElement.style.display = 'block';

    if (top){
        for (let i = 0; i < viewAmount; i++){
            moveCard(user, 'deckArray', 'deckElement', 'viewCardsArray', 'viewCardsElement', 0, false, false);
        };
    } else {
        for (let i = selectedDeckCount - 1; i > selectedDeckCount - 1 - viewAmount; i--){
            moveCard(user, 'deckArray', 'deckElement', 'viewCardsArray', 'viewCardsElement', i, false, false);
        };
    };
    if (!emit && ((systemState.pov.user !== user && !targetOpp) || (systemState.pov.user === user && targetOpp))){
        hideCards(user, 'viewCardsArray', 'viewCardsElement');
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
    const owner = user === 'self' ? '' : "opponent's"
    const message = determineUsername(systemState.pov.user) + ' looked at ' + location + viewAmount + ' card(s) of ' + owner + ' deck';
    appendMessage(systemState.pov.user, message, 'player'); 
}

export const switchWithDeckTop = () => {
    moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, 'deckArray', 'switch', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
    //first part is moving a card to the top of the deck
    moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'deckArray', 'deckElement', sCard.index);
    const initialDeckCount = sCard.user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    for (let i = 0; i < initialDeckCount - 1; i++){
        moveCard(sCard.user, 'deckArray', 'deckElement', 'deckArray', 'deckElement', 0);
    };

    const selectedDeckCount = sCard.user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    if (selectedDeckCount > 1){
        moveCard(sCard.user, 'deckArray', 'deckElement', sCard.zoneArrayString, sCard.zoneElementString, 1);
    };
}