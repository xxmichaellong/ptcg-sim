import { moveCard } from "../image-logic/move-card.js";
import { oppDeck, oppViewCards, oppViewCards_html } from "../setup/opp-initialization.js";
import { deck, viewCards, viewCards_html } from "../setup/self-initialization.js";
import { hideCards, revealCards } from "./reveal-and-hide.js";

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