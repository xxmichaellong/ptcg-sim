import {selectedCard, prizes_html, lostzone_html, discard_html, prizes, deck_html } from "./initialization.js";
import { drawHand } from "../general-actions/draw-hand.js";
import { triggerShufflePopup, shuffleButtonFunction } from "../general-actions/shuffle-container.js";
import { pokestop } from "../card-logic/pokestop.js";
import { flowerSelecting } from "../card-logic/flower-selecting.js";
import { colresssExperiment } from "../card-logic/colress's-experiment.js";
import { triggerRevealAndHidePopup, revealCards, hideCards } from "../general-actions/reveal-and-hide-button.js"; 
import { selfContainersDocument } from "./initialization.js";
import { oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html } from "./opp-initialization.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";
import { variableToString } from "./string-to-variable.js";
import { socket } from "./socket.js";
import { addSpecialCondition } from "../general-actions/special-condition.js";
import { roomId } from "../start-page/generate-id.js";

// Draw a Hand
export const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', function(){drawHand('self')});

// Shuffle deck or prize cards
export const shuffleButton = document.getElementById('shuffleButton');
shuffleButton.addEventListener('click', triggerShufflePopup);

export const shuffleDeckButton = document.getElementById('shuffleDeckButton');
shuffleDeckButton.addEventListener('click', function(){shuffleButtonFunction ('self', 'deck')});

export const shufflePrizesButton = document.getElementById('shufflePrizesButton');
shufflePrizesButton.addEventListener('click', function(){shuffleButtonFunction ('self', 'prizes')});

// pokestop function
export const pokestopButton = document.getElementById('pokestopButton');
pokestopButton.addEventListener('click', pokestop);

// flowerSelecting function
export const flowerSelectingButton = document.getElementById('flowerSelectingButton');
flowerSelectingButton.addEventListener('click', flowerSelecting);

// colress Experiment function
export const colresssExperimentButton = document.getElementById('colresssExperimentButton');
colresssExperimentButton.addEventListener('click', colresssExperiment);

// Get the modal and image elements
export const closeDeckDisplayButton = selfContainersDocument.getElementById('closeDeckDisplayButton');

// Function to close the modal
closeDeckDisplayButton.addEventListener('click', () => {
    deck_html.style.display = 'none';
});

// Get the modal and image elements
export const closeLostzoneDisplayButton = selfContainersDocument.getElementById('closeLostzoneDisplayButton');

// Function to close the modal
closeLostzoneDisplayButton.addEventListener('click', () => {
    lostzone_html.style.display = 'none';
});

// Get the modal and image elements
export const closeDiscardDisplayButton = selfContainersDocument.getElementById('closeDiscardDisplayButton');

// Function to close the modal
closeDiscardDisplayButton.addEventListener('click', () => {
    discard_html.style.display = 'none';
});

export const revealAndHideButton = document.getElementById('revealAndHideButton');
revealAndHideButton.addEventListener('click', triggerRevealAndHidePopup);

// Reveal prizes
export const revealPrizesButton = document.getElementById('revealPrizesButton');
revealPrizesButton.addEventListener('click', function(){revealCards(prizes, prizes_html)});

// Hide prizes
export const hidePrizesButton = document.getElementById('hidePrizesButton');
hidePrizesButton.addEventListener('click', function(){hideCards(prizes, prizes_html)});

/// buttons on the opp side
// Get the modal and image elements
export const closeOppLostzoneDisplayButton = oppContainersDocument.getElementById('closeLostzoneDisplayButton');

// Function to close the modal
closeOppLostzoneDisplayButton.addEventListener('click', () => {
    oppLostzone_html.style.display = 'none';
});

// Get the modal and image elements
export const closeOppDiscardDisplayButton = oppContainersDocument.getElementById('closeDiscardDisplayButton');

// Function to close the modal
closeOppDiscardDisplayButton.addEventListener('click', () => {
    oppDiscard_html.style.display = 'none';
});

export const closeOppDeckDisplayButton = oppContainersDocument.getElementById('closeDeckDisplayButton');

// Function to close the modal
closeOppDeckDisplayButton.addEventListener('click', () => {
    oppDeck_html.style.display = 'none';
});

export const damageCounterButton = document.getElementById('damageCounterButton');
damageCounterButton.addEventListener('click', function(){
    addDamageCounter(selectedCard.user, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
    socket.emit('addDamageCounter', roomId, selectedCard.oUser, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
});
 
export const specialConditionButton = document.getElementById('specialConditionButton');
specialConditionButton.addEventListener('click', function(){
    addSpecialCondition(selectedCard.user, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
    socket.emit('addSpecialCondition', roomId, selectedCard.oUser, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
});