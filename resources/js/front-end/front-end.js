import { containerIds } from "./setup/initialization.js";
import { dragOver, drop } from "./image-logic/drag.js";
import { drawHand } from "./general-actions/draw-hand.js";
import { moveCard } from "./image-logic/move-card.js";

export * from './setup/buttons.js';

export const socket = io('http://localhost:4000');

const mainContainers = document.getElementById('mainContainers');

const mainContainersDocument = mainContainers.contentWindow.document;

containerIds.forEach(id => {
    let container;
    if (id === 'stadium_html'){
        container = document.getElementById(id);
    } else
        container = mainContainersDocument.getElementById(id);
    container.addEventListener("dragover", dragOver);
    container.addEventListener("drop", drop);
});

// Listen for the 'imageAppended' event from the server
socket.on('drawHand', (user, indices) => {
    drawHand(user, indices);
});

socket.on('moveCard', (user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
    moveCard(user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
});
