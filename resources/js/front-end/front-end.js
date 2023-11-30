import { containerIds, selfContainersDocument } from "./setup/initialization.js";
import { dragLeave, dragOver, drop } from "./image-logic/drag.js";
import { drawHand } from "./general-actions/hand/draw-hand.js";
import { moveCard } from "./image-logic/move-card.js";
import { shuffleButtonFunction } from "./general-actions/shuffle-container.js";
import { removeStadium } from "./setup/clean-up.js";
import { addDamageCounter } from "./general-actions/damage-counter.js";
import { stringToVariable } from "./setup/string-to-variable.js";
import { addSpecialCondition } from "./general-actions/special-condition.js";
import { oppContainersDocument } from "./setup/opp-initialization.js";
import { socket } from "./setup/socket.js";
import { closePopups } from "./setup/close-popups.js";
import { discardAndDraw, draw, shuffleAndDraw, shuffleBottomAndDraw } from "./general-actions/hand/discard-and-draw.js";

export * from './setup/buttons.js';
export * from './start-page/generate-id.js';
export * from './message-box/message-box.js'

//auto close popups if focus is on something else
document.addEventListener('click', closePopups);
selfContainersDocument.addEventListener('click', closePopups);
oppContainersDocument.addEventListener('click', closePopups);
document.addEventListener('contextmenu', closePopups);
selfContainersDocument.addEventListener('contextmenu', closePopups);
oppContainersDocument.addEventListener('contextmenu', closePopups);

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

socket.on('shuffleButtonFunction', (user, location, location_html, indices) => {
    shuffleButtonFunction(user, location, location_html, indices);
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

socket.on('discardAndDraw', (discardAmount, drawAmount) => {
    discardAndDraw('opp', discardAmount, drawAmount);
});
socket.on('shuffleAndDraw', (shuffleAmount, drawAmount, indices) => {
    shuffleAndDraw('opp', shuffleAmount, drawAmount, indices);
});
socket.on('shuffleBottomAndDraw', (shuffleAmount, drawAmount, indices) => {
    shuffleBottomAndDraw('opp', shuffleAmount, drawAmount, indices);
});
socket.on('draw', (drawAmount) => {
    draw('opp', drawAmount);
});