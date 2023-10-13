import { shuffle } from "./shuffle.js";
import { addCard } from "./addCard.js";
import { moveCard } from "./moveCard.js";
import { removeImages } from "./removeImages.js";
import { updateCount } from "./counts.js";
import { deck, deck_html, deckDisplay_html, hand, hand_html, lostzone, lostzone_html, discard, discard_html, stadium, stadium_html, prizes, 
prizes_html, active, active_html, bench, bench_html, cardData, prizesHidden_html, lostzoneDisplay_html, discardDisplay_html } from "./initialization.js";
import { allowDrop, drop } from "./drag.js";

// Draw starting hand of 7
export function drawHand(){

    // Reset all initialized parameters
    const cardContainers = [deck, lostzone, discard, stadium, prizes, active, bench, hand];

    for (const container of cardContainers) {
        container.cards = [];
        container.images = [];
    }
    
    [deckDisplay_html, deck_html, lostzone_html, discard_html, stadium_html, prizes_html, active_html, bench_html, hand_html, prizesHidden_html, lostzoneDisplay_html, discardDisplay_html].forEach((container) => {
        removeImages(container);
    });

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
        deckDisplay_html.textContent = errormsg;
    } 
    // If deck is legal, proceed
    else {
        shuffle(deck.cards, deck.images);
        // Append the <img> element to the deck display modal

        for (let i=0; i<deck.count; i++){
            deck_html.appendChild(deck.images[i]);
        }

        //Append deck display
        const coverImage = document.createElement('img');
        coverImage.src = 'cardScans/cardback.png';
        coverImage.draggable = false;
        coverImage.id = "deckCover"; //id to reference for dropping
        coverImage.addEventListener("dragover", allowDrop);
        coverImage.addEventListener("drop", drop);
        // Function to open the modal
        coverImage.addEventListener('click', () => {
            deck_html.style.display = 'block';
            deck.images.forEach(image => {
                image.style.display = 'inline-block';
            });
        });
        deckDisplay_html.appendChild(coverImage);
        
        // Populate Hand array with first 7 values of Deck (and removing cards from deck)

        for (let i=0; i<7; i++){
            moveCard(deck, deck_html, hand, hand_html, i);
        };

        // Populate prize array with first 6 values of Deck
        
        for (let i=0; i<6; i++){
            moveCard(deck, deck_html, prizes, prizes_html, i);
        };

        updateCount();
    };
}