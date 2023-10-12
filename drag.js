import { hand_html, hand, discard, discard_html, prizes, prizes_html, lostzone, lostzone_html, 
    bench, bench_html, active, active_html, stadium, stadium_html, deck, selectedCard, prizesHidden_html } from "./initialization.js";
import { moveEventTarget } from "./moveEventTarget.js";

// Add this function to initiate the drag operation
export function dragStart(event) {
    if (event.target.parentElement === hand_html){
        selectedCard.index = hand.images.indexOf(event.target);
        selectedCard.location = 'hand';
    }
    else if (event.target.parentElement === discard_html){
        selectedCard.index = discard.images.indexOf(event.target);
        selectedCard.location = 'discard';
    }
    else if (event.target.parentElement === prizes_html) {
        selectedCard.index = prizes.images.indexOf(event.target);
        selectedCard.location = 'prizes';
    }
    else if (event.target.parentElement === prizesHidden_html) {
        selectedCard.index = 0;
        selectedCard.location = 'prizes';
    }
    else if (event.target.parentElement === lostzone_html){
        selectedCard.index = lostzone.images.indexOf(event.target);
        selectedCard.location = 'lostzone';
    }
    else if (event.target.parentElement === stadium_html){
        selectedCard.index = stadium.images.indexOf(event.target);
        selectedCard.location = 'stadium';
    }
    else if (event.target.parentElement === bench_html){
        selectedCard.index = bench.images.indexOf(event.target);
        selectedCard.location = 'bench';
    }
    else if (event.target.parentElement === active_html){
        selectedCard.index = active.images.indexOf(event.target);
        selectedCard.location = 'active';
    }
    else {
        selectedCard.index = deck.images.indexOf(event.target);
        selectedCard.location = 'deck';
    };
}

// Add this function to allow dropping in the hand container
export function allowDrop(event) {
    event.preventDefault();
}

// Add this function to handle the drop operation
export function drop(event) {
    event.preventDefault();
    
    let mLocation; // Initialize mLocation

    // Determine the mLocation based on the ID of the target element
    if (event.target.id === "hand_html") {
        mLocation = 'hand';
    } else if (event.target.id === "discardDisplay_html") {
        mLocation = 'discard';
    } else if (event.target.id === "discard_html") {
        mLocation = 'discard';
    } else if (event.target.id === "prizesHidden_html") {
        mLocation = 'prizes';
    } else if (event.target.id === "prizes_html") {
        mLocation = 'prizes';
    } else if (event.target.id === "lostzoneDisplay_html") {
        mLocation = 'lostzone';
    } else if (event.target.id === "lostzone_html") {
        mLocation = 'lostzone';
    } else if (event.target.id === "active_html") {
        mLocation = 'active';
    } else if (event.target.id === "stadium_html") {
        mLocation = 'stadium';
    } else if (event.target.id === "bench_html") {
        mLocation = 'bench';
    } else if (event.target.id === "deck_html") {
        mLocation = 'deck';
    } else if (event.target.id === "deckDisplay_html") {
        mLocation = 'deck';
    }
    moveEventTarget(selectedCard, mLocation);
}