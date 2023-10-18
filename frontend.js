import { containerIds, selectedCard, prizes_html, lostzone_html, discard_html, deck, prizes, discard, lostzone, active, stadium, bench, hand, deck_html, hand_html, deckDisplay_html } from "./initialization.js";
import { allowDrop, drop } from "./drag.js";
import { drawHand } from "./drawHand.js";
import { moveEventTarget } from "./moveEventTarget.js";
import { shufflePopupButton } from "./shuffleButton.js";
import { shuffleContainer } from "./shuffleButton.js";
import { pokestop } from "./pokestop.js";
import { flowerSelecting } from "./flowerSelecting.js";
import { colresssExperiment } from "./colress'sExperiment.js";

export const socket = io();

/* 
const frontEndPlayers = {};

socket.on('updatePlayers', (backEndPlayers) => {
    for (const id in backEndPlayers){
        if (!frontEndPlayers[id]){
            frontEndPlayers[id] = new Player({
                radius:10
            })
        }
    }
})

for (const id in frontEndPlayers){
    if (!backEndPlayers[id]){
        delete frontEndPlayers[id]
    }
} */

//more socket stuff
// Listen for the 'imageAppended' event from the server
socket.on('imageAppended', (imageAttributes) => {

    const coverImage = document.createElement('img');              
    // Set image attributes and event listeners
    for (const attr in imageAttributes) {
        if (typeof imageAttributes[attr] === 'function') {
            // If it's a function (an event listener), add it as an event listener
            coverImage.addEventListener(attr, imageAttributes[attr]);
        } else {
            // Otherwise, set it as an attribute
            coverImage.setAttribute(attr, imageAttributes[attr]);
        };
    }

    deckDisplay_html.appendChild(coverImage);
});



// Buttons

// Draw a Hand
const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', drawHand);

// Shuffle deck or prize cards
const shuffleButton = document.getElementById('shuffleButton');
shuffleButton.addEventListener('click', shufflePopupButton);

const shuffleDeckButton = document.getElementById('shuffleDeckButton');
shuffleDeckButton.addEventListener('click', function() {shuffleContainer('deck_html')});

const shufflePrizesButton = document.getElementById('shufflePrizesButton');
shufflePrizesButton.addEventListener('click', function() {shuffleContainer('prizes_html')});

// Discard selected card
const discardCardButton = document.getElementById('discardCardButton');
discardCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, discard)});

// Bench selected card
const benchCardButton = document.getElementById('benchCardButton');
benchCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, bench)});

// lostzone selected card
const lostzoneCardButton = document.getElementById('lostzoneCardButton');
lostzoneCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, lostzone)});

// stadium selected card
const stadiumCardButton = document.getElementById('stadiumCardButton');
stadiumCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, stadium)});

// prize selected card
const prizesCardButton = document.getElementById('prizesCardButton');
prizesCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, prizes)});

// hand selected card
const handCardButton = document.getElementById('handCardButton');
handCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, hand)});

// deck selected card
const deckCardButton = document.getElementById('deckCardButton');
deckCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, deck)});

// active selected card
const activeCardButton = document.getElementById('activeCardButton');
activeCardButton.addEventListener('click', function() {moveEventTarget(selectedCard, active)});

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
const closeDeckDisplayButton = document.getElementById('closeDeckDisplayButton');

// Function to close the modal
closeDeckDisplayButton.addEventListener('click', () => {
    deck_html.style.display = 'none';
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

containerIds.forEach(id => {
    const container = document.getElementById(id);
    container.addEventListener("dragover", allowDrop);
    container.addEventListener("drop", drop);
});

// pokestop function
const pokestopButton = document.getElementById('pokestopButton');
pokestopButton.addEventListener('click', pokestop);

// flowerSelecting function
const flowerSelectingButton = document.getElementById('flowerSelectingButton');
flowerSelectingButton.addEventListener('click', flowerSelecting);

// colress Experiment function
const colresssExperimentButton = document.getElementById('colresssExperimentButton');
colresssExperimentButton.addEventListener('click', colresssExperiment);