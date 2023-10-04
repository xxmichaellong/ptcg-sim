import { drawHand } from "./drawHand.js";
import { drawCard } from "./drawCard.js";
import { selectedCard } from "./initialization.js";
import { moveEventTarget } from "./moveEventTarget.js";

// Buttons

// Draw a Hand
const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', drawHand);

// Draw a Card from Deck
const drawCardButton = document.getElementById('drawCardButton');
drawCardButton.addEventListener('click', drawCard);

// Discard selected card
const discardCardButton = document.getElementById('discardCardButton');
discardCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'discard')});

// Bench selected card
const benchCardButton = document.getElementById('benchCardButton');
benchCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'bench')});

// Discard selected card
const lostzoneCardButton = document.getElementById('lostzoneCardButton');
lostzoneCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'lostzone')});

// Bench selected card
const stadiumCardButton = document.getElementById('stadiumCardButton');
stadiumCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'stadium')});

// Discard selected card
const prizesCardButton = document.getElementById('prizesCardButton');
prizesCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'prizes')});

// Bench selected card
const handCardButton = document.getElementById('handCardButton');
handCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'hand')});

// Discard selected card
const deckCardButton = document.getElementById('deckCardButton');
deckCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'deck')});

// Bench selected card
const activeCardButton = document.getElementById('activeCardButton');
activeCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, 'active')});


// Get the modal and image elements
const modal = document.getElementById('displayDeck');
const modalButton = document.getElementById('displayDeckButton');
const closeModalButton = document.getElementById('closeDisplayButton');

// Function to open the modal
modalButton.addEventListener('click', () => {
    modal.style.display = 'block';
});

// Function to close the modal
closeModalButton.addEventListener('click', () => {
    modal.style.display = 'none';
});
