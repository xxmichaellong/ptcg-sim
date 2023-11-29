import { containerIds, selfContainersDocument } from "./setup/initialization.js";
import { dragLeave, dragOver, drop } from "./image-logic/drag.js";
import { drawHand } from "./general-actions/draw-hand.js";
import { moveCard } from "./image-logic/move-card.js";
import { shuffleButtonFunction } from "./general-actions/shuffle-container.js";
import { removeStadium } from "./setup/clean-up.js";
import { cardPopup } from "./image-logic/click-events.js";
import { addDamageCounter } from "./general-actions/damage-counter.js";
import { stringToVariable } from "./setup/string-to-variable.js";
import { addSpecialCondition } from "./general-actions/special-condition.js";
import { oppContainersDocument } from "./setup/opp-initialization.js";
import { socket } from "./setup/socket.js";

export * from './setup/buttons.js';
export * from './start-page/generate-id.js';
export * from './message-box/message-box.js'

document.addEventListener('click', function(){
    cardPopup.style.display = 'none';
});

function addEventListeners(container) {
    container.addEventListener('dragover', dragOver);
    container.addEventListener('dragleave', dragLeave);
    container.addEventListener('drop', drop);
}

containerIds.forEach(id => {
    if (id === 'stadium_html'){
        let container = document.getElementById(id);
        addEventListeners(container);
    } else {
        let selfContainer = selfContainersDocument.getElementById(id);
        addEventListeners(selfContainer);

        let oppContainer = oppContainersDocument.getElementById(id);
        addEventListeners(oppContainer);
    }
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
    addDamageCounter(user, location, container, index);
});

socket.on('updateDamageCounter', (user, location, index, textContent) => {
    let damageCounter = stringToVariable(user, location).cards[index].image.damageCounter;
    damageCounter.textContent = textContent;
});

socket.on('removeDamageCounter', (user, location, index) => {
    const targetCard = stringToVariable(user, location).cards[index];

    targetCard.image.damageCounter.textContent = '0';
    targetCard.image.damageCounter.handleRemove();
});

socket.on('addSpecialCondition', (user, location, container, index) => {
    addSpecialCondition(user, location, container, index);
});

socket.on('updateSpecialCondition', (user, location, index, textContent) => {
    let specialCondition = stringToVariable(user, location).cards[index].image.specialCondition;
    specialCondition.textContent = textContent;
    specialCondition.handleColour();
});

socket.on('removeSpecialCondition', (user, location, index) => {
    const targetCard = stringToVariable(user, location).cards[index];

    targetCard.image.specialCondition.textContent = '0';
    targetCard.image.specialCondition.handleRemove();
});
