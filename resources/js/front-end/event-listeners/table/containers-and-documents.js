import { oppContainersDocument, selfContainersDocument } from '../../front-end.js';
import { closePopups } from '../../actions/general/close-popups.js';
import { dragLeave, dragOver, drop } from '../../image-logic/drag.js';
import { keyDown, keyUp } from '../../key-toggles/key-shortcuts.js';

const addDocumentEventListeners = (document) => {
    document.addEventListener('click', (event) => closePopups(event));
    document.addEventListener('contextmenu', (event) => closePopups(event));
    document.addEventListener('keydown', (event) => keyDown(event));
    document.addEventListener('keyup', (event) => keyUp(event));
}

addDocumentEventListeners(document);
addDocumentEventListeners(selfContainersDocument);
addDocumentEventListeners(oppContainersDocument);

const addContainerEventListeners = (container) => {
    container.addEventListener('dragover', dragOver);
    container.addEventListener('dragleave', dragLeave);
    container.addEventListener('drop', drop);
}

const containerIds = [
    'hand_html',
    'prizes_html',
    'lostzoneDisplay_html',
    'lostzone_html',
    'active_html',
    'bench_html',
    'deckDisplay_html',
    'deck_html',
    'discard_html',
    'discardDisplay_html',
    'stadium_html',
    'board_html',
    'viewCards_html'
];

containerIds.forEach(id => {
    if (id === 'stadium_html'){
        const container = document.getElementById(id);
        addContainerEventListeners(container);
    } else {
        const selfContainer = selfContainersDocument.getElementById(id);
        addContainerEventListeners(selfContainer);
        const oppContainer = oppContainersDocument.getElementById(id);
        addContainerEventListeners(oppContainer);
    };
});