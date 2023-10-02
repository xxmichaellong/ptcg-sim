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
import { imageClick } from "./imageClick.js";

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
    deck_html.innerHTML = "";
    lostzone_html.innerHTML = ""; 
    discard_html.innerHTML = ""; 
    stadium_html.innerHTML = ""; 
    prizes_html.innerHTML = ""; 
    active_html.innerHTML = ""; 
    bench_html.innerHTML = ""; 
    hand_html.innerHTML = ""; 

    // Add the cards to the deck array
    addCard(4, 'comfey', 'cardScans/comfey.webp');
    addCard(2, 'sableye', 'cardScans/sableye.webp');
    addCard(1, 'cramorant', 'cardScans/cramorant.webp');
    addCard(1, 'kyogre', 'cardScans/kyogre.webp');
    addCard(1, 'pidgeotV', 'cardScans/pidgeotV.webp');
    addCard(1, 'manaphy', 'cardScans/manaphy.webp');
    addCard(1, 'radiantGreninja', 'cardScans/radiantGreninja.webp');
    addCard(1, 'zamazenta', 'cardScans/zamazenta.webp');
    addCard(4, 'metal', 'cardScans/metal.webp');
    addCard(4, 'water', 'cardScans/water.webp');
    addCard(3, 'psychic', 'cardScans/psychic.webp');
    addCard(4, 'colress\'sExperiment', 'cardScans/colress\'sExperiment.webp');
    addCard(4, 'battleVipPass', 'cardScans/battleVipPass.webp');
    addCard(4, 'mirageGate', 'cardScans/mirageGate.webp');
    addCard(4, 'switchCart', 'cardScans/switchCart.webp');
    addCard(4, 'escapeRope', 'cardScans/escapeRope.webp');
    addCard(3, 'nestBall', 'cardScans/nestBall.jpg');
    addCard(3, 'superRod', 'cardScans/superRod.webp');
    addCard(2, 'energyRecycler', 'cardScans/energyRecycler.webp');
    addCard(2, 'lostVacuum', 'cardScans/lostVacuum.webp');
    addCard(1, 'echoingHorn', 'cardScans/echoingHorn.jpg');
    addCard(1, 'hisuianHeavyBall', 'cardScans/hisuianHeavyBall.webp');
    addCard(1, 'palPad', 'cardScans/palPad.webp');
    addCard(1, 'artazon', 'cardScans/artazon.webp');
    addCard(1, 'pokestop', 'cardScans/pokestop.webp');
    addCard(2, 'forestSealStone', 'cardScans/forestSealStone.webp');

    // Check if the total quantity is 60
    if (deck.count !== 60) {
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

        // Populate Hand array with first 7 values of Deck (and removing cards from deck)
        hand.cards = deck.cards.splice(0, 7);

        // Populate hand_html container with the images of each card
        hand.cards.forEach((card) => {
        // Create an <img> element
            const imgElement = document.createElement('img');
            // Set the src attribute to the image URL
            imgElement.src = card.image;
            // Set the alt attribute (alternative text for the image)
            imgElement.alt = card.name;
            //Add a click event listener to the image
            imgElement.addEventListener('click', imageClick);
            // Append the <img> element to the container
            hand_html.appendChild(imgElement);
            // Add the image to an array so we can access it later
            hand.images.push(imgElement);
        });

        // Populate prize card array with first 6 values of deck
        prizes.cards = deck.cards.splice(0, 6);

        // Populate hand_html container with the images of each card
        prizes.cards.forEach((card) => {
            // Create an <img> element
            const imgElement = document.createElement('img');
            // Set the src attribute to the image URL
            imgElement.src = card.image;
            // Set the alt attribute (alternative text for the image)
            imgElement.alt = card.name;
            //Add a click event listener to the image
            imgElement.addEventListener('click', imageClick);
            // Append the <img> element to the container
            prizes_html.appendChild(imgElement);
            // Add the image to an array so we can access it later
            prizes.images.push(imgElement);
        });
    };
}
