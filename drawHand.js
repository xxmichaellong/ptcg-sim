import { shuffle } from "./shuffle.js";
import { addCard } from "./addCard.js";
import { deck } from "./initialization.js";
import { deck_html } from "./initialization.js";
import { hand } from "./initialization.js";
import { hand_html } from "./initialization.js";
import { lostzone } from "./initialization.js";
import { lostzone_html } from "./initialization.js";
import { discard } from "./initialization.js";
import { discard_html } from "./initialization.js";
import { stadium } from "./initialization.js";
import { stadium_html } from "./initialization.js";
import { prizes } from "./initialization.js";
import { prizes_html } from "./initialization.js";
import { active } from "./initialization.js";
import { active_html } from "./initialization.js";
import { bench } from "./initialization.js";
import { bench_html } from "./initialization.js";
import { moveCard } from "./moveCard.js";
import { cardData } from "./initialization.js";

// Draw starting hand of 7
export function drawHand(){

    // Check if the container exists; if it does remove all images
   const container = document.getElementById('hand_html');
    if (container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        };
    };

    // Reset all initialized parameters
    deck.cards = [];
    lostzone.cards = [];
    discard.cards = [];
    stadium.cards = [];
    prizes.cards = [];
    active.cards = [];
    bench.cards = [];
    hand.cards = [];
    deck.images = [];
    lostzone.images = [];
    discard.images = [];
    stadium.images = [];
    prizes.images = [];
    active.images = [];
    bench.images = [];
    hand.images = [];
    deck_html.innerHTML = "";
    lostzone_html.innerHTML = ""; 
    discard_html.innerHTML = ""; 
    stadium_html.innerHTML = ""; 
    prizes_html.innerHTML = ""; 
    active_html.innerHTML = ""; 
    bench_html.innerHTML = ""; 
    hand_html.innerHTML = ""; 

    // Add the cards to the deck array

    // Loop through the card data and call addCard for each entry.
    for (const [quantity, name, imageUrl] of cardData) {
        for (let i = 0; i < quantity; i++) {
            addCard(1, name, imageUrl);
        };
    }

    // Check if the total quantity is 60
    if (deck.count !== 60) {
        const errormsg = `Total quantity should be 60. The current quantity is ${totalQuantity}.`;
        console.error(errormsg);
        deck_html.textContent = errormsg;
    } 
    // If deck is legal, proceed
    else {
        shuffle(deck.cards, deck.images);

        // Display the shuffled deck
        console.log('Shuffled Decklist:');
        deck.cards.forEach((card, index) => {
            console.log(`${index + 1}. ${card.name}`);
        });
        
        // Populate Hand array with first 7 values of Deck (and removing cards from deck)

        for (let i=0; i<7; i++){
            moveCard(deck, deck_html, hand, hand_html, i);
        };

        // Populate prize array with first 6 values of Deck
        
        for (let i=0; i<6; i++){
            moveCard(deck, deck_html, prizes, prizes_html, i);
        };
    };
}