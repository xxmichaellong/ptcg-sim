import { roomId } from "../front-end.js";
import { moveCard } from "../image-logic/move-card.js";
import { oppDeck, oppViewCards, oppViewCards_html } from "../setup/opp-initialization.js";
import { deck, sCard, viewCards, viewCards_html } from "../setup/self-initialization.js";
import { shuffleIndices } from "../setup/shuffle.js";
import { socket } from "../setup/socket.js";
import { hideCards, revealCards } from "./reveal-and-hide.js";
import { shuffleContainer } from "./shuffle-container.js";

export const draw = (user, drawAmount) => {
    for (let i = 0; i < drawAmount; i++){
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
    };
}

export const viewDeck = (user, viewAmount, targetOpp, top, deckCount) => {
    if (user === 'self'){
        viewCards_html.style.display = 'block';
    } else {
        oppViewCards_html.style.display = 'block';
    };
    if (top){
        for (let i = 0; i < viewAmount; i++){
            moveCard(user, 'deck', 'deck_html', 'viewCards', 'viewCards_html', i);
        };
    } else {
        for (let i = deckCount - 1; i > deckCount - 1 - viewAmount; i--){
            moveCard(user, 'deck', 'deck_html', 'viewCards', 'viewCards_html', i);
        };
    };
    if (targetOpp && user === 'opp'){
        revealCards(oppViewCards, oppViewCards_html);
    };
    if (targetOpp && user === 'self'){
        hideCards(viewCards, viewCards_html);
    };
}

export const shuffleIntoDeck = () => {
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
    
    const deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    const indices = shuffleIndices(deckCount);
    shuffleContainer(sCard.user, 'deck', 'deck_html', indices);

    socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'deck', 'deck_html', indices);
}

export const moveToDeckTop = () => {
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
    socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);

    //since card is appended to bottom, move all existing cards in deck to the bottom afterwards
    const deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;

    for (let i = 0; i < deckCount - 1; i++){
        moveCard(sCard.user, 'deck', 'deck_html', 'deck', 'deck_html', 0);
        socket.emit('moveCard', roomId, sCard.oUser, 'deck', 'deck_html', 'deck', 'deck_html', 0);
    };
}

export const switchWithDeckTop = () => {
    moveToDeckTop();
    const deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    if (deckCount > 1){
        moveCard(sCard.user, 'deck', 'deck_html', sCard.locationAsString, sCard.containerId, 1);
        socket.emit('moveCard', roomId, sCard.oUser, 'deck', 'deck_html', sCard.locationAsString, sCard.containerId, 0);
    };
}