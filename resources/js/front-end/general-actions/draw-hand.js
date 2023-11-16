import { deck, deckDisplay_html } from "../setup/initialization.js"
import { moveCard } from "../image-logic/move-card.js";
import { makeDeckCover } from "../card-types/deck-cover.js";
import { cleanUp } from "../setup/clean-up.js";
import { shuffleContainer } from "./shuffle-container.js";
import { socket } from "../front-end.js";
import { shuffleIndices } from "../setup/shuffle.js";
import { _deckDisplay_html, _deck, _deck_html, _hand, _hand_html, _prizes, _prizes_html } from "../setup/update-user.js";
import { oppDeckDisplay_html } from "../setup/opp-initialization.js";
import { buildDeck } from "./build-deck.js";

// Draw starting hand of 7
export function drawHand(user, indices){

    cleanUp(user);
    // Add the cards to the deck array + append to deck_html container
    buildDeck(user);
    //shuffle the indices only if it's the own user
    if (user === 'self'){
        indices = shuffleIndices(deck.cards.length);
    };
    shuffleContainer(user, 'deck', indices);

    // Append the <img> element to the deck display
    if (user === 'self'){
        deckDisplay_html.appendChild(makeDeckCover(user).image);
    } else {
        oppDeckDisplay_html.appendChild(makeDeckCover(user).image);
    };

    // Populate hand array/container with first 7 values of Deck (and removing cards from deck)
    for (let i = 0; i < 7; i++){
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
    };

    // Populate prize array/container with first 6 values of Deck
    for (let i = 0; i < 6; i++){
        moveCard(user, 'deck', 'deck_html', 'prizes', 'prizes_html', 0);
    };

    if (user === 'self')
        socket.emit('drawHand', 'opp', indices);
}