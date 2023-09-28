import { shuffle } from "./shuffle.js";
import { addCard } from "./addCard.js";
import { deck } from "./initialization.js";
import { deck_html } from "./initialization.js";
import { hand } from "./initialization.js";
import { hand_html } from "./initialization.js";

// Draw starting hand of 7
export function drawHand(){

    // Check if the container exists; if it does remove all images
   const container = document.getElementById('hand_html');
    if (container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        };
    };

    // Reset deck to an empty array
    deck.cards = [];

    // Add the cards to the deck array
    addCard(30, 'Comfey', 'cardScans/comfey.webp');
    addCard(30, 'Sableye', 'cardScans/sableye.webp');
  
    // Check if the total quantity is 60
    const totalQuantity = deck.count;
    if (totalQuantity !== 60) {
        const errormsg = `Total quantity should be 60. The current quantity is ${totalQuantity}.`;
        console.error(errormsg);
        deck_html.textContent = errormsg;
    } 
    // If deck is legal, proceed
    else {
        shuffle(deck.cards);

        // Display the shuffled deck
        console.log('Shuffled Decklist:');
        deck.cards.forEach((card, index) => {
            console.log(`${index + 1}. ${card.name}`);
        });

        // Populate Hand array with first 7 values of Deck
        hand.cards = deck.cards.splice(0, 7);
        
        hand.cards.forEach((card, index) => {
        // Create an <img> element
        const imgElement = document.createElement('img');
        
        // Set the src attribute to the image URL
        imgElement.src = card.image;
        // Set the alt attribute (alternative text for the image)
        imgElement.alt = card.name;

        //Add a data attribute to store the index
        imgElement.dataset.arrayIndex = index;

        //Add a click event listener to the image
        // imgElement.addEventListener('click', handleImageClick);

        // Append the <img> element to the container
        hand_html.appendChild(imgElement);
        });
    };
}
