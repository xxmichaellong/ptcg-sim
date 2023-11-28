import { containerIds } from "./setup/initialization.js";
import { dragLeave, dragOver, drop } from "./image-logic/drag.js";
import { drawHand } from "./general-actions/draw-hand.js";
import { moveCard } from "./image-logic/move-card.js";
import { shuffleButtonFunction } from "./general-actions/shuffle-container.js";
import { removeStadium } from "./setup/clean-up.js";
import { cardPopup } from "./image-logic/click-events.js";
import { addDamageCounter } from "./general-actions/damage-counter.js";
import { stringToVariable } from "./setup/string-to-variable.js";

export * from './setup/buttons.js';

export const socket = io('http://localhost:4000');

document.addEventListener('click', function(){
    cardPopup.style.display = 'none';
});

const selfContainers = document.getElementById('selfContainers');

const selfContainersDocument = selfContainers.contentWindow.document;

containerIds.forEach(id => {
    let container;
    if (id === 'stadium_html'){
        container = document.getElementById(id);
    } else
        container = selfContainersDocument.getElementById(id);
    container.addEventListener('dragover', dragOver);
    container.addEventListener('dragleave', dragLeave);
    container.addEventListener('drop', drop);
});

// Listen for the 'imageAppended' event from the server
socket.on('drawHand', (user, indices) => {
    drawHand(user, indices);
});

socket.on('moveCard', (user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
    moveCard(user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
});

socket.on('shuffleButtonFunction', (user, locationAsString, indices) => {
    shuffleButtonFunction(user, locationAsString, indices);
});

socket.on('removeStadium', () => {
    removeStadium();
});

socket.on('addDamageCounter', (user, location, container, index) => {
    try { addDamageCounter(user, location, container, index);
    } catch (error){
        console.error('An error occurred:', error);
    }
});

socket.on('updateDamageCounter', (user, location, index, textContent) => {
    // Get the damageCounter
    let damageCounter = stringToVariable(user, location).cards[index].image.damageCounter;
    // Update the text content
    damageCounter.textContent = textContent;
});

socket.on('removeDamageCounter', (user, location, index) => {
    const targetCard = stringToVariable(user, location).cards[index];

    targetCard.image.damageCounter.textContent = '0';
    targetCard.image.damageCounter.handleRemove();
});
