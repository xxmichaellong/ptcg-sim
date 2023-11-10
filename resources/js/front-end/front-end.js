import { containerIds, selectedCard, prizes_html, lostzone_html, discard_html, deck, prizes, discard, 
    lostzone, active, stadium, bench, hand, deck_html, deckDisplay_html } from "./setup/initialization.js";
import { allowDrop, drop } from "./image-logic/drag.js";
import { drawHand } from "./general-actions/draw-hand.js";
import { moveEventTarget } from "./image-logic/move-event-target.js";
import { shufflePopupButton, shuffleContainer } from "./general-actions/shuffle-button.js";
import { pokestop } from "./card-logic/pokestop.js";
import { flowerSelecting } from "./card-logic/flower-selecting.js";
import { colresssExperiment } from "./card-logic/colress's-experiment.js";
import { oppContainersDocument, oppDeckDisplay_html } from "./setup/opp-initialization.js";
import { buildImage } from "./setup/build-image.js";

export const socket = io();

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
// Function to open the modal
prizesDisplayButton.addEventListener('click', () => {
    prizes_html.style.display = 'block';
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

const mainContainers = document.getElementById('mainContainers');

const mainContainersDocument = mainContainers.contentWindow.document;

const closePrizesDisplayButton = mainContainersDocument.getElementById('closePrizesDisplayButton');

// Function to close the modal
closePrizesDisplayButton.addEventListener('click', () => {
    prizes_html.style.display = 'none';
});

// Get the modal and image elements
const closeDeckDisplayButton = mainContainersDocument.getElementById('closeDeckDisplayButton');

// Function to close the modal
closeDeckDisplayButton.addEventListener('click', () => {
    deck_html.style.display = 'none';
});

// Get the modal and image elements
const closeLostzoneDisplayButton = mainContainersDocument.getElementById('closeLostzoneDisplayButton');

// Function to close the modal
closeLostzoneDisplayButton.addEventListener('click', () => {
    lostzone_html.style.display = 'none';
});

// Get the modal and image elements
const closeDiscardDisplayButton = mainContainersDocument.getElementById('closeDiscardDisplayButton');

// Function to close the modal
closeDiscardDisplayButton.addEventListener('click', () => {
    discard_html.style.display = 'none';
});

containerIds.forEach(id => {
    let container;
    if (id === 'stadium_html'){
        container = document.getElementById(id);
    }
    else
        container = mainContainersDocument.getElementById(id);
    container.addEventListener("dragover", allowDrop);
    container.addEventListener("drop", drop);
});

// Listen for the 'imageAppended' event from the server
socket.on('imageAppended', (imageAttributes, targetContainerId) => {
    const imageAppended = oppContainersDocument.createElement('img');              
    buildImage(imageAttributes, imageAppended);
    const targetContainer = oppContainersDocument.getElementById(targetContainerId);
    targetContainer.appendChild(imageAppended);
});

// Listen for the 'imageRemoved' event from the server
socket.on('imageRemoved', (imageAttributes, targetContainerId) => {
    const imageRemoved = oppContainersDocument.createElement('img');              
    buildImage(imageAttributes, imageRemoved);
    const targetContainer = oppContainersDocument.getElementById(targetContainerId);
    targetContainer.removeChild(imageRemoved);
});
