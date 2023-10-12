import { drawHand } from "./drawHand.js";
import { drawCard } from "./drawCard.js";
import { selectedCard } from "./initialization.js";
import { moveEventTarget } from "./moveEventTarget.js";
import { deck } from "./initialization.js";
import { deckDisplay_html } from "./initialization.js";
import { prizes } from "./initialization.js";
import { prizes_html } from "./initialization.js";
import { lostzone_html } from "./initialization.js";
import { discard_html } from "./initialization.js";
import { allowDrop } from "./drag.js";
import { drop } from "./drag.js";

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
const deckDisplayButton = document.getElementById('deckDisplayButton');
const closeDeckDisplayButton = document.getElementById('closeDeckDisplayButton');

// Function to open the modal
deckDisplayButton.addEventListener('click', () => {
    deckDisplay_html.style.display = 'block';
    deck.images.forEach(image => {
        image.style.display = 'inline-block';
    });
});

// Function to close the modal
closeDeckDisplayButton.addEventListener('click', () => {
    deckDisplay_html.style.display = 'none';
});

// Get the modal and image elements
const prizesDisplayButton = document.getElementById('prizesDisplayButton');
const closePrizesDisplayButton = document.getElementById('closePrizesDisplayButton');

// Function to open the modal
prizesDisplayButton.addEventListener('click', () => {
    prizes_html.style.display = 'block';
    prizes.images.forEach(image => {
        image.style.display = 'inline-block';
    });
});

// Function to close the modal
closePrizesDisplayButton.addEventListener('click', () => {
    prizes_html.style.display = 'none';
});

// Get the modal and image elements
const closeLostzoneDisplayButton = document.getElementById('closeLostzoneDisplayButton');

// Function to close the modal
closeLostzoneDisplayButton.addEventListener('click', () => {
    lostzone_html.style.display = 'none';
});

// Get the modal and image elements
const closeDiscardDisplayButton = document.getElementById('closeDiscardDisplayButton');

// Function to close the modal
closeDiscardDisplayButton.addEventListener('click', () => {
    discard_html.style.display = 'none';
});

// Drag and drop functions
const containerIds = [
    "hand_html",
    "prizesHidden_html",
    "prizes_html",
    "lostzoneDisplay_html",
    "lostzone_html",
    "active_html",
    "stadium_html",
    "bench_html",
    "deckDisplay_html",
    "deck_html",
    "discard_html",
    "discardDisplay_html"
  ];
  
  containerIds.forEach(id => {
    const container = document.getElementById(id);
    container.addEventListener("dragover", allowDrop);
    container.addEventListener("drop", drop);
  });
  