import { containerIds, deck, discard, selfContainersDocument } from "./setup/self-initialization.js";
import { dragLeave, dragOver, drop } from "./image-logic/drag.js";
import { drawHand } from "./general-actions/hand/draw-hand.js";
import { moveCard } from "./image-logic/move-card.js";
import { shuffleContainer } from "./general-actions/shuffle-container.js";
import { addDamageCounter } from "./general-actions/damage-counter.js";
import { stringToVariable } from "./setup/string-to-variable.js";
import { addSpecialCondition } from "./general-actions/special-condition.js";
import { oppContainersDocument } from "./setup/opp-initialization.js";
import { socket } from "./setup/socket.js";
import { closePopups } from "./setup/close-popups.js";
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from "./general-actions/hand/discard-and-draw.js";
import { draw, keyDraw, viewDeck } from "./general-actions/deck-actions.js";
import { discardAll } from "./general-actions/discard-all.js";

export * from './setup/buttons.js';
export * from './start-page/generate-id.js';
export * from './message-box/message-box.js'

//draw cards with keypress
document.addEventListener('keydown', (event) => {keyDraw(event)});
selfContainersDocument.addEventListener('keydown', (event) => {keyDraw(event)});
oppContainersDocument.addEventListener('keydown', (event) => {keyDraw(event)});

//auto close popups if focus is on something else
document.addEventListener('click', (event) => {closePopups(event)});
selfContainersDocument.addEventListener('click', (event) => {closePopups(event)});
oppContainersDocument.addEventListener('click', (event) => {closePopups(event)});
document.addEventListener('contextmenu', (event) => {closePopups(event)});
selfContainersDocument.addEventListener('contextmenu', (event) => {closePopups(event)});
oppContainersDocument.addEventListener('contextmenu', (event) => {closePopups(event)});

function addEventListeners(container){
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

socket.on('shuffleContainer', (user, location, location_html, indices) => {
    shuffleContainer(user, location, location_html, indices);
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
socket.on('viewDeck', (user, viewAmount, targetOpp, top, deckCount) => {
    viewDeck(user, viewAmount, targetOpp, top, deckCount);
});
socket.on('discardAll', (user, discardAmount) => {
    discardAll(user, discardAmount);
});